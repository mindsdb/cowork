package ai.mindshub.cowork;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * {@code window.Capacitor.Plugins.MindsHubAuth} (ENG-4023).
 *
 * <p>{@code authenticate({ url, callbackScheme })} opens the MindsHub sign-in page in a Custom Tab
 * and resolves with {@code { url }}, the full callback URL Keycloak redirected to (for example
 * {@code ai.mindshub.cowork://auth/callback?code=...}), which MainActivity receives through the
 * intent filter in AndroidManifest.xml. The web app's keycloak-js shell adapter finishes the PKCE
 * exchange.
 *
 * <p>Rejection codes: {@code CANCELLED} (the user came back to the app without finishing sign-in),
 * {@code IN_PROGRESS}, {@code INVALID_ARGUMENT}, {@code FAILED}.
 */
@CapacitorPlugin(name = "MindsHubAuth")
public class MindsHubAuthPlugin extends Plugin {

    /**
     * How long to wait after the app resumes for the callback intent before treating the return as
     * a cancel. onNewIntent normally lands before onResume, so this only has to cover slow devices.
     */
    private static final long CANCEL_GRACE_MS = 1500;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private PluginCall pendingCall;
    private String pendingScheme;
    /** True once the activity paused after the Custom Tab was launched. */
    private boolean leftAppForBrowser;
    private Runnable pendingCancel;

    @PluginMethod
    public void authenticate(PluginCall call) {
        String url = call.getString("url");
        String callbackScheme = call.getString("callbackScheme");
        Uri uri = url == null ? null : Uri.parse(url);
        if (!isSignInUri(uri)) {
            call.reject("authenticate needs an https MindsHub `url`", "INVALID_ARGUMENT");
            return;
        }
        if (callbackScheme == null || callbackScheme.isEmpty()) {
            call.reject("authenticate needs a `callbackScheme`", "INVALID_ARGUMENT");
            return;
        }
        if (pendingCall != null) {
            call.reject("A sign-in is already in progress", "IN_PROGRESS");
            return;
        }

        pendingCall = call;
        pendingScheme = callbackScheme;
        leftAppForBrowser = false;

        getActivity().runOnUiThread(() -> {
            try {
                CustomTabsIntent customTabs = new CustomTabsIntent.Builder().setShowTitle(true).build();
                customTabs.launchUrl(getActivity(), uri);
            } catch (ActivityNotFoundException e) {
                finishWithError("No browser is available to sign in", "FAILED");
            }
        });
    }

    /**
     * Only MindsHub's own sign-in pages, over https. The page asks for this tab, and a page can be
     * made to ask, so the tab must never open on a host that is not ours.
     */
    static boolean isSignInUri(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
            return false;
        }
        String host = uri.getHost().toLowerCase(java.util.Locale.ROOT);
        return host.equals("mindshub.ai") || host.endsWith(".mindshub.ai");
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (pendingCall == null || intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri data = intent.getData();
        if (data == null || data.getScheme() == null || !data.getScheme().equalsIgnoreCase(pendingScheme)) {
            return;
        }
        PluginCall call = takePendingCall();
        JSObject result = new JSObject();
        result.put("url", data.toString());
        call.resolve(result);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (pendingCall != null) {
            leftAppForBrowser = true;
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingCall == null || !leftAppForBrowser) {
            return;
        }
        // Back in the app with a sign-in still open: either the callback intent is about to be
        // delivered, or the user closed the Custom Tab. Give the intent a moment, then cancel.
        clearPendingCancel();
        pendingCancel = () -> {
            pendingCancel = null;
            if (pendingCall != null) {
                finishWithError("The user cancelled sign-in", "CANCELLED");
            }
        };
        mainHandler.postDelayed(pendingCancel, CANCEL_GRACE_MS);
    }

    @Override
    protected void handleOnDestroy() {
        clearPendingCancel();
        super.handleOnDestroy();
    }

    private void finishWithError(String message, String code) {
        PluginCall call = takePendingCall();
        if (call != null) {
            call.reject(message, code);
        }
    }

    private PluginCall takePendingCall() {
        clearPendingCancel();
        PluginCall call = pendingCall;
        pendingCall = null;
        pendingScheme = null;
        leftAppForBrowser = false;
        return call;
    }

    private void clearPendingCancel() {
        if (pendingCancel != null) {
            mainHandler.removeCallbacks(pendingCancel);
            pendingCancel = null;
        }
    }
}
