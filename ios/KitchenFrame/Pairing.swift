import Foundation
import Security

/// The dashboard this phone talks to: its address and key, from the frame's Settings → About →
/// Pair a phone (a QR code the iPhone camera opens as kitchenframe://pair?url=…&key=…).
struct Pairing: Codable, Equatable, Sendable {
    var url: URL
    var key: String

    /// The pairing link from the frame's QR code, or nil when it isn't one (an https address is required).
    static func from(link: URL) -> Pairing? {
        guard link.scheme == "kitchenframe", link.host == "pair",
              let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        let value = { (name: String) in items.first { $0.name == name }?.value ?? "" }
        guard let url = URL(string: value("url")), url.scheme == "https", url.host != nil, !value("key").isEmpty else { return nil }
        return Pairing(url: url, key: value("key"))
    }
}

/// Kept in the Keychain (this device only), not in UserDefaults or a file.
enum PairingStore {
    private static var query: [String: Any] { [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "kitchenframe",
        kSecAttrAccount as String: "pairing",
    ] }

    static func load() -> Pairing? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }

    static func save(_ pairing: Pairing) {
        clear()
        var q = query
        q[kSecValueData as String] = try? JSONEncoder().encode(pairing)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
