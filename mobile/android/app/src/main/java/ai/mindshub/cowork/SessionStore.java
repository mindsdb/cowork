package ai.mindshub.cowork;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The saved sign-in session: an opaque string from the web app, encrypted with an AES-GCM key that
 * lives in the Android Keystore and never leaves it. Only the ciphertext is written to the app's
 * private preferences.
 *
 * <p>Keystore keys are deleted on uninstall and are not part of a backup, so ciphertext restored
 * from a backup, or left from an earlier install, can't be decrypted. {@link #load} treats that as
 * no session and deletes it: a reinstalled or restored app starts signed out.
 */
final class SessionStore {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "cowork_session";
    private static final String PREFS = "cowork_session";
    private static final String PREF_VALUE = "session";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    private static final int IV_BYTES = 12;

    private final SharedPreferences prefs;

    SessionStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The saved session, or null when there is none or it can't be decrypted. */
    String load() {
        String stored = prefs.getString(PREF_VALUE, null);
        if (stored == null) return null;
        try {
            byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
            if (blob.length <= IV_BYTES) throw new IllegalStateException("truncated session");
            SecretKey key = existingKey();
            if (key == null) throw new IllegalStateException("no key");
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES));
            byte[] plain = cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception e) {
            clear();
            return null;
        }
    }

    void save(String session) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(session.getBytes(StandardCharsets.UTF_8));
        byte[] blob = new byte[iv.length + sealed.length];
        System.arraycopy(iv, 0, blob, 0, iv.length);
        System.arraycopy(sealed, 0, blob, iv.length, sealed.length);
        if (!prefs.edit().putString(PREF_VALUE, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("could not write the session");
        }
    }

    void clear() {
        prefs.edit().remove(PREF_VALUE).commit();
    }

    private SecretKey existingKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private SecretKey key() throws Exception {
        SecretKey existing = existingKey();
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }
}
