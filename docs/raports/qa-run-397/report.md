# QA397 — real Devin queued follow-up cancellation at HITL

2026-10-04. Fixed QA Home Site session W4fggLSunrJB41C24MV7C, SWE-2. Fresh static readiness 17/17 PASS. No terminal command confirmed or executed, no project writes, no reset.

UI requested one npm run build via Kalio terminal_spawn and intentionally withheld Confirm. While awaiting confirmation, submitted a second fs_read prompt via composer Enter. UI showed Queued (1) while Confirm count remained 1. Clicked Stop once: queue badge, Confirm and Stop all disappeared.

Audit turn ct5V7ASdfNIlIS_ekiegy / assistant GFit8p6c-fd4Ine1O_rRa: terminal call mcp-8d4070fb-a0ab-45ad-ab24-ce1d4edb4a94-7 requested approval at 1791148753480, confirmation cancelled at 1791148770252, matching tool result cancelled at 1791148770254; ACP cancelled and llm.turn.cancelled by 1791148770291. Scoped observed interval has no fs_read call and no second llm.turn.started. Current-run endpoint empty.

After F5 queue/Confirm/Stop counts remain zero; latest bubble says cancelled / Interrupted. Screenshot stop-queue-after-refresh.png. This proves queue drain during a real manual-approval wait, not Stop during an already executing OS process or an indefinite no-future-execution guarantee.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Queue during active real Devin turn | PASS | Queued (1) with pending Confirm | Other queue states separate |
| Stop drains queued message and HITL | PASS for scenario | UI removed queue/approval, cancelled tool/turn, no queued read in interval; readonly DB check confirms cancelled queued turn | Stop during executing OS process separate |
| F5 does not revive pending work | PASS immediate reload | Three counts zero, Interrupted bubble | Reboot/deep recovery separate |

No unsafe approval override. QA/Home Site remain available; overall goal active.

## Durable queue verification — 2026-10-04 follow-up

Readonly query of fixed QA `chat_runs`, scoped to this session and five latest rows, confirms queued turn `N9oCyKuIIcBRJ48pNR8XT`: status `cancelled`, revision 2, queued_at 1791148770162, queue_cancelled_at/completed_at 1791148770251, queue_claimed_at null. Active turn `ct5V7ASdfNIlIS_ekiegy` is `interrupted`, completed_at 1791148770291. Phase on the cancelled queue row remains `queued`; that field alone must not be interpreted as pending execution. No payload, credentials or other sessions were read. This closes the missing durable-record evidence for this scenario; it does not prove recovery across a backend restart.

Focused local verification: system Node, `vitest run src/modules/chat/run-journal.service.spec.ts` in `apps/kalio-api`: 21/21 PASS. Recovery warnings are fixture scenarios, not a restart of QA. The accompanying initial source reads used duplicated relative paths and failed; they were repeated from the repository root. Test execution itself succeeded with exit 0. This is a focused regression gate, not the full suite or live restart proof.
