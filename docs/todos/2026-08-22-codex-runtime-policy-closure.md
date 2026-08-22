# Codex runtime and policy bridge closure

## Completed in this slice

- [x] Persist project/persona/session execution profiles with seeded direct, Codex guard, and Codex strict profiles.
- [x] Share one Codex App Server process per auth profile and isolate non-default auth profiles with dedicated `CODEX_HOME` roots.
- [x] Route Codex dynamic tools through Kalio dispatch, policy, HITL, and audit correlation.
- [x] Bound foreground, control, and child execution to the default five-slot scheduler.
- [x] Route the configured auto-check evaluator through a no-tools Codex profile and preserve `ask_user`.
- [x] Add a per-auth-profile Codex MCP inheritance toggle in Settings, persist it in `app_settings`, and reset the affected App Server process after changes.
- [x] Verify focused Codex host/source, policy, controller, and integration-settings tests plus frontend typecheck; the final backend build remains blocked by an unrelated dirty Code Intelligence test constructor mismatch.

## Closure gates

- [ ] [P1] Logged-in local Codex App Server smoke across guard, strict, dynamic tool, cancel, and reconnect paths.
- [ ] [P2] Detect dynamic tool/policy changes before `thread/resume`; start a new thread when the binding fingerprint changes.
- [ ] [P2] Reconcile durable native approval rows after App Server/API restart.
- [ ] [P2] Add project/persona profile selector and browser proof.
- [ ] [P2] Add trusted-loopback/auth boundary for external security policy endpoint.
- [ ] [P3] Measure RSS/concurrency against the five-lease design.
- [x] [P2] Block inherited Codex `mcp_servers` by default; expose an explicit Settings toggle per auth profile, with `KALIO_CODEX_INHERIT_MCP` retained only as the environment fallback.
- [ ] [P4] Implement optional Claude Code runtime adapter.

## Boundary

The implementation is local and test-verified only. It is not deployed or production-proven.
