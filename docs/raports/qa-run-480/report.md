# QA480 — refusal hydration and graph mismatch

2026-10-06. Existing Chrome QA session, no restart or new LLM request.

After F5 and hydration, QA479_RESULT heading count is one, exact
QA479_RECOVERED count is one, and Stop agent count is zero.
Graph initially loads runtime identity then settles to Devin SWE-2 QA / swe-2.
The cancelled fs_write and final refusal response are retained.

## P2 — completed response shown as interrupted turn

Scoped GET /api/sessions/W4fggLSunrJB41C24MV7C/runs/history
with turnIds=VKplEkfNEqlcvzr8RLlvC returns run hlGVxsS4AY5I2BV5NZlq8,
phase completed, status completed, provider devin-cli-acp, model swe-2,
revision 6, retryCount 0 and final response kxoCQuBwA7PB9DeJcGiG8.
The settled graph instead labels that Turn cancelled / Turn interrupted.
The tool itself is correctly cancelled. The follow-up turn is ready/completed.
This is a lifecycle presentation mismatch, not a failed Devin recovery.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Chat F5 recovery | PASS | one final and one follow-up, no Stop |
| Graph retains refused tool and response | PASS | settled accessibility tree |
| Graph turn lifecycle agrees with backend | FAIL P2 | completed backend versus interrupted graph |
| Fix verified/deployed | NOT DONE | no source changes this run |

graph.jpg preserves the viewport, while the accessibility tree provides the
exact latest-turn labels; screenshot alone does not prove all off-screen nodes.

## Source diagnosis follow-up

getTurnStatus in executionGraphModel.helpers.ts checks explicit turn.error,
then turn.done, then aggregates tool statuses. A cancelled tool propagates
cancelled to a done turn even without a turn error. withRecordedTurnModels
then translates that cancelled node to Turn interrupted. This explains the
observed mismatch without requiring a Devin transport failure.

Existing cancellation tests protect explicit INTERRUPTED/CANCELLED turn errors,
persisted cancelled tools, cancelled children and architecture roots. A fix must
preserve those boundaries and add a recovered-refusal regression.
Both helper and turn-model files already contain uncommitted changes; ownership
and overlap must be reviewed before edits. No fix or deployment claimed yet.

## Local fix, not yet deployed

Removed propagation of a cancelled tool to a done, error-free turn. Explicit
turn.error cancellation and per-tool/child cancellation remain unchanged.
Added executionGraphRecoveredRefusal.test.ts: observed RED (turn cancelled
instead of success), then GREEN. Existing generic-result test now distinguishes
tool cancellation from completed-turn status, retaining its tool assertion.
Focused four-file suite: 44/44 passed, Vitest 4.1.4, 2026-10-06 14:18 local.
Existing unrelated working-tree cancellation changes remain preserved.
Build, served QA proof, and scoped commit are still required.
