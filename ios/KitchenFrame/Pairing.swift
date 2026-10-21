import Foundation
import Security

/// The dashboard this phone talks to: its address and this phone's own key (dashboard/worker/devices.js),
/// from the frame's Settings → Home → Pair a phone.
struct Pairing: Codable, Equatable, Sendable {
    var url: URL
    var key: String
}

/// A pairing link from the frame's QR code: kitchenframe://pair?url=…&code=…, a one-time code the app
/// trades for a key of its own when the person confirms (API.claim). Older frames put the shared key
/// itself in the link (&key=…), which is still taken as it is.
struct PairingLink: Equatable, Sendable {
    var url: URL
    var code: String?
    var key: String?

    /// Nil when it isn't one (an https address and a code or key are required).
    static func from(link: URL) -> PairingLink? {
        guard link.scheme == "kitchenframe", link.host == "pair",
              let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        let value = { (name: String) in items.first { $0.name == name }?.value ?? "" }
        guard let url = URL(string: value("url")), url.scheme == "https", url.host != nil else { return nil }
        if !value("code").isEmpty { return PairingLink(url: url, code: value("code")) }
        if !value("key").isEmpty { return PairingLink(url: url, key: value("key")) }
        return nil
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
