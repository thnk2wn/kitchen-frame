import SwiftUI

/// The frame's timers, like the Clock app's: the ones running there, counting down here, with +1 min
/// and cancel; then hours and minutes on wheels and a name, to start one on the frame (full screen
/// there). The frame sends its list whenever it changes (POST /api/frame/timers); this reads it every
/// few seconds while it shows, and right after a tap. Siri starts timers too (FrameTimers.swift).
struct TimersView: View {
    let api: API

    @State private var timers: [API.FrameTimer] = []
    @State private var at: Double = 0 // when the frame sent the list shown (ms)
    @State private var hours = 0
    @State private var minutes = 10
    @State private var name = "" // none: "10 min", as on the frame
    @State private var busy: String?
    @State private var problem: String?
    /// On the frame's home network (API.atHome): timers, like Remote, work only there. Nil until known.
    @State private var home: Bool?

    private var sorted: [API.FrameTimer] {
        timers.sorted { ($0.done ? 0 : 1, $0.end) < ($1.done ? 0 : 1, $1.end) }
    }

    var body: some View {
        NavigationStack {
            List {
                if home == false {
                    Label("Timers work on the home Wi-Fi. This phone isn’t on it.", systemImage: "wifi.slash")
                        .font(.callout)
                }
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }

                Section("On the frame") {
                    if sorted.isEmpty { Text("No timers running").foregroundStyle(.secondary) }
                    ForEach(sorted) { row($0) }
                }

                if sorted.filter({ !$0.done }).count < FrameTimers.most {
                    Section("New timer") {
                        HStack(spacing: 0) {
                            Picker("Hours", selection: $hours) {
                                ForEach(0..<5) { Text("\($0) hr").tag($0) }
                            }
                            Picker("Minutes", selection: $minutes) {
                                ForEach(0..<60) { Text("\($0) min").tag($0) }
                            }
                        }
                        .pickerStyle(.wheel)
                        .frame(height: 150)
                        Picker("Name", selection: $name) {
                            Text("None").tag("")
                            ForEach(FrameTimers.names, id: \.self) { Text($0).tag($0) }
                        }
                        Button { Task { await start() } } label: {
                            HStack {
                                Spacer()
                                if busy == "start" { ProgressView() } else { Text("Start on the frame").bold() }
                                Spacer()
                            }
                        }
                        .disabled(hours * 60 + minutes == 0 || busy != nil)
                    }
                    .disabled(home == false)
                }
            }
            .navigationTitle("Timers")
            .refreshable { await load() }
            // While it shows: the frame's list every few seconds (started there, or by Alexa or Siri).
            .task {
                while !Task.isCancelled {
                    await load()
                    try? await Task.sleep(for: .seconds(4))
                }
            }
            // Each time the tab shows: the phone may have left or come back to the home Wi-Fi.
            .onAppear { Task { home = await api.atHome() } }
        }
    }

    private func row(_ t: API.FrameTimer) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(t.label).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if t.done || t.endsAt <= .now {
                    Text("Time’s up").font(.title2.weight(.bold)).foregroundStyle(.red)
                } else {
                    Text(timerInterval: Date.now...t.endsAt, countsDown: true)
                        .font(.title.monospacedDigit().weight(.bold)).foregroundStyle(.orange)
                }
            }
            Spacer()
            Button { Task { await change(t, "add") } } label: {
                if busy == "add" + t.id { ProgressView() } else { Text("+1 min") }
            }
            .buttonStyle(.bordered)
            Button(role: .destructive) { Task { await change(t, "cancel") } } label: {
                if busy == "cancel" + t.id { ProgressView() } else { Image(systemName: "xmark") }
            }
            .buttonStyle(.bordered)
            .accessibilityLabel((t.done ? "Dismiss " : "Cancel ") + t.label)
        }
        .disabled(busy != nil || home == false)
    }

    private func start() async {
        let total = hours * 60 + minutes
        let label = name.isEmpty ? "\(total) min" : name
        await send("start", "start", label: label, seconds: total * 60) {
            let now = Date.now.timeIntervalSince1970 * 1000
            timers.append(.init(id: "new\(now)", label: label, end: now + Double(total) * 60_000, total: total * 60, done: false))
            name = ""
        }
    }

    private func change(_ t: API.FrameTimer, _ action: String) async {
        await send(action + t.id, action, seconds: action == "add" ? 60 : nil, id: t.id) {
            guard let i = timers.firstIndex(where: { $0.id == t.id }) else { return }
            if action == "cancel" { timers.remove(at: i); return }
            let now = Date.now.timeIntervalSince1970 * 1000
            timers[i].end = max(now, timers[i].done ? now : timers[i].end) + 60_000
            timers[i].done = false
        }
    }

    /// Sends the command and shows its effect here at once, then waits (up to about 4 s) for the
    /// frame's own list, which it sends as soon as it has made the change.
    private func send(_ id: String, _ action: String, label: String? = nil, seconds: Int? = nil, id timerId: String? = nil, shown: () -> Void) async {
        busy = id
        problem = nil
        let before = at
        do {
            try await api.timer(action, label: label, seconds: seconds, id: timerId)
            shown()
            busy = nil
            for _ in 0..<8 {
                try? await Task.sleep(for: .milliseconds(500))
                if let t = try? await api.timers(), t.at != before { timers = t.timers; at = t.at; break }
            }
        } catch {
            problem = error.localizedDescription
        }
        busy = nil
    }

    private func load() async {
        guard busy == nil, let t = try? await api.timers() else { return }
        timers = t.timers
        at = t.at
    }
}
