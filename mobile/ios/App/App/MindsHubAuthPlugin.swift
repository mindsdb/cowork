import AuthenticationServices
import Capacitor
import Foundation

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
@objc(MindsHubAuthPlugin)
public class MindsHubAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "MindsHubAuthPlugin"
    public let jsName = "MindsHubAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    /// Held for the session's lifetime: ASWebAuthenticationSession is torn
    /// down (and the sheet closed) as soon as nothing references it.
    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"),
              let url = URL(string: urlString),
              let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http" else {
            call.reject("authenticate needs an http(s) `url`", "INVALID_ARGUMENT")
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

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let window = bridge?.webView?.window ?? bridge?.viewController?.view.window {
            return window
        }
        return ASPresentationAnchor()
    }
}
