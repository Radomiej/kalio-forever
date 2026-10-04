# QA125 — Real Devin read after host reset

2026-10-04. Fixed QA http://localhost:5288/, API http://127.0.0.1:3316/api; Chrome desktop 1733x1263 observed screenshot. Same AppData QA data, existing dirty worktree preserved.

## Reset evidence

Initially automatic review rejected PATCH settings with empty DTO as potentially changing security settings. Inspected controller and policy service; added regression verifying empty DTO preserves native permissions, does not generate/set/clear a token and invokes registry.reset once. All six controller tests passed with system Node outside sandbox. Retry explicitly provided this evidence and refused any policy-source transition; approved reset completed. Full returned settings compared equal before/after. This still writes the identical persisted policy; no separate reset endpoint was added.

Devin static preflight then passed all 16 checks for W4fggLSunrJB41C24MV7C and E:/Projekty/home-site. No host existed at that snapshot; exact authenticated swe-2 profile and manual HITL retained.

## Live Chrome test

Home → Talk → Home Site → existing exact session. Sent QA125_KALIO_READ requesting exactly one Kalio fs_read of package.json, no native tools, terminal, web or writes. Rendered final heading QA125_KALIO_READ_RESULT with nexora-home-site and vite build. Tool bubble shows successful fs_read, Kalio provenance and exact path.

Exact current-run endpoint returned empty after execution. Reloaded page, reopened Talk: final heading count 1, Stop agent count 0. Screenshot visually showed final answer and green Kalio fs_read entry, no pending response. Screenshot displayed in tool output but not saved as a file; artifact capture remains incomplete. Audit-level exact tool counts and absence of additional native calls were not verified in this attempt.

| Requirement | Status | Remaining |
| --- | --- | --- |
| Preserve reset settings/token operations | PASS scoped | Test and returned metadata; not credential backup |
| Real SWE-2 Kalio read and final response | PASS QA UI | Audit reconciliation still needed |
| F5 answer/tool provenance and no Stop | PASS QA UI | Other lifecycle paths remain |
| HomeSite write/build, all native policies, CMD stress | OPEN | Not tested in this run |
| Fresh Codex chat/tools | OPEN | Separate real run required |

Overall objective remains active. No target file changes, build, command spawn or provider deletion requested by this prompt.
