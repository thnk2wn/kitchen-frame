import SwiftUI

/// Show a screen on the frame, start its slideshow, wake it or close what's open, and start, add to or
/// cancel its timers: the commands Alexa sends, over the Worker (POST /api/frame/command). Screenshot
/// shows what it shows right now. Siri starts timers too (FrameTimers.swift).
struct RemoteView: View {
    let api: API

    private static let screens: [(tab: String, name: String, icon: String)] = [
        ("home", "Home", "house"), ("calendar", "Calendar", "calendar"),
        ("groceries", "Groceries", "cart"), ("todo", "To Do", "checklist"),
        ("recipes", "Recipes", "fork.knife"), ("house", "House", "lightbulb"),
        ("music", "Music", "music.note"), ("videos", "Videos", "play.rectangle"),
        ("podcasts", "Podcasts", "mic"), ("fitness", "Fitness", "figure.walk"), ("notices", "Notices", "bell"),
    ]
    private static let names = Dictionary(uniqueKeysWithValues: screens.map { ($0.tab, $0.name) })

    @State private var status: API.FrameStatus?
    @State private var busy: String?
    @State private var problem: String?
    @State private var screenshot = false
    /// The name the next timer started here gets (none: "10 min", as on the frame).
    @State private var timerName: String?
    /// On the frame's home network (API.atHome): the buttons work only there. Nil until known.
    @State private var home: Bool?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(showing).font(.subheadline).foregroundStyle(.secondary)

                    // Said up front, not after a tap: away from home, nothing here works (worker/home.js).
                    if home == false {
                        Label("Remote and Screenshot work on the home Wi-Fi. This phone isn’t on it.", systemImage: "wifi.slash")
                            .font(.callout)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.orange.opacity(0.15), in: .rect(cornerRadius: 12))
                    }
                    if let problem { Text(problem).font(.callout).foregroundStyle(.red) }

                    // Two by two, icon beside the name: full-size buttons with room for "Screenshot".
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                        wide("Slideshow", "photo.on.rectangle", busy: busy == "slideshow") { Task { await send("slideshow", "slideshow", nil) } }
                        wide("Wake", "sun.max", busy: busy == "wake") { Task { await send("wake", "wake", nil) } }
                        wide("Close", "xmark", busy: busy == "close") { Task { await send("close", "close", nil) } }
                        wide("Screenshot", "camera.viewfinder", busy: false) { screenshot = true }
                    }
                    .disabled(home == false)

                    timersSection
                        .disabled(home == false)

                    Text("Show").font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 12)], spacing: 12) {
                        ForEach(Self.screens, id: \.tab) { s in
                            action(s.name, s.icon, command: "show", tab: s.tab)
                        }
                    }
                    .disabled(home == false)
                }
                .padding()
            }
            .navigationTitle("Remote")
            .fullScreenCover(isPresented: $screenshot) { ScreenshotView(api: api) }
            .refreshable { await refreshAfterCheckIn() }
            .task { await refresh() }
            // Each time the tab shows: the phone may have left or come back to the home Wi-Fi.
            .onAppear { Task { home = await api.atHome() } }
        }
    }

    /// The frame's timers, counting down here from their end times, with +1 min and cancel; then a
    /// name to pick (or none) and a time, which starts one on the frame, full screen there.
    @ViewBuilder private var timersSection: some View {
        let running = (status?.timers ?? []).sorted { ($0.done ? 0 : 1, $0.end) < ($1.done ? 0 : 1, $1.end) }
        Text("Timers").font(.headline)
        ForEach(running) { t in
            HStack(spacing: 12) {
                Text(t.label).font(.body.weight(.semibold)).lineLimit(1)
                Spacer()
                if t.done || t.endsAt <= .now {
                    Text("Time’s up").foregroundStyle(.red).font(.body.weight(.semibold))
                } else {
                    Text(timerInterval: Date.now...t.endsAt, countsDown: true)
                        .font(.title3.monospacedDigit().weight(.bold)).foregroundStyle(.orange)
                }
                Button { Task { await timer("add" + t.id, "add", seconds: 60, id: t.id) } } label: {
                    if busy == "add" + t.id { ProgressView() } else { Text("+1") }
                }
                .buttonStyle(.bordered)
                Button(role: .destructive) { Task { await timer("cancel" + t.id, "cancel", id: t.id) } } label: {
                    if busy == "cancel" + t.id { ProgressView() } else { Image(systemName: "xmark") }
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Cancel " + t.label)
            }
            .disabled(busy != nil)
        }
        if running.filter({ !$0.done }).count < FrameTimers.most {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(FrameTimers.names, id: \.self) { n in
                        Button(n) { timerName = timerName == n ? nil : n }
                            .buttonStyle(.bordered)
                            .tint(timerName == n ? .orange : nil)
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), spacing: 8)], spacing: 8) {
                ForEach(FrameTimers.minutes, id: \.self) { m in
                    Button {
                        Task { await timer("start\(m)", "start", label: timerName ?? "\(m) min", seconds: m * 60) }
                    } label: {
                        Group { if busy == "start\(m)" { ProgressView() } else { Text(m < 60 ? "\(m) min" : "1 hr") } }
                            .frame(maxWidth: .infinity, minHeight: 36)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .disabled(busy != nil)
        }
    }

    private func timer(_ id: String, _ action: String, label: String? = nil, seconds: Int? = nil, id timerId: String? = nil) async {
        busy = id
        problem = nil
        do {
            try await api.timer(action, label: label, seconds: seconds, id: timerId)
            if action == "start" { timerName = nil }
            busy = nil
            await refreshAfterCheckIn()
        } catch {
            problem = error.localizedDescription
        }
        busy = nil
    }

    private var showing: String {
        guard let status else { return " " }
        if status.screen == "clock" { return "The frame is showing its clock screen" }
        return "The frame is showing " + (Self.names[status.tab ?? ""] ?? status.tab ?? "something")
    }

    /// The top grid's buttons: the icon beside the name, one line.
    private func wide(_ title: String, _ icon: String, busy spinning: Bool, run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack(spacing: 10) {
                if spinning { ProgressView() } else { Image(systemName: icon).font(.title3).frame(width: 26) }
                Text(title).lineLimit(1)
            }
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.bordered)
        .disabled(busy != nil)
    }

    private func action(_ title: String, _ icon: String, command: String, tab: String? = nil) -> some View {
        let id = command + (tab ?? "")
        return Button {
            Task { await send(id, command, tab) }
        } label: {
            VStack(spacing: 6) {
                if busy == id { ProgressView() } else { Image(systemName: icon).font(.title2) }
                Text(title).font(.footnote)
            }
            .frame(maxWidth: .infinity, minHeight: 64)
        }
        .buttonStyle(.bordered)
        .disabled(busy != nil)
    }

    /// The button spins until the frame has the command (a fraction of a second); what it's showing
    /// updates when its report comes in after.
    private func send(_ id: String, _ command: String, _ tab: String?) async {
        busy = id
        problem = nil
        do {
            try await api.command(command, tab: tab)
            busy = nil
            await refreshAfterCheckIn()
        } catch {
            problem = error.localizedDescription
        }
        busy = nil
    }

    /// Asks the frame to report in, then waits (up to about 8 s) for a report newer than the last one:
    /// reading straight away gets the report from before the button was pressed.
    private func refreshAfterCheckIn() async {
        let before = status?.receivedAt
        try? await api.checkIn()
        for _ in 0..<8 {
            try? await Task.sleep(for: .seconds(1))
            if let s = try? await api.status(), s.receivedAt != before { status = s; return }
        }
        await refresh()
    }

    private func refresh() async {
        status = try? await api.status()
        home = await api.atHome()
    }
}

