# QA239 — new-chat creator source reconciliation

2026-10-04. Local worktree review/test only; no new LLM call or backend restart.

Reviewed NewChatScreen changes: compact configuration/prompt steps, desktop lg:contents keeping all controls visible together, responsive mode-switch sizing, canRun guard for keyboard submit, and draft retained until caller launch succeeds. Three component regressions cover retention on Run, Enter without runtime, and Back/Next retention.

Verification: NewChatScreen.test.tsx and useChatLaunchSend.test.ts, 9 PASS / 2 files, 1.22s at 14:18:01. The hook's negative-path error logs are expected fixture evidence, not hidden. Existing source was already in served mixed frontend; this is source/ownership closure, not a fresh deployment claim.

The existing qa-launch-breakpoint-draft.spec.ts was inspected but not rerun: its finally block permanently deletes the owned empty draft after checks. Prepare an explicit preserve-draft mode before repeating it on user QA. No draft or user session was deleted in this attempt. Latest rendered breakpoint, selected runtime, persona/project and F5 proof remain separate requirements.
