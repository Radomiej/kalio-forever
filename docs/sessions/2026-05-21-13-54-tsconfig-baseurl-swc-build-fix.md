# Tsconfig baseUrl SWC build fix

## What was done

- Restored an explicit non-empty `baseUrl` in `apps/kalio-api/tsconfig.json` so Nest SWC does not receive an empty `jsc.baseUrl` on Windows.
- Added `ignoreDeprecations: "5.0"` in the same backend tsconfig so the baseUrl deprecation warning stays suppressed without removing the setting.
- Inspected `apps/kalio-web/tsconfig.json` but left it unchanged because the requested repo-wide typecheck and filtered builds passed without it.

## Files touched

- `apps/kalio-api/tsconfig.json`
- `docs/sessions/2026-05-21-13-54-tsconfig-baseurl-swc-build-fix.md`

## Decisions made

- Kept the fix as narrow as possible by changing only the backend tsconfig that feeds `nest build` with the SWC builder.
- Used `"5.0"` for `ignoreDeprecations` because this workspace's TypeScript 5.9 rejected `"6.0"` during the first backend build retry.

## Validation

- `pnpm turbo run build --filter=kalio-api`
- `pnpm turbo run typecheck`
- `pnpm turbo run build --filter=kalio-api --filter=kalio-web`

## Open questions

- None.

## Next steps

- If a later cleanup reintroduces `paths` changes in backend tsconfig, keep the explicit non-empty `baseUrl` or revalidate `nest build` on Windows before merging.

## Update 2026-05-21 14:03

### What was done

- Removed `rootDir` from `apps/kalio-api/tsconfig.json` so Nest CLI's SWC builder re-enables `stripLeadingPaths` and emits a flat backend entrypoint at `dist/main.js` again.
- Repointed the backend `@kalio/types` path alias to `../../packages/@kalio/types/dist/index.d.ts` so removing `rootDir` does not pull workspace source from outside the API package back into the compiler program.

### Decisions made

- Left `apps/kalio-web/tsconfig.json` unchanged because the requested filtered build and full typecheck both passed without frontend tsconfig changes.
- Kept the Windows-safe backend tsconfig settings from the earlier fix: explicit `baseUrl: "."` plus `ignoreDeprecations: "5.0"`.

### Validation

- `cd apps/kalio-api && pnpm build` from a clean `dist` produced `apps/kalio-api/dist/main.js`.
- `pnpm turbo run build --filter=kalio-api --filter=kalio-web` passed and left `apps/kalio-api/dist/main.js` in place.
- `pnpm turbo run typecheck` passed.