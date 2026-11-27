# Remote supervision MVP
Date: 2026-11-08. Baseline: main e1bc5a869fd040d915fc049981f066fbbcf024db (Kalio 1.0.5).

## Intent and boundary
A Capacitor Android companion observes multiple paired Kalio installations, their threads, messages, children and durable execution graph. It may approve or deny an existing pending request once. It cannot edit messages/files, submit prompts, start tools, change policies or enable automatic approvals.

Kalio connects outbound to a public Rust/Tokio/Axum relay. The phone also connects outbound; desktop API ports stay private. TLS terminates at the deployment reverse proxy (including a Cloudflare Tunnel). The relay is a trusted operator handling private conversation projections in memory; end-to-end encryption is not claimed. Device-token hashes persist in SQLite; source credentials and model API keys are never included in a generic backend object dump.

## Decisions
Use a broker instead of exposing the entire desktop API through a tunnel: this bounds the mobile command surface and supports several hosts. Reuse Kalio's durable read models and existing settlement services; transport acceptance is never a successful approval. Keep client and server modules in this repository for now; kalio-handheld is a separate SDL/game-console project and is not repurposed.

- Server: apps/kalio-relay; client: apps/kalio-remote; outbound adapter: apps/kalio-api/src/modules/remote-relay.
- Shared TypeScript contract: packages/@kalio/types/src/remote-supervision.ts.
- Host wire endpoint /v1/agent/:instanceId: first frame agent.authenticate with payload.token; wait for auth.accepted.
- Device wire endpoint /v1/device: first frame auth with top-level instanceId and token; wait for auth.accepted and fresh snapshot.
- Pairing: authenticated host requests pair.create; one-use 128-bit code expires after 120 seconds. POST /v1/pair exchanges it for a device capability scoped to one instance. Pair each additional instance separately.
- Device commands session.watch, session.unwatch and approval.decide are allowlisted. Relay constructs the host-bound payload and supplies authenticated deviceId; the phone cannot nominate its identity.
- Overview/session snapshots and approval.result come from Kalio. Correlate request, instance, approval and observed revision; only persisted settlement acknowledgement is success.
- Revalidate current pending request, original argument hash and revision immediately before the existing domain CAS/continuation. Do not synthesize a gateway socket identity.
- Never queue decisions offline or replay ambiguous state-changing requests. Reconnection discards stale transport state and hydrates authoritative snapshots.
- Browser/native pairing uses explicit CORS origins (Android https://localhost); public connections use HTTPS/WSS. No bearer values in URLs or access logs.
- Android restores saved hosts and instance aliases after restart from an app-private AES-GCM vault using a key in Android Keystore. Browser credentials remain memory-only. No localStorage/plain Preferences token persistence.
- Background Android delivery is not promised by an open foreground WebSocket; push notifications/foreground service are a later explicit slice.

## Acceptance

Remote opens on Sessions with the current connection and active-session count visible. Sessions and pending approvals stay accessible from the bottom navigation. The menu holds instance switching, pairing, demo and theme. Filters open on demand. In a narrow viewport a selected conversation takes the place of the list, with explicit return controls from both the conversation and graph. Content can scroll inside the viewport while the header and main navigation stay visible.

On narrow screens, conversation and graph panels extend to both edges. The mobile graph lists full step names, states and outgoing transitions; wider layouts retain the pannable graph. JSON tool results and approval arguments render as fields, with approval identifiers under a technical disclosure. The session list shows last activity when a valid timestamp is available. Forgetting a host removes the local saved pairing only after the device vault accepts the update.
Real WebSocket tests must cover role and instance isolation, pairing replay/expiry, offline decisions, duplicate connection generations, slow consumers and acknowledgement correlation. Backend tests cover stale digest/revision, races with local resolution, actual waiter settlement and secret-free projections. Browser tests cover read-only surfaces, multiple instances, unavailable graphs, approval waiting/denial/error states, reconnect and 320/390px layout. Build a debug APK; do not claim device/emulator execution from compilation.

Unsupported approval families must be projected with decisionAvailable=false and a clear desktop-only reason. Native CLI, host-required terminal, RA-App native effects and extra-budget decisions retain their distinct authorities; never route them all through a generic database update. Native-family implementation is tracked separately until its actor-bound continuation tests pass.

## Verification status
Initial source is under integration and must not be deployed as a verified public service. Local execution is unavailable in this chat; CI is the verification path. Mock images illustrate intended screens, not screenshots of tested implementation. See the session note and PR for actual results.

Session-detail snapshots and approval results are routed only to the requesting authenticated device and are excluded from relay replay history. Deploy the updated Kalio connector and relay together so private results include their destination device.
A device reconnecting to an online host receives its latest overview snapshot once, if available. Overview snapshots are excluded from event replay history.

A new session watch replaces the previous watch for the same authenticated device. Leaving session detail releases the watch. Session replies and errors are correlated to the current watch; replies from an older watch or replaced connection are dropped. Unavailable sessions and projection failures produce a visible error on the requesting device.
A device authenticated while its host is offline receives offline state instead of a cached snapshot. When the host returns, the device accepts a fresh overview and reissues its selected session watch. A correlated relay rejection clears only that pending decision and is never shown as settlement.
