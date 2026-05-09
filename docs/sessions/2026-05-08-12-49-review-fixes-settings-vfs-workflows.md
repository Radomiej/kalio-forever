# Review Fixes: Settings, VFS, Workflows

## What was done

- Reviewed the reported findings against the actual code and tests.
- Fixed the four real frontend implementation/test mismatches from the review:
  - `parseMcpJson.ts`
  - `ModelSettingsSection.tsx`
  - `CLIAgentPanel.tsx`
  - `MCPAddServerForm.tsx`
- Added and fixed fail-first runtime validation for VFS tool arguments:
  - `vfs_read`
  - `vfs_write`
- Removed UTF-8 BOM markers from the affected workflow files:
  - `.github/workflows/audit.yml`
  - `.github/workflows/backend-ci.yml`
  - `.github/workflows/ci.yml`

## Decisions

- The review note about `start-dev.ps1` missing Vite flags was checked and rejected as a false alarm:
  - `apps/kalio-web/package.json` uses `vite`
  - `apps/kalio-web/vite.config.ts` already pins `server.port = 5188`
- The frontend settings fixes were kept local and behavior-scoped:
  - blank/whitespace transport entries are skipped in MCP JSON import
  - generation settings responses are sanitized before state write
  - malformed empty range changes no longer overwrite generation settings state
  - CLI config payloads are normalized before save
  - manual MCP form now rejects blank required fields and preserves quoted args
- VFS validation was fixed at the tool boundary, not inside `VFSService`, matching the earlier `fs_*`, `kv_*`, `terminal_*`, `memory_*` repair pattern.

## Files touched

- `apps/kalio-web/src/features/settings/parseMcpJson.ts`
- `apps/kalio-web/src/features/settings/ModelSettingsSection.tsx`
- `apps/kalio-web/src/features/settings/CLIAgentPanel.tsx`
- `apps/kalio-web/src/features/settings/MCPAddServerForm.tsx`
- `apps/kalio-api/src/modules/tool/tools/vfs-read.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/vfs-write.tool.ts`
- `apps/kalio-api/src/modules/tool/tools/tool-args-validation.spec.ts`
- `apps/kalio-api/src/modules/tool/tools/vfs-write.tool.spec.ts`
- `.github/workflows/audit.yml`
- `.github/workflows/backend-ci.yml`
- `.github/workflows/ci.yml`

## Validation

- Frontend focused specs:
  - `pnpm exec vitest run src/features/settings/parseMcpJson.spec.ts src/features/settings/ModelSettingsSection.test.tsx src/features/settings/CLIAgentPanel.test.tsx src/features/settings/MCPAddServerForm.test.tsx`
  - Result: 4 files passed, 38 tests passed.
- Backend focused VFS specs:
  - `pnpm exec vitest run src/modules/tool/tools/tool-args-validation.spec.ts src/modules/tool/tools/vfs-write.tool.spec.ts`
  - Result: 2 files passed, 23 tests passed.
- Workflow BOM check:
  - first three bytes now `6E-61-6D` (`nam`) instead of `EF-BB-BF`
- Backend typecheck:
  - `pnpm exec tsc --noEmit`
  - Result: passed.

## Remaining issues

- Frontend full typecheck still has pre-existing unrelated errors outside this review-fix slice:
  - `src/features/chat/AgentTurnBubble.tsx`
  - `src/features/chat/AgentTurnBubble.test.tsx`
  - `src/features/chat/chatUtils.ts`
  - `src/features/chat/chatUtils.spec.ts`
  - `src/store/sessionStore.ts`
- These were not caused by the settings/workflow/VFS changes and were not repaired in this batch.