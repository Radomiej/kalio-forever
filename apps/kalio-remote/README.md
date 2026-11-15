# Kalio Remote

A standalone React, TypeScript, Vite, and Capacitor Android supervision client. It pairs directly with a Kalio relay; there is no account service.

## Run
- `npm install`
- `npm run dev` for the browser client
- `npm run build`
- `npx cap add android` once, then `npm run android:sync` and `npm run android:open`

## Pairing and credentials
Enter a relay URL and one-use pairing code. Pairing is a POST to `/v1/pair`. Android saves the host list, local aliases, and device credentials in an app-private file encrypted with AES-GCM using an Android Keystore key. Reopening the app restores the list and reconnects using the saved device credentials. Browser pairing lasts until reload and never writes credentials to browser storage. The menu lists paired hosts and includes **Odśwież połączenia** and **Zmień nazwę instancji**. Clearing app data or uninstalling requires pairing again.

Relay URLs must use HTTPS/WSS except loopback addresses used for local development. WebSocket authentication is sent as the first JSON frame and never in a URL or header.

## Add a Kalio host

1. Use a Kalio build with `RemoteRelayModule`. Set `KALIO_REMOTE_RELAY_ENABLED=true`, choose a distinct `KALIO_REMOTE_RELAY_INSTANCE_ID`, generate a high-entropy `KALIO_REMOTE_RELAY_TOKEN`, and set `KALIO_REMOTE_RELAY_URL` to `wss://kalio-remote.nekko.software/v1/agent/<instance-id>`. Use a private env file or secret store. Without `KALIO_REMOTE_RELAY_INSTANCE_NAME`, the host reports its computer name.
2. Add that instance ID and the SHA-256 hex digest of its token to the Relay's `KALIO_RELAY_AGENTS_JSON`. Preserve all existing entries, then recreate the Relay service. Restart the host with its new env. The Relay never needs the raw host token in its config.
3. On the host, call `POST /api/remote-relay/pairing` on loopback with the host's `KALIO_CONTROL_PLANE_TOKEN` in the bearer header. Paste the code into **Menu Remote → Połącz instancję** on Android with the HTTPS Relay address. The one-use code expires after two minutes. Pair each host separately.
4. Check the host name and online status in the menu. To change only the label on your phone, select the host and choose **Zmień nazwę instancji**.

This deployment uses TLS through Cloudflare. The Relay can read message contents, so use only test data on the public QA stack until end-to-end payload encryption is implemented. The Android vault protects data at rest on the phone and does not change that transport boundary.

## Safety
This app is read-only for sessions and execution graphs. Approval decisions are single, explicit actions with the displayed arguments, revision, and digest. A request only displays as settled after the relay reports an authoritative approval result. Stale or offline snapshots disable decisions. There are no chat commands, editing, deletion, always-allow, or bulk approval controls.

A clearly labeled local preview fixture is available to inspect the interface. It does not make network calls or approve anything.
