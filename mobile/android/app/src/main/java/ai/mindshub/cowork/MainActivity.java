package ai.mindshub.cowork;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * The channel push notifications land in (finished tasks, scheduled runs, shared artifacts).
     * AndroidManifest.xml names it as Firebase's default channel, so a message without its own
     * {@code android.notification.channel_id} uses it. Changing the id strands users' per-channel
     * settings on the old one.
     */
    static final String PUSH_CHANNEL_ID = "cowork_updates";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local (in-app) plugins are not discovered by `cap sync`; register them before the
        // bridge is created in super.onCreate.
        registerPlugin(MindsHubAuthPlugin.class);
        registerPlugin(MindsHubPushPlugin.class);
        super.onCreate(savedInstanceState);
        createPushChannel();
    }

    /** Idempotent: creating an existing channel only updates its name and description. */
    private void createPushChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            PUSH_CHANNEL_ID,
            getString(R.string.push_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription(getString(R.string.push_channel_description));
        manager.createNotificationChannel(channel);
    }
}
