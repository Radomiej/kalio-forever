# KALIO v2 Code Audit

Static-analysis pipeline that produces a prioritized tech-debt report for
`kalio-api`, `kalio-web`, packages, and core contributor/agent docs using
industry-standard JS/TS libs plus a small built-in governance scanner.

## Usage

```powershell
# From repo root
pnpm audit          # run all analyzers, write raw output to docs/audit/raw/
pnpm audit:report   # run audit + aggregate into docs/audit/<date>-report.md
```

`npx` pulls each tool on-demand; nothing is installed globally. First run is
slow (downloads to npm cache), subsequent runs are fast.

## Tools

| Tool | Purpose | Raw output |
|---|---|---|
| built-in scanner | file sizes, silent catches, `any` types | `file-stats.json` |
| regression review leads | Portal-style review leads for TODO/HACK/workaround, literal UI copy, locale branches, browser dialogs, and search/domain-list drift | `file-stats.json` |
| string-business-logic leads | warning queue for message-text and other free-form text parsing branches in business code | `file-stats.json` |
| governance scanner | README / CONTRIBUTING / CODE_OF_CONDUCT / agent-doc drift | `docs-governance.json` |
| `madge` | circular dependencies | `madge-circular.json` |
| `jscpd` | copy/paste detection | `jscpd/jscpd-report.json` |
| `knip` | unused files/exports/deps | `knip-<pkg>.json` |

## Output

- `docs/audit/raw/…` — raw tool JSON (overwritten each run).
- `docs/audit/<YYYY-MM-DD>-report.json` — machine-readable aggregated report.
- `docs/audit/<YYYY-MM-DD>-report.md` — human-readable prioritized refactor queue
  following AGENTS.md architecture rules.

## Governance checks

The governance scanner currently flags:

- missing required top-level contributor or agent-doc files
- README / CONTRIBUTING links missing for core governance docs
- incomplete Contributor Covenant sections in `CODE_OF_CONDUCT.md`
- drift risk between `.github/copilot-instructions.md` and root `.copilot-instructions.md`
- overly long root `AGENTS.md` files that are more likely to drift

Current governance thresholds:

- `AGENTS.md` > 300 lines: `HIGH`
- `AGENTS.md` 221-300 lines: `MEDIUM`
- root `.copilot-instructions.md` > 40 lines when `.github/copilot-instructions.md` exists: `HIGH`

Rationale: these root instruction files are coordination entry points. Once they
grow beyond these limits, they tend to accumulate duplicated policy and drift
from the canonical nested docs.

## Regression review leads

The built-in scan also carries the portable parts of the Portal regression audit:

- `TODO`, `HACK`, `temporary`, and `workaround` markers
- browser `confirm()` / `alert()` calls with inline strings
- literal `placeholder`, `aria-label`, and `title` attributes in frontend TSX
- `locale === ...` branches that may bypass translation files
- search/domain-list terms such as `category`, `facet`, `searchFields`, and `availableFields`

These rows are review leads, not automatic failures. The report caps this section
at 60 rows and expects reviewers to suppress false positives with a concrete
reason rather than treating every match as a bug.

## String-driven business logic leads

The built-in scanner also emits dedicated warnings for code paths that appear to
steer business/runtime behavior from human-readable strings instead of typed
contracts.

Current heuristics flag:

- `error.message` comparisons or substring checks such as `===`, `includes()`,
  `startsWith()`, `endsWith()`, `match()`, and normalized
  `toLowerCase().includes()`
- free-form `content`, `prompt`, `text`, `title`, `label`, `name`, or
  `description` parsing with `includes()`, `startsWith()`, `endsWith()`,
  `match()`, or normalized `toLowerCase().includes()`
- substring parsing on identifier-like fields such as `id`, `sessionId`,
  `runId`, `schemaId`, `toolCallId`, `messageId`, `taskId`, or `nodeId`
- `.equals(...)`-style string matching, kept as a generic warning even though
  JavaScript strings do not normally expose this method

These are warnings, not auto-failures. The expected fix direction is to prefer
machine-readable `code` values, enums, discriminated unions, or typed result
objects. Human-readable message text should stay in logging and UI, not in
branching logic. Typed discriminated unions such as `status === 'done'` are not
the target of this heuristic when they are the contract.

Runtime/projection paths additionally treat ID-fragment parsing as HIGH severity,
because `toolCallId`, `messageId`, `taskId`, `nodeId`, `sessionId`, and `runId`
prefixes are opaque identifiers, not workflow state machines.

## Severity rules

Aligned with AGENTS.md architecture rules:

- 🔴 CRITICAL — file > hard limit (Controller 250, Service 400, Module 120, React 350), silent catch in critical path, circular dep > 3 modules
- 🟡 HIGH     — file > soft limit (Controller 150, Service 300, Module 80, React 200), silent catch non-critical, circular dep
- 🟡 HIGH     — message-text error branching in business/runtime code
- 🟢 MEDIUM   — `any` hotspot (≥ 5/file), duplicate clone, unused export, free-form text parsing branch
- ⚪ LOW      — `any` ≥ 1

## File limits (from AGENTS.md)

| Type | Soft | Hard |
|---|---|---|
| Controller / Gateway | 150 | 250 |
| Service | 300 | 400 |
| Module | 80 | 120 |
| Test file | 400 | 600 |
| React Component | 200 | 350 |
