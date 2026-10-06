# QA491 — Codex Kalio filesystem read after restart

2026-10-06. Chrome fixed QA, session yvD83rgDA_ZHvUwJKlo_S.
One requested Kalio fs_read E:/Projekty/home-site/package.json.
Settled answer QA491_RESULT reports name nexora-home-site and build vite build.
UI shows Kalio provenance and no Stop/pending.

Durable turn 0JH9rQmsbjNdomE9fpOS2, run OPo8PwwffYRFUHysDc-3X:
completed, codex-app-server, gpt-6-luna, retryCount 0.
Assistant Fn-dXSNLnC4M312_RZzIn contains exactly one fs_read call
exec-ca43e1fe-5bc2-470c-a391-96ee35c4c51e. Corresponding result
uXiVZblJRg09liGwBMD8p shares the turn and call identity.

| Requirement | Status | Boundary |
| --- | --- | --- |
| Codex real filesystem communication | PASS live | exact call, result and final response |
| Actual provider, not mock | PASS | persisted codex-app-server run |
| Response settles | PASS UI | no active Stop/pending |
| Broader native behavior | UNVERIFIED | scoped request, not global native audit |
| Writes, builds, Jev and console fix | NOT DONE in this run | not exercised |

result.jpg preserves the settled chat. No file changes, installs or settings writes.
