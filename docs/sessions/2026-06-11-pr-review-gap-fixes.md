# 2026-06-11 PR review gap fixes

## Scope

- Fixed chat architecture launch regression where `projectPath` / `executionCwd` stopped flowing through `useChatComposerActions`.
- Synced conversation title settings through shared frontend state and hardened optimistic rollback against out-of-order save failures.
- Prevented repeated budget-approval clicks from sending duplicate approvals for the same request.
- Fixed absolute helper URL generation for relative API base paths like `/backend`.
- Cleared leaked `pendingBudgetApprovals` state when sessions are deleted or archived.
- Restored durable architecture graph recovery when persisted parent-chat messages no longer carry an `[Architecture: ...]` header but tool-call args still include `schemaName`.
- Corrected chat max-iteration failure reporting to use the final approved loop limit.

## Verification

- `apps/kalio-web`: `npm.cmd exec vitest run src/features/settings/ConversationSettingsPanel.test.tsx src/features/settings/settingsStore.test.ts src/features/chat/ChatInterface.test.tsx src/features/chat/AgentTurnBubble.test.tsx src/features/vfs/ConversationFilesBar.test.tsx src/features/sessions/SessionPanel.test.tsx src/services/apiClient.test.ts`
- `apps/kalio-api`: `npm.cmd exec vitest run src/modules/architecture/architecture-durable-graph.spec.ts src/modules/chat/__tests__/chat.service.spec.ts`
- Root typecheck: `npm.cmd run typecheck`
- Root build: `npm.cmd run build`

## Live-readiness

- Local regression coverage and typed/build gates pass for the touched paths.
- This slice improves PR readiness but does not close every issue found in broader review. Backend payload validation for new persona/settings fields is still a follow-up risk.

## Remaining risks

- The current frontend/backend worktree still contains unrelated in-flight changes outside this fix slice.
- No full-stack Playwright flow was rerun for the new settings sync or budget approval UI in this slice.
