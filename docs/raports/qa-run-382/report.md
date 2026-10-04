# QA382 — deployed regression for stale Devin thinking after restart

2026-10-04. Fixed QA localhost:5288 / API 127.0.0.1:3316, same AppData database. Real Devin ACP swe-2, session W4fggLSunrJB41C24MV7C, E:/Projekty/home-site.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| THINK-04 Repeat full-restart reproduction with new API build | PASS (this attempt) | Before restart runtime watchlist empty. Managed direct skip-build restart succeeded, logs backend/frontend-1791146509157-51116.log. Fresh cold readiness 17/17 PASS. UI QA382 resumed Devin and requested same preview workflow as failing QA380. | Not universal replay-order proof. |
| THINK-04 Durable thinking attribution | PASS | Assistant S6Ibmo65JZ7C5ITvv4yPE, turn i0eFFCUrbRLuXqo6PAzs1: currentResult=true, thinkingLength=0, old CSS markers absent. QA380 historical evidence left intact. | Agents with load-only capability still retain replay risk; synthetic late-event timing coverage pending. |
| THINK-04 FE hydration | PASS | After F5 final QA382_PREVIEW_RESULT restored without Thinking section. Screenshot no-stale-thinking.png. | Multiple cold cycles and next-turn late notification test not newly run. |
| PRESERVE-01 Real project preview recovery | PASS | Matching command/cwd inspected, one manual confirmation. Terminal MGPyRLL3QQSQTKaMGbBL5 running; preview HTTP 200, current run empty. | No target source edits/build in this run. |

Local evidence from QA381: restore/host/source tests 23/23 PASS, API typecheck and Nest build exit 0. Deployed build prefers advertised no-replay resume; no change to stored provider credentials, bridge token or native-tool permissions. Browser and backend evidence close the observed QA380 symptom for this reproduced attempt, not all hypothetical ACP timing cases.

Overall goal remains active: transient startup-window report remains unresolved despite bounded zero-event observations; full tool/lifecycle and Jev goal-loop acceptance are not closed by this regression. No production-readiness claim.
