# QA168 — deployed neutral interruption and real Devin recovery

2026-10-04, fixed QA, exact SWE-2 session W4fggLSunrJB41C24MV7C. Chromium: 1 passed (10.6s).

Visible no-tool response was interrupted by authorized host reset through empty settings PATCH. Public settings stayed identical. Journal errorMessage exactly matched: Turn interrupted because the external agent runtime was lost. It no longer incorrectly names Codex for this Devin failure.

After F5 the partial answer remained with an error indicator; fresh follow-up answered in the same conversation from a different host epoch, and final F5 preserved it with no Stop or transport-recovery indicator. Audit assertions: zero tools and zero process.cmd.invocation during the test; native filesystem/web/terminal remained false. Before-reset and recovered-after-F5 screenshots are in assets/.

This supersedes the source-only neutral-wording boundary in QA165/166. It proves the tested real Devin reset/recovery path, not all providers, subagent failures or overall release readiness. Runtime source ownership/commits and remaining UX acceptance remain open.
