# Bug Log

## 2026-06-21

- `scripts/stack-manager.mjs` could not start a managed QA stack because `C:\Projekty\kalio-forever\.kalio-stack\logs\backend.log` was locked, which caused `EPERM` on `openSync()` and blocked random-port QA startup.
- The managed QA state can report `provider=mock` while `GET /api/llm/config` still returns a live `xiaomimimo` provider from the database, so mock/local QA can silently drift onto a live credential.
- `apps/kalio-web` build fails on `SessionPanelList.tsx` because TypeScript cannot resolve `@tanstack/react-virtual`'s `@tanstack/virtual-core` dependency through the current workspace link layout, so the random QA stack cannot finish its frontend build until that link is made explicit.
