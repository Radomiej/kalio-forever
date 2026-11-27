package dev.kalio.remote;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "RemoteVault")
public final class RemoteVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "kalio.remote.host-vault.v1";
    private static final int MAX_BYTES = 262144;
    private static final int IV_BYTES = 12;

    private AtomicFile file() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(), "remote-hosts.v1"));
    }

    private SecretKey key(boolean createIfMissing) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        if (!createIfMissing) throw new IllegalStateException("Vault key missing");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    @PluginMethod
    public synchronized void read(PluginCall call) {
        AtomicFile vault = file();
        try {
            byte[] sealed = vault.readFully();
            if (sealed.length < IV_BYTES + 16 || sealed.length > MAX_BYTES + IV_BYTES + 16) {
                call.reject("REMOTE_VAULT_INVALID");
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, sealed, 0, IV_BYTES));
            byte[] value = cipher.doFinal(sealed, IV_BYTES, sealed.length - IV_BYTES);
            call.resolve(new JSObject().put("value", new String(value, StandardCharsets.UTF_8)));
        } catch (FileNotFoundException missing) {
            if (vault.getBaseFile().exists()) call.reject("REMOTE_VAULT_READ_FAILED");
            else call.resolve(new JSObject().put("value", "[]"));
        } catch (Exception ignored) {
            call.reject("REMOTE_VAULT_READ_FAILED");
        }
    }

    @PluginMethod
    public synchronized void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > MAX_BYTES) {
            call.reject("REMOTE_VAULT_INVALID");
            return;
        }
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) {
            call.reject("REMOTE_VAULT_INVALID");
            return;
        }
        AtomicFile vault = file();
        FileOutputStream output = null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            byte[] iv = cipher.getIV();
            if (iv.length != IV_BYTES) throw new IllegalStateException("Unexpected vault nonce size");
            byte[] encrypted = cipher.doFinal(bytes);
            byte[] sealed = ByteBuffer.allocate(IV_BYTES + encrypted.length).put(iv).put(encrypted).array();
            output = vault.startWrite();
            output.write(sealed);
            vault.finishWrite(output);
            call.resolve();
        } catch (Exception ignored) {
            if (output != null) vault.failWrite(output);
            call.reject("REMOTE_VAULT_WRITE_FAILED");
        }
    }
}
