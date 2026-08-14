# README and AI Skill Design

**Date:** 2026-07-24  
**Scope:** Root project README and repo-visible AI skill documentation

## Outcome

Make Kalio's root README attractive, scannable, and useful to three audiences:

1. A user deciding whether Kalio is relevant.
2. A contributor who wants to run and change the project.
3. An AI agent that needs clear documentation-maintenance boundaries.

The change remains documentation-only. It does not alter runtime behavior,
package scripts, architecture contracts, or application code.

## Accepted direction

Use one root README as a concise landing page with a predictable information
funnel:

1. identity, value proposition, and navigation links;
2. short product overview and a visual architecture model;
3. the fastest Windows install path;
4. contributor development setup and verification commands;
5. capabilities and supported provider/runtime boundaries;
6. architecture and data-safety notes;
7. documentation, contribution, roadmap, and license links.

Move deep explanations to the existing linked documents instead of expanding
the README with another architecture manual. Preserve useful claims only when
they are supported by the repository's scripts, package metadata, or existing
documentation.

## Skill design

Add `docs/agent-skills/kalio-readme-maintainer.md` and list it in
`docs/agent-skills/README.md`. The skill will instruct AI agents to:

- identify the intended README audience before editing;
- verify commands, ports, versions, routes, providers, badges, and feature
  claims against repository truth;
- keep the first screen concise and put detailed material behind links;
- prefer relative repository links and accessible alt text;
- avoid invented screenshots, metrics, support promises, or release claims;
- preserve the repo's encoding and check for mojibake;
- update the README skill index when the skill set changes;
- validate Markdown links, headings, code fences, and the final diff.

The skill is guidance only. It does not add runtime automation or a second
source of project facts.

## README content model

The rewrite will keep the current project identity and accurate technical
content while changing the order and density:

- Hero: one clear sentence, compact badges, and links to install, docs,
  contributing, and architecture.
- Why Kalio: explain local-first agent architecture runtime in plain language.
- See it in action: retain Mermaid diagrams and module architecture image,
  with descriptive alt text.
- Run it: separate one-line Windows install from contributor setup; keep mock
  mode prominent for offline onboarding.
- Core capabilities: group agent runtime, tools/HITL, VFS/memory, MCP,
  RA-Apps, multimodal input, CLI agents, and execution inspection.
- Architecture: summarize the backend-owned durable truth and frontend
  projection boundary, linking deep dives rather than duplicating them.
- Providers and storage: keep only the choices and safety boundaries needed
  for a first evaluation; link to detailed docs where available.
- Contributor path: commands, project structure, quality gates, and links to
  `CONTRIBUTING.md` and `AGENTS.md`.
- Status and support: distinguish implemented capabilities from roadmap items;
  point questions to issues/discussions and keep license/conduct links visible.

## Safety and error handling

README examples must not expose credentials or suggest unsafe secret handling.
The configuration example will use placeholders, retain the existing warning
about `CREDENTIALS_MASTER_KEY`, and keep the offline `mock` path available.

If a repository claim cannot be verified, the rewrite will omit it or link to
the authoritative source instead of presenting it as fact. Existing badge
values will be retained only when their source and meaning remain clear; no
new live metrics will be invented.

## Verification

After implementation:

1. Check the Markdown diff and encoding for mojibake.
2. Validate that every README relative link and image path exists.
3. Validate heading structure, fenced code blocks, and Mermaid blocks.
4. Confirm README commands and versions against `package.json`, scripts, and
   linked setup docs.
5. Run the repository's documentation/audit gate required for contributor-doc
   changes, if available, and report any unrelated baseline failures.
6. Confirm only the intended README, skill index, skill file, and session/spec
   documentation are changed.

## Out of scope

- New product features, runtime changes, or package dependencies.
- New screenshots or generated visual assets without an existing verified
  source.
- Rewriting every document under `docs/`.
- Changing project status, coverage percentages, or release claims without
  fresh evidence.
