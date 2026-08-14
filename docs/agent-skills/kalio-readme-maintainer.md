# Kalio README Maintainer Skill

## When to use

Use this skill when creating, reviewing, or updating the root README or links
that control README-facing onboarding.

This is a documentation skill. It does not change application behavior, add
runtime automation, or create a second registry of project facts.

## Source of truth

Check facts in this order before editing:

1. package.json and the root scripts for commands, versions, and stack profiles.
2. docs/quickstart-user.md for the Windows install and end-user data flow.
3. docs/local-dev-guide.md and scripts/README.md for ports, QA modes, and test
   entry points.
4. AGENTS.md, CONTRIBUTING.md, and the linked architecture docs for boundaries,
   workflow rules, and current architecture claims.
5. Existing source and tests only when the documentation sources above do not
   answer the question.

If two sources disagree, report the conflict and use the more specific,
current repository source after checking the implementation. Never resolve a
conflict by inventing a third version.

## Audience and information funnel

Write for the reader's next decision:

1. What is Kalio and why is it useful?
2. Can I see the product model quickly?
3. Can I run it safely?
4. Can I understand the core capabilities and boundaries?
5. Where do I find deeper architecture, contributor, or troubleshooting docs?

Keep the first screen short. Use a one-line value proposition, a small set of
meaningful badges, links to the main paths, and one runnable quick start.
Use headings, short paragraphs, lists, tables, and diagrams for scanning. Put
long API or architecture explanations in linked documents.

## Writing rules

- Start with audience, value, and a runnable path.
- Describe behavior in plain language before using project-specific jargon.
- Keep commands copy-pasteable and label the operating system when relevant.
- Use repository-relative links for repository files and descriptive alt text.
- Keep Mermaid and image diagrams supplementary; critical instructions must also
  be available as text.
- Treat badges as signals, not decoration. Keep only badges with a clear source
  and meaning for the reader.
- Never invent capabilities, metrics, screenshots, URLs, commands, release
  status, support promises, or production readiness.
- Keep secrets as placeholders. Preserve the offline mock-provider path.
- Preserve warnings about credentials, local data, destructive tools, and
  environment-specific behavior.
- Check for mojibake after every edit. The repository files are UTF-8.
- Remove stale or duplicate README prose instead of adding another layer.

## Kalio-specific boundaries

- Explain the backend as the durable runtime source of truth and the frontend
  as a rebuildable projection.
- Keep the Architecture Graph and Execution Graph distinct when describing
  workflow design versus observed execution.
- Do not describe a static badge or local audit result as live release proof.
- Keep development, fixed QA, managed random-port QA, and local production
  profiles separate.
- Do not expose API keys, local secrets, or user workspace contents in examples.
- Link to the existing user, contributor, architecture, and agent-skill docs
  instead of duplicating their full content.
- If a claim is unverified, omit it or link to the authoritative source and
  call out the remaining uncertainty.

## Verification gate

Before handing off a README change:

1. Read the final diff and run git diff --check.
2. Confirm every relative Markdown link and image path exists.
3. Check heading order, code-fence pairing, Mermaid blocks, and table headers.
4. Compare commands, ports, versions, provider names, and paths with the source
   files listed above.
5. Search the edited Markdown for mojibake patterns.
6. Run the repository documentation or audit gate required by the changed scope.
7. Report pre-existing failures separately from failures caused by the edit.
8. Report whether the installed skill copy was synchronized. Do not claim it was
   installed unless the matching SKILL.md was actually updated.

## Out of scope

Do not use this skill to:

- change runtime code, package scripts, contracts, or application behavior;
- add a new provider, feature, screenshot, metric, or release claim;
- rewrite every document in docs/;
- change project status to make the README look more complete;
- hide a failing verification command or unrelated working-tree change.
