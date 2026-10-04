# QA202 — exact-turn native audit verification

2026-10-04, fixed QA backend e53b3377/frontend QA188. Minimal test-only fix selects the unique agent-turn bubble containing exact heading QA181_ERROR_1791106578162_RESULT, then its unique audit panel. Response predicate matches both approved session and turn. No last-bubble assumption, app changes, deployment, new prompt or project mutation.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Historical Devin audit remains scoped despite newer turns | PASS | Exact response selected before and after F5; correlated HTTP200; Devin-only and approval-not-execution disclosures | Other native execution cases not proved |
| Recorded Codex does not show Devin audit | PASS | Kalio fs_read provenance and absent Devin panel before/after F5 | Unknown legacy provider fallback remains separately scoped |

Playwright qa-native-audit-scope-readonly.spec.ts explicit opt-in/report202: 2 passed in4.3s, exit0. QA201 provides RED reproduction; screenshots assets/codex-without-devin-audit.png and devin-audit-scope.png saved, not visually inspected in this run. No release-completion claim; original goal stays active.
