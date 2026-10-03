# QA run 80 — real Devin priority and environment decision

2026-10-03. Fixed QA UI http://localhost:5288/, API3316. Actual session W4fggLSunrJB41C24MV7C, exact project E:/Projekty/home-site, explicit Devin ACP swe-2. User prioritizes closing Devin communication first, ChatGPT/Codex second; other UX work delegated to sidecar agent Hypatia (01a100dc-798a-7ec2-8f73-0c9121b31a55).

## Actual Devin proof

Existing warm host initially failed the no-host static gate. Authorized PATCH /api/runtime/devin-cli/settings with {} reset it, retaining local token and native filesystem/web/terminal=false. Static readiness then passed all 16 rows.

| Requirement | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Real SWE-2 asks Kalio for approval | PASS | Turn CzmUV-mw-3nB4JQfuc7KL, terminal_spawn npm args=[run], cwd exact approved project; UI waiting for approval; runtime tool_pending/waiting_for_human | Command intentionally never approved |
| Long HITL cancellation | PASS | waiting timestamp1791015633426; cancellation events1791015726837/40, about93.4s; Stop through UI; no current run afterwards | Approval/resume after >60s still unproven |
| F5 pending recovery | PARTIAL | Reload initially Connecting; Stop control subsequently restored and cancelled actual pending turn | No durable screenshot/pending-state assertion after recovery |
| Follow-up actual communication | PASS | After second preserving host reset and16/16preflight, UI sent one fs_read request; turn OeigeFDUYoNF3VayAgyig; tool_result success, runtime completed; rendered final nexora-home-site / vite build with Kalio provenance | Reconnect and full lifecycle twins not closed |
| No uncontrolled CMD | UNVERIFIED during inference | Ten samples08:25:54–08:26:10UTC after follow-up completed: only old preview CMD17528/47956, both created09:54:07local | Initial global40s sample output was excessive/truncated and not usable for ownership/delta proof; startup/transient monitoring still required |
| Desktop vs compact launch | PASS | Extended live browser test:1440 shows persona+model+prompt together, Next/Back hidden;320/390/820 sequential;1PASS3.6s; seven screenshots assets | Sidecar visual/spec review pending |
| QA remains available | PASS | Final UI HTTP200; no QA DB deletion/restart | DEV iterative test environment transition still to verify |

No target file write, build, deploy or commit was requested from Devin in this run. Test terminal command never executed. Desktop test visited real fixed QA via disposable helper API64654/UI64653; helper runner exit0. No mock network interception.

## User decision

DEV is the agent's iterative implementation/test environment and may be reset. QA is the always-on user-facing demonstration/pre-production environment: deploy verified changes there. User permits scoped destructive test-data operations and necessary QA resets, but explicitly requires preserving or restoring QA provider settings/credentials. Notify before a necessary destructive QA operation; use an encrypted recoverable backup if preservation cannot be guaranteed. No plaintext secret export. Existing provider configuration was not deleted or changed here.

Priorities: real Devin first; real ChatGPT/Codex second; secondary UI/features deferred/delegated. Whole requested goal remains active.
