# Kalio Remote

A standalone React, TypeScript, Vite, and Capacitor Android supervision client. It pairs directly with a Kalio relay; there is no account service.

## Run
- `npm install`
- `npm run dev` for the browser client
- `npm run build`
- `npx cap add android` once, then `npm run android:sync` and `npm run android:open`

## Pairing and credentials
Enter a relay URL and one-use pairing code. Pairing is a POST to `/relay/v1/pair`; paste the code manually. This build does not claim camera scanning. Relay credentials live only in the app's in-memory vault and are cleared when the app closes. Browser storage is never used. Android secure persistence is not enabled yet; reconnection requires pairing again after process exit.

Relay URLs must use HTTPS/WSS except loopback addresses used for local development. WebSocket authentication is sent as the first JSON frame and never in a URL or header.

## Safety
This app is read-only for sessions and execution graphs. Approval decisions are single, explicit actions with the displayed arguments, revision, and digest. A request only displays as settled after the relay reports an authoritative approval result. Stale or offline snapshots disable decisions. There are no chat commands, editing, deletion, always-allow, or bulk approval controls.

A clearly labeled local preview fixture is available to inspect the interface. It does not make network calls or approve anything.
