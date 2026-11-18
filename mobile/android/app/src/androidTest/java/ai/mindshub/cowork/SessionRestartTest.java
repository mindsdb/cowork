package ai.mindshub.cowork;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.FixMethodOrder;
import org.junit.Test;
import org.junit.runners.MethodSorters;
import static org.junit.Assert.*;

/** Also run these methods in separate instrumentation processes with a force-stop between them. */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
public class SessionRestartTest {
    private SessionStore store() {
        return new SessionStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
    }
    @Test public void aSave() throws Exception {
        store().clear();
        store().save("synthetic-restart-test-session");
    }
    @Test public void bRestore() throws Exception {
        assertEquals("synthetic-restart-test-session", store().load());
        store().clear();
        assertNull(store().load());
    }
}
