import SwiftUI

@main
struct KitchenFrameApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    init() {
        // Every launch, including the background ones HealthKit makes for new Activity data.
        FitnessSync.shared.startIfEnabled()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // The frame's pairing QR code, opened from the iPhone camera.
                .onOpenURL { model.pair(with: $0) }
                // Opening the app sends the latest rings, whatever background delivery managed.
                .onChange(of: phase, initial: true) { _, now in
                    // Asks for any Health access added since it was turned on (iOS shows the sheet only for new
                    // kinds of data), then sends.
                    if now == .active { Task {
                        if FitnessSync.shared.enabled { try? await FitnessSync.shared.requestAccess() }
                        await FitnessSync.shared.send(reason: "App opened")
                    } }
                }
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

    /// Fitness sharing stops first, while the pairing still reaches the frame to remove this person.
    func unpair() async {
        if FitnessSync.shared.enabled { await FitnessSync.shared.stop() }
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
                    NavigationLink { FitnessSettingsView() } label: { LabeledContent("Apple Health", value: FitnessSync.shared.summary) }
                }
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .navigationTitle("Settings")
            .confirmationDialog("Unpair this phone?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Unpair", role: .destructive) { Task { await model.unpair() } }
            } message: {
                Text("You can pair again from the frame’s Settings.")
            }
        }
    }
}

/// Settings → Apple Health: whether this phone sends its owner's Activity rings to the frame, under
/// what name, heart rate or not, and the sends of the last day (to see how far behind background
/// updates run), on a page of its own.
struct FitnessSettingsView: View {
    @State private var sync = FitnessSync.shared
    @State private var problem: String?

    var body: some View {
        Form {
        Section {
            Toggle("Share Fitness on the frame", isOn: Binding(get: { sync.enabled }, set: { on in Task { await turn(on) } }))
                .disabled(!FitnessSync.available || sync.name.trimmingCharacters(in: .whitespaces).isEmpty)
            TextField("Your name on the frame", text: Binding(get: { sync.name }, set: { sync.name = $0 }))
                .textContentType(.givenName)
                .disabled(sync.enabled)
            if sync.enabled {
                Toggle("Average heart rate on workouts", isOn: Binding(get: { sync.heartRate }, set: { on in Task { await heart(on) } }))
                Button(sync.sending ? "Sending…" : "Send now") { Task { await sync.send(reason: "Send now") } }
                    .disabled(sync.sending)
            }
            if let problem { Text(problem).foregroundStyle(.red) }
        } footer: {
            Text("Shows your Activity rings, today’s steps and your last few workouts (time, distance, calories, climb, effort and the weather, and average heart rate if you turn it on) on the frame’s Fitness tab, nothing else from Health. It sends when you open this app and when Health has new data, usually within the hour while your phone is unlocked now and then. Turn it off to hide yourself on the frame; turned back on, you’re there again in seconds. Guest mode (the Remote tab) hides everyone’s, with other personal things.")
        }
        if sync.enabled, !sync.recent.isEmpty {
            Section {
                ForEach(sync.recent) { s in
                    LabeledContent {
                        Text(s.error ?? "Sent").foregroundStyle(s.error == nil ? Color.secondary : Color.red)
                    } label: {
                        Text(s.reason)
                        Text(s.at.formatted(.relative(presentation: .named)))
                    }
                }
            } header: {
                Text("Sends today")
            } footer: {
                Text("The last 24 hours, newest first: “App opened” is this app, “Health update” is Health waking it in the background.")
            }
        }
        }
        .navigationTitle("Apple Health")
    }

    /// Heart rate needs its own Health access, asked for when it's turned on; then it's sent at once.
    private func heart(_ on: Bool) async {
        problem = nil
        sync.heartRate = on
        if on { do { try await sync.requestAccess() } catch { problem = error.localizedDescription } }
        await sync.send(reason: on ? "Heart rate on" : "Heart rate off")
    }

    private func turn(_ on: Bool) async {
        problem = nil
        guard on else { await sync.stop(); return }
        do {
            try await sync.requestAccess()
            sync.enabled = true
            sync.startIfEnabled()
            await sync.send(reason: "Turned on")
        } catch {
            problem = error.localizedDescription
        }
    }
}
