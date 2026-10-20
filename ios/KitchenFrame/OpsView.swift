import SwiftUI

/// The status page (dashboard/ops/) on the phone: the frame, the backend's health, the frame's event log,
/// the Alexa log and recent notices, from the same GET /api/ops/summary the page reads. The page signs in
/// with GitHub because it's a public address; the app already holds the dashboard key from pairing.
/// What needs attention follows the page's own rules (dashboard/ops/page.html).
struct OpsReport: Sendable {
    enum Level: Sendable { case ok, warn, bad }
    struct Row: Identifiable, Sendable {
        let id = UUID()
        var label: String
        var value: String
        var level = Level.ok
    }
    struct Group: Identifiable, Sendable {
        let id = UUID()
        var title: String
        var rows: [Row]
    }
    struct Line: Identifiable, Sendable {
        let id = UUID()
        var at: Date?
        var title: String
        var detail: String
        var level = Level.ok
    }

    var online = false
    var frame: [Row] = []
    var groups: [Group] = []
    var log: [Line] = []
    var alexa: [Line] = []
    var notices: [Line] = []

    /// Rows that need a look, for the tab's badge.
    var attention: Int {
        (online ? 0 : 1) + (frame + groups.flatMap(\.rows)).filter { $0.level == .bad || $0.level == .warn }.count
    }

    static func parse(_ data: Data, now: Date = Date()) -> OpsReport? {
        guard let d = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        var r = OpsReport()
        let date = { (v: Any?) -> Date? in (v as? String).flatMap { iso($0) } }
        let mins = { (t: Date?) -> Double in t.map { now.timeIntervalSince($0) / 60 } ?? .infinity }

        // The frame
        let f = d["frame"] as? [String: Any] ?? [:]
        if let seen = date(f["receivedAt"]) {
            r.online = mins(seen) < 13
            r.frame = [
                Row(label: "Checked in", value: ago(seen, now), level: r.online ? .ok : .bad),
                Row(label: "Showing", value: [f["screen"] as? String, (f["tab"] as? String).map { $0 + " tab" }].compactMap { $0 }.joined(separator: " · ")),
                Row(label: "Home Assistant", value: f["ha"] as? String ?? "—", level: f["ha"] as? String == "connected" ? .ok : .bad),
                Row(label: "Dashboard", value: [f["release"] as? String, (f["version"] as? String).map { "build " + $0 }].compactMap { $0 }.joined(separator: " · ")),
                Row(label: "Kiosk app", value: f["kiosk"] as? String ?? "before 1.6"),
                Row(label: "Page loaded", value: date(f["loadedAt"]).map { ago($0, now) } ?? "—"),
            ]
        } else {
            r.frame = [Row(label: "Frame", value: "Never checked in", level: .bad)]
        }

        // The backend
        if let c = d["calendar"] as? [String: Any] {
            let updated = date(c["updated"])
            var rows = [Row(label: "Updated", value: updated.map { ago($0, now) } ?? "never", level: mins(updated) > 75 ? .warn : .ok)]
            let names = c["names"] as? [String] ?? []
            let events = c["events"] as? [String: Any] ?? [:]
            // A failing feed on its own row, as the page shows it: amber while its saved copy is under
            // two days old, red when older or empty (and for Mac bridge calendars, which have no copy time).
            var failing: [Int: [String: Any]] = [:]
            for e in c["errors"] as? [[String: Any]] ?? [] { if let i = e["cal"] as? Int { failing[i] = e } }
            for (i, n) in names.enumerated() {
                let count = events[String(i)] as? Int ?? 0
                let label = n.isEmpty ? "Calendar \(i + 1)" : n
                guard let e = failing[i] else { rows.append(Row(label: label, value: "\(count) events")); continue }
                let since = date(e["since"])
                let fresh = e.keys.contains("since") && (since.map { now.timeIntervalSince($0) < 48 * 3600 } ?? (count > 0))
                rows.append(Row(label: label, value: "\(count) events · last fetch failed (\(e["error"] as? String ?? "?"))" + (since.map { ", showing the copy from " + ago($0, now) } ?? ""),
                                level: fresh ? .warn : .bad))
            }
            r.groups.append(Group(title: "Calendar", rows: rows))
        }
        if let lists = d["lists"] as? [String: [String: Any]], !lists.isEmpty {
            let rows = lists.sorted { $0.key < $1.key }.map { name, l -> Row in
                guard l["source"] as? String == "reminders" else { return Row(label: name.capitalized, value: "Todoist") }
                let stale = date(l["stale"]), waiting = l["waiting"] as? Bool == true, error = l["error"] as? String
                let state = error ?? (waiting ? "waiting for the Mac" : stale.map { "Mac last seen " + ago($0, now) } ?? "Mac in touch")
                let pending = l["pending"] as? Int ?? 0
                return Row(label: name.capitalized, value: "Reminders: \(l["items"] as? Int ?? 0) items" + (pending > 0 ? ", \(pending) changes queued" : "") + " · " + state,
                           level: error != nil || stale != nil || waiting ? .warn : .ok)
            }
            r.groups.append(Group(title: "Lists", rows: rows))
        }
        if let m = d["mac"] as? [String: Any] {
            let seen = date(m["seen"])
            var rows = [Row(label: "Checked in", value: seen.map { ago($0, now) } ?? "never", level: mins(seen) > 15 ? .bad : .ok)]
            if let e = m["error"] as? String { rows.append(Row(label: "Status", value: e, level: .bad)) }
            if let c = m["calendars"] as? [String: Any] {
                let sent = date(c["sent"])
                rows.append(Row(label: "Calendars", value: (c["names"] as? [String] ?? []).joined(separator: ", ") + " · sent " + (sent.map { ago($0, now) } ?? "never"),
                                level: mins(sent) > 180 ? .warn : .ok))
            }
            if let p = m["photos"] as? [String: Any] {
                let showing = p["showing"] as? Int ?? 0
                rows.append(Row(label: "Photos", value: "\(p["album"] as? String ?? "") · \(showing) showing", level: showing > 0 ? .ok : .warn))
                // Its own row: on the end of the one above it wrapped mid-phrase on a phone.
                if let changed = date(p["changed"]) { rows.append(Row(label: "Photos changed", value: ago(changed, now))) }
                if let s = p["storage"] as? [String: Any], let bytes = s["bytes"] as? Double, let limit = s["limit"] as? Double, limit > 0 {
                    let share = bytes / limit
                    rows.append(Row(label: "Storage", value: "\(mb(bytes)) of \(mb(limit)) (\(Int((share * 100).rounded()))%) · \(s["photos"] as? Int ?? 0) photos, \(s["videos"] as? Int ?? 0) videos",
                                    level: share > 0.9 ? .bad : share > 0.7 ? .warn : .ok))
                }
            }
            if let relay = m["relay"] as? [String: Bool], !relay.isEmpty {
                rows.append(Row(label: "Camera relay", value: relay.sorted { $0.key < $1.key }.map { $0.key + ($0.value ? " running" : " DOWN") }.joined(separator: " · "),
                                level: relay.values.allSatisfy { $0 } ? .ok : .bad))
            }
            for p in m["problems"] as? [String] ?? [] { rows.append(Row(label: "Problem", value: p, level: .bad)) }
            if let v = m["version"] as? String { rows.append(Row(label: "Bridge", value: v)) }
            r.groups.append(Group(title: "Mac bridge", rows: rows))
        }
        if let p = d["paprika"] as? [String: Any], p["configured"] as? Bool == true {
            var rows: [Row]
            if let e = p["error"] as? String { rows = [Row(label: "Sync", value: e, level: .bad)] }
            else {
                // As the page: what changed when, and when the 15-minute check last ran (amber past 45).
                let checked = date(p["checked"])
                rows = [Row(label: "Recipes", value: "\(p["recipes"] as? Int ?? 0)"),
                        Row(label: "Recipes changed", value: date(p["updated"]).map { ago($0, now) } ?? "never"),
                        Row(label: "Meal plan changed", value: date(p["mealsUpdated"]).map { ago($0, now) } ?? "never"),
                        Row(label: "Last checked", value: checked.map { ago($0, now) } ?? "not yet", level: mins(checked) > 45 ? .warn : .ok)]
                if let e = p["checkError"] as? String { rows.append(Row(label: "Last check failed", value: e, level: .bad)) }
                if let left = p["remaining"] as? Int, left > 0 { rows.append(Row(label: "Still to fetch", value: "\(left)")) }
            }
            r.groups.append(Group(title: "Paprika", rows: rows))
        }
        // Fitness: as the page shows it, amber past 12 hours without a send, red past 36.
        if let fit = d["fitness"] as? [String: Any] {
            if let e = fit["error"] as? String { r.groups.append(Group(title: "Fitness", rows: [Row(label: "Status", value: e, level: .bad)])) }
            else if let people = fit["people"] as? [[String: Any]], !people.isEmpty {
                // Two short rows each (when, then why), which fit a phone's width.
                let rows = people.flatMap { p -> [Row] in
                    let sent = date(p["updated"])
                    let hours = mins(sent) / 60
                    var rows = [Row(label: p["name"] as? String ?? "?", value: "sent " + (sent.map { ago($0, now) } ?? "never"),
                                    level: hours > 36 ? .bad : hours > 12 ? .warn : .ok)]
                    if let why = p["reason"] as? String { rows.append(Row(label: "Reason", value: why)) }
                    return rows
                }
                r.groups.append(Group(title: "Fitness", rows: rows))
            }
        }

        // The frame's event log, newest first: what it noticed, warnings and errors coloured.
        let skip: Set = ["t", "event", "level"]
        r.log = (f["log"] as? [[String: Any]] ?? []).reversed().prefix(80).map { e in
            let details = e.filter { !skip.contains($0.key) }.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" }.joined(separator: " · ")
            let level = e["level"] as? String
            return Line(at: date(e["t"]), title: e["event"] as? String ?? "?", detail: details, level: level == "error" ? .bad : level == "warn" ? .warn : .ok)
        }

        // The Alexa log, newest first: what an Echo heard, and what the skill did.
        r.alexa = (d["alexa"] as? [[String: Any]] ?? []).reversed().prefix(60).map { e in
            if e["source"] as? String == "alexa" {
                return Line(at: date(e["t"]), title: "\(e["device"] as? String ?? "Echo") heard “\(e["heard"] as? String ?? "")”",
                            detail: [e["intent"] as? String, (e["reply"] as? String).map { "replied: " + $0 }].compactMap { $0 }.joined(separator: " · "))
            }
            let refused = e["refused"] as? String
            return Line(at: date(e["t"]), title: "Skill: " + (e["intent"] as? String ?? e["type"] as? String ?? "request"),
                        detail: [(e["said"] as? String).map { "said “\($0)”" }, (e["sent"] as? String).map { "sent " + $0 }, refused.map { "refused: " + $0 }].compactMap { $0 }.joined(separator: " · "),
                        level: refused == nil ? .ok : .warn)
        }

        // Notices that ended in the last 24 hours.
        r.notices = (d["notices"] as? [[String: Any]] ?? []).map { n in
            Line(at: date(n["created"]), title: n["title"] as? String ?? "", detail: [n["how"] as? String, date(n["ended"]).map { "ended " + ago($0, now) }].compactMap { $0 }.joined(separator: " · "),
                 level: n["tone"] as? String == "alert" ? .bad : n["tone"] as? String == "info" ? .ok : .warn)
        }
        return r
    }

    static func iso(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    static func ago(_ t: Date, _ now: Date) -> String {
        let m = Int((now.timeIntervalSince(t) / 60).rounded())
        return m < 1 ? "just now" : m < 60 ? "\(m) min ago" : m < 1440 ? "\(Int((Double(m) / 60).rounded())) h ago" : "\(Int((Double(m) / 1440).rounded())) d ago"
    }

    static func mb(_ b: Double) -> String { b >= 1_073_741_824 ? String(format: "%.1f GB", b / 1_073_741_824) : "\(Int((b / 1_048_576).rounded())) MB" }
}

@MainActor @Observable
final class OpsModel {
    var report: OpsReport?
    var problem: String?
    var loadedAt: Date?

    func load(_ api: API) async {
        do {
            guard let r = OpsReport.parse(try await api.opsSummary()) else { throw API.Failure(message: "The status didn’t make sense.") }
            report = r; problem = nil; loadedAt = Date()
        } catch { problem = error.localizedDescription }
    }
}

struct OpsView: View {
    let api: API
    @Environment(AppModel.self) private var model
    @State private var section = Section.health

    enum Section: String, CaseIterable { case health = "Health", log = "Event log", alexa = "Alexa", notices = "Notices" }

    var body: some View {
        NavigationStack {
            List {
                Picker("Section", selection: $section) {
                    ForEach(Section.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if let problem = model.ops.problem { SwiftUI.Section { Text(problem).foregroundStyle(.red) } }
                if let r = model.ops.report {
                    switch section {
                    case .health: health(r)
                    case .log: lines(r.log, empty: "Nothing logged.")
                    case .alexa: lines(r.alexa, empty: "No Alexa requests in the last 3 days.")
                    case .notices: lines(r.notices, empty: "No notices ended in the last 24 hours.")
                    }
                } else if model.ops.problem == nil {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
            .navigationTitle("Ops")
            .refreshable { await model.ops.load(api) }
            .task { await model.ops.load(api) }
        }
    }

    @ViewBuilder private func health(_ r: OpsReport) -> some View {
        SwiftUI.Section {
            Label(r.online ? "Frame online" : "Frame not checking in", systemImage: r.online ? "checkmark.circle.fill" : "xmark.octagon.fill")
                .foregroundStyle(r.online ? .green : .red).font(.headline)
            ForEach(r.frame) { row($0) }
        } header: { Text("Frame") } footer: {
            if let at = model.ops.loadedAt { Text("Updated \(at.formatted(date: .omitted, time: .shortened)). Pull to refresh.") }
        }
        ForEach(r.groups) { g in
            SwiftUI.Section(g.title) { ForEach(g.rows) { row($0) } }
        }
    }

    private func row(_ r: OpsReport.Row) -> some View {
        LabeledContent {
            Text(r.value).multilineTextAlignment(.trailing).foregroundStyle(color(r.level, else: .secondary))
        } label: {
            Text(r.label)
        }
    }

    @ViewBuilder private func lines(_ items: [OpsReport.Line], empty: String) -> some View {
        if items.isEmpty { Text(empty).foregroundStyle(.secondary) }
        ForEach(items) { l in
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(l.title).font(.subheadline.weight(.semibold)).foregroundStyle(color(l.level, else: .primary))
                    Spacer(minLength: 8)
                    if let at = l.at { Text(at.formatted(.dateTime.weekday(.abbreviated).hour().minute())).font(.caption).foregroundStyle(.secondary) }
                }
                if !l.detail.isEmpty { Text(l.detail).font(.caption).foregroundStyle(.secondary).lineLimit(4) }
            }
        }
    }

    private func color(_ level: OpsReport.Level, else other: Color) -> Color {
        switch level { case .bad: .red; case .warn: .orange; case .ok: other }
    }
}
