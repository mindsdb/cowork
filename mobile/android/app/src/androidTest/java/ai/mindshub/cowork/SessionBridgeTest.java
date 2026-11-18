package ai.mindshub.cowork;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Exercise the actual activity's main-frame and iframe credential boundary. */
@RunWith(AndroidJUnit4.class)
public class SessionBridgeTest {
    private String evaluate(WebView view, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("JavaScript completed", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitTrue(WebView view, String script) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(view, script))) return;
            Thread.sleep(50);
        }
        fail("Bridge condition was not met: " + script);
    }
    @Test public void mainFrameCanSaveButSameOriginChildCannotClear() throws Exception {
        SessionStore store = new SessionStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
        store.clear();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> reference = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView view = activity.getBridge().getWebView();
                reference.set(view);
                view.loadDataWithBaseURL(activity.getBridge().getServerUrl(),
                    "<html><body>Session bridge test</body></html>", "text/html", "UTF-8", null);
            });
            WebView view = reference.get();
            awaitTrue(view, "document.readyState === 'complete' && !!window.androidBridge");
            evaluate(view, "window.bridgeReplies=[]; androidBridge.onmessage=e=>bridgeReplies.push(JSON.parse(e.data));" +
                "androidBridge.postMessage(JSON.stringify({callbackId:'main-save',pluginId:'MindsHubAuth',methodName:'saveSession',options:{session:'synthetic-bridge-session'}}));");
            awaitTrue(view, "bridgeReplies.some(r=>r.callbackId==='main-save' && r.success)");
            assertEquals("synthetic-bridge-session", store.load());
            evaluate(view, "window.childAttempted=false; window.addEventListener('message',e=>{if(e.data==='attempted')childAttempted=true});" +
                "var frame=document.createElement('iframe');frame.srcdoc=\"<script>try{androidBridge.postMessage(JSON.stringify({callbackId:'child-clear',pluginId:'MindsHubAuth',methodName:'clearSession',options:{}}))}finally{parent.postMessage('attempted','*')}<\\/script>\";document.body.appendChild(frame);");
            awaitTrue(view, "childAttempted");
            evaluate(view, "androidBridge.postMessage(JSON.stringify({callbackId:'main-read',pluginId:'MindsHubAuth',methodName:'loadSession',options:{}}));");
            awaitTrue(view, "bridgeReplies.some(r=>r.callbackId==='main-read' && r.data.session==='synthetic-bridge-session')");
            assertEquals("synthetic-bridge-session", store.load());
            assertEquals("false", evaluate(view, "bridgeReplies.some(r=>r.callbackId==='child-clear')"));
        } finally { store.clear(); }
    }
}
