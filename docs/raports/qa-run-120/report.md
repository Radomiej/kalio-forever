# QA120 — Newly resolved model reaches parent launch readiness

2026-10-04. Fixed QA, starting HEAD7408f8e plus preserved dirty changes. No restart, prompt submission, tool approval or target change.

Extended bounded picker test parametrizes model/report and monitors POST /api/sessions. Chose newly resolved GPT-6 Sol on chatgpt-default rather than reusing Luna. Real UI1440x900 test PASS2.1s(test1.3s); catalog options verified, resolver body/response exact account/model/kalio_strict, selected input matches. Entered an unsent draft and confirmed parent Run becomes enabled, captured screenshot, then cleared draft. Zero session-create requests. This proves parent launch readiness, not actual launch/generation.

Source inspection: NewChatScreen's hint is conditional on persona recommendation, not selected profile. With no recommendation it always shows Choose a connected runtime/provider and model, even after valid selection. No evidence that selection was lost; misleading wording is a P3 polish issue. useChatLaunchSend persists profile before activation/send. Focused selector/new-chat/launch-hook tests12/12 PASS1.46s; hook persistence is mocked, not live server proof.

| Acceptance | Status | Boundary |
| --- | --- | --- |
| New dynamic profile updates parent readiness | PASS QA | Exact Sol selection and enabled Run with draft |
| No accidental chat/generation | PASS scoped | No POST sessions; Run never clicked |
| Local persist-before-send chain | PASS local | Existing hook fixture |
| Actual launch/F5/tools/HITL | OPEN | No submitted prompt |

Screenshots: [catalog](assets/codex-catalog.png), [selected and Run enabled](assets/codex-selected.png), visually inspected.
