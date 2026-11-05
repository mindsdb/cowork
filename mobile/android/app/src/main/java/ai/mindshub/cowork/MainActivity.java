package ai.mindshub.cowork;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins are not discovered by `cap sync`; register them before the
        // bridge is created in super.onCreate.
        registerPlugin(MindsHubAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
