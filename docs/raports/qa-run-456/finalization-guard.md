# QA456 — unresolved CLI child finalization guard

Date: 2026-10-06. Scope: local API architecture runtime, not a QA deployment.

An unresolved latest implementer CLI child must block successful finalization,
including when external QA or independent file/build verification has passed.
Failed external QA retains precedence. A terminal successful child can finalize.

The old service fixture explicitly permitted a still-running child to be ignored
after a successful build. It now covers both running and completed status: running
routes back to the implementer and cannot emit a final artifact; completed permits
finalization. Its one-visit limit intentionally ends the continued run as failed.
No runtime gate was weakened to make this fixture pass.

## Verification

- Earlier targeted mutation: removing the child guard caused 5 of the 10 graph
  runtime regression tests to fail; the production guard was restored immediately.
- Full architecture module: 37 files, 361 tests passed, no failures.
- API typecheck: exit 0.
- API build: exit 0, TypeScript 0 issues, SWC 684 compiled files.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Running/failed/cancelled/unknown child cannot be hidden by accepted QA | PASS | local graph runtime regression |
| Completed/terminal-success/success/exited child can finalize | PASS | local regression |
| Independent successful host build cannot override a running child | PASS | service running/completed fixture |
| Goal router falls back to implementer instead of final artifact | PASS | service assertion |
| Fixed QA runs this new build and preserves provider settings | UNVERIFIED | no restart/deploy in this slice |
| Live Jev judge and Devin child complete the goal loop | UNVERIFIED | not established by mocked executor tests |

This does not close startup console flashing, live Jev integration, or the full
Home Site delivery goal. The built artifact is ready for a controlled QA rollout;
the currently running process has not been proven to load it.
