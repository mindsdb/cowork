import AuthenticationServices
import Capacitor
import Foundation
import Security

/// `window.Capacitor.Plugins.MindsHubAuth` (ENG-4023).
///
/// `authenticate({ url, callbackScheme })` opens the MindsHub sign-in page in
/// an `ASWebAuthenticationSession` (a real Safari sheet, so Google sign-in and
/// saved passwords work) and resolves with `{ url }`, the full callback URL
/// Keycloak redirected to (e.g. `ai.mindshub.cowork://auth/callback?code=…`).
/// The web app's keycloak-js shell adapter finishes the PKCE exchange.
///
/// Rejection codes: `CANCELLED` (user closed the sheet), `IN_PROGRESS`,
/// `INVALID_ARGUMENT`, `FAILED`.
///
/// `loadSession()`, `saveSession({ session })` and `clearSession()` keep the
/// signed-in session (an opaque string from the web app) in the Keychain, so
/// the next launch can restore it. See `SessionKeychain`.
@objc(MindsHubAuthPlugin)
public class MindsHubAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "MindsHubAuthPlugin"
    public let jsName = "MindsHubAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSession", returnType: CAPPluginReturnPromise)
    ]

    /// Held for the session's lifetime: ASWebAuthenticationSession is torn
    /// down (and the sheet closed) as soon as nothing references it.
    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              MindsHubAuthPlugin.isSignInURL(url) else {
            call.reject("authenticate needs an https MindsHub `url`", "INVALID_ARGUMENT")
            return
        }
        guard let callbackScheme = call.getString("callbackScheme"), !callbackScheme.isEmpty else {
            call.reject("authenticate needs a `callbackScheme`", "INVALID_ARGUMENT")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.session != nil {
                call.reject("A sign-in is already in progress", "IN_PROGRESS")
                return
            }

            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { [weak self] callbackURL, error in
                DispatchQueue.main.async {
                    self?.session = nil
                    if let callbackURL = callbackURL {
                        call.resolve(["url": callbackURL.absoluteString])
                    } else if let authError = error as? ASWebAuthenticationSessionError,
                              authError.code == .canceledLogin {
                        call.reject("The user cancelled sign-in", "CANCELLED")
                    } else {
                        call.reject(error?.localizedDescription ?? "Sign-in failed", "FAILED", error)
                    }
                }
            }
            session.presentationContextProvider = self
            // Share Safari's cookies so a user already signed in to MindsHub
            // (or Google) is not asked again.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session

            if !session.start() {
                self.session = nil
                call.reject("Could not start the sign-in session", "FAILED")
            }
        }
    }

    @objc func loadSession(_ call: CAPPluginCall) {
        if let session = SessionKeychain.load() {
            call.resolve(["session": session])
        } else {
            call.resolve()
        }
    }

    @objc func saveSession(_ call: CAPPluginCall) {
        guard let session = call.getString("session"), !session.isEmpty else {
            call.reject("saveSession needs a `session`", "INVALID_ARGUMENT")
            return
        }
        if SessionKeychain.save(session) {
            call.resolve()
        } else {
            call.reject("Could not save the session", "FAILED")
        }
    }

    @objc func clearSession(_ call: CAPPluginCall) {
        SessionKeychain.clear()
        call.resolve()
    }

    /// Only MindsHub's own sign-in pages, over https. The page asks for this
    /// sheet, and a page can be made to ask (script in an embedded frame), so
    /// the sheet must never open on a host that is not ours.
    static func isSignInURL(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else {
            return false
        }
        return host == "mindshub.ai" || host.hasSuffix(".mindshub.ai")
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.webView?.window ?? bridge?.viewController?.view.window {
            return window
        }
        return ASPresentationAnchor()
    }
}

/// The saved session, as one generic-password Keychain item.
///
/// It is readable only while the device has been unlocked since boot, and
/// never leaves this device (no iCloud Keychain, no backup restore onto
/// another phone). Keychain items outlive an uninstall, so the first read
/// after a fresh install deletes any item left by an earlier install: a
/// reinstalled app starts signed out.
enum SessionKeychain {
    private static let service = "ai.mindshub.cowork.session"
    private static let account = "keycloak"
    private static let installMarker = "ai.mindshub.cowork.sessionStoreReady"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> String? {
        forgetPreviousInstall()
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ session: String) -> Bool {
        forgetPreviousInstall()
        let data = Data(session.utf8)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var item = query
        item.merge(attributes) { _, new in new }
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }

    /// UserDefaults are removed on uninstall and Keychain items are not, so a
    /// missing marker means this is the first launch of a fresh install.
    private static func forgetPreviousInstall() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: installMarker) else { return }
        clear()
        defaults.set(true, forKey: installMarker)
    }
}
