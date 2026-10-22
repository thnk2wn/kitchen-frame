import CommonCrypto
import Foundation
import SwiftUI

/// This phone's owner's PIN for the frame (POST /api/devices/pin; dashboard/worker/devices.js). It works
/// anywhere the frame asks for a PIN (unlocking a door, guest mode off, pairing a phone), and it's the
/// only one that shows its owner's own details there (their weight). Only a salted hash leaves the
/// phone, in the frame's own format (dashboard/src/lib/pin.js): PBKDF2-SHA256, 60,000 rounds, a random
/// 16-byte salt as hex, used as text. The digits themselves aren't kept, here or anywhere.
enum FramePin {
    static let length = 4
    private static let rounds: UInt32 = 60_000
    private static let setKey = "pin.set"

    static var isSet: Bool { UserDefaults.standard.bool(forKey: setKey) }

    static func hash(_ pin: String, salt: String) -> String {
        var out = [UInt8](repeating: 0, count: 32)
        let password = Array(pin.utf8).map { Int8(bitPattern: $0) }
        let saltBytes = Array(salt.utf8)
        _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, password.count, saltBytes, saltBytes.count,
                                 CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds, &out, out.count)
        return out.map { String(format: "%02x", $0) }.joined()
    }

    /// Sends a new PIN (its hash) for this phone's owner, under the name the frame shows them by.
    static func set(_ pin: String, person: String, api: API) async throws {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw URLError(.cannotCreateFile) }
        let salt = bytes.map { String(format: "%02x", $0) }.joined()
        let body: [String: Any] = ["pin": ["salt": salt, "hash": hash(pin, salt: salt)], "person": person]
        _ = try await api.post("api/devices/pin", body: try JSONSerialization.data(withJSONObject: body), contentType: "application/json")
        UserDefaults.standard.set(true, forKey: setKey)
    }

    static func remove(api: API) async throws {
        _ = try await api.post("api/devices/pin", body: try JSONSerialization.data(withJSONObject: ["pin": NSNull()]), contentType: "application/json")
        UserDefaults.standard.set(false, forKey: setKey)
    }
}

/// Settings → PIN: set, change or remove this phone's owner's PIN for the frame.
struct PinSettingsView: View {
    let api: API
    @State private var isSet = FramePin.isSet
    @State private var first = ""
    @State private var again = ""
    @State private var editing = false
    @State private var busy = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private var person: String {
        let name = FitnessSync.shared.name.trimmingCharacters(in: .whitespaces)
        return name.isEmpty ? "Phone" : name
    }
    private func digits(_ s: String) -> String { String(s.filter(\.isNumber).prefix(FramePin.length)) }

    var body: some View {
        Form {
            Section {
                LabeledContent("Your PIN", value: isSet ? "Set" : "Not set")
                if editing {
                    SecureField("New PIN (\(FramePin.length) digits)", text: Binding(get: { first }, set: { first = digits($0) }))
                        .keyboardType(.numberPad).focused($focused)
                    SecureField("Again", text: Binding(get: { again }, set: { again = digits($0) }))
                        .keyboardType(.numberPad)
                    Button(busy ? "Saving…" : "Save PIN") { Task { await save() } }
                        .disabled(busy || first.count != FramePin.length || again.count != FramePin.length)
                    Button("Cancel", role: .cancel) { editing = false; first = ""; again = ""; problem = nil }
                } else {
                    Button(isSet ? "Change PIN" : "Set PIN") { editing = true; problem = nil; focused = true }
                    if isSet { Button("Remove PIN", role: .destructive) { Task { await remove() } }.disabled(busy) }
                }
                if let problem { Text(problem).foregroundStyle(.red) }
            } footer: {
                Text("Works anywhere the frame asks for a PIN. Only yours shows your own details there, like your weight. Don’t reuse your phone or bank PIN: four digits are easy to guess from the frame.")
            }
        }
        .navigationTitle("PIN")
    }

    private func save() async {
        guard first == again else { problem = "The two PINs don’t match."; again = ""; return }
        busy = true
        defer { busy = false }
        do {
            try await FramePin.set(first, person: person, api: api)
            isSet = true; editing = false; first = ""; again = ""; problem = nil
            // Showing the weight waited for a PIN: send it now that there is one.
            if FitnessSync.shared.weightShow == .pin { await FitnessSync.shared.send(reason: "PIN set") }
        } catch { problem = error.localizedDescription }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            try await FramePin.remove(api: api)
            isSet = false; problem = nil
            // "With my PIN" and no PIN: the trend only, until there's one again.
            if FitnessSync.shared.weightShow == .pin { await FitnessSync.shared.send(reason: "Weight hidden (PIN removed)") }
        } catch { problem = error.localizedDescription }
    }
}
