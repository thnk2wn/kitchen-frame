import Foundation
import HealthKit

/// Sends this phone owner's Activity rings, today's steps and recent workouts to the frame's Fitness tab
/// (POST /api/fitness; dashboard/worker/fitness.js). Nothing else from Health leaves the phone.
///
/// When it sends: when the app opens, from Settings → Send now, and when HealthKit wakes the app with
/// new data (background delivery: workouts as soon as they're saved, the rest at most hourly, at
/// iOS's discretion). Health data is locked while the phone is, so a wake-up then reads nothing and
/// the next one catches up. The frame shows how old each person's numbers are.
@MainActor @Observable
final class FitnessSync {
    static let shared = FitnessSync()

    /// One send, for Settings' "Recent sends": when, why, and whether it worked.
    struct Sent: Codable, Identifiable {
        var at: Date
        var reason: String
        var error: String?
        var id: Date { at }
    }

    private let store = HKHealthStore()
    private let defaults = UserDefaults.standard
    private var queries: [HKObserverQuery] = []
    /// Who this phone is to the Worker: made once, so two people typing the same name stay two people.
    let phoneId: String

    var enabled: Bool { didSet { defaults.set(enabled, forKey: "fitness.enabled") } }
    /// The name the frame shows for this phone's owner.
    var name: String { didSet { defaults.set(name, forKey: "fitness.name") } }
    /// Settings → Apple Health → Average heart rate: off unless turned on (it needs its own Health access).
    var heartRate: Bool { didSet { defaults.set(heartRate, forKey: "fitness.heartRate") } }
    private(set) var history: [Sent] { didSet { defaults.set(try? JSONEncoder().encode(history), forKey: "fitness.history") } }
    private(set) var sending = false
    private var resendAfter: String?

    /// The sends Settings lists: the last 24 hours, at most 8.
    var recent: [Sent] { Array(history.filter { Date.now.timeIntervalSince($0.at) < 24 * 3600 }.prefix(8)) }

    /// Settings' Apple Health row: "Off", or "On · sent 5 min ago" (or the last send's problem).
    var summary: String {
        guard enabled else { return "Off" }
        guard let last = history.first else { return "On" }
        return last.error != nil ? "On · last send failed" : "On · sent " + last.at.formatted(.relative(presentation: .named))
    }

    private init() {
        enabled = defaults.bool(forKey: "fitness.enabled")
        name = defaults.string(forKey: "fitness.name") ?? ""
        heartRate = defaults.bool(forKey: "fitness.heartRate")
        history = (defaults.data(forKey: "fitness.history")).flatMap { try? JSONDecoder().decode([Sent].self, from: $0) } ?? []
        if let id = defaults.string(forKey: "fitness.id") { phoneId = id } else {
            phoneId = UUID().uuidString.lowercased()
            defaults.set(phoneId, forKey: "fitness.id")
        }
    }

    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    private static let workouts = HKObjectType.workoutType()
    private static let energy = HKQuantityType(.activeEnergyBurned)
    private static let exercise = HKQuantityType(.appleExerciseTime)
    private static let standHour = HKCategoryType(.appleStandHour)
    private static let steps = HKQuantityType(.stepCount)
    private static let walkRun = HKQuantityType(.distanceWalkingRunning)
    private static let cycling = HKQuantityType(.distanceCycling)
    private static let swimming = HKQuantityType(.distanceSwimming)
    private static let resting = HKQuantityType(.basalEnergyBurned)
    private static let effort = HKQuantityType(.workoutEffortScore)
    private static let estimatedEffort = HKQuantityType(.estimatedWorkoutEffortScore)
    private static let heart = HKQuantityType(.heartRate)

    /// Asks once for read access to just what the frame shows (iOS shows the Health sheet the first time).
    func requestAccess() async throws {
        var read: Set<HKObjectType> = [HKObjectType.activitySummaryType(), Self.workouts, Self.energy, Self.exercise, Self.standHour, Self.steps, Self.walkRun, Self.cycling, Self.swimming,
                                       Self.resting, Self.effort, Self.estimatedEffort]
        if heartRate { read.insert(Self.heart) }
        try await store.requestAuthorization(toShare: [], read: read)
    }

    /// At launch (including a background launch for new Health data): watch for changes if sharing is on.
    /// Observers have to be set up at every launch for background delivery to reach the app.
    func startIfEnabled() {
        guard enabled, Self.available, queries.isEmpty else { return }
        let watched: [(HKSampleType, HKUpdateFrequency)] = [(Self.workouts, .immediate), (Self.energy, .hourly), (Self.exercise, .hourly), (Self.standHour, .hourly), (Self.steps, .hourly)]
        for (type, frequency) in watched {
            let isWorkout = type == Self.workouts
            let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
                guard error == nil else { completion(); return }
                // HealthKit's completion handler may be called from any thread; it isn't marked Sendable.
                let done = Done(completion)
                Task { @MainActor in
                    await FitnessSync.shared.sendFromBackground(workout: isWorkout)
                    done.call()
                }
            }
            store.execute(query)
            queries.append(query)
            store.enableBackgroundDelivery(for: type, frequency: frequency) { _, _ in }
        }
    }

    /// Turns sharing off (Settings, or unpairing): no more wake-ups, and the frame stops showing this
    /// person. Waits for a send already under way, so it can't land after the removal.
    func stop() async {
        enabled = false
        queries.forEach(store.stop)
        queries = []
        try? await store.disableAllBackgroundDelivery()
        while sending { try? await Task.sleep(for: .milliseconds(200)) }
        if let pairing = PairingStore.load() { try? await API(pairing: pairing).removeFitness(id: phoneId) }
    }

    /// A background wake-up. Each one may be a new launch, so the last send is remembered on disk:
    /// at most one send every 2 minutes, for the burst when several kinds of data change at one Watch
    /// sync. No longer than that: iOS wakes the app at most hourly per kind, so a wake-up skipped here
    /// can be the only one that hour (a send from the iPhone's own steps, then the Watch's rings
    /// minutes later, left the frame on no rings for an hour).
    /// (Observers also fire once when they start, so a launch shows up here too.)
    private func sendFromBackground(workout: Bool) async {
        // A send already under way: wait for it (and the one it queues) before reporting done to
        // HealthKit, which ends the background time the queued send needs.
        while sending { try? await Task.sleep(for: .milliseconds(200)) }
        let key = workout ? "fitness.lastWorkoutSend" : "fitness.lastRingSend"
        let last = defaults.object(forKey: key) as? Date ?? .distantPast
        guard Date.now.timeIntervalSince(last) >= 2 * 60 else { return }
        if await send(reason: workout ? "Health update (workouts)" : "Health update (rings)") { defaults.set(Date.now, forKey: key) }
    }

    /// The frame's Refresh (its notification's link opened the app): sends now and says how it went,
    /// for the banner. Opening the app sends too, so one may already be under way: then its result
    /// answers (it read Health just now). Nil when sharing is off or has no name, so nothing was sent.
    func answerFrame() async -> Sent? {
        let asked = Date.now.addingTimeInterval(-10)
        if !(await send(reason: "Frame asked")) { while sending { try? await Task.sleep(for: .milliseconds(200)) } }
        return history.first { $0.at >= asked }
    }

    /// Reads today and the past week and sends it. Errors are kept for Settings, not thrown; true if sent.
    @discardableResult
    func send(reason: String) async -> Bool {
        // One send at a time. One asked for meanwhile (heart rate just turned off, say) runs after it,
        // so the Worker ends up with what the settings are now, not when the first send read Health.
        if sending { resendAfter = reason; return false }
        guard enabled, !name.isEmpty else { return false }
        var entry = Sent(at: .now, reason: reason)
        defer { history = Array(([entry] + history).prefix(12)) }
        guard let pairing = PairingStore.load() else { entry.error = "Not paired with a frame"; return false }
        sending = true
        defer {
            sending = false
            if let next = resendAfter { resendAfter = nil; Task { await send(reason: next) } }
        }
        do {
            let report = try await read(reason: reason)
            // HealthKit doesn't say when read access was refused; it just returns nothing.
            guard !report.days.isEmpty else { entry.error = "No ring data from Health. Check Kitchen Frame’s Health access."; return false }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            _ = try await API(pairing: pairing).post("api/fitness", body: try encoder.encode(report), contentType: "application/json")
            return true
        } catch {
            entry.error = (error as? HKError)?.code == .errorDatabaseInaccessible ? "Phone was locked" : error.localizedDescription
            return false
        }
    }

    /// Carries HealthKit's observer completion handler (safe from any thread) into the main actor.
    private final class Done: @unchecked Sendable {
        let call: () -> Void
        init(_ call: @escaping () -> Void) { self.call = call }
    }

    // MARK: Reading Health

    struct Report: Encodable {
        var id: String
        /// One day's rings, with its steps and workout minutes for the frame's trends (streaks, against
        /// the usual, workout days): the last 4 weeks and today.
        struct Day: Encodable { var date: String; var move, moveGoal, exercise, exerciseGoal, stand, standGoal: Double; var steps: Double?; var workoutMinutes: Double? }
        /// The workout sheet's details too: total calories (active and resting), climb, Apple's effort
        /// score, the weather the Watch saved, and average heart rate when that setting is on.
        struct Workout: Encodable {
            var type: String; var kind: String; var start: Date; var minutes: Double; var kcal: Double?; var meters: Double?
            var totalKcal: Double?; var climbMeters: Double?; var effort: Double?; var tempC: Double?; var humidity: Double?; var heartRate: Double?
        }
        var name: String
        var reason: String
        var unit: String
        var days: [Day]
        var steps: Double?
        var meters: Double?
        var workouts: [Workout]
        /// When the newest active-energy reading ends: how current the rings are, which a send time
        /// isn't (a send early in the day can come before the Watch has synced).
        var dataAt: Date?
    }

    private func read(reason: String) async throws -> Report {
        let cal = Calendar.current
        let today = cal.startOfDay(for: .now)
        let from = cal.date(byAdding: .day, value: -28, to: today)!
        async let rings = summaries(from: from, calendar: cal)
        async let dailySteps = perDay(Self.steps, unit: .count(), from: from, calendar: cal)
        async let dailyWorkout = workoutMinutesPerDay(from: from, calendar: cal)
        async let steps = sum(Self.steps, unit: .count(), since: today)
        async let meters = sum(Self.walkRun, unit: .meter(), since: today)
        async let workouts = recentWorkouts(since: cal.date(byAdding: .day, value: -14, to: today)!)
        async let dataAt = latestEnd(Self.energy, since: cal.date(byAdding: .day, value: -2, to: today)!)
        let (stepsBy, workoutBy) = (try await dailySteps, try await dailyWorkout)
        let days = try await rings.map { d in
            var d = d
            d.steps = stepsBy[d.date]
            d.workoutMinutes = workoutBy[d.date] ?? 0
            return d
        }
        return Report(id: phoneId, name: name, reason: reason, unit: Locale.current.measurementSystem == .metric ? "km" : "mi",
                      days: days, steps: try await steps, meters: try await meters, workouts: try await workouts, dataAt: try await dataAt)
    }

    /// "2026-10-19" for the day a Date falls on here.
    private static func dayKey(_ date: Date, _ cal: Calendar) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// A day-by-day total of a quantity (steps) since a day's start, by local day.
    private func perDay(_ type: HKQuantityType, unit: HKUnit, from start: Date, calendar cal: Calendar) async throws -> [String: Double] {
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil)),
            options: .cumulativeSum, anchorDate: start, intervalComponents: DateComponents(day: 1))
        var out: [String: Double] = [:]
        try await descriptor.result(for: store).enumerateStatistics(from: start, to: .now) { stats, _ in
            if let v = stats.sumQuantity()?.doubleValue(for: unit) { out[Self.dayKey(stats.startDate, cal)] = v }
        }
        return out
    }

    /// Minutes of workouts per local day (by when each started), for "worked out on 19 of 28 days".
    private func workoutMinutesPerDay(from start: Date, calendar cal: Calendar) async throws -> [String: Double] {
        let descriptor = HKSampleQueryDescriptor(predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: nil))], sortDescriptors: [])
        var out: [String: Double] = [:]
        for w in Self.unique(try await descriptor.result(for: store)) { out[Self.dayKey(w.startDate, cal), default: 0] += w.duration / 60 }
        return out
    }

    /// One ring summary per day. The day comes from the summary's own year, month and day, never via a
    /// Date (a Date for a bare day lands at UTC midnight and reads as the day before here).
    private func summaries(from start: Date, calendar cal: Calendar) async throws -> [Report.Day] {
        var from = cal.dateComponents([.era, .year, .month, .day], from: start)
        var to = cal.dateComponents([.era, .year, .month, .day], from: .now)
        from.calendar = cal
        to.calendar = cal
        let predicate = HKQuery.predicate(forActivitySummariesBetweenStart: from, end: to)
        let summaries: [HKActivitySummary] = try await withCheckedThrowingContinuation { cont in
            store.execute(HKActivitySummaryQuery(predicate: predicate) { _, results, error in
                if let error { cont.resume(throwing: error) } else { cont.resume(returning: results ?? []) }
            })
        }
        return summaries.compactMap { s in
            let c = s.dateComponents(for: cal)
            guard let y = c.year, let m = c.month, let d = c.day else { return nil }
            return Report.Day(
                date: String(format: "%04d-%02d-%02d", y, m, d),
                move: s.activeEnergyBurned.doubleValue(for: .kilocalorie()),
                moveGoal: s.activeEnergyBurnedGoal.doubleValue(for: .kilocalorie()),
                exercise: s.appleExerciseTime.doubleValue(for: .minute()),
                exerciseGoal: (s.exerciseTimeGoal ?? s.appleExerciseTimeGoal).doubleValue(for: .minute()),
                stand: s.appleStandHours.doubleValue(for: .count()),
                standGoal: (s.standHoursGoal ?? s.appleStandHoursGoal).doubleValue(for: .count()), steps: nil, workoutMinutes: nil)
        }
    }

    private func sum(_ type: HKQuantityType, unit: HKUnit, since start: Date) async throws -> Double? {
        let predicate = HKSamplePredicate.quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil))
        let stats = try await HKStatisticsQueryDescriptor(predicate: predicate, options: .cumulativeSum).result(for: store)
        return stats?.sumQuantity()?.doubleValue(for: unit)
    }

    /// The end of the newest sample of a type since a time, if any.
    private func latestEnd(_ type: HKQuantityType, since start: Date) async throws -> Date? {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)], limit: 1)
        return try await descriptor.result(for: store).first?.endDate
    }

    private func recentWorkouts(since start: Date) async throws -> [Report.Workout] {
        // Ten, then the first five once copies are gone: other apps (Strava, Peloton) save a Watch
        // workout again, with the same start and type.
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: nil))],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)], limit: 10)
        var out: [Report.Workout] = []
        for w in Self.unique(try await descriptor.result(for: store)).prefix(5) {
            let distance = [Self.walkRun, Self.cycling, Self.swimming].lazy
                .compactMap { w.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }.first
            let indoor = w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool
            let active = w.statistics(for: Self.energy)?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let rest = w.statistics(for: Self.resting)?.sumQuantity()?.doubleValue(for: .kilocalorie())
            let quantity = { (key: String, unit: HKUnit) in (w.metadata?[key] as? HKQuantity).map { $0.doubleValue(for: unit) } }
            out.append(Report.Workout(
                type: Self.title(w.workoutActivityType, indoor: indoor), kind: Self.kind(w.workoutActivityType), start: w.startDate,
                minutes: w.duration / 60, kcal: active, meters: distance,
                totalKcal: active.map { $0 + (rest ?? 0) },
                climbMeters: quantity(HKMetadataKeyElevationAscended, .meter()),
                effort: await effortScore(of: w),
                tempC: quantity(HKMetadataKeyWeatherTemperature, .degreeCelsius()),
                humidity: quantity(HKMetadataKeyWeatherHumidity, .percent()).map { $0 * 100 },
                heartRate: heartRate ? w.statistics(for: Self.heart)?.averageQuantity()?.doubleValue(for: HKUnit.count().unitDivided(by: .minute())) : nil))
        }
        return out
    }

    /// Workouts with copies (the same start and type) left out, in order.
    private static func unique(_ workouts: [HKWorkout]) -> [HKWorkout] {
        var seen = Set<String>()
        return workouts.filter { seen.insert("\(Int($0.startDate.timeIntervalSince1970))|\($0.workoutActivityType.rawValue)").inserted }
    }

    /// The effort the person rated on the Watch, else Apple's estimate (1-10), or nil.
    private func effortScore(of w: HKWorkout) async -> Double? {
        for type in [Self.effort, Self.estimatedEffort] {
            let related = HKQuery.predicateForWorkoutEffortSamplesRelated(workout: w, activity: nil)
            let d = HKSampleQueryDescriptor(predicates: [.quantitySample(type: type, predicate: related)], sortDescriptors: [], limit: 1)
            if let s = try? await d.result(for: store).first { return s.quantity.doubleValue(for: .appleEffortScore()) }
        }
        return nil
    }

    /// The frame's icon group for a workout (worker/fitness.js KINDS).
    static func kind(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: "run"
        case .walking, .hiking: "walk"
        case .cycling, .handCycling: "bike"
        case .swimming, .waterFitness: "swim"
        case .traditionalStrengthTraining, .functionalStrengthTraining, .coreTraining: "strength"
        case .yoga, .pilates, .mindAndBody, .flexibility, .cooldown: "yoga"
        case .highIntensityIntervalTraining, .crossTraining, .mixedCardio, .jumpRope, .kickboxing: "hiit"
        case .elliptical, .stairClimbing, .stairs, .stepTraining: "elliptical"
        case .rowing, .paddleSports: "rowing"
        default: "other"
        }
    }

    /// The name the Fitness app uses, near enough.
    static func title(_ t: HKWorkoutActivityType, indoor: Bool?) -> String {
        let place = indoor == true ? "Indoor" : "Outdoor"
        switch t {
        case .running: return "\(place) run"
        case .walking: return "\(place) walk"
        case .cycling: return "\(place) cycle"
        case .hiking: return "Hike"
        case .swimming: return indoor == false ? "Open water swim" : "Pool swim"
        case .traditionalStrengthTraining: return "Strength training"
        case .functionalStrengthTraining: return "Functional strength"
        case .coreTraining: return "Core training"
        case .yoga: return "Yoga"
        case .pilates: return "Pilates"
        case .mindAndBody: return "Mind and body"
        case .flexibility: return "Flexibility"
        case .cooldown: return "Cooldown"
        case .highIntensityIntervalTraining: return "HIIT"
        case .crossTraining: return "Cross training"
        case .mixedCardio: return "Mixed cardio"
        case .elliptical: return "Elliptical"
        case .stairClimbing, .stairs: return "Stair stepper"
        case .rowing: return "Rower"
        case .dance, .cardioDance, .socialDance: return "Dance"
        case .tennis: return "Tennis"
        case .pickleball: return "Pickleball"
        case .golf: return "Golf"
        case .basketball: return "Basketball"
        case .soccer: return "Soccer"
        case .jumpRope: return "Jump rope"
        case .kickboxing: return "Kickboxing"
        default: return "Workout"
        }
    }
}
