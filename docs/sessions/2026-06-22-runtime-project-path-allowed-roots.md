# Runtime Project Path Allowed Roots Sync

## What changed

- `AllowedPathsService` now exposes idempotent `ensurePath()` behavior.
- `SessionsService` now treats `runtimeContext.architectureContext.projectPath` as executable runtime scope and syncs it into `allowed_paths` on create/update/runtime-context update.
- `ChatModule` now imports `AllowedPathsModule` explicitly so every launch surface that persists `projectPath` gets the same backend behavior.

## Why

- Real-project workflow runs could persist `projectPath` into host and child runtime metadata while still failing branch `fs_list/fs_read` with `ACCESS_DENIED`.
- The user-visible baseline `Oceń architekturę projektu` therefore depended on hidden Settings-side manual path registration, which violated the intended workflow contract.

## Verification

- `corepack pnpm --filter kalio-api exec -- vitest run src/modules/chat/__tests__/sessions.service.spec.ts src/modules/allowed-paths/allowed-paths.service.spec.ts`
- `corepack pnpm --filter kalio-api run typecheck`
- rebuilt QA on `3316/5288`
- cleared `/api/allowed-paths` to `[]`
- launched workflow from Talk UI with `projectPath=C:\Projekty\kalio-forever`
- observed auto-created allowed path entry for the repo
- observed zero branch `ACCESS_DENIED`
- observed persisted branch transcript content and successful reopen after reload

## Live readiness

- The repo-path baseline blocker is removed for real-project workflow launches.
- QA startup, workflow visibility, and refresh replay are now re-proven on the rebuilt stack.

## Remaining blockers

- `stack-manager status --json` still disagrees with live `/api/llm/config` on effective provider/model.
- Live provider quality is still unstable on the same baseline run: one branch produced malformed streamed tool args and one timed out after 120000ms.
- Fresh FE proof for stop/HITL on this rebuilt QA slice is still pending.
