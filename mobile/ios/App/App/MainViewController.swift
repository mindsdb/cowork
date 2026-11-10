import Capacitor
import UIKit
import WebKit

/// The app's bridge view controller. Local (in-app) plugins are not discovered
/// by `cap sync`, so they are registered here.
class MainViewController: CAPBridgeViewController {
    private var mainFrameBridgeFilter: MainFrameBridgeFilter?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MindsHubAuthPlugin())
        restrictBridgeToMainFrame()
    }

    /// Capacitor registers its `bridge` message handler for every frame and
    /// does not check which frame a call came from. The web app renders
    /// generated HTML in sandboxed iframes, and those must not reach native
    /// plugins, so the handler is replaced by one that only forwards calls
    /// from the main frame.
    private func restrictBridgeToMainFrame() {
        guard let webView = webView,
              let capacitorHandler = webView.navigationDelegate as? WKScriptMessageHandler else {
            return
        }
        let filter = MainFrameBridgeFilter(target: capacitorHandler)
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: MainFrameBridgeFilter.handlerName)
        controller.add(filter, name: MainFrameBridgeFilter.handlerName)
        mainFrameBridgeFilter = filter
    }
}

/// Forwards Capacitor bridge messages from the main frame; drops the rest.
final class MainFrameBridgeFilter: NSObject, WKScriptMessageHandler {
    /// The name Capacitor registers its handler under (WebViewDelegationHandler).
    static let handlerName = "bridge"

    private weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        target?.userContentController(userContentController, didReceive: message)
    }
}
