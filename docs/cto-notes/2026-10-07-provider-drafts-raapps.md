# CTO feedback — 2026-10-07

Recorded from the user's messages during QA. These are requirements, not evidence of completion.

1. Devin must appear among selectable providers/agents, not only inside separate integration settings. Persist the explicit default across restart. Check availability server-side without silently switching to mock/API providers or spawning repeated consoles.
2. Chat model selection must be discreet: one searchable model picker, optional provider filter, concise provider/model rows. Technical catalog-refresh controls and pricing banners do not belong beside the prompt. Refresh catalogs quietly through existing backend queues/cache.
3. New Chat is a draft. Opening it must not write a conversation/history record. Persist once on first nonempty submit; protect double submit; preserve legitimate pending/failed/child sessions.
4. RA-Apps must support an explicit execution profile/model or inheritance from the current Kalio conversation. Fallback is a declared configuration, not an invisible error-driven provider switch.
5. Interactive Q&A must display a real question and clickable answers. Blank content is an error, never a successfully ready app. Clicking an answer returns it to the conversation, including after reload.

Related evidence: `docs/raports/qa-run-494/README.md`. Devin communication remains the primary acceptance target; Jev/Goal and Codex require their own runtime proof.
