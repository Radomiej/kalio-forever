# QA 437 — hide diagnostic/E2E lifecycle processes

Date: 2026-10-05 Europe/Warsaw. Starting revision 031a0fcf, branch codex/kalio-provider-runtime-ux. Fixed QA was not restarted or reset; providers and live Home Site preview were not changed. Pre-existing foreign source changes remain outside this commit.

## Finding and implementation

CLIAgentProbeService already requests windowsHide and serializes/caches status probes. In contrast, both Playwright launchers omitted windowsHide for build/managed processes, the stack launcher, worker and taskkill shutdown. This is a concrete process-launch policy defect in our tooling, not proof that these calls caused the user's ordinary fixed-QA startup flashes.

A fail-first test runs the actual launchers in an isolated temporary repository with fake build/backend/frontend/Playwright programs. A Node preload observes real child_process.spawn options without replacing the operation. The initial run exited 1 and captured seven calls lacking windowsHide: three cmd.exe, three node.exe and one taskkill. This validates the Windows launch boundary; it does not directly measure window visibility.

Minimal fix: apply windowsHide in start-playwright-stack's common spawnProcess, runner's worker/stack launch and both Windows taskkill paths. Keep cwd, arguments, environment, stdio, ports, process ownership and exit handling unchanged. No new dependency, model/profile change or protected contract edit. Production files remain below 500 LOC. Test fixtures are removed in their existing finally lifecycle.

## Verification

- node --test apps/e2e/scripts/start-playwright-stack.test.mjs: exit 0, 15/15 PASS, zero skips. New full-lifecycle trace has no call without windowsHide. Existing cases cover health recovery, restart, random ports, isolated databases, mock forcing and fixed-QA runtime-config preservation.
- node --check on both changed .mjs files: PASS. git diff --check for owned paths: PASS. No API/web application source changed, so a new application build is not needed for this launcher-only slice.
- node scripts/run-test-gate.mjs: exit 0, shared types/SDK builds and repo preflight PASS, API 2978 tests PASS / three skipped, launcher suite 15/15 PASS. Frontend workspace test step completed successfully as part of the gate; its exact summary was inside truncated output and is not quoted here. This gate is not the complete browser E2E suite.
- Actual Chromium Stop/follow-up E2E: exit 0, 1/1 PASS on fresh mock random-port stack (API 61911/UI 61910), KALIO_PLAYWRIGHT_SKIP_BUILD=1. The documented wrapper forces mock and allocates isolated storage. No Devin prompt was sent.

## Window observation limits

Window observer was ready before E2E, at 2026-10-04T23:49:58.588Z. Its 30-second interval ended at 23:50:28.589Z; browser work/shutdown finished after that interval. Therefore it does not cover the complete E2E lifecycle. It recorded three unclassified events with PID 61404, no recoverable window class/visibility, and exited 0 with empty stderr. No process ancestry was collected in this attempt, so that PID is not attributed to the E2E. The full test gate ran concurrently, so this was not an isolated visibility benchmark. Do not interpret the missing classified events as proof of no visible windows.

| AC | Requirement | Status | Evidence / remaining |
| --- | --- | --- | --- |
| TOOL-WIN-01 | Tooling explicitly hides lifecycle child consoles | PASS for exercised launcher workflow | real spawn-options trace, seven initial omissions, no omissions after fix |
| TOOL-WIN-02 | Preserve launch/stop functionality | PASS for test and isolated browser boundaries | 15 launcher tests and 1 Chromium regression |
| QA-01 | Do not disrupt user's fixed QA | PASS for availability and no reset | API/UI/Home HTTP 200, existing result still visible, fixed runtime config unchanged |
| WIN-04 | Eliminate user's ordinary startup flashes | UNVERIFIED | no ordinary QA restart here, event classification remains insufficient |

Screenshot assets/01-preserved-qa.png shows the existing QA 436 Devin build/preview result still visible, not a fresh Devin run. Final endpoints: http://localhost:5288/ and http://127.0.0.1:57868/, both HTTP 200. Provider digest was not rerun because this attempt did not write/reset the fixed QA database; do not substitute this for a new digest measurement.

[P2] Required before closing WIN-04: attribute a visible brief window to its owner/launch path during ordinary fixed-QA start. This fix removes a verified tooling defect but does not establish the cause of all reported flashes or close the overall Home Site/Devin/Goal objective.
