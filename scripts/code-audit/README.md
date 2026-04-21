# KALIO v2 Code Audit

Static-analysis pipeline that produces a prioritized tech-debt report for
`kalio-api`, `kalio-web`, and packages using industry-standard JS/TS libs
(no bespoke shell scripts).

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
| `madge` | circular dependencies | `madge-circular.json` |
| `jscpd` | copy/paste detection | `jscpd/jscpd-report.json` |
| `knip` | unused files/exports/deps | `knip-<pkg>.json` |

## Output

- `docs/audit/raw/…` — raw tool JSON (overwritten each run).
- `docs/audit/<YYYY-MM-DD>-report.json` — machine-readable aggregated report.
- `docs/audit/<YYYY-MM-DD>-report.md` — human-readable prioritized refactor queue
  following AGENTS.md architecture rules.

## Severity rules

Aligned with AGENTS.md architecture rules:

- 🔴 CRITICAL — file > hard limit (Controller 250, Service 400, Module 120, React 350), silent catch in critical path, circular dep > 3 modules
- 🟡 HIGH     — file > soft limit (Controller 150, Service 300, Module 80, React 200), silent catch non-critical, circular dep
- 🟢 MEDIUM   — `any` hotspot (≥ 5/file), duplicate clone, unused export
- ⚪ LOW      — `any` ≥ 1

## File limits (from AGENTS.md)

| Type | Soft | Hard |
|---|---|---|
| Controller / Gateway | 150 | 250 |
| Service | 300 | 400 |
| Module | 80 | 120 |
| Test file | 400 | 600 |
| React Component | 200 | 350 |
