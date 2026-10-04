# QA185 — ordinary-message Thinking lifecycle and disclosure parity

2026-10-04. Checkout C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever, branch codex/kalio-provider-runtime-ux, pre-edit HEAD cdf63d1c plus preserved mixed dirty work. Fixed UI http://localhost:5288/, API :3316, AppData kalio-forever-qa. Backend QA167 unchanged; frontend rebuilt and served by existing preview, main bundle index-DVXln7Z1.js. runtime-config.js restored to authoritative :3316 API/socket origins after Vite build. No backend restart, QA data/provider change, agent prompt, target-project mutation or process spawn through Devin.

Reviewed ordinary MessageBubble as the sibling of committed ThinkingBlock. Committed the existing lifecycle fix (thinking animation only during actual thinking, stops when answer starts; empty streaming bubble delegated to conversation) and completed the disclosure accessibility contract: type=button, aria-expanded, unique aria-controls, stable hidden content target. Ordinary message preserves its existing auto-collapse when answer starts; no attempt to silently change grouped-turn history behavior.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Ordinary-message disclosure | PASS locally | RED missing aria-expanded, GREEN new regression asserts controlled target/state | Actual ordinary-message browser fixture not separately seeded |
| Manual collapse and end of thinking | PASS locally | More thinking tokens do not reopen collapsed content; stream end removes activity; reopen retains text | Live token/race timing separately scoped |
| Answer-start/no duplicate pending | PASS locally | Existing regressions plus sibling suites | Full workflow consumers remain separately scoped |
| Frontend gates | PASS | 62 tests / 3 files; tsc --noEmit exit0; Vite build 3117 modules | Large bundle warning persists |
| Existing real Devin history after F5 | PASS on current QA | Chromium 320/390/820px, no Stop/pending/active Thinking, no overflow, compact session panel hidden | Does not prove ordinary-message ARIA through real provider reasoning |

Playwright qa-home-site-chat-live-audit.spec.ts: 1 passed (3.1s). Screenshots assets/completed-real-chat-320.png, -390.png, -820.png saved; 390px screenshot visually inspected. This is read-only history proof of exact existing swe-2 session W4fggLSunrJB41C24MV7C, not a new LLM run. Initial RED had two failures: missing ARIA and the changed expectation that collapsed content remains hidden rather than unmounted; both resolved by the intended DOM contract.

No full goal/production completion claim. Other dirty runtime changes remain preserved and unstaged. Source/runtime boundary explicitly includes the existing mixed tree, not a claim that all deployed code equals HEAD.
