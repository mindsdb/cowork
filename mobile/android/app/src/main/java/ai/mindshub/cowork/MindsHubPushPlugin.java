package ai.mindshub.cowork;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * {@code window.Capacitor.Plugins.MindsHubPush} (ENG-4023), Android only.
 *
 * <p>{@code isSupported()} resolves with {@code { supported }}: whether this build carries a
 * Firebase configuration. {@code PushNotifications.register()} calls
 * {@code FirebaseMessaging.getInstance()}, which throws on a build made without
 * {@code google-services.json}, and Capacitor rethrows a plugin method's exception on the main
 * thread, so the app would crash. The web app asks this first and treats push as unavailable
 * instead.
 *
 * <p>The google-services Gradle plugin turns {@code google-services.json} into string resources,
 * {@code google_app_id} among them; Firebase initializes from exactly that resource
 * ({@code FirebaseOptions.fromResource}), so its presence is the test.
 */
@CapacitorPlugin(name = "MindsHubPush")
public class MindsHubPushPlugin extends Plugin {

    @PluginMethod
    public void isSupported(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("supported", id != 0);
        call.resolve(result);
    }
}
