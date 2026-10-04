# QA232 — deploy Codex single-flight start to fixed QA

Date: 2026-10-04. Fixed QA localhost:5288 / API :3316. Patch commit 8d6e1659. Built backend from QA231 local gates (24 tests, typecheck, build).

Before restart: chat_runs contained only completed, cancelled, failed, interrupted and interrupted_needs_retry states; no active runs. Consistent SQLite backup: ignored .tmp/qa-provider-backup/qa-before-232.db. Managed stack restarted with unchanged AppData data root, fixed ports, direct runtime and existing dist.

| Acceptance | Status | Evidence |
| --- | --- | --- |
| Preserve profiles/credentials/settings | PASS | SHA256 equality against backup for execution_profiles, credentials, app_settings |
| Managed backend/frontend healthy after restart | PASS | stack-manager start completed; both health gates passed |
| Real cold host tolerates simultaneous checks | PASS for shared host identity | Two concurrent POST checks returned online/connected with identical epoch dwhmg7-0157EI9eesevFL |
| Exact OS process count and global CMD activity | UNVERIFIED | Same epoch does not independently prove global process count; a combined shell audit command failed parsing before execution |
| New live LLM turn after this deployment | UNVERIFIED | Not run in this attempt; QA229/230 were prior deployment |

No model prompt, target project edit, permission change or provider mutation was made in this attempt. This receipt closes deployment and real concurrent host identity, not the full historical CMD-spam issue or durable opt-in/autoreconnect UX. Next: independent process/audit measurement and a real communication regression against this deployed revision.
