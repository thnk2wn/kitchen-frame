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
                // The frame's pairing QR code, opened from the iPhone camera; or kitchenframe://fitness/send,
                // the frame's Refresh (a Home Assistant notification's link), which sends and says so in a
                // banner, so the person who tapped it knows it worked.
                .onOpenURL { link in
                    if link.host == "fitness" { Task { await model.answerFrame() } } else { model.pair(with: link) }
                }
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
                // For the simulator: -pairLink kitchenframe://pair?… pairs without the "Open in" prompt or the pairing alert.
                .task {
                    let args = ProcessInfo.processInfo.arguments
                    if let i = args.firstIndex(of: "-pairLink"), args.count > i + 1, let link = URL(string: args[i + 1]), let p = PairingLink.from(link: link) {
                        Task { await model.confirmPairing(p) } // DEBUG only: no prompt, for the simulator
                    }
                    // -frameAsk: as if the frame's Refresh notification was tapped (its banner, for screenshots).
                    if args.contains("-frameAsk") { await model.answerFrame() }
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

    /// The banner after the frame's Refresh notification was tapped: sending, then how it went, then gone.
    enum FrameAsk: Equatable { case sending, sent, failed(String), off }
    var frameAsk: FrameAsk?

    func answerFrame() async {
        frameAsk = .sending
        let sent = await FitnessSync.shared.answerFrame()
        frameAsk = sent.map { $0.error.map(FrameAsk.failed) ?? .sent } ?? .off
        let shown = frameAsk
        try? await Task.sleep(for: .seconds(shown == .sent ? 4 : 8))
        if frameAsk == shown { frameAsk = nil }
    }

    /// A pairing link waiting for the person to confirm it (RootView's alert shows where it points).
    /// A link only ever asks: it could come from anyone, and it decides where this phone sends its
    /// health data (2026-10-20 security review).
    var pendingPairing: PairingLink?

    func pair(with link: URL) {
        guard let p = PairingLink.from(link: link) else {
            pairingProblem = "That isn’t a Kitchen Frame pairing code."
            return
        }
        pairingProblem = nil
        if p.key != nil, p.url == pairing?.url, p.key == pairing?.key { return } // the same frame and key again
        pendingPairing = p
    }

    /// Whether the waiting link points somewhere other than the current pairing (a different frame).
    var pendingChangesFrame: Bool {
        guard let p = pendingPairing, let current = pairing else { return false }
        return p.url.host?.lowercased() != current.url.host?.lowercased()
    }

    /// Pairs with the confirmed link: a code is traded for this phone's own key first. Moving to another
    /// frame turns fitness sharing off before that (which also removes this person from the old frame),
    /// so health data goes there only once it's turned on again deliberately.
    func confirmPairing(_ link: PairingLink) async {
        pendingPairing = nil
        let p: Pairing
        do {
            if let key = link.key { p = Pairing(url: link.url, key: key) }
            else {
                let who = FitnessSync.shared.name.trimmingCharacters(in: .whitespaces)
                p = try await API.claim(link, name: who.isEmpty ? "iPhone" : who + "’s iPhone")
            }
        } catch {
            pairingProblem = error.localizedDescription
            return
        }
        if pairing != nil, p.url.host?.lowercased() != pairing?.url.host?.lowercased(), FitnessSync.shared.enabled {
            await FitnessSync.shared.stop()
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
        content
            .overlay(alignment: .top) {
                if let ask = model.frameAsk { FrameAskBanner(ask: ask).transition(.move(edge: .top).combined(with: .opacity)) }
            }
            .animation(.snappy, value: model.frameAsk)
            .alert(model.pendingChangesFrame ? "Pair with a different frame?" : "Pair with this frame?",
                   isPresented: Binding(get: { model.pendingPairing != nil }, set: { if !$0 { model.pendingPairing = nil } }),
                   presenting: model.pendingPairing) { p in
                // The pairing shown, passed along: closing the alert clears pendingPairing first.
                Button("Pair") { Task { await model.confirmPairing(p) } }
                Button("Cancel", role: .cancel) { model.pendingPairing = nil }
            } message: { p in
                Text((p.url.host ?? p.url.absoluteString)
                     + (model.pendingChangesFrame
                        ? "\n\nThis replaces \(model.pairing?.url.host ?? "the current frame"). Fitness sharing turns off until you turn it on again."
                        : "\n\nOnly pair with your own frame: it gets what this phone sends, including your Fitness data if you share it."))
            }
    }

    @ViewBuilder private var content: some View {
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

/// What the frame's Refresh did, at the top of the screen after its notification was tapped.
struct FrameAskBanner: View {
    let ask: AppModel.FrameAsk

    var body: some View {
        HStack(spacing: 10) {
            switch ask {
            case .sending: ProgressView(); Text("Sending your rings to the frame…")
            case .sent: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green); Text("Sent. The frame has your latest rings.")
            case .failed(let why): Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange); Text("Couldn’t send: \(why)")
            case .off: Image(systemName: "heart.slash").foregroundStyle(.secondary); Text("Fitness sharing is off. Turn it on in Settings → Apple Health.")
            }
        }
        .font(.subheadline.weight(.medium))
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.regularMaterial, in: .rect(cornerRadius: 20))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
        .padding(.horizontal)
        .padding(.top, 4)
        .accessibilityElement(children: .combine)
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
                if let api = model.api {
                    GuestModeSection(api: api)
                    Section { NavigationLink { PinSettingsView(api: api) } label: { LabeledContent("PIN", value: FramePin.isSet ? "Set" : "Not set") } }
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

/// Settings → Guest mode: hides personal things on the frame (Fitness, for now) while guests are here.
/// Read again each time Settings shows: it may have changed on the frame or the other phone.
struct GuestModeSection: View {
    let api: API
    @State private var guest: API.Guest?
    @State private var problem: String?

    var body: some View {
        Section {
            Toggle("Guest mode", isOn: Binding(get: { guest?.on ?? false }, set: { on in Task { await set(on) } }))
                .disabled(guest == nil)
        } footer: {
            Text(problem ?? (guest?.on == true ? "Personal things, like Fitness, are hidden on the frame. Turn this off when your guests leave." : "Hides personal things on the frame, like Fitness, while guests are here."))
        }
        .onAppear { Task { await load() } }
    }

    private func load() async {
        do { guest = try await api.guest(); problem = nil } catch { problem = "Guest mode: " + error.localizedDescription }
    }

    private func set(_ on: Bool) async {
        do { guest = try await api.setGuest(on); problem = nil } catch { problem = "Guest mode: " + error.localizedDescription }
    }
}

/// Settings → Apple Health: whether this phone sends its owner's Activity rings to the frame, under
/// what name, heart rate or not, and the sends of the last day (to see how far behind background
/// updates run), on a page of its own.
struct FitnessSettingsView: View {
    @State private var sync = FitnessSync.shared
    @State private var problem: String?
    @FocusState private var goalFocused: Bool

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
            Text("Your rings, steps and recent workouts on the frame’s Fitness tab. Sent when Health has new data, usually within the hour. Hidden in guest mode.")
        }
        if sync.enabled {
            Section {
                Toggle("Share weight trend", isOn: Binding(get: { sync.weight }, set: { on in Task { await weight(on) } }))
                if sync.weight {
                    LabeledContent("Goal") {
                        HStack(spacing: 4) {
                            TextField("Goal", value: Binding(get: { sync.weightGoal > 0 ? sync.weightGoal : nil }, set: { sync.weightGoal = max(0, $0 ?? 0) }), format: .number.precision(.fractionLength(0...1)))
                                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).focused($goalFocused)
                            Text(FitnessSync.weightUnit.name).foregroundStyle(.secondary)
                        }
                    }
                    if let read = sync.weighInsRead { LabeledContent("Read from Health", value: read).font(.footnote) }
                    Picker("On the frame", selection: Binding(get: { sync.weightShow }, set: { v in sync.weightShow = v; Task { await sync.send(reason: "Weight on the frame: \(v.rawValue)") } })) {
                        Text("Trend only").tag(FitnessSync.WeightShow.trend)
                        Text("Weight with my PIN").tag(FitnessSync.WeightShow.pin)
                        Text("Weight, no PIN").tag(FitnessSync.WeightShow.open)
                    }
                    if sync.weightShow == .pin && !FramePin.isSet { Text("Set your PIN in Settings → PIN; until then only the trend shows.").font(.footnote).foregroundStyle(.secondary) }
                }
            } header: {
                Text("Weight")
            } footer: {
                Text(sync.weight && sync.weightGoal <= 0
                     ? "Set a goal to start."
                     : "Trend only: your pace and how far you are from your goal, no weight. With my PIN: your weight too, on the frame after your PIN. No PIN: your weight for anyone, on your Fitness card too.")
            }
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
                Text("The last 24 hours, newest first.")
            }
        }
        }
        .navigationTitle("Apple Health")
        .toolbar {
            // The decimal pad has no return key: Done sends the new goal.
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { goalFocused = false; Task { await sync.send(reason: "Weight goal changed") } }
            }
        }
    }

    /// Weight needs its own Health access, asked for when it's turned on; then it's watched and sent.
    private func weight(_ on: Bool) async {
        problem = nil
        sync.weight = on
        if on { do { try await sync.requestAccess() } catch { problem = error.localizedDescription } }
        sync.rewatch()
        await sync.send(reason: on ? "Weight on" : "Weight off")
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
