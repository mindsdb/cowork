package ai.mindshub.cowork;

import android.content.Context;
import android.util.AttributeSet;
import com.getcapacitor.CapacitorWebView;

/** Allow Capacitor's origin-checked listener, including on the first navigation. */
public final class CoworkWebView extends CapacitorWebView {
    public CoworkWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    public void addJavascriptInterface(Object object, String name) {
        // Capacitor tries this all-frame fallback if its listener is unavailable.
        if ("androidBridge".equals(name)) return;
        super.addJavascriptInterface(object, name);
    }
}
