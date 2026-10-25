import Foundation

/// Calls to the Kitchen Frame Worker (dashboard/worker/index.js), with this phone's key.
struct API: Sendable {
    let pairing: Pairing

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func send(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil, timeout: TimeInterval = 30) async throws -> Data {
        let (data, res) = try await exchange(path, method: method, query: query, body: body, contentType: contentType, timeout: timeout)
        let status = res?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = Self.errorText(data)
            throw Failure(message: said ?? (status == 401 ? "The frame didn’t accept this phone’s key. Pair it again." : "The frame’s server answered \(status)."))
        }
        return data
    }

    /// The Worker's { error } text, whatever else the answer carries (home-only refusals add home: false).
    private static func errorText(_ data: Data) -> String? {
        struct Said: Decodable { var error: String? }
        return (try? JSONDecoder().decode(Said.self, from: data))?.error
    }

    /// Whether this phone is on the frame's home network, where Remote and Screenshot work
    /// (dashboard/worker/home.js). Nil when it couldn't be asked.
    func atHome() async -> Bool? {
        struct Home: Decodable { var home: Bool }
        return try? JSONDecoder().decode(Home.self, from: try await send("api/frame/home")).home
    }

    /// One request with the dashboard key, whatever it answers (send() turns anything but 2xx into a Failure).
    private func exchange(_ path: String, method: String = "GET", query: [URLQueryItem] = [], body: Data? = nil, contentType: String? = nil, timeout: TimeInterval = 30) async throws -> (Data, HTTPURLResponse?) {
        var url = pairing.url.appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("Bearer " + pairing.key, forHTTPHeaderField: "Authorization")
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        let (data, res) = try await URLSession.shared.data(for: req)
        return (data, res as? HTTPURLResponse)
    }

    private func json(_ value: some Encodable) throws -> Data { try JSONEncoder().encode(value) }

    /// Trades a pairing link's one-time code for this phone's own key (POST /api/devices/claim, the
    /// only call made without a key: the code is the proof). Throws the frame's reason when it's refused.
    static func claim(_ link: PairingLink, name: String) async throws -> Pairing {
        guard let code = link.code else { throw Failure(message: "That pairing code has no code in it.") }
        var req = URLRequest(url: link.url.appending(path: "api/devices/claim"), timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(["code": code, "name": name])
        let (data, res) = try await URLSession.shared.data(for: req)
        struct Claimed: Decodable { var token: String? }
        guard (res as? HTTPURLResponse)?.statusCode == 200, let token = (try? JSONDecoder().decode(Claimed.self, from: data))?.token else {
            throw Failure(message: errorText(data) ?? "The frame didn’t accept that pairing code. Show a new one on the frame.")
        }
        return Pairing(url: link.url, key: token)
    }

    // MARK: Screenshot

    /// What the frame's screen shows now (dashboard/worker/screenshot.js): asks it, then waits up to
    /// 30 s for its kiosk app to capture and upload a JPEG. The frame says if it couldn't.
    func screenshot() async throws -> (image: Data, takenAt: Date) {
        struct Asked: Decodable { var asked: Double; var sent: Int; var error: String? }
        let asked = try JSONDecoder().decode(Asked.self, from: try await send("api/frame/screenshot/request", method: "POST", body: Data("{}".utf8), contentType: "application/json"))
        if asked.sent == 0 { throw Failure(message: asked.error ?? "The frame isn’t connected right now.") }
        for _ in 0..<30 {
            try await Task.sleep(for: .seconds(1))
            let (data, res) = try await exchange("api/frame/screenshot", query: [URLQueryItem(name: "since", value: String(Int(asked.asked)))])
            switch res?.statusCode {
            case 200:
                let at = Double(res?.value(forHTTPHeaderField: "X-Taken-At") ?? "") ?? Date.now.timeIntervalSince1970 * 1000
                return (data, Date(timeIntervalSince1970: at / 1000))
            case 404: continue
            default:
                let said = Self.errorText(data)
                throw Failure(message: said ?? "The frame’s server answered \(res?.statusCode ?? 0).")
            }
        }
        throw Failure(message: "No screenshot came back. The frame may be off, or its kiosk app older than 1.7.")
    }

    func post(_ path: String, json value: [String: String], timeout: TimeInterval = 30) async throws -> Data {
        try await send(path, method: "POST", body: try json(value), contentType: "application/json", timeout: timeout)
    }

    func post(_ path: String, body: Data, contentType: String, timeout: TimeInterval = 30) async throws -> Data {
        try await send(path, method: "POST", body: body, contentType: contentType, timeout: timeout)
    }

    // MARK: Remote

    struct FrameStatus: Decodable, Sendable {
        var tab: String?
        var screen: String?
        var receivedAt: String?
        /// The frame's timers at its last check-in (dashboard/src/lib/timers.svelte.js).
        var timers: [FrameTimer]?
    }

    /// A timer on the frame: when it ends (ms since 1970), its whole length in seconds, and whether it's
    /// ringing.
    struct FrameTimer: Decodable, Sendable, Identifiable {
        var id: String
        var label: String
        var end: Double
        var total: Int
        var done: Bool
        var endsAt: Date { Date(timeIntervalSince1970: end / 1000) }
    }

    /// Everything the status page shows (dashboard/worker/ops.js), as JSON.
    func opsSummary() async throws -> Data {
        try await send("api/ops/summary")
    }

    func status() async throws -> FrameStatus {
        try JSONDecoder().decode(FrameStatus.self, from: try await send("api/frame/status"))
    }

    /// Asks the frame to report what it's showing now (it answers within a second or two).
    func checkIn() async throws {
        _ = try await send("api/frame/checkin", method: "POST")
    }

    // MARK: Fitness

    // Sending is in Fitness.swift (FitnessSync), which only the app has, not the share extension.

    /// Stops the frame showing this phone's person's rings (worker/fitness.js), by the phone's id.
    func removeFitness(id: String) async throws {
        _ = try await send("api/fitness", method: "DELETE", query: [URLQueryItem(name: "id", value: id)])
    }

    // MARK: Guest mode

    /// Guest mode (worker/guest.js): nothing personal (Fitness) on the frame, until it's turned off.
    struct Guest: Decodable, Sendable { var on: Bool }

    func guest() async throws -> Guest {
        try JSONDecoder().decode(Guest.self, from: try await send("api/frame/guest"))
    }

    func setGuest(_ on: Bool) async throws -> Guest {
        struct Body: Encodable { var on: Bool }
        return try JSONDecoder().decode(Guest.self, from: try await send("api/frame/guest", method: "POST", body: try json(Body(on: on)), contentType: "application/json"))
    }

    /// show (with a tab), slideshow, wake or close: the same commands Alexa sends.
    func command(_ command: String, tab: String? = nil) async throws {
        try await sendCommand(Command(command: command, tab: tab))
    }

    /// A timer on the frame, as Alexa starts them: start one (shown full screen there), or cancel or add
    /// to one, by its id, or with none the one ringing or ending next.
    func timer(_ action: String, label: String? = nil, seconds: Int? = nil, id: String? = nil) async throws {
        try await sendCommand(Command(command: "timer", action: action, label: label, seconds: seconds, id: id))
    }

    private struct Command: Encodable {
        var command: String
        var tab: String?
        var action: String?
        var label: String?
        var seconds: Int?
        var id: String?
    }

    private func sendCommand(_ c: Command) async throws {
        let data = try await send("api/frame/command", method: "POST", body: try json(c), contentType: "application/json")
        struct Sent: Decodable { var sent: Int? }
        if let sent = try? JSONDecoder().decode(Sent.self, from: data), sent.sent == 0 {
            throw Failure(message: "The frame isn’t connected right now.")
        }
    }
}
