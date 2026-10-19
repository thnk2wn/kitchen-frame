import Foundation

/// Calls to the Kitchen Frame Worker (dashboard/worker/index.js), with the dashboard key.
struct API: Sendable {
    let pairing: Pairing

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func send(_ path: String, method: String = "GET", body: Data? = nil, contentType: String? = nil, timeout: TimeInterval = 30) async throws -> Data {
        var req = URLRequest(url: pairing.url.appending(path: path), timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("Bearer " + pairing.key, forHTTPHeaderField: "Authorization")
        if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        req.httpBody = body
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let said = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw Failure(message: said ?? (status == 401 ? "The frame didn’t accept this phone’s key. Pair it again." : "The frame’s server answered \(status)."))
        }
        return data
    }

    private func json(_ value: some Encodable) throws -> Data { try JSONEncoder().encode(value) }

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
    }

    func status() async throws -> FrameStatus {
        try JSONDecoder().decode(FrameStatus.self, from: try await send("api/frame/status"))
    }

    /// Asks the frame to report what it's showing now (it answers within a second or two).
    func checkIn() async throws {
        _ = try await send("api/frame/checkin", method: "POST")
    }

    /// show (with a tab), slideshow, wake or close: the same commands Alexa sends.
    func command(_ command: String, tab: String? = nil) async throws {
        struct Command: Encodable { var command: String; var tab: String? }
        let data = try await send("api/frame/command", method: "POST", body: try json(Command(command: command, tab: tab)), contentType: "application/json")
        struct Sent: Decodable { var sent: Int? }
        if let sent = try? JSONDecoder().decode(Sent.self, from: data), sent.sent == 0 {
            throw Failure(message: "The frame isn’t connected right now.")
        }
    }
}
