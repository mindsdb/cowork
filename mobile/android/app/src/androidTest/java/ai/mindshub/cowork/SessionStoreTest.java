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
        store = new SessionStore(context);
        prefs = context.getSharedPreferences("cowork_session", Context.MODE_PRIVATE);
        store.clear();
    }
    @After public void tearDown() throws Exception { store.clear(); }
    @Test public void survivesStoreRecreationWithoutPlaintext() throws Exception {
        String session = "test-secret";
        store.save(session);
        assertEquals(session, new SessionStore(context).load());
        assertFalse(prefs.getString("session", "").contains("test-secret"));
    }
    @Test public void signOutDestroysKeyAndCannotRestoreOldCiphertext() throws Exception {
        store.save("old-session");
        String encrypted = prefs.getString("session", null);
        store.clear();
        prefs.edit().putString("session", encrypted).commit();
        assertNull(new SessionStore(context).load());
        store.save("new-session");
        assertEquals("new-session", new SessionStore(context).load());
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
        keys.deleteEntry("cowork_session");
        assertNull(store.load());
    }
}
