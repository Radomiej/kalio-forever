# QA213 — Jev exists on a different branch

2026-10-04. Read-only inspection, no model request, merge, provider mutation or deployment.

Current QA-serving worktree: C:\Users\Radomiej\.codex\worktrees\5a7e\kalio-forever, branch codex/kalio-provider-runtime-ux, head 4ae06196. Main checkout: E:\Projekty\kalio-forever, branch codex/kalio-runtime-installer, head 19d5c0c2. Common ancestor c436ca478feb82a65c6035e15a8496663b39ff14.

## Verified source boundary

- Main branch includes 43beadce (Jev HITL / Architect auto-routing), ede6284b (shared Decision Settings), c45f6dcc (control-plane REST auth), and 19d5c0c2 (historical verification docs).
- Main checkout contains HitlJevService, JevDecisionsClient, DecisionSettingsService and ArchitectureAutoRoutingService. The QA-serving worktree does not contain these Jev-specific files.
- Jev client exposes noul probability and choice/confidence. HITL asks an approval decision; architecture selects an exact allowed outgoing edge. Both use server-resolved settings and sanitized state.
- Auto-routing requires exactly one default edge, checks confidence, persists/runtime handling is a separate inspection boundary. The service passes only task prompt and up to 20 incoming summaries truncated to 500 characters each.
- Therefore absence of Jev in chat execution profiles does not establish absence of the Jev feature. QA209's profile/schema discovery was narrower than the actual decision-service integration.

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Jev source presence | PASS, main branch only | Exact files and commits inspected | Not integrated into QA branch |
| Jev currently usable on fixed QA | UNVERIFIED | Current source lacks integration | Branch/contract integration, build and real QA decision |
| Proposed goal loop | UNVERIFIED | Existing choice service can route | Versioned goal updates, durable summaries, acceptance evidence, safe completion guard |
| AutoApprove live proof | UNVERIFIED | Existing main-branch HITL adapter inspected | Current credential, policy enforcement and scoped live test |

[P2] Deployment/source divergence: the Jev feature exists elsewhere but current QA cannot be declared Jev-ready. Do not duplicate it or blindly merge installer/security/shared-contract changes. Review exact diff and preserve foreign work first.

No historical live result was promoted to current QA proof. Original objective remains open; Devin/ChatGPT communication stays the primary delivery target.
