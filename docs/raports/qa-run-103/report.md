# QA103 — Local native-policy enforcement patch

2026-10-04. Worktree HEAD61a2c91 with earlier dirty changes retained. Local adapter verification only; fixed QA was not restarted, reset or upgraded during this attempt. No live prompt, confirmation or target-project mutation. No screenshots: no browser interaction occurred in this attempt.

## Patch

The effective native policy is copied/frozen in the source and passed through registry and host into the ephemeral Devin project-local configuration. Disabled filesystem tools read/grep/glob/edit/write, terminal exec and webfetch/web_search receive deny rules. Enabled categories receive ask rules instead of automatic approval. MCP tool rules are not blanket-denied; existing manual Kalio HITL is unchanged.

Registry reuse with changed category flags now fails closed until reset rather than silently reusing an incompatible host. It copies the input policy so a caller cannot mutate a registered host's policy. Settings reset remains the established replacement path; automatic retirement/replacement is not added.

## Verification

Fail-first config test: missing permissions.deny reproduced (one FAIL, existing serialization test PASS). After implementation and final snapshot changes, four focused suites passed24/24 (4.07seconds). Standalone API typecheck passed before the final freeze-only edits. Final API build then reported0 TypeScript issues and676 compiled files, exit0. Focused ESLint for config/config spec/host/registry spec passed before the final freeze-only edits. git diff --check passed. No claim of full-suite or production verification.

| AC | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Config deny/ask and rewrite preservation | PASS local | Config tests3/3 | Installed ACP must actually load rules |
| Policy copy and mismatch rejection | PASS local | Registry tests5/5 | Settings reset and resumed grant behavior live |
| Existing source/host regressions | PASS local | Source12 and host4 tests | Full runtime proof |
| Native denial in QA | UNVERIFIED | QA102 remains a reproduced bypass | Deploy and capture actual failed tool outcome, not prose |
| Kalio positive read/HITL/F5 | UNVERIFIED for this patch | Earlier proof does not cover new config | Real fs_read and persistence regression |
| QA providers preserved | N/A mutation | No DB/settings writes in this attempt | Recheck at deployment |

An independent advisor confirmed callback-only enforcement is insufficient and flagged session-grant precedence. A hard CLI denial may legitimately emit zero native_approval events, so QA102's callback-count assertion is not a sufficient acceptance contract for the fix. Live proof must include a correlated failed native outcome and no successful read. Write matcher support and unknown native tools require explicit installed-version checks; this patch is not yet complete filesystem-category proof.

Changes remain uncommitted pending live verification and dependency-aware review: llm-source already contains earlier owned/dirty work, which must not be staged wholesale merely to commit these two policy lines. No unrelated changes were removed.
