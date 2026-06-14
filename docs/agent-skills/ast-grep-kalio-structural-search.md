# ast-grep Kalio Structural Search Skill

Installed skill path:

```text
C:\Users\Radomiej\.codex\skills\ast-grep-kalio-structural-search\SKILL.md
```

This repository copy records the expected behavior for agents that only read repo docs.

## Core Rule

Use `ast-grep-mcp` when the task is about code shape, repeated syntax patterns, or AST structure across the repo. Do not force Serena to answer broad structural search questions that are better solved by AST matching.

## When To Use

- You need to find repeated call shapes, object literal shapes, JSX/TSX constructs, or hook patterns.
- You need to search for a behavior pattern that may not map cleanly to one symbol name.
- You want to debug why a structural pattern is not matching by inspecting syntax trees.
- You need a YAML rule that can later be reused for audits or codemod-like sweeps.

## Working Pattern

1. Use Serena first if you do not yet know the right files or symbols.
2. Once scope is known, use `ast-grep-mcp` tools:
   - `find_code` for straightforward patterns
   - `find_code_by_rule` for complex YAML rules
   - `test_match_code_rule` to validate a YAML rule on a small snippet
   - `dump_syntax_tree` when a pattern does not match
3. Prefer `output_format: text` unless you need JSON metadata.
4. Keep `project_folder` absolute and scoped as narrowly as practical.

## Official Rule Format

Based on the official ast-grep docs:

- inline rules use the same top-level fields as a rule file: `id`, `language`, `rule`
- multiple inline rules are separated with `---`
- `scan --rule path/to/rule.yml` is the stable file-based fallback when ad-hoc inline execution is unreliable
- `scan --config sgconfig.yml` is the project-level mode for a reusable rule pack

Primary references:

- [Rule Essentials](https://ast-grep.github.io/guide/rule-config.html)
- [ast-grep scan](https://ast-grep.github.io/reference/cli/scan.html)

## Kalio-Specific Guidance

- Good fits in this repo:
  - finding all `resolveLiveTurnState($$$)` call sites
  - finding `useEffect(...)` patterns in FE
  - finding `@ConfirmedTool()` / risky tool shapes in BE
  - finding duplicated object-literal runtime flags or branch/session launch shapes
- YAML rules are useful here when the question is relational, e.g. “find a function that has await”, “find handlers inside a specific component shape”, or “find a call nested in another construct”.
- On Windows/Codex, `ast-grep-mcp` depends on `ast-grep.exe` being available in the MCP server PATH; the installed Codex config already handles that.

## Serena Complement

- Serena is better for:
  - declaration/reference/implementation navigation
  - project memory
  - service and module ownership
- `ast-grep-mcp` is better for:
  - structural sweeps
  - syntax-shape audits
  - YAML rule testing
  - AST debugging
- Strongest workflow:
  1. Serena narrows the target files/symbols.
  2. `ast-grep-mcp` performs the structural sweep.
  3. Serena re-enters if the results need semantic ownership analysis.

## Common Mistakes

| Mistake | Better move |
|---|---|
| Using plain text grep for syntax-driven questions | Use `find_code` or `find_code_by_rule`. |
| Writing a complex YAML rule without testing it | Use `test_match_code_rule` first. |
| Assuming a non-match means the idea is wrong | Inspect AST with `dump_syntax_tree` and refine the rule. |
| Using `ast-grep-mcp` as the first tool for named-symbol ownership | Start with Serena, then switch. |

## Kalio FE Audit Pack

This repo now keeps reusable FE shell/workflow audit rules in:

```text
tools/ast-grep/fe-shell-audits/
```

Current useful rules:

- `direct-message-streaming-flag.yml`
- `shell-mode-conditional.yml`
- `launch-entrypoints.yml`

Use them when auditing regressions around `New Chat`, live streaming, workflow shell, or session activation.

## Current MCP Caveat

In this environment, plain structural pattern search via `find_code` works reliably, but the current `find_code_by_rule` / `test_match_code_rule` wrapper may reject otherwise valid inline YAML with a parser error. If that happens:

1. keep using `find_code` for quick structural sweeps,
2. save the YAML rule to `tools/ast-grep/...`,
3. run it through CLI or future MCP fixes with `scan --rule`,
4. document the fallback instead of pretending inline YAML worked.

## Quick Reference

- Repeated syntax/call/object/JSX shape -> `ast-grep-mcp`
- Need AST-aware repo sweep -> `ast-grep-mcp`
- Need symbol graph or memories -> Serena
- Need both “where is it used?” and “what code shape repeats?” -> Serena first, `ast-grep-mcp` second
