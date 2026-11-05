import Capacitor
import UIKit

/// The app's bridge view controller. Local (in-app) plugins are not discovered
/// by `cap sync`, so they are registered here.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MindsHubAuthPlugin())
    }
}
