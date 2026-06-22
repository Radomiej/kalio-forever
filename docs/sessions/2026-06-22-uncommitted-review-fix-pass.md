# 2026-06-22 Uncommitted Review Fix Pass

## What changed

- Hardened session runtime-path registration so public session create/update calls no longer widen `AllowedPathsService` roots by default.
- Kept trusted execution paths working by explicitly registering runtime project paths from:
  - `ChatService` before live execution,
  - `SubagentRuntimeService` for child-session create/update,
  - `ArchitectureRuntimeService` for architecture root/branch sessions.
- Restored backwards-compatible session history reads:
  - `GET /api/sessions/:id/messages` still returns the full history unless paging params are explicitly provided,
  - paged history now returns total-count / has-more / oldest-id metadata headers,
  - CORS now exposes those headers to the browser.
- Fixed frontend older-history loading to merge against the latest session-store state and rebuild agent turns after older pages are appended.
- Added regression coverage for:
  - trusted-vs-public runtime path registration,
  - full-history vs explicit paging controller behavior,
  - frontend older-history merge and turn rebuild.

## Why

- Public session metadata writes were silently authorizing project roots, which made the allowlist broader than intended.
- The new history-window API shape broke older callers by truncating history to `40` messages unless they opted into paging.
- The new "load older messages" flow could drop live messages that arrived while the older-page request was in flight.

## Verification

- `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/sessions.service.spec.ts src/modules/chat/sessions.controller.spec.ts src/modules/chat/__tests__/subagent-runtime.service.spec.ts src/modules/chat/__tests__/chat.service.spec.ts`
- `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/agent-loop-limits.spec.ts --reporter=verbose`
- `corepack pnpm --filter kalio-api exec vitest run src/modules/chat/__tests__/chat-max-iterations.spec.ts src/modules/chat/__tests__/chat.service.event-ordering.spec.ts src/modules/chat/__tests__/issues-verification.spec.ts`
- `corepack pnpm --filter kalio-web exec vitest run src/features/chat/ChatInterface.test.tsx`
- `corepack pnpm --filter kalio-api run typecheck`
- `corepack pnpm --filter kalio-web run typecheck`
- `corepack pnpm test`
- `corepack pnpm test:e2e`

## Release readiness

- Not release-ready yet.
- This slice is locally regression-tested, but the branch-wide verification gate is still red.

## Remaining risk

- `corepack pnpm test` still fails in the aggregate run even though the relevant chat suites pass in isolation, which points to remaining branch-level interference or unrelated shared-state coupling.
- `corepack pnpm test:e2e` still fails across broader workflow/runtime scenarios outside this slice, so a clean release claim would still be false.
