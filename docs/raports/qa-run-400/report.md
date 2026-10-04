# QA400 — broader communication regression gate

2026-10-04, system Node on Windows, outside sandbox. Checkout `C:/Users/Radomiej/.codex/worktrees/5a7e/kalio-forever`, source HEAD `4477150e` plus existing dirty worktree. Tests cover current source, not a fresh deployment of all uncommitted changes. No live prompt, provider change, restart, target modification or deployment.

| Area | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| API agent-runtime + chat | PASS local selected modules | vitest run src/modules/agent-runtime src/modules/chat: 94 files passed, 1 skipped; 811 tests passed, 3 skipped; 18.53 s, exit 0 | Other API modules and live suite not run |
| Web chat + graph | PASS local selected feature | vitest run src/features/chat: 83 files, 873 tests passed; 15.86 s, exit 0 | Other web features and full E2E not run |
| API typecheck | PASS | Local typescript/bin/tsc --noEmit, exit 0 | No new build/deployment |
| Web typecheck | PASS | Local typescript/bin/tsc --noEmit, exit 0 | No new build/deployment |

## Interpretation

1684 selected tests passed; 3 explicitly skipped tests in devin-cli-config.live.spec.ts remain unexecuted. Expected negative-path fixture logs include unavailable storage/history, aborted approval reconciliation, stale-run recovery and transport failures; no failed tests or failed exit status. First API output chunk was truncated; final test summary confirms all selected files' result, not inspection of every log line.

Fresh real-provider proof is QA399 (Devin post-Stop read and Chat/Graph/F5 parity). QA397 supplies durable cancelled-queue proof. These local green gates do not prove all runtime races or transient console absence, nor do they close Jev or the full original goal.

## Remaining acceptance boundaries

- [P2] Transient visible console windows: reported by user; WIN-01/02 in QA398 still unverified. Need sensitive startup capture and process attribution, not another version-only probe.
- [P2] Jev integration: target goal/evidence/version packet and live loop not implemented in this checkout; protected shared-contract integration requires review under repository policy.
- [P2] Full release gate and live executing-process Stop/recovery scenarios remain separate from these selected tests.

QA was not altered by this run. No screenshot: this attempt is a local regression gate with no browser mutation. Unrelated changes and the other agent's work remain untouched. No external Linear/Notion sync or production readiness claim.
