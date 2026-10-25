import AppIntents
import Foundation

/// Timers on the frame, from this phone: the Timers tab (TimersView), and Siri through App
/// Shortcuts ("Hey Siri, set a 10 minute Kitchen Frame timer"). Each is the Worker's timer command,
/// the one Alexa sends (dashboard/worker/alexa.js): the frame starts it and shows it full screen.
/// Like Remote, it works from the home Wi-Fi only (dashboard/worker/home.js).
enum FrameTimers {
    /// The frame's own default names (dashboard/src/lib/timers.svelte.js), and how many can run.
    static let names = ["Pasta", "Bread", "Veggies", "Oven", "Protein"]
    static let most = 3

    /// "10 minutes", "1 hour and 30 minutes": what Siri says back.
    static func said(minutes m: Int) -> String {
        let n = { (v: Int, unit: String) in "\(v) \(unit)\(v == 1 ? "" : "s")" }
        let parts = [m / 60 > 0 ? n(m / 60, "hour") : nil, m % 60 > 0 ? n(m % 60, "minute") : nil].compactMap { $0 }
        return parts.joined(separator: " and ")
    }

    static func api() throws -> API {
        guard let pairing = PairingStore.load() else { throw Problem("This phone isn’t paired with the frame yet. Open Kitchen Frame to pair it.") }
        return API(pairing: pairing)
    }

    /// Runs a command, giving Siri the frame's reason when it fails.
    static func run(_ work: (API) async throws -> Void) async throws {
        do { try await work(try api()) } catch let p as Problem { throw p } catch { throw Problem(error.localizedDescription) }
    }

    struct Problem: Error, CustomLocalizedStringResourceConvertible {
        let message: String
        init(_ message: String) { self.message = message }
        var localizedStringResource: LocalizedStringResource { "\(message)" }
    }
}

/// Timer lengths Siri can hear in the phrase itself (App Shortcut phrases take only enums and
/// entities, not a free duration).
enum TimerLength: Int, AppEnum {
    case m1 = 1, m2 = 2, m3 = 3, m4 = 4, m5 = 5, m6 = 6, m7 = 7, m8 = 8, m9 = 9, m10 = 10, m12 = 12, m15 = 15
    case m20 = 20, m25 = 25, m30 = 30, m40 = 40, m45 = 45, m60 = 60, m90 = 90, m120 = 120

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Length"
    // Literals: Xcode reads these when it builds, for Siri.
    static let caseDisplayRepresentations: [TimerLength: DisplayRepresentation] = [
        .m1: DisplayRepresentation(title: "1 minute", synonyms: ["1 minute", "1 min", "a minute", "one minute"]),
        .m2: DisplayRepresentation(title: "2 minutes", synonyms: ["2 minute", "2 min"]),
        .m3: DisplayRepresentation(title: "3 minutes", synonyms: ["3 minute", "3 min"]),
        .m4: DisplayRepresentation(title: "4 minutes", synonyms: ["4 minute", "4 min"]),
        .m5: DisplayRepresentation(title: "5 minutes", synonyms: ["5 minute", "5 min"]),
        .m6: DisplayRepresentation(title: "6 minutes", synonyms: ["6 minute", "6 min"]),
        .m7: DisplayRepresentation(title: "7 minutes", synonyms: ["7 minute", "7 min"]),
        .m8: DisplayRepresentation(title: "8 minutes", synonyms: ["8 minute", "8 min"]),
        .m9: DisplayRepresentation(title: "9 minutes", synonyms: ["9 minute", "9 min"]),
        .m10: DisplayRepresentation(title: "10 minutes", synonyms: ["10 minute", "10 min"]),
        .m12: DisplayRepresentation(title: "12 minutes", synonyms: ["12 minute", "12 min"]),
        .m15: DisplayRepresentation(title: "15 minutes", synonyms: ["15 minute", "15 min"]),
        .m20: DisplayRepresentation(title: "20 minutes", synonyms: ["20 minute", "20 min"]),
        .m25: DisplayRepresentation(title: "25 minutes", synonyms: ["25 minute", "25 min"]),
        .m30: DisplayRepresentation(title: "30 minutes", synonyms: ["30 minute", "30 min", "half an hour", "a half hour"]),
        .m40: DisplayRepresentation(title: "40 minutes", synonyms: ["40 minute", "40 min"]),
        .m45: DisplayRepresentation(title: "45 minutes", synonyms: ["45 minute", "45 min"]),
        .m60: DisplayRepresentation(title: "1 hour", synonyms: ["an hour", "one hour", "60 minutes"]),
        .m90: DisplayRepresentation(title: "1 hour and 30 minutes", synonyms: ["an hour and a half", "one and a half hours", "90 minutes"]),
        .m120: DisplayRepresentation(title: "2 hours", synonyms: ["two hours", "120 minutes"]),
    ]
}

/// Names Siri can hear in the phrase: the frame's defaults and a few more.
enum TimerName: String, AppEnum {
    case pasta, bread, veggies, oven, protein, rice, eggs, chicken, potatoes, cookies, pizza

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Name"
    static let caseDisplayRepresentations: [TimerName: DisplayRepresentation] = [
        .pasta: "Pasta",
        .bread: "Bread",
        .veggies: "Veggies",
        .oven: "Oven",
        .protein: "Protein",
        .rice: "Rice",
        .eggs: "Eggs",
        .chicken: "Chicken",
        .potatoes: "Potatoes",
        .cookies: "Cookies",
        .pizza: "Pizza",
    ]
    var label: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
}

struct StartFrameTimer: AppIntent {
    static let title: LocalizedStringResource = "Start a Frame Timer"
    static let description = IntentDescription("Starts a timer on the kitchen frame, shown full screen there.")

    @Parameter(title: "Length", requestValueDialog: "For how long?")
    var length: TimerLength

    @Parameter(title: "Name")
    var name: TimerName?

    static var parameterSummary: some ParameterSummary { Summary("Start a \(\.$length) \(\.$name) timer on the frame") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let m = length.rawValue
        try await FrameTimers.run { try await $0.timer("start", label: name?.label ?? "\(m) min", seconds: m * 60) }
        return .result(dialog: "\((name.map { $0.label + " timer" } ?? "Timer")), \(FrameTimers.said(minutes: m)), on the frame.")
    }
}

struct CancelFrameTimer: AppIntent {
    static let title: LocalizedStringResource = "Cancel the Frame Timer"
    static let description = IntentDescription("Cancels the frame’s timer that’s ringing, or else the one ending next.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await FrameTimers.run { try await $0.timer("cancel") }
        return .result(dialog: "Cancelled.")
    }
}

struct AddFrameTimerMinute: AppIntent {
    static let title: LocalizedStringResource = "Add a Minute to the Frame Timer"
    static let description = IntentDescription("Adds a minute to the frame’s timer that’s ringing, or else the one ending next.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await FrameTimers.run { try await $0.timer("add", seconds: 60) }
        return .result(dialog: "Added a minute.")
    }
}

/// The phrases Siri knows without any setup. Each has to name the app, and can carry one parameter
/// ("a pasta timer" then asks how long). Siri keeps timers for itself: "set a … timer" goes to the
/// Clock, with the app's name as the timer's, and with the app named it answers "I can't set a timer on
/// Kitchen Frame". So the ones that work leave the word out: "Kitchen Frame 10 minutes", "Kitchen Frame
/// pasta", "Kitchen Frame countdown".
struct FrameShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartFrameTimer(), phrases: [
            // Without "timer", which Siri keeps for its own ("I can't set a timer on Kitchen Frame").
            "\(.applicationName) \(\.$length)",
            "\(.applicationName) \(\.$name)",
            "\(.applicationName) countdown",
            "\(.applicationName) \(\.$length) countdown",
            "\(.applicationName) \(\.$name) countdown",
            "Count down \(\.$length) on \(.applicationName)",
            "\(.applicationName) timer",
            "\(.applicationName) start a timer",
            "\(.applicationName) \(\.$length) timer",
            "\(.applicationName) timer for \(\.$length)",
            "\(.applicationName) \(\.$name) timer",
            "Ask \(.applicationName) to start a timer",
            "Ask \(.applicationName) to start a \(\.$length) timer",
            "Ask \(.applicationName) to start a \(\.$name) timer",
            "Tell \(.applicationName) to start a \(\.$length) timer",
            "Start a \(.applicationName) countdown",
            "Start a \(\.$length) countdown on \(.applicationName)",
            "Start a \(\.$name) countdown on \(.applicationName)",
        ], shortTitle: "Start Timer", systemImageName: "timer")
        AppShortcut(intent: CancelFrameTimer(), phrases: [
            "\(.applicationName) cancel",
            "\(.applicationName) cancel the countdown",
            "\(.applicationName) cancel the timer",
            "Tell \(.applicationName) to cancel the timer",
            "Ask \(.applicationName) to cancel the timer",
        ], shortTitle: "Cancel Timer", systemImageName: "xmark.circle")
        AppShortcut(intent: AddFrameTimerMinute(), phrases: [
            "\(.applicationName) add a minute",
            "Tell \(.applicationName) to add a minute",
        ], shortTitle: "Add a Minute", systemImageName: "plus.circle")
    }
}
