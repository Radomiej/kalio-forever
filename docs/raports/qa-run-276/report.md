# QA276 — manual HITL and restart recovery

2026-10-04, Europe/Warsaw. **2 passed (7.1s), exit 0**. System Node outside sandbox, isolated Chromium one worker, API 64075, storage data/playwright-stack/1791123148534-52372, existing builds. Command from apps/e2e: node scripts/run-playwright-with-stack.mjs hitl-tool-confirmation-runtime.spec.ts --project=chromium --workers=1 --reporter=line.

Only test preparation changed: reuse createExistingMockConversation with explicit designer persona/profile instead of an empty unbound session. Existing browser confirmation, VFS-content, backend restart and same-turn/single-result assertions remain unchanged. Initialization creates no tool result and therefore does not weaken the one-tool-result assertion.

| Area | Status | Evidence | Remaining |
|---|---|---|---|
| Manual confirmation | PASS | UI Confirm visible/clicked, hidden afterwards; exact VFS content | Deterministic mock, not Devin |
| Restart recovery | PASS | Isolated backend PID 48308 replaced by 44256; same pending confirmation restored after reload | Fixed user QA not restarted |
| Same turn / once | PASS | Exactly one persisted tool_result, assistant completion matches its turnId | No OS-wide process assertion |
| Visual capture | Not newly captured | Browser assertions prove interaction; failed QA275 captures retained | No new screenshot claim |
| Overall release | NOT CLOSED | 16 original QA257 failures remain unresolved; full suite not rerun | Remaining workflow/runtime gates |

Actual VFS write remained within disposable session storage. No app code, provider setting in fixed QA, target-project file, live Devin or Codex request changed. This is Kalio runtime recovery proof with a mock, not live ACP restart proof.
