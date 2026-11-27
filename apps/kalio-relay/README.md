# Kalio remote supervision relay

Standalone Rust/Axum 0.8 service for the KalioAndroid companion protocol. The relay authenticates workstation agents and paired devices, routes a small allowlist of supervision messages, and retains only the latest overview snapshot and a short in-memory event ring. It does not store chat history or execute tools.

## Run

Install Rust stable, then:

```sh
cd apps/kalio-relay
cp .env.example .env
# Replace the example value with a real SHA-256 hash and export the variables.
export KALIO_RELAY_AGENTS_JSON='{"workstation":"<64-hex-sha256>"}'
cargo run --release
```

Configuration is mandatory: startup fails if `KALIO_RELAY_AGENTS_JSON` is absent, empty, or contains malformed hashes. `KALIO_RELAY_ALLOWED_ORIGINS` is a JSON array of exact browser origins; it defaults to `https://localhost` and `http://localhost`. Add the explicit development web origin when needed. Wildcard origins and credentialed CORS are disabled. Each value is the SHA-256 hex digest of that instance's high-entropy bearer token. The token itself belongs in the workstation's secret store. The SQLite file stores paired device token hashes only. Back it up as credential material.

The default bind is `127.0.0.1:8787`; keep development traffic on localhost. For remote use, place the service behind a TLS reverse proxy (for example Cloudflare Tunnel) and use `wss://`. The relay trusts its operator and TLS endpoint; this protocol does not provide end-to-end encryption.

## Docker Compose with Cloudflare Tunnel

Build the web client from the repository root with `pnpm --filter @kalio/remote run build`. From this directory, run `docker compose -p kalio-remote-site -f compose.remote.yml up -d --build` for the loopback preview at `http://127.0.0.1:8788`.

For the QA hostname, create a dedicated remotely managed Cloudflare Tunnel. Set its published application hostname to `kalio-remote.nekko.software` and service URL to `http://web:80`. Supply its connector token as `KALIO_REMOTE_TUNNEL_TOKEN` from an ignored local env file or a secret manager and add `--profile tunnel` before `up`. The desktop Kalio API stays on loopback. Configure each participating host with a distinct instance ID and bearer token, add its SHA-256 token hash to `KALIO_RELAY_AGENTS_JSON`, and use `wss://kalio-remote.nekko.software/v1/agent/<instance-id>` as the connector URL.

Create a one-use code from the host's loopback `POST /api/remote-relay/pairing` using its control-plane authorization. Enter the HTTPS relay URL and code in the Remote web or Android app. Pair each host separately. This QA protocol supports status and existing approvals. Keep private project traffic out of this stack until end-to-end encryption is available.

## Protocol v1

All envelopes use `{v:1,type,instanceId,requestId?,sequence?,payload?}`. Instance identifiers are exact and case-sensitive.

* Agent connects to `GET /v1/agent/{instanceId}` and sends the first frame within five seconds: `{"v":1,"type":"agent.authenticate","instanceId":"...","payload":{"token":"..."}}`. The relay compares its SHA-256 digest in constant time against the configured hash for that exact instance and replies `auth.accepted` before sending state or accepting commands.
* Agent may publish `snapshot`, `session.snapshot`, `approval.result`, or `pair.create`. Pair creation returns `pair.created` with a random 128-bit code valid for 120 seconds, bound to that instance and consumed once.
* Phone calls `POST /v1/pair` with JSON `{"code":"..." }`. The response contains the instance ID, device ID, and a random 256-bit device token. Keep that token in secure device storage.
* Device connects to `GET /v1/device`, then sends the first WebSocket frame within five seconds: `{"v":1,"type":"auth","instanceId":"...","token":"..."}`. Tokens are never accepted in URLs or query parameters.
* Device commands are limited to `session.watch`, `session.unwatch`, `approval.decide`, and `ping`. A decision carries `requestId`, `approvalId`, `revision`, `argsSha256`, and `decision`. The relay only forwards it to the online agent. The relay adds the authenticated device ID as `payload.deviceId`; any client-supplied payload is discarded. The host must validate the current pending approval and the revision/digest, perform its normal human-in-the-loop settlement, then publish `approval.result`. The relay never approves an action.
* When an agent disconnects, devices receive `instance.offline`. Decisions submitted while offline receive `approval.rejected`; commands are not queued for a later reconnect. The relay clears the cached overview and watches when the host disconnects or is replaced. Connected devices receive `instance.online` before the new host snapshot. Devices that authenticate while the host is offline receive `instance.offline`.

A device has one active watch. `session.watch` carries a top-level `requestId` and `sessionId`. The relay translates the watch ID for the host, then restores the original `requestId` on current `session.snapshot` responses. Watch failures use `payload.session: null` and `payload.error` with one of `invalid_session`, `instance_offline`, `relay_busy`, `watch_limit`, `session_not_found`, or `projection_failed`. Send `session.unwatch` without a request ID to clear the authenticated device's watch. Approval delivery failures use `approval.rejected` with top-level `requestId` and `reason` (`instance_offline` or `relay_busy`).

The relay limits WebSocket frames to 1 MiB, uses bounded queues, and disconnects slow device consumers when their queue fills. Browser pairing requests receive CORS access only from configured origins; device WebSocket upgrades with an Origin header use the same allowlist. Server-side clients without an Origin header can still connect. Pair codes live in a bounded in-memory map. Device registrations persist in SQLite; instance snapshots and watches live in process memory. A device token is scoped to the instance returned at pairing. Pair a device separately with each instance.

## Checks

Run `cargo test` and `cargo clippy --all-targets -- -D warnings` from this directory. The suite includes local WebSocket integration tests.
