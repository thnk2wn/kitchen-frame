import SwiftUI

@main
struct KitchenFrameApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // The frame's pairing QR code, opened from the iPhone camera.
                .onOpenURL { model.pair(with: $0) }
                #if DEBUG
                // For the simulator: -pairLink kitchenframe://pair?… pairs without the "Open in" prompt.
                .task {
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-pairLink"), args.count > i + 1, let link = URL(string: args[i + 1]) { model.pair(with: link) }
                }
                #endif
        }
    }
}

@MainActor @Observable
final class AppModel {
    private(set) var pairing: Pairing? = PairingStore.load()
    var pairingProblem: String?
    let ops = OpsModel()

    var api: API? { pairing.map(API.init) }

    func pair(with link: URL) {
        guard let p = Pairing.from(link: link) else {
            pairingProblem = "That isn’t a Kitchen Frame pairing code."
            return
        }
        PairingStore.save(p)
        pairing = p
        pairingProblem = nil
    }

    func unpair() {
        PairingStore.clear()
        pairing = nil
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    // DEBUG -tab <name> opens on that tab (screenshots).
    @State private var tab = ProcessInfo.processInfo.arguments.drop { $0 != "-tab" }.dropFirst().first ?? "remote"

    var body: some View {
        if let api = model.api {
            TabView(selection: $tab) {
                Tab("Remote", systemImage: "av.remote", value: "remote") { RemoteView(api: api) }
                Tab("Ops", systemImage: "waveform.path.ecg", value: "ops") { OpsView(api: api) }
                    .badge(model.ops.report?.attention ?? 0)
                Tab("Settings", systemImage: "gear", value: "settings") { SettingsView() }
            }
            // Ops' badge (things that need a look) is kept current while the app is open.
            .task {
                while !Task.isCancelled {
                    await model.ops.load(api)
                    try? await Task.sleep(for: .seconds(300))
                }
            }
        } else {
            PairView()
        }
    }
}

struct PairView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ContentUnavailableView {
            Label("Pair with your frame", systemImage: "qrcode.viewfinder")
        } description: {
            Text("On the frame, open Settings → About → Pair a phone. Then point this iPhone’s Camera at the code and tap the Kitchen Frame link.")
        } actions: {
            if let problem = model.pairingProblem { Text(problem).foregroundStyle(.red) }
        }
    }
}

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @State private var confirming = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Frame") {
                    LabeledContent("Paired with", value: model.pairing?.url.host ?? "—")
                    Button("Unpair this phone", role: .destructive) { confirming = true }
                }
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Unpair this phone?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) { model.unpair() }
            } message: {
                Text("You can pair again from the frame’s Settings.")
            }
        }
    }
}
