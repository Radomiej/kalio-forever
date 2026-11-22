# Kalio Remote Connector and Environment Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a narrow outbound Kalio relay connector, preserve existing chat/HITL lifecycle semantics, and make approved MCP and skill definitions reproducible across dev, QA, and installed prod.

**Architecture:** A new `RemoteControlModule` connects outward to the Rust relay and routes validated protocol commands through focused facades over existing Kalio services. It does not reuse the Telegram relay or call Kalio's own HTTP/Socket.IO surface. Configuration parity is profile-aware and secret-free; seeded skills remain build assets, while user skills move through an offline preview/apply command with backups and content-hash conflict checks.

**Tech Stack:** TypeScript 5.8 strict, NestJS 11, Socket.IO-independent WebSocket client, Vitest, Drizzle/better-sqlite3, pnpm 9/Turborepo, existing Kalio runtime and Playwright QA stack.

**Spec:** `E:\Projekty\kalio-forever\docs\superpowers\specs\2026-09-22-kalio-remote-relay-design.md`

## Global Constraints

- Work in a dedicated worktree based on the user's current working tree; preserve every unrelated dirty file in `E:\Projekty\kalio-forever`.
- Do not modify `packages/@kalio/types/**`; relay wire contracts remain internal generated connector types.
- Do not extend the existing Telegram `RelayModule`; create `RemoteControlModule`.
- Do not proxy localhost HTTP/Socket.IO or expose the loopback MCP bridge.
- Host credentials go through `CredentialsService`; `.kalio/*.toml` contains no tokens, headers, passwords, or environment secret values.
- All host connections are outbound WSS with bounded exponential backoff and jitter.
- Reuse `SessionsService`, `SessionRuntimeStopService`, `HitlRequestService`, `ChatService`, and durable runtime snapshots instead of duplicating lifecycle logic.
- Preserve F5/reconnect rebuilding from backend truth; sleeps are not lifecycle synchronization.
- Keep every production file below 500 lines and use no `any` or empty catch blocks.
- Before source implementation, submit the connector/config migration decision packet to an independent GPT-5.6 Sol `xhigh` architecture review and resolve every P0/P1 finding.
- Run Windows Node/pnpm, better-sqlite3, Playwright, and QA stack evidence outside the sandbox with `C:\Program Files\nodejs` first on PATH.
- Do not copy `~/.codex/config.toml`, whole Kalio databases, chats, credentials, personas, settings, or audit logs.
- Add emergency-stop behavior only in the final implementation task.
- Never use broad `taskkill`, process-name matching, or termination of unrelated Codex/Node/shell/Devin processes.

## Review Focus

- Missing, revoked, rotated, or malformed host credentials must leave Kalio local operation intact and must never fall back to an unauthenticated connection; Task 2 adds these tests.
- Duplicate, expired, stale-boot, and out-of-order relay commands must not create duplicate sessions/turns/stops/HITL decisions; Tasks 2, 4, and 5 add these tests.
- Relay disconnect during generation must not stop local work, lose durable events, or cause parallel replay; Tasks 3 and 5 add these tests.
- Profile configuration must not leak secrets, silently map an unknown profile to prod, or let packaged defaults overwrite user edits; Task 6 adds these tests.
- Skill parity must preview conflicts, back up targets, avoid logging prompts, and leave all databases unchanged on dry run or failed validation; Task 7 adds these tests.

---

### Task 1: Import the canonical protocol and scaffold the isolated connector boundary

**Files:**
- Create: `apps/kalio-api/src/modules/remote-control/generated/remote-protocol.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-control.types.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-control.module.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-admission.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-admission.service.spec.ts`
- Create: `scripts/sync-remote-protocol.mjs`
- Create: `scripts/sync-remote-protocol.test.mjs`
- Modify: `apps/kalio-api/src/app.module.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: signed/generated protocol artifact from `E:\Projekty\kalio-remote\packages\protocol\dist`.
- Produces: `parseRelayFrame(value: unknown): RelayFrame`, `PROTOCOL_VERSION`, and checked-in protocol hash.
- Produces: `RemoteAdmissionService.requireOpen(operation)`; it is open by default until the final emergency task.
- Produces: a module with no public controller and no inbound listener.

- [ ] **Step 1: Write failing protocol-sync and admission tests**

Test exact artifact hash verification, changed generated output detection,
unknown major rejection, malformed/oversized frame rejection, and default-open
admission.

```ts
it('rejects an unsupported relay protocol major version', () => {
  expect(() => parseRelayFrame({
    protocolVersion: '2.0',
    messageId: 'm1',
    sentAt: new Date(0).toISOString(),
    kind: 'command',
    payload: {},
  })).toThrow(/unsupported protocol major/i);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-admission.service.spec.ts
node --test scripts/sync-remote-protocol.test.mjs
```

Expected: FAIL because the module, parser, and sync script do not exist.

- [ ] **Step 3: Implement deterministic protocol import**

The sync script accepts an explicit artifact directory, verifies the manifest
SHA-256, copies only generated TypeScript plus metadata, formats it, and supports
`--check` without writing.

```js
const sourceDir = resolve(requiredArg('--source'));
const mode = process.argv.includes('--check') ? 'check' : 'write';
await synchronizeProtocol({ sourceDir, targetFile, manifestFile, mode });
```

Do not add a runtime dependency on a sibling checkout.

- [ ] **Step 4: Implement the module and default-open admission service**

```ts
export type RemoteAdmissionOperation = 'session.create' | 'message.send' | 'runtime.resume';

@Injectable()
export class RemoteAdmissionService {
  requireOpen(_operation: RemoteAdmissionOperation): void {}
}
```

Import `RemoteControlModule` once in `AppModule`. It exposes no controller and
starts no connection until enabled configuration and a host credential exist.

- [ ] **Step 5: Run tests and typecheck**

```powershell
pnpm --filter @kalio/api test -- remote-admission.service.spec.ts
node --test scripts/sync-remote-protocol.test.mjs
pnpm --filter @kalio/api typecheck
```

- [ ] **Step 6: Commit the connector boundary**

```powershell
git add apps/kalio-api/src/modules/remote-control apps/kalio-api/src/app.module.ts scripts package.json
git commit -m "feat(remote): add isolated relay connector boundary"
```

### Task 2: Pair the host and maintain one authenticated outbound WSS connection

**Files:**
- Create: `apps/kalio-api/src/modules/remote-control/remote-control-config.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-host-identity.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-host-connector.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-host-connector.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-pairing.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-pairing.controller.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-pairing.controller.spec.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-control.module.ts`
- Modify: `apps/kalio-api/src/config/kalio-config.types.ts`
- Modify: `docs/kalio-toml-config.md`

**Interfaces:**
- Produces: local-only pairing endpoint accepting relay URL, display name, and single-use code.
- Produces: `RemoteHostConnectorService` with connect, heartbeat, reconnect, revoke, and shutdown lifecycle.
- Consumes: credential key `kalio.remote.host-token`; only `CredentialsService` reads/writes its value.
- Consumes: safe TOML fields `remote.enabled`, `remote.relay_url`, and `remote.display_name`.

- [ ] **Step 1: Write failing config, pairing, and socket tests**

Cover disabled configuration, HTTPS/WSS-only public URL, loopback HTTP allowed
for local tests, missing credential, pairing success, credential write failure,
revoked credential, protocol mismatch, one live socket, 15-second heartbeat,
45-second offline state, bounded `1s..60s` backoff with jitter, clean shutdown,
and no token in logs/errors.

```ts
it('does not connect when remote control is disabled', async () => {
  const connector = harness({ config: { enabled: false }, credential: 'secret' });
  await connector.onApplicationBootstrap();
  expect(connectorSockets.opened).toBe(0);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-host-connector.service.spec.ts remote-pairing.controller.spec.ts
```

- [ ] **Step 3: Implement safe configuration and pairing**

```ts
export interface RemoteControlConfig {
  enabled: boolean;
  relayUrl: string | null;
  displayName: string;
}

export const REMOTE_HOST_TOKEN_KEY = 'kalio.remote.host-token';
```

The local pairing endpoint exchanges the code with the relay, stores the host
id in app settings and the token in credentials, then discards the code. It
returns only host id, display name, and relay origin.

- [ ] **Step 4: Implement outbound WSS lifecycle**

Use one connector-owned WebSocket and an injectable transport factory for
tests. Send `host.hello` with a fresh backend `hostBootId`, protocol version,
Kalio version, capabilities, and last emergency epoch. Never use Socket.IO.

```ts
export interface RemoteSocketTransport {
  connect(input: { url: string; authorization: string; maxFrameBytes: number }): Promise<RemoteSocket>;
}
```

- [ ] **Step 5: Run focused and module tests**

```powershell
pnpm --filter @kalio/api test -- remote-host-connector.service.spec.ts remote-pairing.controller.spec.ts
pnpm --filter @kalio/api test -- chat.module.spec.ts
pnpm --filter @kalio/api typecheck
```

- [ ] **Step 6: Commit pairing and WSS**

```powershell
git add apps/kalio-api/src/modules/remote-control apps/kalio-api/src/config docs/kalio-toml-config.md
git commit -m "feat(remote): pair Kalio with outbound relay"
```

### Task 3: Publish sanitized session, runtime, and HITL snapshots

**Files:**
- Create: `apps/kalio-api/src/modules/remote-control/remote-snapshot.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-snapshot.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-event-buffer.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-event-buffer.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-event-projection.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-host-connector.service.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-control.module.ts`

**Interfaces:**
- Consumes: `SessionsService`, `SessionRuntimeWatchlistService`, `HitlRequestService`, `SessionEventsService`, and message repository through a ChatModule facade.
- Produces: bounded `sessions.snapshot` and `session.read` responses.
- Produces: sequenced, redacted host events and a replay buffer with snapshot fallback.

- [ ] **Step 1: Write failing projection and replay tests**

Test list limit 200, archived exclusion, message cursor, child visibility,
runtime state, pending HITL revision, prompt/tool-argument redaction, no project
filesystem path, no MCP/env/header/credential fields, sequence dedupe, replay,
buffer overflow snapshot fallback, and backend-restart boot change.

```ts
it('never projects project paths or credential-bearing fields', async () => {
  const snapshot = await service.readSession('session-1', { limit: 50 });
  expect(JSON.stringify(snapshot)).not.toContain('E:\\Projekty');
  expect(JSON.stringify(snapshot)).not.toMatch(/authorization|envVars|headers|apiKey/i);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-snapshot.service.spec.ts remote-event-buffer.service.spec.ts
```

- [ ] **Step 3: Implement safe snapshot projection**

Project only stable identifiers, display metadata, timestamps, role/content for
chat messages, sanitized pending HITL summaries, and existing typed runtime
status. Reject page limits above 200.

```ts
export interface RemoteSessionSnapshot {
  session: RemoteSessionSummary;
  messages: RemoteMessage[];
  nextBeforeMessageId: string | null;
  runtime: RemoteRuntimeSnapshot;
  pendingHitl: RemoteHitlRequest[];
}
```

- [ ] **Step 4: Implement event sequencing and replay**

Sequence numbers are monotonic for one `hostBootId`. Keep a bounded in-memory
buffer of 10,000 events or 15 minutes, whichever is smaller; fall back to a
fresh durable snapshot on a gap outside the buffer.

- [ ] **Step 5: Run focused tests, typecheck, and regression tests**

```powershell
pnpm --filter @kalio/api test -- remote-snapshot.service.spec.ts remote-event-buffer.service.spec.ts
pnpm --filter @kalio/api test -- chat.runtime-snapshot.spec.ts chat.runtime-hitl.spec.ts
pnpm --filter @kalio/api typecheck
```

- [ ] **Step 6: Commit read-only projections**

```powershell
git add apps/kalio-api/src/modules/remote-control
git commit -m "feat(remote): publish safe durable session snapshots"
```

### Task 4: Route create, send, scoped stop, and HITL through existing services

**Files:**
- Create: `apps/kalio-api/src/modules/chat/remote-chat-control.service.ts`
- Create: `apps/kalio-api/src/modules/chat/remote-chat-control.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-command-router.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-command-router.service.spec.ts`
- Modify: `apps/kalio-api/src/modules/chat/chat.module.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-control.module.ts`

**Interfaces:**
- Produces: exported `RemoteChatControlService` wrapping private `SessionPipelineService` without exporting the pipeline.
- Produces: `RemoteCommandRouterService.execute(commandContext, command): Promise<RemoteCommandOutcome>`.
- Consumes: `SessionsService`, `SessionRuntimeStopService`, `HitlRequestService`, `ChatService`, and `RemoteAdmissionService`.

- [ ] **Step 1: Write failing command routing tests**

Cover allowed project/persona snapshot membership, session create, send,
admission before submit, event forwarding, descendant stop, AgentFlow/CLI/
subagent drain through `SessionRuntimeStopService`, stale HITL revision, duplicate
decision, approve continuation, denial, unknown command, and forbidden command
shapes for terminal/files/settings/MCP.

```ts
it('uses the shared runtime stop service instead of process termination', async () => {
  await router.execute(context, { type: 'session.stop', sessionId: 'root' });
  expect(runtimeStop.stopSessionTree).toHaveBeenCalledWith('root');
  expect(processKill).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-chat-control.service.spec.ts remote-command-router.service.spec.ts
```

- [ ] **Step 3: Implement the ChatModule facade**

```ts
@Injectable()
export class RemoteChatControlService {
  constructor(
    private readonly pipeline: SessionPipelineService,
    private readonly stopService: SessionRuntimeStopService,
  ) {}

  submit(payload: ChatSendPayload, emit: EmitFn): Promise<void> {
    return this.pipeline.submit(payload, emit);
  }

  stopSessionTree(sessionId: string): Promise<RuntimeSnapshotSessionTree> {
    return this.stopService.stopSessionTree(sessionId);
  }
}
```

Export this facade from `ChatModule`; keep `SessionPipelineService` private.

- [ ] **Step 4: Implement the narrow command router**

Call `RemoteAdmissionService.requireOpen()` before create/send/resume. Validate
ids against the latest safe host snapshot. Use HITL request id plus revision for
compare-and-set; route approval through `ChatService.approveAndResumeTool()` and
denial through `cancelPendingTool()`.

- [ ] **Step 5: Run focused and existing lifecycle regressions**

```powershell
pnpm --filter @kalio/api test -- remote-chat-control.service.spec.ts remote-command-router.service.spec.ts
pnpm --filter @kalio/api test -- session-runtime-stop.service.spec.ts chat.gateway.spec.ts chat.service.spec.ts
pnpm --filter @kalio/api typecheck
```

- [ ] **Step 6: Commit remote control routing**

```powershell
git add apps/kalio-api/src/modules/chat apps/kalio-api/src/modules/remote-control
git commit -m "feat(remote): route relay commands through Kalio runtime"
```

### Task 5: Add command deduplication, deadlines, replay, and reconnect reconciliation

**Files:**
- Create: `apps/kalio-api/src/modules/remote-control/remote-command-ledger.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-command-ledger.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-reconciliation.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-reconciliation.service.spec.ts`
- Modify: `apps/kalio-api/src/database/schema.ts`
- Create: `apps/kalio-api/drizzle/00XX_remote_command_ledger.sql`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-host-connector.service.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-command-router.service.ts`

**Interfaces:**
- Produces: durable host-local command ledger keyed by `(relayId, idempotencyKey)`.
- Produces: reconnect handshake with last event sequence and command outcomes.
- Produces: explicit `completed`, `rejected`, `expired`, or `indeterminate` response.

- [ ] **Step 1: Write failing ledger and reconnect tests**

Test duplicates before/after completion, duplicate across process restart,
expired-before-admission, disconnect before ack, disconnect after ack, stale
host boot id, relay replacement id, event replay, snapshot fallback, and one
active drain per session.

```ts
it('does not submit a duplicate message after backend restart', async () => {
  await firstRouter.execute(context('idem-1'), sendCommand());
  const restarted = await restartAgainstSameDatabase();
  await restarted.execute(context('idem-1'), sendCommand());
  expect(pipeline.submit).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-command-ledger.service.spec.ts remote-reconciliation.service.spec.ts
```

- [ ] **Step 3: Implement the durable ledger**

Persist command type, payload hash, session id, state, outcome metadata, relay
id, host boot id, expiry, and timestamps. A reused key with a different payload
hash is rejected as conflict.

```ts
export interface RemoteCommandClaim {
  kind: 'new' | 'duplicate';
  record: RemoteCommandRecord;
}
```

- [ ] **Step 4: Implement reconnect reconciliation**

On reconnect, advertise last durable event sequence and unresolved command ids.
Never report an acknowledged command as completed without durable Kalio state;
mark unresolved work `indeterminate` and send a fresh session snapshot.

- [ ] **Step 5: Run migration, focused tests, and affected build**

```powershell
pnpm --filter @kalio/api test -- remote-command-ledger.service.spec.ts remote-reconciliation.service.spec.ts
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
```

- [ ] **Step 6: Commit reliability slice**

```powershell
git add apps/kalio-api/src apps/kalio-api/drizzle
git commit -m "feat(remote): reconcile relay commands after reconnect"
```

### Task 6: Add profile-aware safe MCP configuration and package it for prod

**Files:**
- Create: `.kalio/config.dev.toml`
- Create: `.kalio/config.qa.toml`
- Create: `.kalio/config.prod.toml`
- Modify: `.kalio/config.toml`
- Modify: `apps/kalio-api/src/config/kalio-config.types.ts`
- Modify: `apps/kalio-api/src/config/kalio-config.service.ts`
- Modify: `apps/kalio-api/src/config/kalio-config.service.spec.ts`
- Modify: `apps/kalio-api/src/config/env.schema.ts`
- Modify: `scripts/build-runtime-package.mjs`
- Modify: `scripts/runtime-package-smoke.mjs`
- Modify: `scripts/desktop-server-bootstrap.mjs`
- Modify: `scripts/runtime-server-bootstrap.mjs`
- Modify: `docs/kalio-toml-config.md`
- Modify: `docs/quickstart-user.md`

**Interfaces:**
- Produces: `KALIO_CONFIG_HOME` for app-managed safe defaults.
- Produces: normalized profile `dev | qa | prod`; `runtime` and `desktop` map to `prod`.
- Produces: ordered layers app-managed base/profile, user base/profile, project base/profile.
- Produces: packaged `config/config.toml` and `config/config.prod.toml` without secrets.

- [ ] **Step 1: Write failing profile-layer tests**

Cover precedence, dev/QA/prod selection, runtime/desktop mapping, unknown profile
failure, absent profile files, nested project layers, managed runtime config,
no secret-shaped keys in packaged files, and user/project overrides not being
overwritten by install/update.

```ts
it('fails closed for an unknown install profile', async () => {
  await expect(service.loadEffectiveConfig({
    cwd: repo,
    homeDir,
    env: { KALIO_INSTALL_PROFILE: 'staging' },
  })).rejects.toThrow(/unsupported Kalio install profile/i);
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- kalio-config.service.spec.ts
node --test scripts/runtime-scripts.test.mjs
```

- [ ] **Step 3: Implement profile normalization and layered loading**

```ts
export type KalioInstallProfile = 'dev' | 'qa' | 'prod';

export function normalizeKalioInstallProfile(value: string | undefined): KalioInstallProfile {
  if (!value || value === 'development' || value === 'dev') return 'dev';
  if (value === 'qa') return 'qa';
  if (value === 'prod' || value === 'runtime' || value === 'desktop') return 'prod';
  throw new Error(`Unsupported Kalio install profile: ${value}`);
}
```

Load app-managed files first so user and repository layers can override them.
Within each location, load `config.toml` then `config.<profile>.toml`.

- [ ] **Step 4: Define safe Data Analyst MCP parity**

Keep server identity and `http://127.0.0.1:3000/mcp` in checked-in TOML. Keep
headers and tokens out of all files. Profile files explicitly set only enabled
state and non-secret timeout/capability differences. The parity target is that
dev, QA, and prod all discover the same `data-analyst` server id; runtime health
may be disconnected when Data Analyst is not running and must be reported as
such rather than treated as configuration absence.

```toml
[mcp_servers.data-analyst]
enabled = true
url = "http://127.0.0.1:3000/mcp"
```

- [ ] **Step 5: Package safe config and prove update preservation**

Copy only the checked-in `.kalio` base/profile files into runtime package
`config/`. Set `KALIO_CONFIG_HOME` from bootstrap. Run a smoke update over a
fixture containing a user-modified `~/.kalio/config.toml` and assert it remains
byte-identical.

- [ ] **Step 6: Run focused and packaging gates**

```powershell
pnpm --filter @kalio/api test -- kalio-config.service.spec.ts
node --test scripts/runtime-scripts.test.mjs
pnpm run runtime:package:smoke
pnpm --filter @kalio/api typecheck
```

- [ ] **Step 7: Commit profile-aware MCP configuration**

```powershell
git add .kalio apps/kalio-api/src/config scripts docs/kalio-toml-config.md docs/quickstart-user.md
git commit -m "feat(config): align safe MCP profiles across environments"
```

### Task 7: Add safe skill synchronization and environment parity reporting

**Files:**
- Create: `scripts/kalio-environment-paths.mjs`
- Create: `scripts/kalio-skill-sync.mjs`
- Create: `scripts/kalio-skill-sync.test.mjs`
- Create: `scripts/kalio-environment-parity.mjs`
- Create: `scripts/kalio-environment-parity.test.mjs`
- Modify: `apps/kalio-api/src/modules/skills/skills.service.ts`
- Modify: `apps/kalio-api/src/modules/skills/skills.service.spec.ts`
- Modify: `scripts/README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm skills:sync -- --source dev --targets qa,prod --skill-id <id>` with dry run by default and explicit `--apply`.
- Produces: timestamped target database backups before apply.
- Produces: `pnpm environments:parity` with secret-free MCP signatures and skill id/content hashes.
- Consumes: explicit environment map for dev, QA, and installed prod; never guesses alternate prod database paths.

- [ ] **Step 1: Write failing sync and report tests against fixture databases**

Cover dry-run byte identity, explicit skill selection, stable id, prompt not in
stdout/stderr, same-hash skip, different-hash conflict, target backup, atomic
rollback on failure, missing table/database, running-process/lock refusal,
seeded-skill reporting, MCP manifest parity, and redaction of URL query,
headers, env values, credential-shaped fields, and skill prompts.

```js
test('dry run does not change target bytes or print prompt', async () => {
  const before = await readFile(targetDb);
  const result = await runSync(['--source', 'dev', '--targets', 'qa,prod', '--skill-id', 'user-1']);
  assert.deepEqual(await readFile(targetDb), before);
  assert.doesNotMatch(result.stdout + result.stderr, /private prompt canary/);
});
```

- [ ] **Step 2: Run script tests and confirm RED**

```powershell
node --test scripts/kalio-skill-sync.test.mjs scripts/kalio-environment-parity.test.mjs
```

- [ ] **Step 3: Implement explicit environment path resolution**

```js
export const environments = {
  dev: { profile: 'dev', database: join(localAppData, 'kalio-forever-dev', 'kalio-dev.db') },
  qa: { profile: 'qa', database: resolve(repoRoot, 'data', 'kalio-qa.db') },
  prod: { profile: 'prod', database: join(localAppData, 'Kalio', 'data', 'kalio.db') },
};
```

Reject any target outside these resolved paths. Require system Node and open
SQLite with foreign keys, a busy timeout, and one transaction per target.

- [ ] **Step 4: Implement preview/apply skill sync**

The preview prints only environment, id, name, source, content hash, action, and
conflict reason. Apply first copies the target DB to a timestamped backup in the
same data directory, then inserts/updates the selected skill transactionally.

```js
export function classifySkillSync(source, target) {
  if (!target) return { action: 'insert' };
  if (target.contentHash === source.contentHash) return { action: 'skip' };
  return { action: 'conflict', requiresReplace: true };
}
```

No command supports `--all`; each user skill id must be explicit.

- [ ] **Step 5: Implement parity report and seeded-skill hash validation**

The report loads safe effective config layers plus database metadata and emits
PASS/DIFF/UNAVAILABLE for each environment. `SkillsService` logs seeded skill
count and ids at debug level, never prompts, and continues stable-id upsert.

- [ ] **Step 6: Run dry-run against the real environments**

With dev, QA, and prod stopped:

```powershell
pnpm environments:parity
pnpm skills:sync -- --source dev --targets qa,prod --skill-id 4Td01N0LHnml49qa5Gt6F
```

Expected preview: `New Skill` is an insert for QA and prod; no database changes
and no prompt text is printed.

- [ ] **Step 7: Apply the approved skill migration and verify hashes**

```powershell
pnpm skills:sync -- --source dev --targets qa,prod --skill-id 4Td01N0LHnml49qa5Gt6F --apply
pnpm environments:parity
```

Expected: timestamped QA/prod backups exist; all three environments show the
same id and content hash for `New Skill`; the seeded architecture skill and
safe Data Analyst MCP signature match; secrets remain absent from output.

- [ ] **Step 8: Commit tooling, not databases or backups**

```powershell
git add scripts apps/kalio-api/src/modules/skills package.json
git commit -m "feat(config): safely synchronize Kalio skills"
```

Confirm `data/*.db`, `%LOCALAPPDATA%` files, and backups are untracked.

### Task 8: Prove real relay interoperability and Devin SWE-2 QA

**Files:**
- Create: `apps/e2e/tests/remote-relay.spec.ts`
- Create: `apps/e2e/tests/remote-relay-reconnect.spec.ts`
- Create: `docs/QA/remote-relay-devin-swe-2-evidence-2026-09-22.md`
- Modify: `docs/local-dev-guide.md`
- Modify: `docs/quickstart-user.md`

**Interfaces:**
- Consumes: running `kalio-remote`, real Kalio QA stack, protocol v1, and the locally installed Devin CLI.
- Produces: behavior-level evidence for browser control, Kalio FE parity, reconnect, stop, HITL, and current Devin free-model availability.

- [ ] **Step 1: Pass the local gate before any live provider run**

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
pnpm --filter @kalio/api test -- remote-
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
pnpm --filter @kalio/web typecheck
pnpm --filter @kalio/web build
```

Expected: focused regressions, affected typechecks, and builds pass before a
real Devin invocation.

- [ ] **Step 2: Reconfirm the installed free Devin SWE-2 model identifier**

Run `devin --version` and `devin models list` read-only. The 2026-09-22 baseline
is Devin CLI `3000.11.1`, family `SWE-2`, with `swe-2-high`, `swe-2-medium`, and
`swe-2-max` all marked `Free`. Use `swe-2-high` for the bounded QA canary and
record the exact command excerpt. If a later CLI no longer exposes that id as
free, record BLOCKED and do not silently substitute a paid model.

- [ ] **Step 3: Run a bounded Devin canary when free SWE-2.0 is available**

Use a disposable project directory and `--model swe-2-high` with one text-only
prompt, no native filesystem, terminal, web, or destructive tools, and the
existing Kalio HITL/MCP policy. The baseline direct-CLI canary returned exactly
`KALIO_SWE2_OK`; the implementation gate still needs Kalio ACP streaming,
effective provider/model from `/api/llm/config`, usage/charge evidence showing
the free lane, stop behavior, and CLI cleanup.

- [ ] **Step 4: Write and run real relay Playwright scenarios**

```powershell
pnpm stack:start
npx playwright test apps/e2e/tests/remote-relay.spec.ts apps/e2e/tests/remote-relay-reconnect.spec.ts
```

Test login, paired host visibility, create chat on QA host, send/stream, Kalio
FE and relay transcript agreement, F5 on both frontends, connector restart,
relay restart, scoped stop, HITL approve/deny, duplicate command suppression,
and host credential revoke.

- [ ] **Step 5: Route defects back through implementation tasks**

Do not patch generated demo output or bypass Kalio policy. For every failure,
record the exact environment, command, observable symptom, owning task, and
regression test. Repeat the focused gate before rerunning the live canary.

- [ ] **Step 6: Commit QA automation and evidence**

```powershell
git add apps/e2e/tests docs/QA docs/local-dev-guide.md docs/quickstart-user.md
git commit -m "test(remote): prove relay and Devin interoperability"
```

The evidence distinguishes mock/fake-host, local QA, real Devin, tunnel, and
production surfaces. A free-model discovery failure is not reported as a relay
failure.

### Task 9: Add connector-side emergency admission and scoped drain last

**Files:**
- Modify: `apps/kalio-api/src/modules/remote-control/remote-admission.service.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-admission.service.spec.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-emergency.service.ts`
- Create: `apps/kalio-api/src/modules/remote-control/remote-emergency.service.spec.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-command-router.service.ts`
- Modify: `apps/kalio-api/src/modules/remote-control/remote-host-connector.service.ts`
- Modify: `apps/kalio-api/src/modules/chat/session-pipeline.service.ts`
- Modify: `apps/kalio-api/src/modules/chat/subagent-runtime.service.ts`
- Modify: `apps/kalio-api/src/modules/chat/chat.module.ts`
- Modify: `docs/chat-streaming-tools-architecture.md`

**Interfaces:**
- Produces: boot-scoped local admission latch and durable last-applied emergency epoch.
- Consumes: relay `emergency.stop { epoch, relayBootId }`.
- Uses: `SessionRuntimeStopService.stopSessionTree()` for every active Kalio root session.
- Produces: per-session and final host emergency outcome without process enumeration.

- [ ] **Step 1: Confirm all normal relay and Kalio gates are GREEN**

```powershell
pnpm --filter @kalio/api test -- remote-
npx playwright test apps/e2e/tests/remote-relay.spec.ts apps/e2e/tests/remote-relay-reconnect.spec.ts
```

Expected: normal flows pass before emergency behavior changes admission.

- [ ] **Step 2: Write failing admission, drain, reconnect, and isolation tests**

Test latch closes before enumeration/drain, create/send/resume rejection, queued
follow-up cancellation, all active Kalio root sessions drained once, descendants
not double-drained, partial failure reporting, duplicate epoch idempotency,
missed epoch reconciliation, same-relay-boot reconnect remains closed, new
relay boot reopens only after reconciliation, local non-Kalio process unchanged,
and unrelated Codex process handle/PID unchanged.

```ts
it('never invokes global process termination during emergency stop', async () => {
  await emergency.apply({ epoch: 7, relayBootId: 'relay-1' });
  expect(runtimeStop.stopSessionTree).toHaveBeenCalled();
  expect(execFile).not.toHaveBeenCalledWith(expect.stringMatching(/taskkill/i), expect.anything());
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

```powershell
pnpm --filter @kalio/api test -- remote-admission.service.spec.ts remote-emergency.service.spec.ts
```

- [ ] **Step 4: Implement the common local admission latch**

```ts
export interface EmergencyAdmissionState {
  relayBootId: string;
  emergencyEpoch: number;
  closedAt: number;
}

requireOpen(operation: RemoteAdmissionOperation): void {
  if (this.state) throw new ServiceUnavailableException('Kalio emergency stop is active.');
}
```

Call the guard at remote command admission and the shared chat/subagent start or
resume boundaries so local UI cannot start a new Kalio-owned run while the host
latch is closed.

- [ ] **Step 5: Implement scoped all-session drain**

Snapshot active root session ids before draining. Close admission first, clear
queued follow-ups, then call `stopSessionTree(rootId)` once per root. Aggregate
outcomes and send them to the relay. Do not invoke shell commands or operating
system process enumeration.

- [ ] **Step 6: Implement restart reconciliation**

Persist only the last applied emergency epoch and relay boot id. On reconnect to
the same relay boot, keep admission closed. On a new relay boot, first reconcile
any missed epoch and verify old Kalio runs are quiescent, then reopen admission.

- [ ] **Step 7: Run emergency, existing lifecycle, and Codex isolation proof**

```powershell
pnpm --filter @kalio/api test -- remote-admission.service.spec.ts remote-emergency.service.spec.ts
pnpm --filter @kalio/api test -- session-pipeline.service.spec.ts session-runtime-stop.service.spec.ts subagent-runtime.service.spec.ts
pnpm --filter @kalio/api typecheck
npx playwright test apps/e2e/tests/remote-relay.spec.ts
```

Record an unrelated Codex process before and after the real emergency scenario.
Expected: same process remains alive; only Kalio registry-owned runs stop.

- [ ] **Step 8: Commit emergency connector behavior**

```powershell
git add apps/kalio-api/src/modules/remote-control apps/kalio-api/src/modules/chat docs/chat-streaming-tools-architecture.md
git commit -m "feat(remote): enforce scoped emergency admission"
```

### Task 10: Final release gate and durable handoff

**Files:**
- Create: `docs/sessions/2026-09-22-kalio-remote-connector-and-parity.md`
- Modify: `project-spec.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all connector, parity, relay, browser, Android, tunnel, and emergency evidence.
- Produces: current as-built architecture and an environment-specific closure matrix.

- [ ] **Step 1: Run final Kalio gates from the dedicated worktree**

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
pnpm --filter @kalio/api test
pnpm --filter @kalio/api typecheck
pnpm --filter @kalio/api build
pnpm --filter @kalio/web test
pnpm --filter @kalio/web typecheck
pnpm --filter @kalio/web build
node --test scripts/kalio-skill-sync.test.mjs scripts/kalio-environment-parity.test.mjs scripts/runtime-scripts.test.mjs
pnpm test:e2e
```

Expected: all affected unit/integration/build/E2E gates complete. Record any
unrelated pre-existing full-suite failure separately with exact output.

- [ ] **Step 2: Run environment parity and target-runtime proof**

Verify dev, QA, and installed prod separately. For each, record process/runtime
version, safe MCP signature, skill ids/hashes, relay connection, session
snapshot, create/send/stream, reconnect/F5, scoped stop, HITL, and emergency
behavior. Do not promote local or QA evidence to production closure.

- [ ] **Step 3: Update durable architecture and session documentation**

Update `project-spec.md` with the new remote connector boundary, protocol
ownership, authentication assumptions, environment config layering, and
emergency semantics. The session note includes a Mermaid flow, decisions,
commands/results, exact revisions, remaining risks, and Codex isolation proof.

- [ ] **Step 4: Review the owned diff and commit documentation**

```powershell
git diff --check
git status --short
git add README.md project-spec.md docs/sessions/2026-09-22-kalio-remote-connector-and-parity.md
git commit -m "docs(remote): record connector and parity evidence"
```

Expected: staged paths belong to this plan; existing installer/updater work in
the user's main checkout remains untouched.
