# QA205 — explicit Codex catalog refresh scope

2026-10-04, local frontend source at HEAD7a276e87 with preserved mixed work. QA204 screenshot showed Recheck Codex models below a selected Devin model. Source inspection confirms the action calls codex.refresh for all connected Codex accounts; it is not a Devin refresh or provider-selector bug.

Minimal fix keeps the existing action and behavior but adds visible scope text and aria-describedby: Codex catalog only, all connected accounts, does not refresh Devin. No new refresh mechanism, host reset or polling added.

| Acceptance | Status | Evidence | Remaining |
| --- | --- | --- | --- |
| Scope is explicit with Devin selected | PASS locally | New regression failed before fix on missing text, passed after | Rendered QA proof not yet taken |
| Codex action does not recheck Devin | PASS locally | getCodexModels(account,true) called; getDevinCliStatus count unchanged after click | Mock boundary, not live HTTP trace |
| Existing combobox behavior | PASS locally |8tests passed1.11s; frontend TypeScript --noEmit exit0 | Build/deploy and compact layout remain required |

RED:1failed7skipped, exit1 at12:36:08. GREEN:8passed,exit0 at12:36:36. Existing act warnings in unrelated discovery/free-plan tests remain unsuppressed. No QA rebuild/restart/deploy, provider changes or project writes this run. Changes not committed yet. Goal remains active.
