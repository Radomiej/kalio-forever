# QA301 — Kalio dispatcher provenance in graph inspector

2026-10-04. Local frontend component tests, fixed QA not rebuilt/restarted.

Traced tool-group payload to canonical chat tool items/snapshots; provider-native Devin actions are projected separately by NativeToolAuditPanel, not mixed into this dispatcher group. Existing ToolCallBubble chrome labels that same dispatcher channel Kalio. Added Origin:Kalio for single-tool inspector and Kalio label to each grouped tool summary, retaining collapsed grouping. No inference from a tool name and no contract/persistence changes.

Regression RED1 failure/23 passes (Kalio absent), GREEN24/24 exit0 after scoped presentation change, system Node outside sandbox. Existing group test retains running/error distinction, arguments/results and empty-result behavior. Includes QA300 completion wording regression.

| AC / PIT | Status | Evidence | Remaining |
|---|---|---|---|
| Dispatcher origin / PIT-07 | PASS locally | Canonical channel trace, RED/GREEN | Browser QA proof |
| Grouping and states / PIT-02,03 | PASS locally | Same group, running/error/no-result assertions | Single-tool dedicated origin regression |
| Provider-native audit | UNVERIFIED in graph | Separate chat component unchanged | Optional graph access to actual audit, not guessed execution |
| Deployment / PIT-11 | UNVERIFIED | Dist unchanged | Build/runtime-config preservation and rendered proof |

Design-pityfall guided preserving one grouped node and distinguishing actual dispatcher provenance from provider-native audit. Overall goal active; no completion claim.
