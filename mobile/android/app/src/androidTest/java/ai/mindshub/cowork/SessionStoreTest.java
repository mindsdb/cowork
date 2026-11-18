package ai.mindshub.cowork;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.security.KeyStore;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SessionStoreTest {
    private Context context;
    private SessionStore store;
    private SharedPreferences prefs;
    @Before public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        store = new SessionStore(context, "test.invalid");
        prefs = context.getSharedPreferences("cowork_session.test.invalid", Context.MODE_PRIVATE);
        store.clear();
    }
    @After public void tearDown() throws Exception { store.clear(); }
    @Test public void survivesStoreRecreationWithoutPlaintext() throws Exception {
        String session = "test-secret";
        store.save(session);
        assertEquals(session, new SessionStore(context, "test.invalid").load());
        assertFalse(prefs.getString("session", "").contains("test-secret"));
    }
    @Test public void signOutDestroysKeyAndCannotRestoreOldCiphertext() throws Exception {
        store.save("old-session");
        String encrypted = prefs.getString("session", null);
        store.clear();
        prefs.edit().putString("session", encrypted).commit();
        assertNull(new SessionStore(context, "test.invalid").load());
        store.save("new-session");
        assertEquals("new-session", new SessionStore(context, "test.invalid").load());
    }
    @Test public void otherDeploymentCannotReadOrClearSession() throws Exception {
        store.save("synthetic-session");
        SessionStore other = new SessionStore(context, "other.invalid");
        try {
            assertNull(other.load());
            other.save("other-session");
            other.clear();
            assertEquals("synthetic-session", store.load());
        } finally { other.clear(); }
    }
    @Test public void corruptedCiphertextStartsSignedOut() throws Exception {
        store.save("session");
        prefs.edit().putString("session", "invalid ciphertext").commit();
        assertNull(store.load());
        assertFalse(prefs.contains("session"));
    }
    @Test public void restoredBackupWithoutKeyStartsSignedOut() throws Exception {
        store.save("session");
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        keys.deleteEntry("cowork_session.test.invalid");
        assertNull(store.load());
    }
}
