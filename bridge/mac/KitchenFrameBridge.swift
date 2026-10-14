// Kitchen Frame Reminders bridge: keeps chosen Apple Reminders lists in step with the frame.
//
// Runs in the background on a Mac signed in to iCloud (a LaunchAgent; see install.sh and
// docs/lists.md). It reads and changes Reminders with Apple's EventKit, the only supported way in:
//   - whenever a chosen list changes (Siri, a phone, the watch), it sends the list to the Worker;
//   - the Worker pushes the frame's changes (an item ticked off, items added) over a WebSocket, and
//     this applies them to Reminders, then reports which ones it applied;
//   - every 5 minutes it checks in anyway, so the frame knows the Mac is alive.
// Which Reminders list feeds which frame list comes from the Worker's settings (GROCERIES_SOURCE,
// REMINDERS_GROCERIES_LIST, ...). This only needs the Worker's address and BRIDGE_TOKEN:
//   ~/Library/Application Support/KitchenFrameBridge/config.json  {"worker": "https://…", "token": "…"}
//
// Run with --check to ask for Reminders access and log the lists it can see, then exit.
import EventKit
import Foundation

let supportDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/KitchenFrameBridge")
let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/KitchenFrameBridge.log")

func log(_ s: String) {
  let line = ISO8601DateFormatter().string(from: Date()) + " " + s + "\n"
  if isatty(STDERR_FILENO) != 0 { FileHandle.standardError.write(line.data(using: .utf8)!) }
  if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
  else { try? line.write(to: logURL, atomically: true, encoding: .utf8) }
}

struct Config: Decodable { let worker: String; let token: String }

final class Bridge: NSObject, URLSessionWebSocketDelegate {
  let store = EKEventStore()
  let cfg: Config
  var session: URLSession!
  var lists: [String: String] = [:]   // frame list (groceries, todo) -> Reminders list name
  var configAt = Date.distantPast
  var toAck: [String] = []           // ops applied here, not yet reported to the Worker
  var doneOps: [String] = []         // ops applied recently, so a repeat is never applied twice
  var syncing = false, again = false
  var socket: URLSessionWebSocketTask?
  var backoff: TimeInterval = 5
  var pending: DispatchWorkItem?

  init(cfg: Config) {
    self.cfg = cfg
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue.main)
    let saved = (try? JSONDecoder().decode([String: [String]].self, from: Data(contentsOf: supportDir.appendingPathComponent("ops.json")))) ?? [:]
    toAck = saved["toAck"] ?? []
    doneOps = saved["done"] ?? []
  }

  func saveOps() {
    let data = try? JSONEncoder().encode(["toAck": toAck, "done": Array(doneOps.suffix(500))])
    try? data?.write(to: supportDir.appendingPathComponent("ops.json"), options: .atomic)
  }

  // MARK: Reminders access

  func requestAccess() async -> Bool {
    do {
      if #available(macOS 14.0, *) { return try await store.requestFullAccessToReminders() }
      return try await store.requestAccess(to: .reminder)
    } catch {
      log("Reminders access failed: \(error.localizedDescription)")
      return false
    }
  }

  func calendar(named name: String) -> EKCalendar? {
    store.calendars(for: .reminder).first { $0.title.compare(name, options: [.caseInsensitive]) == .orderedSame }
  }

  func incomplete(in cal: EKCalendar) async -> [EKReminder] {
    await withCheckedContinuation { cont in
      store.fetchReminders(matching: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [cal])) { cont.resume(returning: $0 ?? []) }
    }
  }

  // MARK: Worker

  func request(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
    var req = URLRequest(url: URL(string: cfg.worker.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!)
    req.httpMethod = method
    req.setValue("Bearer " + cfg.token, forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = body
    req.timeoutInterval = 30
    let (data, res) = try await session.data(for: req)
    let status = (res as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw NSError(domain: "worker", code: status, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): " + String(decoding: data.prefix(200), as: UTF8.self)]) }
    return data
  }

  func loadConfig() async throws {
    let data = try await request("/api/bridge/config")
    let r = try JSONDecoder().decode([String: [String: String]].self, from: data)
    let next = r["lists"] ?? [:]
    if next != lists { log("Lists from the Worker: " + (next.isEmpty ? "none set to Reminders" : next.map { "\($0.key) ← \"\($0.value)\"" }.sorted().joined(separator: ", "))) }
    lists = next
    configAt = Date()
  }

  // MARK: Sync

  // Coalesces bursts (one Siri add fires several change notifications) into one run.
  func soon(_ delay: TimeInterval = 2) {
    pending?.cancel()
    let work = DispatchWorkItem { Task { await self.sync() } }
    pending = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  @MainActor func sync() async {
    if syncing { again = true; return }
    syncing = true
    defer { syncing = false }
    repeat {
      again = false
      do { try await syncOnce() } catch { log("Sync failed: \(error.localizedDescription)") }
    } while again
  }

  func syncOnce() async throws {
    if Date().timeIntervalSince(configAt) > 3600 { try await loadConfig() }
    var payload: [String: Any] = [:]
    var cals: [String: EKCalendar] = [:]
    for (list, name) in lists {
      guard let cal = calendar(named: name) else { log("No Reminders list named \"\(name)\" (for \(list)). Check the name, and that iCloud Reminders is on."); continue }
      cals[list] = cal
      let items = await incomplete(in: cal)
        .sorted { a, b in
          // Tasks: dated first (soonest on top). Groceries: the order they were added.
          if list == "todo" {
            let da = day(a.dueDateComponents) ?? "9999", db = day(b.dueDateComponents) ?? "9999"
            if da != db { return da < db }
          }
          return (a.creationDate ?? .distantPast) < (b.creationDate ?? .distantPast)
        }
        .map { r -> [String: String] in
          var item = ["id": r.calendarItemIdentifier, "title": r.title ?? ""]
          if let d = day(r.dueDateComponents) { item["due"] = d }
          if let n = r.notes?.split(whereSeparator: \.isNewline).first.map(String.init), !n.isEmpty { item["note"] = n }
          return item
        }
      payload[list] = ["name": cal.title, "items": items]
    }
    let acking = toAck
    let body = try JSONSerialization.data(withJSONObject: ["lists": payload, "applied": acking])
    let data = try await request("/api/bridge/snapshot", method: "POST", body: body)
    toAck.removeAll { acking.contains($0) }
    saveOps()

    let ops = ((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["ops"] as? [[String: Any]]) ?? []
    var changed = false
    for op in ops {
      guard let id = op["id"] as? String, let list = op["list"] as? String, let type = op["type"] as? String else { continue }
      if doneOps.contains(id) { if !toAck.contains(id) { toAck.append(id) }; continue }
      guard let cal = cals[list] else { continue }
      do {
        if type == "add", let title = op["content"] as? String {
          let r = EKReminder(eventStore: store)
          r.title = title
          if let note = op["description"] as? String, !note.isEmpty { r.notes = note }
          r.calendar = cal
          try store.save(r, commit: true)
          log("Added \"\(title)\" to \(cal.title)")
        } else if type == "complete", let itemId = op["itemId"] as? String {
          if let r = store.calendarItem(withIdentifier: itemId) as? EKReminder, !r.isCompleted {
            r.isCompleted = true
            try store.save(r, commit: true)
            log("Completed \"\(r.title ?? "")\" in \(cal.title)")
          } // already gone or done in Reminders: nothing to do
        }
        doneOps.append(id)
        toAck.append(id)
        changed = true
      } catch {
        log("Couldn't apply \(type) (\(id)): \(error.localizedDescription)")
      }
    }
    if changed { saveOps(); again = true } // report them, with the lists as they are now
  }

  func day(_ c: DateComponents?) -> String? {
    guard let c = c, let y = c.year, let m = c.month, let d = c.day else { return nil }
    return String(format: "%04d-%02d-%02d", y, m, d)
  }

  // MARK: Live connection

  func connect() {
    var url = cfg.worker.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/bridge/live"
    url = url.replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
    var req = URLRequest(url: URL(string: url)!)
    req.setValue("Bearer " + cfg.token, forHTTPHeaderField: "Authorization")
    let ws = session.webSocketTask(with: req)
    socket = ws
    ws.resume()
    receive(ws)
  }

  func receive(_ ws: URLSessionWebSocketTask) {
    ws.receive { [weak self] result in
      guard let self = self, ws === self.socket else { return }
      switch result {
      case .success:
        self.backoff = 5
        self.soon(0.2) // the frame queued something: pick it up now
        self.receive(ws)
      case .failure(let error):
        log("Live connection dropped (\(error.localizedDescription)); retrying in \(Int(self.backoff))s")
        self.socket = nil
        DispatchQueue.main.asyncAfter(deadline: .now() + self.backoff) { self.connect() }
        self.backoff = min(self.backoff * 2, 300)
      }
    }
  }

  func run() {
    NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in self?.soon() }
    // Heartbeat: check in, and nudge iCloud in case a change notification was missed.
    Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.store.refreshSourcesIfNecessary(); self?.soon(0) }
    // Keep-alive for the live connection (answered by Cloudflare without waking the Worker).
    Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.socket?.send(.string("ping")) { _ in } }
    connect()
    soon(0)
  }
}

// MARK: Main

try? FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
// Keep the log small: past 1 MB, keep its last half.
if let d = try? Data(contentsOf: logURL), d.count > 1_000_000 { try? d.suffix(500_000).write(to: logURL) }
let check = CommandLine.arguments.contains("--check")
guard let data = try? Data(contentsOf: supportDir.appendingPathComponent("config.json")),
      let cfg = try? JSONDecoder().decode(Config.self, from: data) else {
  log("Missing or unreadable \(supportDir.path)/config.json (run install.sh)")
  exit(1)
}
let bridge = Bridge(cfg: cfg)
Task { @MainActor in
  guard await bridge.requestAccess() else {
    log("No access to Reminders. Allow it in System Settings > Privacy & Security > Reminders > KitchenFrameBridge (Full Access).")
    exit(2)
  }
  if check {
    let names = bridge.store.calendars(for: .reminder).map { $0.title }.sorted()
    log("Reminders access OK. Lists on this Mac: " + names.joined(separator: ", "))
    do { try await bridge.loadConfig(); log("Worker reachable.") } catch { log("Worker check failed: \(error.localizedDescription)") }
    exit(0)
  }
  log("Starting; Worker \(cfg.worker)")
  do { try await bridge.loadConfig() } catch { log("Couldn't read the Worker's settings yet: \(error.localizedDescription)") }
  bridge.run()
}
RunLoop.main.run()
