import SwiftUI

/// Show a screen on the frame, start its slideshow, wake it or close what's open: the commands
/// Alexa sends, over the Worker (POST /api/frame/command).
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
    @State private var guest: API.Guest?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(showing).font(.subheadline).foregroundStyle(.secondary)

                    HStack(spacing: 12) {
                        action("Slideshow", "photo.on.rectangle", command: "slideshow")
                        action("Wake", "sun.max", command: "wake")
                        action("Close", "xmark", command: "close")
                    }

                    // Guest mode: hides personal things on the frame (Fitness, for now) while guests are here.
                    VStack(alignment: .leading, spacing: 4) {
                        Toggle("Guest mode", isOn: Binding(get: { guest?.on ?? false }, set: { on in Task { await setGuest(on) } }))
                            .disabled(guest == nil)
                        Text(guestNote).font(.footnote).foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 12))

                    Text("Show").font(.headline)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 12)], spacing: 12) {
                        ForEach(Self.screens, id: \.tab) { s in
                            action(s.name, s.icon, command: "show", tab: s.tab)
                        }
                    }

                    if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                }
                .padding()
            }
            .navigationTitle("Remote")
            .refreshable { await refreshAfterCheckIn() }
            .task { await refresh() }
            // Each time the tab shows: guest mode may have changed on the frame or the other phone.
            .onAppear { Task { await loadGuest() } }
        }
    }

    private var guestNote: String {
        guest?.on == true ? "Personal things, like Fitness, are hidden on the frame. Turn this off when your guests leave." : "Hides personal things on the frame, like Fitness, while guests are here."
    }

    private func setGuest(_ on: Bool) async {
        do { guest = try await api.setGuest(on); problem = nil } catch { problem = "Guest mode: " + error.localizedDescription }
    }

    private var showing: String {
        guard let status else { return " " }
        if status.screen == "clock" { return "The frame is showing its clock screen" }
        return "The frame is showing " + (Self.names[status.tab ?? ""] ?? status.tab ?? "something")
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

    private func send(_ id: String, _ command: String, _ tab: String?) async {
        busy = id
        problem = nil
        do {
            try await api.command(command, tab: tab)
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
        await loadGuest()
    }

    private func loadGuest() async {
        do { guest = try await api.guest() } catch { problem = "Guest mode: " + error.localizedDescription }
    }
}

