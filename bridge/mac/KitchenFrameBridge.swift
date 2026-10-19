// Kitchen Frame Mac bridge: sends the Worker the Apple things a server can't reach without a public
// link, each only if the Worker's settings ask for it (docs/mac-bridge.md).
//
// Runs in the background on a Mac signed in to iCloud (a LaunchAgent; see install.sh). For Reminders
// lists it reads and changes Reminders with Apple's EventKit, the only supported way in:
//   - whenever a chosen list changes (Siri, a phone, the watch), it sends the list to the Worker;
//   - the Worker pushes the frame's changes (an item ticked off, added or edited) over a WebSocket, and
//     this applies them to Reminders, then reports which ones it applied;
//   - every 5 minutes it checks in anyway, so the frame knows the Mac is alive;
//   - Apple Calendar calendars named in the Worker's CALENDAR_URLS as bridge:<name> are sent too, with
//     their alerts (iCloud's public calendar links leave alerts out): whenever they change, and hourly;
//   - with the Worker's ALBUM_URL set to bridge:<album name>, that shared album's photos, sized for the
//     frame's screen, so the album needs no public link: as Photos on this Mac gets changes, and every
//     10 minutes.
// Which Reminders list feeds which frame list comes from the Worker's settings (GROCERIES_SOURCE,
// REMINDERS_GROCERIES_LIST, ...). This only needs the Worker's address and BRIDGE_TOKEN:
//   ~/Library/Application Support/KitchenFrameBridge/config.json  {"worker": "https://…", "token": "…"}
//
// With REMINDERS_EXTRAS=on on the Worker it also reads sections, flags and assignees from the
// Reminders app's own database (RemindersDB below), which needs Full Disk Access.
//
// With PODCASTS=bridge on the Worker it reads the Podcasts app's library (PodcastsDB below, also Full
// Disk Access): the shows followed, ranked by listening, with their recent and half-played episodes.
// The library is the iPhone's, through iCloud (Podcasts → Settings → Sync Library), so it keeps the
// Podcasts app open in the background here to stay in sync.
//
// Run with --check to ask for Reminders access and log the lists it can see, then exit.
import AppKit
import AVFoundation
import CoreLocation
import EventKit
import Foundation
import Photos
import SQLite3

let supportDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/KitchenFrameBridge")
let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/KitchenFrameBridge.log")

func log(_ s: String) {
  let line = ISO8601DateFormatter().string(from: Date()) + " " + s + "\n"
  if isatty(STDERR_FILENO) != 0 { FileHandle.standardError.write(line.data(using: .utf8)!) }
  if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
  else { try? line.write(to: logURL, atomically: true, encoding: .utf8) }
}

// home (optional, opt-in): photos taken within radius metres of it show "Home" instead of a place
// name. Kept only in this file on the Mac, so the Worker never learns where home is.
struct Home: Decodable { let lat: Double; let lon: Double; let radius: Double? }
struct Config: Decodable { let worker: String; let token: String; let home: Home? }

final class Bridge: NSObject, URLSessionWebSocketDelegate, PHPhotoLibraryChangeObserver {
  let store = EKEventStore()
  let cfg: Config
  var session: URLSession!
  var lists: [String: String] = [:]   // frame list (groceries, todo) -> Reminders list name
  var extras = false                 // REMINDERS_EXTRAS: sections, flags and assignees from RemindersDB
  var calendars: [String: Bool] = [:] // Apple Calendar calendars to send (bridge:<name>) -> send notes too
  var window = (back: 40, ahead: 70)  // days of events to send, from the Worker
  var calendarAccess = false
  var remindersAccess = false
  var sentCalendars = ""              // what was last sent, to send only changes
  var sentCalendarsAt = Date.distantPast
  var photoCfg: (album: String, landscape: Int, portrait: Int)? // the shared album to send, from the Worker
  var clipSeconds = 32.0              // seconds of each video to send (the Worker's photos.clip)
  var photosAccess = false
  var photosSyncing = false
  var sentPhotos = ""                 // the photo list last confirmed complete, to skip unchanged runs
  var sentPhotosAt = Date.distantPast
  var photosWatched = false
  var withPlace = -1                  // photos with a place, last logged
  var lastLookup: Date?
  // Place names by ~10 m square ("35.6012,-82.5543" -> "Asheville, NC"; "" for none), so each place
  // is looked up once; kept across restarts.
  lazy var places: [String: String] = (try? JSONDecoder().decode([String: String].self, from: Data(contentsOf: supportDir.appendingPathComponent("places.json")))) ?? [:]
  var photosSoon: DispatchWorkItem?
  var problems: [String: String] = [:] // what's wrong now, by area, sent with each check-in for the status page

  // Records (or clears, with nil) the current problem in one area, logging it when it changes.
  func problem(_ area: String, _ text: String?) {
    if problems[area] == text { return }
    problems[area] = text
    if let t = text { log(t) }
  }

  // The camera relay (bridge/camera-relay/) runs on this Mac too: is go2rtc's API and the gate up?
  func relayStatus() -> [String: Bool]? {
    let agent = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/local.kitchen-frame.go2rtc.plist")
    guard FileManager.default.fileExists(atPath: agent.path) else { return nil }
    return ["go2rtc": listening(1984), "gate": listening(1985)]
  }
  func listening(_ port: UInt16) -> Bool {
    let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { Darwin.close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = port.bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    return withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 } }
  }
  // When this build was made, so the status page shows which bridge is running.
  lazy var built: String = {
    let d = (try? Bundle.main.executableURL?.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? nil
    return d.map { "built " + ISO8601DateFormatter().string(from: $0) } ?? "unknown"
  }()
  let db = RemindersDB()
  let podcastsDB = PodcastsDB()
  var podcasts = false               // PODCASTS=bridge: send the Podcasts library
  var sentPodcasts = ""              // what was last sent, to send only changes
  var sentPodcastsAt = Date.distantPast
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

  func requestCalendarAccess() async -> Bool {
    do {
      if #available(macOS 14.0, *) { return try await store.requestFullAccessToEvents() }
      return try await store.requestAccess(to: .event)
    } catch {
      log("Calendar access failed: \(error.localizedDescription)")
      return false
    }
  }

  func requestPhotosAccess() async -> Bool {
    let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    return status == .authorized || status == .limited
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

  func request(_ path: String, method: String = "GET", body: Data? = nil, contentType: String = "application/json") async throws -> Data {
    var req = URLRequest(url: URL(string: cfg.worker.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)!)
    req.httpMethod = method
    req.setValue("Bearer " + cfg.token, forHTTPHeaderField: "Authorization")
    req.setValue(contentType, forHTTPHeaderField: "Content-Type")
    req.httpBody = body
    req.timeoutInterval = 30
    let (data, res) = try await session.data(for: req)
    let status = (res as? HTTPURLResponse)?.statusCode ?? 0
    guard status == 200 else { throw NSError(domain: "worker", code: status, userInfo: [NSLocalizedDescriptionKey: "HTTP \(status): " + String(decoding: data.prefix(200), as: UTF8.self)]) }
    return data
  }

  func loadConfig() async throws {
    let data = try await request("/api/bridge/config")
    let r = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    let next = r["lists"] as? [String: String] ?? [:]
    if next != lists { log("Lists from the Worker: " + (next.isEmpty ? "none set to Reminders" : next.map { "\($0.key) ← \"\($0.value)\"" }.sorted().joined(separator: ", "))) }
    lists = next
    // Reminders access is asked for only when a list comes from Reminders (like Calendar and Photos).
    if !lists.isEmpty && !remindersAccess {
      remindersAccess = await requestAccess()
      problem("reminders-access", remindersAccess ? nil : "No access to Reminders. Allow it in System Settings > Privacy & Security > Reminders > KitchenFrameBridge (Full Access).")
    }
    let pods = r["podcasts"] as? Bool ?? false
    if pods != podcasts { log(pods ? "Podcasts on: reading the Podcasts library" : "Podcasts off") }
    podcasts = pods
    let more = r["extras"] as? Bool ?? false
    if more != extras { log(more ? "Extras on: reading sections, flags and assignees from the Reminders database" : "Extras off") }
    extras = more
    let cals = (r["calendars"] as? [String: [String: Any]] ?? [:]).mapValues { $0["notes"] as? Bool ?? false }
    if cals != calendars { log("Calendars from the Worker: " + (cals.isEmpty ? "none" : cals.keys.sorted().map { "\"\($0)\"" }.joined(separator: ", "))) }
    calendars = cals
    if let w = r["window"] as? [String: Int] { window = (w["back"] ?? 40, w["ahead"] ?? 70) }
    if !calendars.isEmpty && !calendarAccess {
      calendarAccess = await requestCalendarAccess()
      problem("calendar-access", calendarAccess ? nil : "No access to Calendar. Allow it in System Settings > Privacy & Security > Calendars > KitchenFrameBridge (Full Access).")
    }
    if let p = r["photos"] as? [String: Any], let album = p["album"] as? String {
      if photoCfg?.album != album { log("Photos from the Worker: the shared album \"\(album)\"") }
      photoCfg = (album, p["landscape"] as? Int ?? 1920, p["portrait"] as? Int ?? 960)
      clipSeconds = (p["clip"] as? Double) ?? Double(p["clip"] as? Int ?? 32)
      if !photosAccess {
        photosAccess = await requestPhotosAccess()
        problem("photos-access", photosAccess ? nil : "No access to Photos. Allow it in System Settings > Privacy & Security > Photos > KitchenFrameBridge.")
        // Hear about album changes as iCloud delivers them, rather than only on the 10-minute timer.
        if photosAccess && !photosWatched { PHPhotoLibrary.shared().register(self); photosWatched = true }
      }
    } else {
      photoCfg = nil
    }
    configAt = Date()
  }

  // iCloud brings this Mac the phone's changes more reliably while the app itself runs: the Podcasts
  // library syncs only then, Reminders (seen 2026-10-17) can go hours without the phone's ticks until
  // the app opens, and Calendar (2026-10-18) held back an event edited on the phone. Each is started
  // hidden when it isn't running (at most every 10 minutes).
  var launchedAt: [String: Date] = [:]
  var refreshedAt = Date.distantPast
  func keepOpen(_ id: String, _ name: String) {
    guard NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty,
          Date().timeIntervalSince(launchedAt[id] ?? .distantPast) > 600,
          let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return }
    launchedAt[id] = Date()
    let how = NSWorkspace.OpenConfiguration()
    how.activates = false
    how.hides = true
    NSWorkspace.shared.openApplication(at: url, configuration: how) { _, error in
      log(error.map { "Couldn't start \(name): \($0.localizedDescription)" } ?? "Started \(name) in the background, to keep it in sync with iCloud")
    }
  }
  func keepPodcastsOpen() { keepOpen("com.apple.podcasts", "Podcasts") }

  // MARK: Photos (ALBUM_URL = bridge:<album name>)

  // Sends the album's photo list; the Worker answers with the ones it doesn't have; uploads those,
  // sized for the screen; sends the list again. The Worker deletes photos that left the album.
  @MainActor func syncPhotos() async {
    guard let pc = photoCfg, photosAccess, !photosSyncing else { return }
    photosSyncing = true
    defer { photosSyncing = false }
    guard let assets = albumAssets(pc.album) else {
      problem("photos", "No album named \"\(pc.album)\" in Photos on this Mac. Check the name, and that Shared Albums is on (Photos > Settings > iCloud).")
      return
    }
    let iso = ISO8601DateFormatter()
    var list: [[String: Any]] = []
    for a in assets {
      var p: [String: Any] = ["id": photoId(a), "w": a.pixelWidth, "h": a.pixelHeight]
      if let d = a.creationDate { p["date"] = iso.string(from: d) }
      if let name = await place(of: a) { p["place"] = name }
      if a.mediaType == .video { p["video"] = true; p["seconds"] = Int(a.duration.rounded()) }
      list.append(p)
    }
    let placed = list.filter { $0["place"] != nil }.count
    if placed != withPlace { log("Places: \(placed) of \(list.count) photos in \"\(pc.album)\" have one"); withPlace = placed }
    let ids = list.map { "\($0["id"] ?? "")|\($0["place"] ?? "")" }.joined(separator: ",")
    if ids == sentPhotos && Date().timeIntervalSince(sentPhotosAt) < 3600 { return }
    log("Album \"\(pc.album)\" changed: \(list.count) photos; sending")
    do {
      var missing = try await postPhotos(list)
      if !missing.isEmpty {
        let byId = Dictionary(assets.map { (photoId($0), $0) }, uniquingKeysWith: { a, _ in a })
        var sent = 0
        for id in missing {
          guard let a = byId[id], let jpg = await jpeg(a, pc) else { continue }
          // One photo that won't go doesn't stop the rest; it's tried again next time.
          do {
            _ = try await request("/api/bridge/photos/" + id, method: "PUT", body: jpg, contentType: "image/jpeg")
            sent += 1
          } catch { log("Photo \(id) not uploaded (\(jpg.count / 1024) KB): \(error.localizedDescription)") }
        }
        log("Uploaded \(sent) of \(missing.count) new photo(s) from \"\(pc.album)\"")
        missing = try await postPhotos(list)
      }
      if missing.isEmpty { sentPhotos = ids; sentPhotosAt = Date() }
      Task { await self.syncVideos() }
      problem("photos", missing.isEmpty ? nil : "\(missing.count) photo(s) from \"\(pc.album)\" couldn't be uploaded; trying again in 10 minutes")
    } catch {
      problem("photos", "Photos sync failed: \(error.localizedDescription)")
    }
  }

  // Photos changed on this Mac (iCloud brought a new photo, say): look again in 15 s, so a burst of
  // changes (several photos added at once) is one look.
  func photoLibraryDidChange(_ changeInstance: PHChange) {
    DispatchQueue.main.async {
      self.photosSoon?.cancel()
      let work = DispatchWorkItem { Task { await self.syncPhotos() } }
      self.photosSoon = work
      DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: work)
    }
  }

  func postPhotos(_ list: [[String: Any]]) async throws -> [String] {
    let data = try await request("/api/bridge/photos", method: "POST", body: try JSONSerialization.data(withJSONObject: ["photos": list]))
    let r = (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    // Videos the Worker doesn't have yet (an experiment: video in the slideshow). Sent after the
    // stills, one at a time, so they never hold up photos.
    if let videos = r["missingVideos"] as? [String], !videos.isEmpty { pendingVideos = videos }
    return (r["missing"] as? [String]) ?? []
  }

  // MARK: Videos (experimental)

  var pendingVideos: [String] = []
  var videosSyncing = false

  // Sends each album video the Worker asks for as an MP4 with its index at the front, so playback can
  // start before the whole file has arrived. Logs the original's format, for comparing.
  @MainActor func syncVideos() async {
    guard !videosSyncing, !pendingVideos.isEmpty, let pc = photoCfg, let assets = albumAssets(pc.album) else { return }
    videosSyncing = true
    defer { videosSyncing = false }
    let byId = Dictionary(assets.map { (photoId($0), $0) }, uniquingKeysWith: { a, _ in a })
    for id in pendingVideos {
      guard let a = byId[id], a.mediaType == .video else { continue }
      if let info = await videoInfo(a) { log("Video \(id): original \(info)") }
      let started = Date()
      guard let file = await exportVideo(a) else { log("Video \(id): couldn't re-encode it"); continue }
      defer { try? FileManager.default.removeItem(at: file) }
      guard let data = try? Data(contentsOf: file) else { continue }
      log("Video \(id): prepared, \(data.count / 1024) KB, in \(Int(Date().timeIntervalSince(started))) s")
      do {
        _ = try await request("/api/bridge/videos/" + id, method: "PUT", body: data, contentType: "video/mp4")
        log("Video \(id): uploaded")
      } catch { log("Video \(id) not uploaded: \(error.localizedDescription)") }
    }
    pendingVideos = []
  }

  func videoInfo(_ a: PHAsset) async -> String? {
    let o = PHVideoRequestOptions()
    o.isNetworkAccessAllowed = true
    let asset: AVAsset? = await withCheckedContinuation { cont in PHImageManager.default().requestAVAsset(forVideo: a, options: o) { av, _, _ in cont.resume(returning: av) } }
    guard let av = asset, let track = try? await av.loadTracks(withMediaType: .video).first else { return nil }
    let size = (try? await track.load(.naturalSize)) ?? .zero
    let rate = (try? await track.load(.estimatedDataRate)) ?? 0
    let fmt = (try? await track.load(.formatDescriptions))?.first
    let codec = fmt.map { f -> String in
      let c = CMFormatDescriptionGetMediaSubType(f)
      return String(bytes: [24, 16, 8, 0].map { UInt8((c >> $0) & 0xff) }, encoding: .ascii) ?? "?"
    } ?? "?"
    return "\(Int(size.width))x\(Int(size.height)) \(codec) \(Int(rate / 1000)) kbit/s \(Int(a.duration)) s"
  }

  // The first clipSeconds (from the Worker) of the video's picture, without its sound: the slideshow
  // shows a video muted and moves on after its slide time, so the rest would only cost storage and the frame's Wi-Fi, and it
  // keeps any video under the Worker's size limit however long it is. Not re-encoded: the shared
  // album's copy is already H.264 at 720p (Apple's own presets re-encoded it larger).
  func exportVideo(_ a: PHAsset) async -> URL? {
    let o = PHVideoRequestOptions()
    o.isNetworkAccessAllowed = true
    o.deliveryMode = .highQualityFormat
    let asset: AVAsset? = await withCheckedContinuation { cont in PHImageManager.default().requestAVAsset(forVideo: a, options: o) { av, _, _ in cont.resume(returning: av) } }
    guard let av = asset, let track = try? await av.loadTracks(withMediaType: .video).first else { return nil }
    let length = (try? await av.load(.duration)) ?? .zero
    let range = CMTimeRange(start: .zero, duration: CMTimeMinimum(length, CMTime(seconds: clipSeconds, preferredTimescale: 600)))
    let comp = AVMutableComposition()
    guard let out = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { return nil }
    do { try out.insertTimeRange(range, of: track, at: .zero) } catch { log("Video clip: \(error.localizedDescription)"); return nil }
    out.preferredTransform = (try? await track.load(.preferredTransform)) ?? .identity
    guard let s = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetPassthrough) else { return nil }
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
    s.outputURL = file
    s.outputFileType = .mp4
    s.shouldOptimizeForNetworkUse = true
    await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in s.exportAsynchronously { cont.resume() } }
    if s.status != .completed { log("Video export: \(s.error?.localizedDescription ?? "status \(s.status.rawValue)")"); return nil }
    return file
  }


  // The album's photos, newest first (at most 500). Shared albums are albums to Photos, too.
  func albumAssets(_ name: String) -> [PHAsset]? {
    var found: PHAssetCollection?
    PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil).enumerateObjects { c, _, stop in
      if (c.localizedTitle ?? "").compare(name, options: [.caseInsensitive]) == .orderedSame { found = c; stop.pointee = true }
    }
    guard let album = found else { return nil }
    let opts = PHFetchOptions()
    opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    var out: [PHAsset] = []
    PHAsset.fetchAssets(in: album, options: opts).enumerateObjects { a, _, stop in
      out.append(a)
      if out.count >= 500 { stop.pointee = true }
    }
    return out
  }

  // A JPEG of exactly the size wanted, in pixels. Photos can hand back a Retina (2x) image for the
  // size asked, which came out over the Worker's 1 MB limit; drawing into a bitmap of the target
  // size fixes that. Lower quality is tried if it's still over 900 KB.
  func encode(_ cg: CGImage, fitting size: CGSize) -> Data? {
    let scale = min(1, size.width / CGFloat(cg.width), size.height / CGFloat(cg.height))
    let w = max(1, Int((CGFloat(cg.width) * scale).rounded())), h = max(1, Int((CGFloat(cg.height) * scale).rounded()))
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
    ctx.interpolationQuality = .high
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    guard let out = ctx.makeImage() else { return nil }
    let rep = NSBitmapImageRep(cgImage: out)
    for q in [0.8, 0.65, 0.5] {
      if let d = rep.representation(using: .jpeg, properties: [.compressionFactor: q]), d.count <= 900 * 1024 { return d }
    }
    return nil
  }

  // Where a photo was taken: the place of interest Apple's geocoder knows there, with its town
  // ("Golden Gate Park, San Francisco"), else the town ("Asheville, NC"), with the country when it
  // isn't this Mac's. Close to what Photos shows, though Photos has its own place names it doesn't share.
  // Looked up from the photo's own location (a place of interest needs it), and cached by ~10 m;
  // only the name leaves the Mac, never the coordinates. nil for a photo with no location.
  func place(of a: PHAsset) async -> String? {
    guard let loc = a.location else { return nil }
    if let h = cfg.home, loc.distance(from: CLLocation(latitude: h.lat, longitude: h.lon)) <= (h.radius ?? 150) { return "Home" }
    let key = String(format: "%.4f,%.4f", loc.coordinate.latitude, loc.coordinate.longitude)
    if let known = places[key] { return known.isEmpty ? nil : known }
    // Apple's geocoder allows about one lookup a second; new places only, so this is rare.
    if let last = lastLookup, Date().timeIntervalSince(last) < 1.2 { try? await Task.sleep(nanoseconds: 1_200_000_000) }
    lastLookup = Date()
    // Not cached when the lookup fails (offline, rate-limited): tried again next time.
    guard let mark = try? await CLGeocoder().reverseGeocodeLocation(loc).first else { return nil }
    let town = mark.locality ?? mark.subAdministrativeArea
    var parts: [String]
    if let poi = mark.areasOfInterest?.first, !poi.isEmpty, poi.caseInsensitiveCompare(town ?? "") != .orderedSame {
      // The town only when the name doesn't already say it ("Riverside Springfield", not "…, Springfield").
      parts = [poi] + (town.map { poi.localizedCaseInsensitiveContains($0) ? [] : [$0] } ?? [])
    } else {
      // No place of interest, or it's the town itself ("Key West"): the town and state.
      parts = [town, mark.administrativeArea].compactMap { $0 }
    }
    if let c = mark.isoCountryCode, c != Locale.current.region?.identifier, let country = mark.country { parts.append(country) }
    let name = parts.joined(separator: ", ")
    places[key] = name
    if let data = try? JSONEncoder().encode(places) { try? data.write(to: supportDir.appendingPathComponent("places.json"), options: .atomic) }
    return name.isEmpty ? nil : name
  }

  // A photo's id on the frame: its Photos id plus when it was last edited, so an edit is a new photo.
  func photoId(_ a: PHAsset) -> String {
    let base = String(a.localIdentifier.split(separator: "/").first ?? "").filter { $0.isLetter || $0.isNumber || $0 == "-" }
    return base + "-" + String(Int((a.modificationDate ?? a.creationDate ?? Date(timeIntervalSince1970: 0)).timeIntervalSince1970), radix: 36)
  }

  // The photo as a JPEG sized for the screen: a landscape the screen's width, a portrait half of it
  // (they show in pairs). A video gives its still. Downloads from iCloud when the Mac hasn't it yet.
  func jpeg(_ a: PHAsset, _ pc: (album: String, landscape: Int, portrait: Int)) async -> Data? {
    let width = Double(a.pixelHeight > a.pixelWidth ? pc.portrait : pc.landscape)
    let scale = min(1, width / Double(max(a.pixelWidth, 1)))
    let size = CGSize(width: (Double(a.pixelWidth) * scale).rounded(), height: (Double(a.pixelHeight) * scale).rounded())
    let o = PHImageRequestOptions()
    o.isNetworkAccessAllowed = true
    o.deliveryMode = .highQualityFormat
    o.resizeMode = .exact
    return await withCheckedContinuation { cont in
      var done = false
      PHImageManager.default().requestImage(for: a, targetSize: size, contentMode: .aspectFit, options: o) { img, info in
        if done || (info?[PHImageResultIsDegradedKey] as? Bool) == true { return }
        done = true
        guard let img = img, let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
          log("Couldn't get photo \(a.localIdentifier): \((info?[PHImageErrorKey] as? Error)?.localizedDescription ?? "no image")")
          cont.resume(returning: nil)
          return
        }
        cont.resume(returning: self.encode(cg, fitting: size))
      }
    }
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
    // Which lists to sync can change on the Worker; re-read it at most every 5 minutes.
    if Date().timeIntervalSince(configAt) > 290 { try await loadConfig() }
    var payload: [String: Any] = [:]
    var cals: [String: EKCalendar] = [:]
    let more = extras ? db.read(lists: Array(lists.values)) : [:]
    if !lists.isEmpty && remindersAccess {
      keepOpen("com.apple.reminders", "Reminders")
      // And ask iCloud for changes now and then (EventKit's own nudge; harmless when nothing's new).
      if Date().timeIntervalSince(refreshedAt) > 240 { refreshedAt = Date(); store.refreshSourcesIfNecessary() }
    }
    for (list, name) in lists where remindersAccess {
      guard let cal = calendar(named: name) else { problem("list:" + list, "No Reminders list named \"\(name)\" (for \(list)). Check the name, and that iCloud Reminders is on."); continue }
      problem("list:" + list, nil)
      cals[list] = cal
      let items = await incomplete(in: cal)
        .sorted { a, b in
          // Tasks: dated first (soonest on top; within a day, untimed then by time). Groceries: the
          // order they were added.
          if list == "todo" {
            let da = when(a.dueDateComponents), db = when(b.dueDateComponents)
            if da != db { return da < db }
          }
          return (a.creationDate ?? .distantPast) < (b.creationDate ?? .distantPast)
        }
        .map { r -> [String: Any] in
          var item: [String: Any] = ["id": r.calendarItemIdentifier, "title": r.title ?? ""]
          if let d = day(r.dueDateComponents) { item["due"] = d }
          if let t = clock(r.dueDateComponents) { item["time"] = t }
          if level(r.priority) > 0 { item["priority"] = level(r.priority) }
          if let x = more[cal.title.lowercased()]?.items[r.calendarItemIdentifier] {
            if let v = x.section { item["section"] = v }
            if x.flagged { item["flagged"] = true }
            if let v = x.assignee { item["assignee"] = v }
          }
          if let n = r.notes?.split(whereSeparator: \.isNewline).first.map(String.init), !n.isEmpty { item["note"] = n }
          return item
        }
      payload[list] = ["name": cal.title, "items": items, "sections": more[cal.title.lowercased()]?.sections ?? []]
    }
    let acking = toAck
    // Extras that can't be read (Full Disk Access off) are a problem worth showing too.
    if extras { problems["extras"] = db.lastProblem.isEmpty ? nil : "Extras: " + db.lastProblem } else { problems["extras"] = nil }
    var status: [String: Any] = ["problems": problems.keys.sorted().compactMap { problems[$0] }, "version": built]
    if let r = relayStatus() { status["relay"] = r }
    var bodyObj: [String: Any] = ["lists": payload, "applied": acking, "status": status]
    // Calendars: only when they changed, or hourly so the Worker knows they're current.
    var calText = ""
    if calendarAccess && !calendars.isEmpty {
      let cals = calendarsPayload()
      calText = String(decoding: (try? JSONSerialization.data(withJSONObject: cals, options: [.sortedKeys])) ?? Data(), as: UTF8.self)
      if calText != sentCalendars || Date().timeIntervalSince(sentCalendarsAt) > 3600 { bodyObj["calendars"] = cals }
    }
    // Podcasts: when the library changed (something played, a new episode), or hourly.
    var podText = ""
    if podcasts {
      keepPodcastsOpen()
      let shows = podcastsDB.read()
      problem("podcasts", podcastsDB.lastProblem.isEmpty ? nil : "Podcasts: " + podcastsDB.lastProblem)
      podText = String(decoding: (try? JSONSerialization.data(withJSONObject: shows, options: [.sortedKeys])) ?? Data(), as: UTF8.self)
      if !shows.isEmpty && (podText != sentPodcasts || Date().timeIntervalSince(sentPodcastsAt) > 3600) { bodyObj["podcasts"] = shows }
    } else { problem("podcasts", nil) }
    let body = try JSONSerialization.data(withJSONObject: bodyObj)
    let data = try await request("/api/bridge/snapshot", method: "POST", body: body)
    if bodyObj["podcasts"] != nil {
      if podText != sentPodcasts { log("Sent podcasts: \((bodyObj["podcasts"] as? [Any])?.count ?? 0) shows") }
      sentPodcasts = podText; sentPodcastsAt = Date()
    }
    if bodyObj["calendars"] != nil {
      if calText != sentCalendars { log("Sent calendars: " + calendars.keys.sorted().joined(separator: ", ")) }
      sentCalendars = calText; sentCalendarsAt = Date()
    }
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
          if let p = op["priority"] as? Int, (1...3).contains(p) { r.priority = [0, 9, 5, 1][p] }
          r.calendar = cal
          try store.save(r, commit: true)
          log("Added \"\(title)\" to \(cal.title)")
        } else if type == "update", let itemId = op["itemId"] as? String {
          if let r = store.calendarItem(withIdentifier: itemId) as? EKReminder {
            if let title = op["content"] as? String, !title.isEmpty { r.title = title }
            if let p = op["priority"] as? Int, (0...3).contains(p) { r.priority = [0, 9, 5, 1][p] }
            try store.save(r, commit: true)
            log("Updated \"\(r.title ?? "")\" in \(cal.title)")
          } // gone from Reminders: nothing to do
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

  // The chosen calendars' events in the Worker's window, repeats expanded (one entry per occurrence),
  // each with its alerts in minutes before the start. uid is the iCloud event's own id, the same as
  // in its calendar link, so reminders already said aren't said again after switching over.
  func calendarsPayload() -> [String: [[String: Any]]] {
    let now = Date(), cal = Calendar.current
    let from = now.addingTimeInterval(-Double(window.back) * 86400), to = now.addingTimeInterval(Double(window.ahead) * 86400)
    let iso = ISO8601DateFormatter()
    let dayFmt = DateFormatter()
    dayFmt.calendar = Calendar(identifier: .gregorian); dayFmt.locale = Locale(identifier: "en_US_POSIX"); dayFmt.timeZone = .current
    dayFmt.dateFormat = "yyyy-MM-dd"
    var out: [String: [[String: Any]]] = [:]
    if !calendars.isEmpty { keepOpen("com.apple.iCal", "Calendar") }
    for (name, notes) in calendars {
      guard let c = store.calendars(for: .event).first(where: { $0.title.compare(name, options: [.caseInsensitive]) == .orderedSame }) else {
        problem("calendar:" + name, "No calendar named \"\(name)\" on this Mac. Check the name, and that iCloud Calendars is on.")
        continue
      }
      problem("calendar:" + name, nil)
      out[name] = store.events(matching: store.predicateForEvents(withStart: from, end: to, calendars: [c]))
        .filter { $0.status != .canceled }
        .sorted { $0.startDate < $1.startDate }
        .map { e -> [String: Any] in
          var o: [String: Any] = ["uid": e.calendarItemExternalIdentifier ?? e.eventIdentifier ?? UUID().uuidString, "title": e.title ?? "", "allDay": e.isAllDay]
          if e.isAllDay {
            // All-day: plain dates, the end exclusive (EventKit ends them at 23:59:59 on the last day).
            o["start"] = dayFmt.string(from: e.startDate)
            o["end"] = dayFmt.string(from: cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: e.endDate)) ?? e.endDate)
          } else {
            o["start"] = iso.string(from: e.startDate)
            o["end"] = iso.string(from: e.endDate)
          }
          if let l = e.location, !l.isEmpty { o["location"] = l }
          if notes, let n = e.notes, !n.isEmpty { o["notes"] = n }
          let alarms = (e.alarms ?? []).filter { $0.absoluteDate == nil }.map { Int((-$0.relativeOffset / 60).rounded()) }
          if !alarms.isEmpty { o["alarms"] = alarms }
          return o
        }
    }
    return out
  }

  func day(_ c: DateComponents?) -> String? {
    guard let c = c, let y = c.year, let m = c.month, let d = c.day else { return nil }
    return String(format: "%04d-%02d-%02d", y, m, d)
  }

  // A timed reminder's time, "16:30"; nil for one due on a day with no time.
  func clock(_ c: DateComponents?) -> String? {
    guard day(c) != nil, let h = c?.hour, let m = c?.minute else { return nil }
    return String(format: "%02d:%02d", h, m)
  }

  func when(_ c: DateComponents?) -> String { (day(c) ?? "9999") + (clock(c) ?? "") }

  // Reminders' priority (1–4 high, 5 medium, 6–9 low, 0 none; the app uses 1, 5 and 9) on the frame's
  // scale: 3 high, 2 medium, 1 low, 0 none. Adds from the frame go the other way: 3 → 1, 2 → 5, 1 → 9.
  func level(_ p: Int) -> Int { p == 0 ? 0 : p <= 4 ? 3 : p == 5 ? 2 : 1 }

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
    // Photos: their own loop, so uploads never hold up the lists.
    Timer.scheduledTimer(withTimeInterval: 600, repeats: true) { [weak self] _ in Task { await self?.syncPhotos() } }
    Task { await self.syncPhotos() }
    // Keep-alive for the live connection (answered by Cloudflare without waking the Worker).
    Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in self?.socket?.send(.string("ping")) { _ in } }
    connect()
    soon(0)
  }
}

// MARK: Reminders database (REMINDERS_EXTRAS)

// EventKit leaves out sections (such as the grocery template's aisles), flags and assignees. The
// Reminders app keeps them in its own SQLite database, which this reads, and only reads, when the
// bridge has Full Disk Access. It isn't an API: a macOS update can change it, and then these are left
// out (said once in the log) while everything else carries on through EventKit.
struct Extra { var section: String?; var flagged = false; var assignee: String? }

final class RemindersDB {
  let stores = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Group Containers/group.com.apple.reminders/Container_v1/Stores")
  var lastProblem = ""

  func problem(_ s: String) {
    if s != lastProblem { log("Extras: " + s) }
    lastProblem = s
  }

  // Lower-cased list name -> its sections (in Reminders' order) and extras by EventKit item id.
  func read(lists names: [String]) -> [String: (sections: [String], items: [String: Extra])] {
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: stores.path) else {
      problem("can't read the Reminders database. Give KitchenFrameBridge Full Disk Access (System Settings > Privacy & Security > Full Disk Access); it's picked up within 5 minutes.")
      return [:]
    }
    var out: [String: (sections: [String], items: [String: Extra])] = [:]
    var failed = ""
    for f in files.sorted() where f.hasPrefix("Data-") && f.hasSuffix(".sqlite") {
      var db: OpaquePointer?
      guard sqlite3_open_v2(stores.appendingPathComponent(f).path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { sqlite3_close(db); continue }
      defer { sqlite3_close(db) }
      for name in names where out[name.lowercased()] == nil {
        do { if let r = try readList(db, name) { out[name.lowercased()] = r } } catch { failed = "\(error)" }
      }
    }
    if out.isEmpty && !failed.isEmpty { problem("the Reminders database has changed shape (\(failed)); sections, flags and assignees are left out") }
    else if !out.isEmpty { lastProblem = "" }
    return out
  }

  func readList(_ db: OpaquePointer?, _ name: String) throws -> (sections: [String], items: [String: Extra])? {
    guard let list = try rows(db, "select Z_PK, cast(ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA as text) from ZREMCDBASELIST where ZNAME = ? collate nocase and ifnull(ZMARKEDFORDELETION, 0) = 0 limit 1", [name]).first,
          let pk = list[0] else { return nil }
    // Sections, oldest first (the order Reminders shows a template's sections in).
    var sectionName: [String: String] = [:], order: [String] = []
    for r in try rows(db, "select ZCKIDENTIFIER, ZDISPLAYNAME from ZREMCDBASESECTION where ZLIST = ? and ifnull(ZMARKEDFORDELETION, 0) = 0 order by ZCREATIONDATE", [pk]) {
      if let id = r[0], let n = r[1] { sectionName[id] = n; order.append(n) }
    }
    // Which section each reminder is in: the list's membership record, latest entry per reminder.
    var inSection: [String: (String, Double)] = [:]
    if let json = list[1], let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], let ms = obj["memberships"] as? [[String: Any]] {
      for m in ms {
        guard let member = m["memberID"] as? String, let group = m["groupID"] as? String else { continue }
        let at = m["modifiedOn"] as? Double ?? 0
        if (inSection[member]?.1 ?? -1) < at { inSection[member] = (group, at) }
      }
    }
    // Assignees (shared lists): an assignment row points at the reminder and at a sharee (a person).
    var assignee: [String: String] = [:]
    for r in try rows(db, """
      select a.ZREMINDER1, coalesce(nullif(s.ZFIRSTNAME, ''), nullif(s.ZNICKNAME, ''), s.ZDISPLAYNAME)
      from ZREMCDOBJECT a join ZREMCDOBJECT s on s.Z_PK = a.ZASSIGNEE
      where a.Z_ENT = (select Z_ENT from Z_PRIMARYKEY where Z_NAME = 'REMCDAssignment') and ifnull(a.ZMARKEDFORDELETION, 0) = 0
      """, []) {
      if let r1 = r[0], let who = r[1] { assignee[r1] = who }
    }
    var items: [String: Extra] = [:]
    for r in try rows(db, "select Z_PK, ZDACALENDARITEMUNIQUEIDENTIFIER, ZCKIDENTIFIER, ZFLAGGED from ZREMCDREMINDER where ZLIST = ? and ZCOMPLETED = 0 and ifnull(ZMARKEDFORDELETION, 0) = 0", [pk]) {
      guard let id = r[1] else { continue }
      let section = r[2].flatMap { inSection[$0] }.flatMap { sectionName[$0.0] }
      let x = Extra(section: section, flagged: r[3] == "1", assignee: r[0].flatMap { assignee[$0] })
      if x.section != nil || x.flagged || x.assignee != nil { items[id] = x }
    }
    return (order, items)
  }

  func rows(_ db: OpaquePointer?, _ sql: String, _ args: [String]) throws -> [[String?]] { try sqliteRows(db, sql, args) }
}

// Runs a query and returns each row's columns as text.
func sqliteRows(_ db: OpaquePointer?, _ sql: String, _ args: [String]) throws -> [[String?]] {
  var st: OpaquePointer?
  guard sqlite3_prepare_v2(db, sql, -1, &st, nil) == SQLITE_OK else { throw NSError(domain: "sqlite", code: 1, userInfo: [NSLocalizedDescriptionKey: String(cString: sqlite3_errmsg(db))]) }
  defer { sqlite3_finalize(st) }
  let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  for (i, a) in args.enumerated() { sqlite3_bind_text(st, Int32(i + 1), a, -1, transient) }
  var out: [[String?]] = []
  while sqlite3_step(st) == SQLITE_ROW {
    out.append((0..<sqlite3_column_count(st)).map { c in sqlite3_column_text(st, c).map { String(cString: $0) } })
  }
  return out
}

// MARK: Podcasts database (PODCASTS=bridge)

// Apple has no API for a podcast library. The Podcasts app keeps it (the iPhone's, through iCloud) in
// its own SQLite database, which this reads, and only reads, with Full Disk Access. Like the Reminders
// one it isn't an API: a macOS update can change it, and then podcasts are left out (said in the log
// and on the status page). Times there count seconds from 2001.
final class PodcastsDB {
  let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Documents/MTLibrary.sqlite")
  var lastProblem = "" // logged and shown on the status page by the bridge (problem("podcasts", …))
  func problem(_ s: String) { lastProblem = s }
  static let iso = ISO8601DateFormatter()
  func date(_ s: String?) -> String? {
    guard let s = s, let t = Double(s), t > 0 else { return nil }
    return PodcastsDB.iso.string(from: Date(timeIntervalSinceReferenceDate: t))
  }

  // The shows followed: [{ id, title, author, feed, storeId, art, plays, lastPlayed, episodes: [...] }],
  // each with its 12 newest episodes and any half-played ones.
  func read() -> [[String: Any]] {
    var db: OpaquePointer?
    guard FileManager.default.isReadableFile(atPath: file.path),
          sqlite3_open_v2(file.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
      sqlite3_close(db)
      problem("can't read the Podcasts library. Give KitchenFrameBridge Full Disk Access (System Settings > Privacy & Security > Full Disk Access), and open Podcasts once with Sync Library on.")
      return []
    }
    defer { sqlite3_close(db) }
    do {
      var stats: [String: (plays: Int, last: String?)] = [:]
      for r in try sqliteRows(db, "select ZPODCAST, sum(ifnull(ZPLAYCOUNT, 0)) + sum(ifnull(ZPLAYHEAD, 0) > 30), max(case when ZPLAYCOUNT > 0 or ZPLAYHEAD > 30 then ZPLAYSTATELASTMODIFIEDDATE end) from ZMTEPISODE group by ZPODCAST", []) {
        if let pk = r[0] { stats[pk] = (Int(r[1] ?? "0") ?? 0, date(r[2])) }
      }
      let cols = "ZUUID, ZTITLE, ZPUBDATE, ZDURATION, substr(ZITEMDESCRIPTIONWITHOUTHTML, 1, 700), ZENCLOSUREURL, ZPLAYHEAD, ZPLAYSTATE, ZPLAYSTATELASTMODIFIEDDATE, ifnull(ZVIDEO, 0)"
      func episode(_ r: [String?]) -> [String: Any]? {
        guard let id = r[0], let title = r[1], let url = r[5], url.hasPrefix("https://") else { return nil }
        var e: [String: Any] = ["id": id, "title": title, "url": url]
        if let d = date(r[2]) { e["date"] = d }
        if let d = Double(r[3] ?? ""), d > 0 { e["seconds"] = Int(d) }
        if let d = r[4]?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty { e["description"] = d }
        if let p = Double(r[6] ?? ""), p > 30, r[7] != "2" { e["position"] = Int(p) }
        if r[7] == "2" { e["played"] = true }
        if let d = date(r[8]) { e["touched"] = d }
        if r[9] == "1" { e["video"] = true }
        return e
      }
      var out: [[String: Any]] = []
      for r in try sqliteRows(db, "select Z_PK, ZTITLE, ZAUTHOR, ZFEEDURL, ZSTORECOLLECTIONID, ZARTWORKTEMPLATEURL, ZUUID from ZMTPODCAST where ZSUBSCRIBED = 1 and ifnull(ZHIDDEN, 0) = 0", []) {
        guard let pk = r[0], let title = r[1] else { continue }
        var seen = Set<String>()
        var episodes: [[String: Any]] = []
        let recent = try sqliteRows(db, "select \(cols) from ZMTEPISODE where ZPODCAST = ? order by ZPUBDATE desc limit 12", [pk])
        let started = try sqliteRows(db, "select \(cols) from ZMTEPISODE where ZPODCAST = ? and ZPLAYHEAD > 30 and ifnull(ZPLAYSTATE, 0) != 2 order by ZPLAYSTATELASTMODIFIEDDATE desc limit 5", [pk])
        for row in started + recent { if let e = episode(row), let id = e["id"] as? String, !seen.contains(id) { seen.insert(id); episodes.append(e) } }
        var show: [String: Any] = ["id": r[6] ?? pk, "title": title, "episodes": episodes, "plays": stats[pk]?.plays ?? 0]
        if let v = r[2], !v.isEmpty { show["author"] = v }
        if let v = r[3], !v.isEmpty { show["feed"] = v }
        if let v = r[4], v != "0" { show["storeId"] = v }
        if let v = r[5], !v.isEmpty { show["art"] = v.replacingOccurrences(of: "{w}x{h}{c}.{f}", with: "300x300bb.jpg").replacingOccurrences(of: "{w}x{h}bb.{f}", with: "300x300bb.jpg") }
        if let v = stats[pk]?.last { show["lastPlayed"] = v }
        out.append(show)
      }
      problem(out.isEmpty ? "no shows followed in the Podcasts library yet (is Sync Library on?)" : "")
      return out
    } catch {
      problem("the Podcasts library has changed shape (\(error)); podcasts are left out")
      return []
    }
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
// Each job is optional: Reminders lists, Apple calendars and a shared album are each handled only when
// the Worker's settings say that source comes from this Mac, and macOS is asked only for those.
Task { @MainActor in
  if check {
    do { try await bridge.loadConfig(); log("Worker reachable.") } catch { log("Worker check failed: \(error.localizedDescription)") }
    if bridge.lists.isEmpty && bridge.calendars.isEmpty && bridge.photoCfg == nil {
      log("Nothing is set to come from this Mac yet (lists, calendars or photos); see docs/mac-bridge.md.")
    }
    if !bridge.lists.isEmpty {
      log(bridge.remindersAccess ? "Reminders access OK. Lists on this Mac: " + bridge.store.calendars(for: .reminder).map { $0.title }.sorted().joined(separator: ", ") : "Reminders access NOT granted.")
    }
    if let pc = bridge.photoCfg {
      log(bridge.photosAccess ? "Photos access OK. Album \"\(pc.album)\": " + (bridge.albumAssets(pc.album).map { "\($0.count) photos" } ?? "NOT FOUND") : "Photos access NOT granted.")
    }
    if !bridge.calendars.isEmpty {
      log(bridge.calendarAccess ? "Calendar access OK. Calendars on this Mac: " + bridge.store.calendars(for: .event).map { $0.title }.sorted().joined(separator: ", ") : "Calendar access NOT granted.")
    }
    exit(0)
  }
  log("Starting; Worker \(cfg.worker)")
  do { try await bridge.loadConfig() } catch { log("Couldn't read the Worker's settings yet: \(error.localizedDescription)") }
  bridge.run()
}
RunLoop.main.run()
