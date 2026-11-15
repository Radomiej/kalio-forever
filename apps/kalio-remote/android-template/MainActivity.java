package dev.kalio.remote;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public final class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RemoteVaultPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
