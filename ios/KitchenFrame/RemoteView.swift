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
        ("podcasts", "Podcasts", "mic"), ("notices", "Notices", "bell"),
    ]
    private static let names = Dictionary(uniqueKeysWithValues: screens.map { ($0.tab, $0.name) })

    @State private var status: API.FrameStatus?
    @State private var busy: String?
    @State private var problem: String?

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
            .refreshable { try? await api.checkIn(); try? await Task.sleep(for: .seconds(2)); await refresh() }
            .task { await refresh() }
        }
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
            try? await api.checkIn()
            try? await Task.sleep(for: .seconds(2))
            await refresh()
        } catch {
            problem = error.localizedDescription
        }
        busy = nil
    }

    private func refresh() async {
        status = try? await api.status()
    }
}
