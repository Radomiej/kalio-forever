# 2026-05-18 12:12 - Allowed Paths Windows case handling

## What was done

- Reproduced a Windows-specific `AllowedPathsService.isAllowed()` regression where a configured root like `C:\Projekty` did not allow a child path when the runtime path used different casing.
- Added a focused regression test covering `C:\Projekty` vs `c:\projekty\ProjectPlanner`.
- Changed allowed-path containment checks to be case-insensitive on Windows while keeping existing symlink/realpath protections intact.

## Files touched

- `apps/kalio-api/src/modules/allowed-paths/allowed-paths.service.ts`
- `apps/kalio-api/src/modules/allowed-paths/allowed-paths.service.spec.ts`

## Decisions

- Kept the fix local to the containment check instead of widening path normalization behavior elsewhere.
- Preserved case-sensitive behavior on non-Windows platforms.
- Left the symlink defense based on `realpathSync()` unchanged and validated it through the existing spec coverage.

## Validation

- `apps/kalio-api`: `npx vitest run src/modules/allowed-paths/allowed-paths.service.spec.ts`
- `apps/kalio-api`: `node_modules\\.bin\\tsc.CMD --noEmit`
- `get_errors` on both touched files returned no errors

## Open questions

- The live backend was not reachable on `localhost:3016` during runtime inspection, so this pass validated the fix through backend tests rather than a live API round-trip.

## Next steps

- Once the dev stack is running, recheck `GET /api/allowed-paths` plus a real `run_cli_agent`/`spawn_cli_agent` call against `C:\Projekty\ProjectPlanner` to confirm the runtime behavior matches the unit fix.