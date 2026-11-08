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

Configuration is mandatory: startup fails if `KALIO_RELAY_AGENTS_JSON` is absent, empty, or contains malformed hashes. Each value is the SHA-256 hex digest of that instance's high-entropy bearer token. The token itself belongs in the workstation's secret store. The SQLite file stores paired device token hashes only. Back it up as credential material.

The default bind is `127.0.0.1:8787`; keep development traffic on localhost. For remote use, place the service behind a TLS reverse proxy (for example Cloudflare Tunnel) and use `wss://`. The relay trusts its operator and TLS endpoint; this protocol does not provide end-to-end encryption.

## Protocol v1

All envelopes use `{v:1,type,instanceId,requestId?,sequence?,payload?}`. Instance identifiers are exact and case-sensitive.

* Agent connects to `GET /v1/agent/{instanceId}` and sends the first frame within five seconds: `{"v":1,"type":"agent.authenticate","instanceId":"...","payload":{"token":"..."}}`. The relay compares its SHA-256 digest in constant time against the configured hash for that exact instance and replies `auth.accepted` before sending state or accepting commands.
* Agent may publish `snapshot`, `session.snapshot`, `approval.result`, or `pair.create`. Pair creation returns `pair.created` with a random 128-bit code valid for 120 seconds, bound to that instance and consumed once.
* Phone calls `POST /v1/pair` with JSON `{"code":"..." }`. The response contains the instance ID, device ID, and a random 256-bit device token. Keep that token in secure device storage.
* Device connects to `GET /v1/device`, then sends the first WebSocket frame within five seconds: `{"v":1,"type":"auth","instanceId":"...","token":"..."}`. Tokens are never accepted in URLs or query parameters.
* Device commands are limited to `session.watch`, `approval.decide`, and `ping`. A decision carries `requestId`, `approvalId`, `revision`, `argsSha256`, and `decision`. The relay only forwards it to the online agent. The host must validate the current pending approval and the revision/digest, perform its normal human-in-the-loop settlement, then publish `approval.result`. The relay never approves an action.
* When an agent disconnects, devices receive `instance.offline`. Decisions submitted while offline receive `approval.rejected`; commands are not queued for a later reconnect. A reconnect clears cached snapshot and event history; devices wait for a fresh snapshot from the host.

The relay limits WebSocket frames to 1 MiB, uses bounded queues, and disconnects slow device consumers when their queue fills. Pair codes live in a bounded in-memory map. Device registrations persist in SQLite; instance snapshots and event history are process memory only. A device token is scoped to the instance returned at pairing. Pair a device separately with each instance.

## Checks

Run `cargo test` and `cargo clippy --all-targets -- -D warnings` from this directory. The source includes focused unit tests. These commands have not been run in the current workspace because the execution environment is unavailable.
