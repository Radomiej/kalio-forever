# 2026-05-11 10:07 - Audit pipeline fix

## What was done

- Added regression tests for two audit false-negatives in `scripts/code-audit/audit-scripts.test.mjs`.
- Made `scripts/code-audit/run-audit.mjs` and `scripts/code-audit/aggregate.mjs` importable without auto-running `main()`.
- Fixed silent-catch detection so comment-only catches are reported.
- Fixed knip aggregation so unused files nested under `issues[].files` are included and deduplicated.
- Re-ran the full audit pipeline and generated a fresh report for 2026-05-11.

## Files touched

- `scripts/code-audit/run-audit.mjs`
- `scripts/code-audit/aggregate.mjs`
- `scripts/code-audit/audit-scripts.test.mjs`
- `docs/audit/2026-05-11-report.md`
- `docs/audit/2026-05-11-report.json`

## Decisions made

- Kept the fix narrow: only the two proven false-negative paths were changed.
- Used pure exported helpers plus a direct-execution guard to make the scripts testable without changing CLI behavior.
- Deduplicated knip unused-file rows because the same file can surface through multiple report shapes.

## Open questions

- The audit runner still emits a Node deprecation warning around `shell: true` child-process args during `madge`; this was not changed here.
- The refreshed report now exposes more silent catches and dead files; those follow-up refactors are still pending.

## Next steps

1. Triage newly surfaced silent catches on the critical path.
2. Remove or reconnect the newly surfaced unused frontend panels/components.
3. Start the pseudo-module migration from the `ToolModule` / `ChatModule` composition hubs by extracting explicit ports for subagent and tool dispatch.