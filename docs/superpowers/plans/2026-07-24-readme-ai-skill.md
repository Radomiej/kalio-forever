# README and AI Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Kalio's root README into an attractive, scannable onboarding page and add a repo-visible AI skill that keeps future README edits factual and maintainable.

**Architecture:** This is a documentation-only change. `README.md` remains the public landing page, `docs/agent-skills/kalio-readme-maintainer.md` becomes the agent-maintenance guidance, and `docs/agent-skills/README.md` remains the skill index. Runtime code, package scripts, and shared contracts are untouched.

**Tech Stack:** GitHub Flavored Markdown, Mermaid, repository-relative links, PowerShell validation, existing Kalio documentation and package scripts.

## Global Constraints

- Keep the change documentation-only; do not modify runtime code, package scripts, architecture contracts, or application behavior.
- Verify every project claim against `package.json`, root scripts, `AGENTS.md`, and existing linked documentation.
- Keep the README concise and move deep architecture detail into existing documents.
- Use repository-relative links and descriptive image alt text.
- Do not invent screenshots, metrics, providers, commands, support promises, or release claims.
- Preserve `LLM_PROVIDER=mock` onboarding and the existing `CREDENTIALS_MASTER_KEY` safety warning.
- Check the final Markdown for mojibake, broken links, unmatched code fences, and accidental scope expansion.

---

### Task 1: Rewrite the public README landing page

**Files:**
- Modify: `README.md`
- Read for facts: `package.json`, `scripts/README.md`, `docs/quickstart-user.md`, `docs/local-dev-guide.md`, `CONTRIBUTING.md`, `AGENTS.md`

**Interfaces:**
- Consumes: existing package scripts, URLs, versions, architecture diagrams, and linked docs.
- Produces: a root README with the sections `Why Kalio`, `See it in action`, `Quick start`, `Core capabilities`, `How the runtime works`, `Providers`, `Data and safety`, `For contributors`, `Documentation`, `Roadmap`, and `License`.

- [ ] **Step 1: Capture the source-of-truth facts before editing**

Run from the repository root:

```powershell
Get-Content -LiteralPath package.json
Get-Content -LiteralPath scripts/README.md
Get-Content -LiteralPath docs/quickstart-user.md
Get-Content -LiteralPath docs/local-dev-guide.md
```

Record only facts needed by the README: Node/pnpm floors, dev/QA/prod ports, installer URL, `mock` provider behavior, root commands, architecture links, and storage/security boundaries.

- [ ] **Step 2: Replace the README with the approved information funnel**

Keep the current Kalio identity, MIT badge, CI badge, technology badges, Mermaid diagrams, architecture image, feature claims, provider table, storage table, roadmap, and contributor links when they remain supported. Reorder and rewrite them so the page starts with:

```markdown
# Kalio

**Local-first runtime for designing, running, and inspecting agent workflows.**

[Install](#quick-start) · [Develop](#for-contributors) · [Architecture](docs/agentflow-architecture-and-workflow.md) · [Docs](#documentation)
```

Use these copy boundaries:

- `Why Kalio`: explain that Kalio treats agent architecture as editable runtime configuration and keeps data/workflows local-first.
- `See it in action`: retain the architecture diagram and one concise event-flow diagram.
- `Quick start`: put the Windows one-line install first, then contributor setup with `pnpm install`, `.env`, `pnpm dev`, and the verified `3016/5188` endpoints.
- `Core capabilities`: use short grouped cards or bullets instead of long prose blocks.
- `How the runtime works`: explain backend durable truth versus frontend projection and link deep dives.
- `Providers`: keep the provider table and offline `mock` path; do not claim an endpoint works unless the existing provider documentation supports it.
- `Data and safety`: preserve session sandboxing, encrypted provider secrets, and the production key requirement.
- `For contributors`: show the minimum `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, and `pnpm audit:report` commands, then link to `CONTRIBUTING.md` and `AGENTS.md`.
- `Documentation`: link to the quickstart, local-dev guide, architecture docs, agent-skills index, code of conduct, and license.
- `Roadmap`: distinguish shipped capabilities from open work without changing status.

Use real UTF-8 punctuation and emoji only where they render correctly. Keep every link target relative to the repository root.

- [ ] **Step 3: Inspect the rendered structure statically**

Run:

```powershell
git diff -- README.md
git diff --check
rg -n "^#{1,6} |^```|^~~~|\]\([^)]*\)|<img |mermaid" README.md
```

Expected: the diff contains only README content changes, `git diff --check` reports no whitespace errors, and every code fence/diagram has a matching closing fence.

- [ ] **Step 4: Commit the README slice**

```powershell
git add -- README.md
git commit -m "docs: improve Kalio README onboarding"
```

---

### Task 2: Add the README maintenance skill

**Files:**
- Create: `docs/agent-skills/kalio-readme-maintainer.md`
- Modify: `docs/agent-skills/README.md`

**Interfaces:**
- Consumes: the existing repo skill-copy convention described in `docs/agent-skills/README.md`.
- Produces: a named `kalio-readme-maintainer` skill and an index entry that points agents to it.

- [ ] **Step 1: Write the skill with repository-specific guardrails**

The skill must include these rules:

```markdown
# Kalio README Maintainer Skill

## When to use

Use for creating, reviewing, or updating the root README or README-facing onboarding links.

## Source of truth

Verify commands and versions against `package.json` and scripts; verify architecture claims against `AGENTS.md` and the linked architecture docs; verify user setup against `docs/quickstart-user.md` and `docs/local-dev-guide.md`.

## Writing rules

- Start with audience, value, and one runnable path.
- Keep the first screen scannable; use headings, short paragraphs, lists, tables, and diagrams where they improve orientation.
- Put detailed architecture/API material in linked documents.
- Use relative links and descriptive alt text.
- Treat badges as signals, not decoration; retain only badges with clear meaning and a trustworthy source.
- Never invent capabilities, metrics, screenshots, commands, URLs, release status, or support promises.
- Keep secrets as placeholders and preserve the `mock` offline path.
- Check for mojibake after every edit.

## Verification

- Inspect `git diff --check`.
- Validate relative links and image paths.
- Check heading order and fenced code blocks.
- Compare commands and ports with repository source of truth.
- Report any unverified claim instead of silently keeping it.
```

Expand the actual file with the repo's existing skill-copy/sync rule and explicit out-of-scope behavior. Do not add executable automation or a second project-facts registry.

- [ ] **Step 2: Register the skill in the index**

Add `kalio-readme-maintainer` to the `Current Project Skills` list in `docs/agent-skills/README.md`, preserving the existing list style and sync warning.

- [ ] **Step 3: Validate and commit the skill slice**

Run:

```powershell
git diff -- docs/agent-skills/README.md docs/agent-skills/kalio-readme-maintainer.md
git diff --check
```

Expected: the index contains exactly one new skill entry, the skill has no placeholder instructions, and the diff is whitespace-clean. Then commit:

```powershell
git add -- docs/agent-skills/README.md docs/agent-skills/kalio-readme-maintainer.md
git commit -m "docs: add README maintenance skill"
```

---

### Task 3: Run documentation verification and review the final scope

**Files:**
- Read: `README.md`, `docs/agent-skills/README.md`, `docs/agent-skills/kalio-readme-maintainer.md`, `package.json`, `docs/quickstart-user.md`, `docs/local-dev-guide.md`
- Verify: all files changed by Tasks 1 and 2

**Interfaces:**
- Consumes: final documentation diff and source-of-truth files.
- Produces: evidence that links, Markdown structure, commands, and scope are valid.

- [ ] **Step 1: Verify repository-relative links and images**

Run this read-only PowerShell check from the repository root:

```powershell
$markdownFiles = @('README.md', 'docs/agent-skills/README.md', 'docs/agent-skills/kalio-readme-maintainer.md')
$missing = @()
foreach ($markdownFile in $markdownFiles) {
  foreach ($match in (rg -o "!?\[[^\]]*\]\(([^)]+)\)" $markdownFile)) {
    $target = [regex]::Match($match, "\]\(([^)]+)\)").Groups[1].Value
    if ($target -notmatch '^(https?://|mailto:|#)' -and -not (Test-Path -LiteralPath (Join-Path (Get-Location) $target))) {
      $missing += "$markdownFile -> $target"
    }
  }
}
if ($missing.Count -gt 0) { $missing; exit 1 }
"All checked relative Markdown targets exist."
```

Expected: `All checked relative Markdown targets exist.`

- [ ] **Step 2: Check encoding, fences, headings, and diff scope**

Run:

```powershell
rg -n "â€”|â€“|â€|ðŸ|Ã|Â" README.md docs/agent-skills/README.md docs/agent-skills/kalio-readme-maintainer.md
git diff --check
git status --short
git diff --stat HEAD~2..HEAD
```

Expected: the mojibake search returns no matches, `git diff --check` is clean, and the diff contains only the README, skill index, skill file, plus their two commits and the already committed spec/plan documents.

- [ ] **Step 3: Run the repository documentation/audit gate**

Run with the repository's system Node runtime on Windows:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
pnpm audit:report
```

Expected: the command completes or reports only pre-existing audit findings. Do not change unrelated audit output to make this documentation task pass.

- [ ] **Step 4: Review final status and report evidence**

Run:

```powershell
git status --short
git log -4 --oneline --decorate
```

Report the changed files, verification commands, any baseline failures, and whether an installed copy of the new skill was synced. Do not claim installed-skill availability unless the matching installed `SKILL.md` was actually updated.
