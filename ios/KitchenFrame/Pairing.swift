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

/// Kept in the Keychain (this device only), not in UserDefaults or a file, in a group the share
/// extension can read too (KeychainGroup in Info.plist: the team prefix and this app's id).
enum PairingStore {
    private static let group = Bundle.main.object(forInfoDictionaryKey: "KeychainGroup") as? String

    private static func query(shared: Bool) -> [String: Any] {
        var q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "kitchenframe",
            kSecAttrAccount as String: "pairing",
        ]
        if shared, let group { q[kSecAttrAccessGroup as String] = group }
        return q
    }

    private static func read(shared: Bool) -> Pairing? {
        var q = query(shared: shared)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }

    static func load() -> Pairing? {
        if let p = read(shared: true) { return p }
        // Paired before the share extension: move it to the shared group.
        guard let old = read(shared: false) else { return nil }
        save(old)
        return old
    }

    static func save(_ pairing: Pairing) {
        clear()
        var q = query(shared: true)
        q[kSecValueData as String] = try? JSONEncoder().encode(pairing)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func clear() {
        SecItemDelete(query(shared: true) as CFDictionary)
        SecItemDelete(query(shared: false) as CFDictionary)
    }
}
