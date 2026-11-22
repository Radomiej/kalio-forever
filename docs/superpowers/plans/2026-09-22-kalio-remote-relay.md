# Kalio Remote Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-owner Rust relay with a React web client and Capacitor Android client that safely controls up to five outbound-connected Kalio hosts.

**Architecture:** A Rust/Axum modular monolith binds to loopback, persists identity, host, command, cursor, and audit state in SQLite WAL, and serves the React application. Kalio hosts connect over authenticated outbound WebSockets using a generated narrow protocol; browser and mobile sessions use separate credential adapters. A fake-host harness proves the relay independently before the real Kalio connector is integrated.

**Tech Stack:** Rust 1.85 edition 2024, Axum 0.8, Tokio 1, SQLx 0.8 SQLite, Argon2 0.5, React 19, TypeScript 5.9.3, Vite 8.2.0, Vitest 4.1.10, Playwright, Capacitor 7.6.8, Cloudflare Tunnel.

**Spec:** `E:\Projekty\kalio-forever\docs\superpowers\specs\2026-09-22-kalio-remote-relay-design.md`

## Global Constraints

- Create the implementation in `E:\Projekty\kalio-remote`; do not add relay source to `kalio-forever`.
- Initialize the first owner only through a local hidden-password CLI prompt; no public registration route.
- Support exactly one owner and at most five non-revoked hosts.
- Bind the relay to `127.0.0.1`; Cloudflare Tunnel owns public ingress.
- Store only password PHC strings and opaque-token digests; never log secrets, cookies, Authorization headers, pairing codes, or skill prompts.
- Do not expose or proxy Kalio REST, Socket.IO, the local MCP bridge, terminal, filesystem, settings, credentials, arbitrary tools, or arbitrary MCP.
- Reject unknown protocol major versions and frames larger than 1 MiB.
- Keep Rust modules and React production files below 500 lines.
- Use RED-GREEN-REFACTOR for every production behavior and commit only task-owned files.
- Before source implementation, submit the complete protocol/auth/reconnect/emergency decision packet to an independent GPT-5.6 Sol `xhigh` architecture review and resolve every P0/P1 finding.
- Add the emergency red button only in the final task after normal control flows pass.
- Never terminate processes by image name or affect unrelated Codex, Node, shell, Devin, or agent processes.

## Review Focus

- A stolen, expired, rotated, or revoked web/mobile/host token must fail without revealing whether another valid credential exists; Tasks 2, 3, and 7 add these tests.
- A duplicated command after reconnect must return its first result without creating a second session, turn, stop, or HITL decision; Tasks 3 and 6 add these tests.
- A stale `hostBootId`, protocol-major mismatch, malformed JSON, or frame over 1 MiB must be rejected and audited; Task 3 adds these tests.
- An interrupted stream must rebuild from durable snapshot/event sequence after F5 or reconnect, while an acknowledged-but-unfinished command becomes `indeterminate`; Tasks 5 and 6 add these tests.
- Emergency stop must close admission before drain, report unreachable hosts, survive host reconnect semantics, clear only after relay restart, and leave unrelated Codex alive; Task 9 adds these tests.

---

### Task 1: Bootstrap the independent repository and canonical protocol

**Files:**
- Create: `E:\Projekty\kalio-remote\AGENTS.md`
- Create: `E:\Projekty\kalio-remote\Cargo.toml`
- Create: `E:\Projekty\kalio-remote\package.json`
- Create: `E:\Projekty\kalio-remote\crates\domain\Cargo.toml`
- Create: `E:\Projekty\kalio-remote\crates\domain\src\lib.rs`
- Create: `E:\Projekty\kalio-remote\crates\domain\src\protocol.rs`
- Create: `E:\Projekty\kalio-remote\crates\domain\tests\protocol_contract.rs`
- Create: `E:\Projekty\kalio-remote\packages\protocol\package.json`
- Create: `E:\Projekty\kalio-remote\packages\protocol\src\index.ts`
- Create: `E:\Projekty\kalio-remote\scripts\generate-protocol.mjs`
- Create: `E:\Projekty\kalio-remote\docs\architecture.md`

**Interfaces:**
- Produces: Rust `HostFrame`, `HostCommand`, `HostEvent`, `CommandState`, `Capability`, and `PROTOCOL_VERSION`.
- Produces: generated TypeScript discriminated unions and `parseHostFrame(value: unknown): HostFrame`.
- Produces: `npm run protocol:check`, which fails when generated TypeScript differs from Rust JSON Schema.

- [ ] **Step 1: Create the repository and mapping record before source code**

Create `E:\Projekty\kalio-remote`, initialize Git on branch `main`, and run the
project-bootstrap exact-mapping checks. Create/reuse the Linear project and
Notion Project row only after both records point to this exact path. Record the
accepted local stack and the canonical design document path in
`docs/architecture.md`.

```powershell
New-Item -ItemType Directory -Path E:\Projekty\kalio-remote
Set-Location E:\Projekty\kalio-remote
git init -b main
```

Expected: one empty repository at the exact path, with no files copied from a
different checkout.

- [ ] **Step 2: Write failing Rust protocol contract tests**

Pin the envelope and strict version/size behavior:

```rust
#[test]
fn command_round_trip_preserves_idempotency_and_boot_scope() {
    let frame = fixture_send_message_command();
    let json = serde_json::to_vec(&frame).unwrap();
    assert!(json.len() <= MAX_FRAME_BYTES);
    assert_eq!(decode_host_frame(&json).unwrap(), frame);
}

#[test]
fn unsupported_major_version_is_rejected() {
    let error = decode_host_frame(br#"{\"protocolVersion\":\"2.0\",\"kind\":\"command\",\"payload\":{}}"#).unwrap_err();
    assert_eq!(error.code(), "unsupported_protocol_major");
}
```

- [ ] **Step 3: Run the protocol tests and confirm RED**

```powershell
cargo test -p kalio-remote-domain --test protocol_contract
```

Expected: FAIL because the protocol crate and decoder do not exist.

- [ ] **Step 4: Implement the minimal canonical protocol**

Use tagged enums and deny unknown fields on command payloads:

```rust
pub const PROTOCOL_VERSION: &str = "1.0";
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum HostCommand {
    SessionsSnapshot { cursor: Option<String>, limit: u16 },
    SessionRead { session_id: String, before_message_id: Option<String>, limit: u16 },
    SessionCreate { persona_id: String, project_id: String, title: Option<String> },
    MessageSend { session_id: String, content: String },
    SessionStop { session_id: String },
    HitlResolve { request_id: String, revision: u32, decision: HitlDecision, reason: Option<String> },
}
```

Generate JSON Schema from Rust, then generate and format TypeScript. Do not
hand-maintain a second protocol model.

- [ ] **Step 5: Run Rust and TypeScript contract checks and confirm GREEN**

```powershell
cargo test -p kalio-remote-domain
npm install
npm run protocol:generate
npm run protocol:check
```

Expected: all tests pass and a second generation produces no Git diff.

- [ ] **Step 6: Commit the repository foundation**

```powershell
git add AGENTS.md Cargo.toml package.json crates packages scripts docs
git commit -m "chore(remote): bootstrap relay protocol workspace"
```

### Task 2: Add SQLite persistence, owner bootstrap, and browser sessions

**Files:**
- Create: `E:\Projekty\kalio-remote\crates\persistence\Cargo.toml`
- Create: `E:\Projekty\kalio-remote\crates\persistence\src\lib.rs`
- Create: `E:\Projekty\kalio-remote\crates\persistence\src\sqlite.rs`
- Create: `E:\Projekty\kalio-remote\crates\persistence\migrations\0001_identity.sql`
- Create: `E:\Projekty\kalio-remote\crates\relay\Cargo.toml`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\main.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\cli.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\auth.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\http\auth_routes.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\auth_flow.rs`

**Interfaces:**
- Produces: `OwnerRepository::{create_once, verify_password, replace_password}`.
- Produces: `SessionRepository::{issue_web, issue_mobile, rotate_mobile, revoke, validate}`.
- Produces: `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`, and `GET /api/auth/me`.
- Produces: CLI commands `init-owner` and `reset-owner-password`.

- [ ] **Step 1: Write failing identity and session integration tests**

Use a temporary SQLite database and deterministic clock. Cover first-owner
creation, duplicate initialization, 13-character rejection, valid login,
uniform invalid-login response, idle and absolute expiry, logout, reset
revocation, CSRF rejection, bad Origin, five failures per IP, global limiter,
mobile rotation, and rotated-token replay revocation.

```rust
#[tokio::test]
async fn reset_password_revokes_every_device_session() {
    let app = TestRelay::new().await;
    app.init_owner("radomiej", "correct horse battery staple").await;
    let web = app.login_web().await;
    let mobile = app.login_mobile().await;
    app.reset_owner_password("another long owner password").await;
    assert_eq!(app.me_with_cookie(&web).await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(app.refresh_mobile(&mobile.refresh_token).await.status(), StatusCode::UNAUTHORIZED);
}
```

- [ ] **Step 2: Run focused auth tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay --test auth_flow
```

Expected: FAIL because migrations, repositories, CLI, and routes are missing.

- [ ] **Step 3: Implement schema and repositories**

The migration creates `owner`, `owner_sessions`, and `audit_events`, enables
foreign keys and WAL, and enforces one owner with a fixed singleton key.

```sql
CREATE TABLE owner (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  username TEXT NOT NULL UNIQUE,
  password_phc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Hash passwords through `spawn_blocking`. Generate 32 random bytes for opaque
tokens and persist `SHA-256(token)` only.

- [ ] **Step 4: Implement CLI and HTTP session middleware**

```rust
pub struct AuthenticatedOwner {
    pub session_id: Uuid,
    pub session_kind: SessionKind,
}

pub async fn require_browser_write(
    State(state): State<AppState>,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<AuthenticatedOwner, ApiError>;
```

Use `HttpOnly; Secure; SameSite=Strict; Path=/` and exact Origin plus CSRF for
browser writes. Apply the stated idle/absolute lifetimes and rate limits.

- [ ] **Step 5: Run auth tests, clippy, and secret-log assertions**

```powershell
cargo test -p kalio-remote-relay --test auth_flow
cargo clippy --workspace --all-targets -- -D warnings
```

Expected: PASS; captured logs do not contain fixture passwords or tokens.

- [ ] **Step 6: Commit identity**

```powershell
git add crates/domain crates/persistence crates/relay
git commit -m "feat(remote): add single-owner authentication"
```

### Task 3: Add host pairing, registry, WebSocket lifecycle, and idempotency

**Files:**
- Create: `E:\Projekty\kalio-remote\crates\persistence\migrations\0002_hosts_commands.sql`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\hosts\mod.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\hosts\pairing.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\hosts\registry.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\hosts\socket.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\commands\store.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\host_protocol.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\support\fake_host.rs`

**Interfaces:**
- Produces: owner routes to create pairing code, list/rename/revoke hosts.
- Produces: unauthenticated-by-owner but pairing-code protected exchange route.
- Produces: authenticated `/host/v1/connect` WebSocket.
- Produces: `HostRegistry::dispatch(host_id, boot_id, command) -> CommandReceipt`.
- Produces: fake host capable of hello, heartbeat, ack, event replay, disconnect, and malformed frames.

- [ ] **Step 1: Write failing pairing and socket tests**

Cover single-use and ten-minute expiry, sixth-host rejection, revoked token,
token digest storage, unknown major version, stale boot id, heartbeat timeout,
1 MiB boundary, malformed frame audit, duplicate idempotency key, and disconnect
after acknowledgement.

```rust
#[tokio::test]
async fn duplicate_idempotency_key_returns_original_receipt() {
    let (relay, host) = paired_fake_host().await;
    let first = relay.dispatch(host.id(), "idem-1", session_create()).await;
    let second = relay.dispatch(host.id(), "idem-1", session_create()).await;
    assert_eq!(second.command_id, first.command_id);
    assert_eq!(host.received_count("session_create"), 1);
}
```

- [ ] **Step 2: Run focused protocol tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay --test host_protocol
```

- [ ] **Step 3: Implement pairing and host persistence**

Store `pairing_code_digest`, expiry, consumed timestamp, and host token digest.
Use one transaction to consume the code and create the host. Count only
non-revoked hosts toward the limit of five.

```rust
pub async fn consume_pairing_code(
    tx: &mut Transaction<'_, Sqlite>,
    code_digest: &[u8],
    host_name: &str,
    now: DateTime<Utc>,
) -> Result<IssuedHostCredential, PairingError>;
```

- [ ] **Step 4: Implement authenticated WSS and command lifecycle**

Require the host credential in the WebSocket upgrade request, authenticate
before upgrade, enforce frame limits, and track one active connection per host.
Persist `queued`, `acknowledged`, `completed`, `rejected`, `expired`, or
`indeterminate` outcomes and a 24-hour idempotency record.

```rust
pub async fn dispatch(
    &self,
    host_id: HostId,
    expected_boot_id: HostBootId,
    idempotency_key: IdempotencyKey,
    deadline: DateTime<Utc>,
    command: HostCommand,
) -> Result<CommandReceipt, DispatchError>;
```

- [ ] **Step 5: Run tests and confirm GREEN**

```powershell
cargo test -p kalio-remote-relay --test host_protocol
cargo test --workspace
```

- [ ] **Step 6: Commit host control plane**

```powershell
git add crates/domain crates/persistence crates/relay
git commit -m "feat(remote): pair and control outbound hosts"
```

### Task 4: Build the responsive authenticated web shell

**Files:**
- Create: `E:\Projekty\kalio-remote\apps\web\package.json`
- Create: `E:\Projekty\kalio-remote\apps\web\src\main.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\app\App.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\authApi.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\LoginPage.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\hosts\HostSwitcher.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\styles\tokens.css`
- Create: `E:\Projekty\kalio-remote\apps\web\src\styles\global.css`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\LoginPage.test.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\hosts\HostSwitcher.test.tsx`

**Interfaces:**
- Consumes: browser auth routes and owner host-list routes.
- Produces: `AuthProvider`, `useAuth()`, and a selected `hostId` URL state.
- Produces: mobile-first shell with explicit loading, empty, offline, unauthorized, rate-limited, and error states.

- [ ] **Step 1: Write failing UI behavior tests**

Test accessible labels, Enter-submit, wrong password, rate limit retry time,
expired session redirect, host status text plus icon, keyboard host switching,
empty host onboarding, and no credential persistence in local/session storage.

```tsx
it('does not persist owner credentials in browser storage', async () => {
  await loginAsOwner();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
npm --workspace @kalio-remote/web test -- --run
```

- [ ] **Step 3: Implement the smallest authenticated shell**

Use cookie credentials, an in-memory CSRF token returned by `/api/auth/me`, and
URL-based host selection. Keep status announcements in an `aria-live` region
and maintain visible keyboard focus.

```ts
export interface AuthClient {
  login(input: { username: string; password: string }): Promise<OwnerSession>;
  me(): Promise<OwnerSession>;
  logout(csrfToken: string): Promise<void>;
}
```

- [ ] **Step 4: Run unit, type, accessibility, and viewport checks**

```powershell
npm --workspace @kalio-remote/web test -- --run
npm --workspace @kalio-remote/web run typecheck
npm --workspace @kalio-remote/web run build
```

Use Playwright screenshots at 360x800, 390x844, 768x1024, and 1280x800.
Expected: no horizontal overflow, no clipped actions, visible focus, and no
color-only online/offline meaning.

- [ ] **Step 5: Commit web shell**

```powershell
git add apps/web package.json package-lock.json
git commit -m "feat(remote): add owner web shell"
```

### Task 5: Add host and session snapshots with reconnect-safe hydration

**Files:**
- Create: `E:\Projekty\kalio-remote\crates\persistence\migrations\0003_host_snapshots.sql`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\snapshots.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\http\session_routes.rs`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\sessionApi.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\SessionList.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\ConversationPage.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\sessionStore.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\sessionStore.test.ts`
- Create: `E:\Projekty\kalio-remote\e2e\reconnect.spec.ts`

**Interfaces:**
- Consumes: `sessions.snapshot`, `session.read`, host event sequences, and fake-host replay.
- Produces: owner routes for bounded session/message pages and browser event stream.
- Produces: `sessionStore.replaceSnapshot()` and `sessionStore.applySequencedEvent()`.

- [ ] **Step 1: Write failing snapshot and hydration tests**

Test sequence deduplication, gap detection, full snapshot replacement, message
pagination, F5 rebuild, host restart with a new boot id, and acknowledged command
recovery as `indeterminate`.

```ts
it('requests a snapshot when a host event sequence has a gap', () => {
  const result = store.applySequencedEvent({ hostId: 'h1', sequence: 9, event: fixtureEvent() });
  expect(result).toEqual({ kind: 'snapshot_required', expectedSequence: 1, receivedSequence: 9 });
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay snapshot
npm --workspace @kalio-remote/web test -- --run sessionStore
```

- [ ] **Step 3: Implement bounded snapshot persistence and routes**

Persist only relay projections required by the remote UI. Use cursor pagination;
default 50 sessions/messages and reject limits above 200.

```rust
pub async fn apply_host_event(
    &self,
    host_id: HostId,
    boot_id: HostBootId,
    sequence: u64,
    event: HostEvent,
) -> Result<SnapshotApplyResult, SnapshotError>;
```

- [ ] **Step 4: Implement frontend hydration and reconnect states**

The store begins empty, fetches the server snapshot, applies only contiguous
events, and never treats socket connection alone as hydrated.

```ts
type HostSyncState =
  | { kind: 'loading' }
  | { kind: 'live'; lastSequence: number }
  | { kind: 'reconnecting'; lastSequence: number }
  | { kind: 'snapshot_required'; expectedSequence: number; receivedSequence: number };
```

- [ ] **Step 5: Run unit and browser reconnect proof**

```powershell
cargo test --workspace
npm --workspace @kalio-remote/web test -- --run
npx playwright test e2e/reconnect.spec.ts
```

Expected: a real page reload reconstructs the conversation from relay state;
fake-host disconnect/reconnect neither duplicates nor loses committed messages.

- [ ] **Step 6: Commit read-only remote state**

```powershell
git add crates apps/web e2e
git commit -m "feat(remote): hydrate host conversations after reconnect"
```

### Task 6: Add create, send, stream, scoped stop, and HITL controls

**Files:**
- Create: `E:\Projekty\kalio-remote\crates\relay\src\http\command_routes.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\command_flows.rs`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\CreateChatDialog.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\Composer.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\sessions\CommandStatus.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\hitl\HitlCard.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\hitl\HitlCard.test.tsx`
- Create: `E:\Projekty\kalio-remote\e2e\remote-control.spec.ts`

**Interfaces:**
- Consumes: `HostRegistry::dispatch` and session snapshot store.
- Produces: owner command routes requiring CSRF or mobile bearer auth.
- Produces: create-chat, message composer, streaming transcript, scoped stop, and revision-checked HITL UI.

- [ ] **Step 1: Write failing command and UI tests**

Cover offline host, missing capability, project/persona not present in safe host
snapshot, empty and oversized message, duplicate send, stop descendants, double
stop, stale HITL revision, duplicate approval, reject with reason, disconnect
after ack, and retry after `indeterminate` only after refresh.

```rust
#[tokio::test]
async fn stale_hitl_revision_is_conflict_not_success() {
    let response = owner_api().resolve_hitl("req-1", 1, "approve").await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(fake_host().received_count("hitl_resolve"), 0);
}
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay --test command_flows
npm --workspace @kalio-remote/web test -- --run HitlCard
```

- [ ] **Step 3: Implement authenticated command routes**

Require caller-generated idempotency keys and current host boot id. Return
`202 Accepted` with the command receipt, then stream lifecycle updates.

```rust
pub struct SubmitCommandRequest {
    pub host_boot_id: HostBootId,
    pub idempotency_key: IdempotencyKey,
    pub command: HostCommand,
}
```

- [ ] **Step 4: Implement control UI with explicit command states**

Disable duplicate controls while a command is queued or acknowledged. Display
rejected, expired, and indeterminate states in text. Keep the message draft if
submission fails before acknowledgement.

```ts
export type VisibleCommandState =
  | 'queued'
  | 'acknowledged'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'indeterminate';
```

- [ ] **Step 5: Run complete normal-flow proof**

```powershell
cargo test --workspace
npm --workspace @kalio-remote/web test -- --run
npm --workspace @kalio-remote/web run build
npx playwright test e2e/remote-control.spec.ts
```

Expected: fake host proves create, send, token streaming, stop, approve, deny,
duplicate suppression, disconnect, reconnect, and F5 hydration.

- [ ] **Step 6: Commit normal control flows**

```powershell
git add crates apps/web e2e
git commit -m "feat(remote): control chats and HITL through relay"
```

### Task 7: Add Capacitor Android with secure rotating credentials

**Files:**
- Create: `E:\Projekty\kalio-remote\capacitor.config.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\credentialStore.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\browserCredentialStore.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\capacitorCredentialStore.ts`
- Create: `E:\Projekty\kalio-remote\apps\web\src\auth\credentialStore.test.ts`
- Generate: `E:\Projekty\kalio-remote\android\`
- Create: `E:\Projekty\kalio-remote\e2e\mobile-auth.spec.ts`

**Interfaces:**
- Consumes: mobile login and refresh routes from Task 2.
- Produces: `CredentialStore` implemented by browser-cookie and Capacitor-secure-storage adapters.
- Produces: bundled Android app using `https` scheme; optional remote server URL is build-time only.

- [ ] **Step 1: Write failing credential adapter tests**

Test cold start, access expiry refresh, atomic refresh replacement, replay
revocation, logout deletion, storage failure, offline startup, and proof that
refresh tokens never reach `localStorage`.

```ts
export interface CredentialStore {
  readRefreshToken(): Promise<string | null>;
  replaceRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
npm --workspace @kalio-remote/web test -- --run credentialStore
```

- [ ] **Step 3: Implement adapters and Capacitor configuration**

Use `@aalzehla/capacitor-secure-storage-plugin@1.4.1` only for the mobile
refresh token. The browser adapter returns `null` because browser auth remains
cookie-based.

```ts
const config: CapacitorConfig = {
  appId: 'pl.kalio.remote',
  appName: 'Kalio Remote',
  webDir: 'apps/web/dist',
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
};
```

- [ ] **Step 4: Generate and sync Android, then run build checks**

```powershell
npm install
npm run cap:add:android
npm run cap:sync
npm run android:debug
```

Expected: `app-debug.apk` builds from bundled assets with no committed relay
hostname or credential.

- [ ] **Step 5: Run emulator/device QA**

Prove first login, cold start, rotation, offline screen, reconnect, host switch,
chat send/stream, HITL, scoped stop, logout, and revoked-device denial. Capture
the Android package/version and device/emulator identifier.

- [ ] **Step 6: Commit Android client**

```powershell
git add capacitor.config.ts apps/web android package.json package-lock.json e2e
git commit -m "feat(remote): add secure Capacitor client"
```

### Task 8: Add Cloudflare Tunnel operations and production security gate

**Files:**
- Create: `E:\Projekty\kalio-remote\deploy\cloudflare\config.example.yml`
- Create: `E:\Projekty\kalio-remote\deploy\cloudflare\install-service.ps1`
- Create: `E:\Projekty\kalio-remote\deploy\cloudflare\smoke.ps1`
- Create: `E:\Projekty\kalio-remote\docs\operations.md`
- Create: `E:\Projekty\kalio-remote\docs\backup-restore.md`
- Create: `E:\Projekty\kalio-remote\scripts\security-gate.ps1`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\public_boundary.rs`

**Interfaces:**
- Produces: secret-free tunnel template targeting `http://127.0.0.1:<port>`.
- Produces: repeatable local and public smoke/security checks.
- Produces: backup and temporary-directory restore procedure.

- [ ] **Step 1: Write failing public-boundary tests**

Test loopback default, refusal to start with public bind unless an explicit
unsafe-development flag is present, exact allowed Origin, no wildcard CORS,
WebSocket origin rejection, security headers, request body limits, and redacted
trace logs.

```rust
#[test]
fn default_bind_is_loopback_only() {
    assert_eq!(RelayConfig::default().bind_addr, "127.0.0.1:8787".parse().unwrap());
}
```

- [ ] **Step 2: Run public-boundary tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay --test public_boundary
```

- [ ] **Step 3: Implement deployment scripts and documentation**

The sample tunnel config contains only symbolic placeholders and local origin:

```yaml
ingress:
  - hostname: remote.example.invalid
    service: http://127.0.0.1:8787
  - service: http_status:404
```

The service script reads the real tunnel credential from Cloudflare's managed
location. It does not copy it into the repository or process arguments shown in
logs.

- [ ] **Step 4: Implement backup/restore and security gate**

The gate runs Rust tests, web tests/build, Playwright, dependency audit, origin
negative tests, login rate-limit tests, host-revoke tests, and a backup restored
into a temporary directory.

```powershell
.\scripts\security-gate.ps1 -BaseUrl http://127.0.0.1:8787
```

Expected: PASS locally without a tunnel. Public mode additionally requires the
real HTTPS base URL and a real WSS fake-host reconnect.

- [ ] **Step 5: Prove the real Cloudflare target**

Run the same owner/browser/host flows through the actual hostname. Confirm the
relay process still listens only on loopback and Cloudflare WebSockets survive
disconnect/reconnect. Record public target, relay revision, tunnel identity,
test timestamp, and failures without recording credentials.

- [ ] **Step 6: Commit operations**

```powershell
git add deploy docs scripts crates/relay/tests
git commit -m "ops(remote): secure relay behind Cloudflare Tunnel"
```

### Task 9: Add the red button after the normal product is proven

**Files:**
- Create: `E:\Projekty\kalio-remote\crates\persistence\migrations\0004_emergency_events.sql`
- Create: `E:\Projekty\kalio-remote\crates\relay\src\emergency.rs`
- Create: `E:\Projekty\kalio-remote\crates\relay\tests\emergency_stop.rs`
- Create: `E:\Projekty\kalio-remote\apps\web\src\emergency\EmergencyStop.tsx`
- Create: `E:\Projekty\kalio-remote\apps\web\src\emergency\EmergencyStop.test.tsx`
- Create: `E:\Projekty\kalio-remote\e2e\emergency-stop.spec.ts`
- Modify: `E:\Projekty\kalio-remote\docs\operations.md`

**Interfaces:**
- Produces: in-memory `AdmissionLatch` keyed by current relay boot id.
- Produces: `POST /api/emergency-stop` and read-only emergency status.
- Produces: `emergency.stop` host command with durable epoch and per-host outcomes.
- Consumes: connector-side emergency admission/drain contract from the companion Kalio plan.

- [ ] **Step 1: Confirm the prerequisite normal-flow gate is GREEN**

```powershell
cargo test --workspace
npm --workspace @kalio-remote/web test -- --run
npx playwright test e2e/remote-control.spec.ts e2e/reconnect.spec.ts
```

Expected: all normal flows pass before any emergency implementation begins.

- [ ] **Step 2: Write failing emergency semantics tests**

Test admission closes before host drain dispatch, new create/send/retry rejection,
all connected hosts receive one epoch, duplicate red press is idempotent,
offline host remains unconfirmed, relay restart creates a new boot id and clears
the central latch, missed-epoch host reconciles before new command admission,
and unrelated Codex PID/process handle remains unchanged.

```rust
#[tokio::test]
async fn emergency_closes_admission_before_dispatching_drain() {
    let relay = running_relay_with_two_hosts().await;
    relay.press_emergency().await.unwrap();
    assert!(relay.admission().is_closed());
    assert_eq!(relay.hosts().emergency_dispatch_count(), 2);
    assert!(matches!(relay.create_session().await, Err(ApiError::EmergencyStopActive)));
}
```

- [ ] **Step 3: Run emergency tests and confirm RED**

```powershell
cargo test -p kalio-remote-relay --test emergency_stop
npm --workspace @kalio-remote/web test -- --run EmergencyStop
```

- [ ] **Step 4: Implement boot-scoped admission and emergency epochs**

```rust
pub struct AdmissionLatch {
    relay_boot_id: RelayBootId,
    closed_at: RwLock<Option<DateTime<Utc>>>,
}

impl AdmissionLatch {
    pub fn require_open(&self) -> Result<(), AdmissionError>;
    pub fn close(&self, now: DateTime<Utc>) -> bool;
}
```

Call `require_open()` from every remote create/send/resume route before command
creation. Persist emergency audit/epoch and host acknowledgements, but do not
persist the in-memory central latch across relay process boot.

- [ ] **Step 5: Implement guarded danger UI**

Require typing `STOP ALL KALIO AGENTS`, show connected/unreachable host counts,
disable all start/send controls immediately after server acknowledgement, and
show per-host stop outcomes. Do not present unreachable hosts as stopped.

- [ ] **Step 6: Run full emergency and Codex isolation proof**

```powershell
cargo test --workspace
npm --workspace @kalio-remote/web test -- --run
npx playwright test e2e/emergency-stop.spec.ts
.\scripts\security-gate.ps1 -BaseUrl http://127.0.0.1:8787
```

Run with at least two fake hosts, one disconnected host, one real Kalio host,
and a separately recorded unrelated Codex process. Expected: Kalio-owned runs
drain, new remote work is blocked, the offline host is reported unconfirmed,
Codex remains alive, and only relay restart reopens central admission.

- [ ] **Step 7: Commit emergency stop**

```powershell
git add crates apps/web e2e docs
git commit -m "feat(remote): add restart-cleared emergency stop"
```

### Task 10: Final cross-surface release evidence

**Files:**
- Create: `E:\Projekty\kalio-remote\docs\sessions\2026-09-22-initial-relay-release.md`
- Modify: `E:\Projekty\kalio-remote\README.md`

**Interfaces:**
- Consumes: every prior gate plus the real Kalio connector evidence.
- Produces: one evidence matrix separating local, QA/tunnel, Android, and production proof.

- [ ] **Step 1: Run final local gates from a clean checkout**

```powershell
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm test
npm run typecheck
npm run build
npx playwright test
npm run cap:sync
npm run android:debug
```

Expected: all commands complete successfully. `cap:sync` is recorded separately
from APK build and emulator/device proof.

- [ ] **Step 2: Run target-runtime evidence**

Prove the real Kalio connector through the relay, real Cloudflare HTTPS/WSS,
browser F5/reconnect, Android cold start/reconnect, host revoke, device revoke,
backup/restore, normal stop, HITL approve/deny, red button, relay restart, and
unrelated Codex survival.

- [ ] **Step 3: Write the durable session record and README operations**

The session note includes exact revisions, environments, commands, outcomes,
remaining blockers, a Mermaid flow, and the difference between built, local,
QA/tunnel, Android, and production evidence. README links owner initialization,
host pairing, web/mobile use, Cloudflare deployment, backup/restore, revocation,
and emergency recovery.

- [ ] **Step 4: Verify the final diff and commit**

```powershell
git diff --check
git status --short
git add README.md docs/sessions/2026-09-22-initial-relay-release.md
git commit -m "docs(remote): record initial relay release evidence"
```

Expected: only task-owned files are staged and no secret, tunnel credential,
database, token, APK, or generated report is committed.
