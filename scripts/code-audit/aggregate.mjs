#!/usr/bin/env node
/**
 * Aggregate raw audit outputs into a single prioritized tech-debt report.
 * Reads docs/audit/raw/* (produced by run-audit.mjs) and writes:
 *   - docs/audit/<date>-report.json
 *   - docs/audit/<date>-report.md
 *
 * Severity rules (aligned with AGENTS.md):
 *   🔴 CRITICAL — silent catch in critical path, OR > 3 circular cycles
 *   🟡 HIGH     — hard-size architecture debt, silent catch in non-critical path, OR circular dep
 *   🟢 MEDIUM   — soft-size architecture debt, any-type hotspot, duplicate clone, unused export
 *   ⚪ LOW      — any-type ≥ 1
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'audit', 'raw');
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'audit');

// File limits from AGENTS.md
const LIMITS = {
  controller: { soft: 150, hard: 250 },
  service: { soft: 300, hard: 400 },
  module: { soft: 80, hard: 120 },
  test: { soft: 400, hard: 600 },
  react: { soft: 200, hard: 350 },
};

// Critical path regex for kalio-v2 module structure
const CRITICAL_PATH = /(modules\/(chat|persona|tool|vfs|mcp|raapp|credentials|llm)\/|features\/chat\/)/i;

// Determine file type and limits
function getFileType(file) {
  if (file.includes('.controller.') || file.includes('.gateway.')) return 'controller';
  if (file.includes('.service.')) return 'service';
  if (file.includes('.module.')) return 'module';
  if (file.includes('.test.') || file.includes('.spec.')) return 'test';
  if (file.includes('kalio-web') && /\.(tsx|jsx)$/.test(file)) return 'react';
  return 'service'; // default
}

function getLimits(file) {
  const type = getFileType(file);
  return LIMITS[type] || LIMITS.service;
}

export function classifySizeFinding(file, lines) {
  const limits = getLimits(file);
  if (lines > limits.hard) {
    return {
      severity: '\u{1F7E1} HIGH',
      category: 'architecture-debt',
      conformance: 'hard-limit',
      limit: limits.hard,
    };
  }
  if (lines > limits.soft) {
    return {
      severity: '\u{1F7E2} MEDIUM',
      category: 'architecture-debt',
      conformance: 'soft-limit',
      limit: limits.soft,
    };
  }
  return {
    severity: '\u{1F7E2} MEDIUM',
    category: 'architecture-debt',
    conformance: 'within-limit',
    limit: limits.soft,
  };
}

function buildArchitectureDebtRow(row) {
  const limits = getLimits(row.file);
  const classification = classifySizeFinding(row.file, row.lines);
  const hardLimit = classification.conformance === 'hard-limit';

  return {
    Severity: classification.severity,
    Category: classification.category,
    Conformance: classification.conformance,
    File: row.file,
    Lines: row.lines,
    Limit: `${limits.soft}/${limits.hard}`,
    Type: getFileType(row.file),
    Owner: 'Architecture refactor backlog',
    Status: 'open',
    NextSlice: hardLimit
      ? 'Extract one responsibility before the next feature change'
      : 'Schedule a focused split before the next feature change',
    Fix: hardLimit
      ? 'Split responsibilities into focused modules per SRP'
      : 'Plan split before next feature add',
  };
}

async function readJson(name, fallback) {
  try {
    const text = await readFile(path.join(RAW_DIR, name), 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function mdTable(headers, rows) {
  const esc = (v) => String(v ?? '').replaceAll('|', '\\|');
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${headers.map((h) => esc(r[h])).join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

export function collectKnipRows(report, pkg) {
  const rows = [];
  const seenUnusedFiles = new Set();
  const pushUnusedFile = (item) => {
    const name = typeof item === 'string'
      ? item
      : (item && typeof item === 'object' && 'name' in item && typeof item.name === 'string' ? item.name : null);
    if (!name || seenUnusedFiles.has(name)) return;
    seenUnusedFiles.add(name);
    rows.push({ Severity: '🟢 MEDIUM', Package: pkg, Kind: 'unused file', Item: name });
  };

  const files = report?.files ?? [];
  for (const f of files) {
    pushUnusedFile(f);
  }
  const issues = report?.issues ?? [];
  for (const issue of issues) {
    for (const f of issue.files ?? []) {
      pushUnusedFile(f);
    }
    for (const ex of issue.exports ?? []) {
      rows.push({ Severity: '⚪ LOW', Package: pkg, Kind: 'unused export', Item: `${issue.file}:${ex.name}` });
    }
    for (const dep of issue.dependencies ?? []) {
      rows.push({ Severity: '🟢 MEDIUM', Package: pkg, Kind: 'unused dep', Item: dep.name ?? String(dep) });
    }
  }
  return rows;
}

export function buildNextActions({
  counts,
  architectureDebtSummary,
  criticalCircularCount,
  criticalSilentCount,
  anyCount,
}) {
  const actions = [];

  if (counts.critical > 0) {
    actions.push('Tackle the top-3 CRITICAL rows in the Prioritized refactor queue.');
    if (criticalCircularCount > 0) {
      actions.push('Break CRITICAL circular dependencies before further extraction.');
    }
    if (criticalSilentCount > 0) {
      actions.push('Fix CRITICAL silent catches on the critical path.');
    }
  } else {
    actions.push('No active CRITICAL release blockers remain; keep CRITICAL reserved for active blockers.');
  }

  if (architectureDebtSummary.hard > 0) {
    actions.push(`Schedule ${architectureDebtSummary.hard} hard-limit architecture debt items for focused refactoring.`);
  }

  const nonArchitectureHigh = Math.max(0, counts.high - architectureDebtSummary.hard);
  if (nonArchitectureHigh > 0) {
    actions.push(`Triage ${nonArchitectureHigh} HIGH findings outside the size-debt backlog.`);
  }

  if (anyCount > 0) {
    actions.push('Opportunistically reduce any usage using @kalio/types.');
  }

  return actions;
}

async function main() {
  const fileStats = await readJson('file-stats.json', { rows: [], silentCatchHits: [], anyHits: [], regressionReviewLeads: [], stringBusinessLogicHits: [] });
  const governance = await readJson('docs-governance.json', { docs: {}, findings: [] });
  
  // Merge all madge outputs
  const madgeFiles = await readdir(RAW_DIR);
  const madgeOutputs = [];
  for (const f of madgeFiles) {
    if (f.startsWith('madge-circular-') && f.endsWith('.json')) {
      const data = await readJson(f, []);
      madgeOutputs.push(...(Array.isArray(data) ? data : (data?.circular ?? [])));
    }
  }
  
  const jscpdStats = await readJson(path.join('jscpd', 'jscpd-report.json'), null);
  
  // Merge all knip outputs
  const knipReports = {};
  for (const pkg of ['apps-kalio-api', 'apps-kalio-web', 'packages-kalio-types', 'packages-kalio-sdk']) {
    knipReports[pkg] = await readJson(`knip-${pkg}.json`, {});
  }

  // --- God Objects -----------------------------------------------------------
  const sizeCandidates = fileStats.rows
    .filter((r) => {
      const limits = getLimits(r.file);
      return r.lines > limits.soft;
    })
  const architectureDebtRows = sizeCandidates.map(buildArchitectureDebtRow);
  const godRows = architectureDebtRows.slice(0, 25);
  const architectureDebtSummary = {
    total: architectureDebtRows.length,
    hard: architectureDebtRows.filter((r) => r.Conformance === 'hard-limit').length,
    soft: architectureDebtRows.filter((r) => r.Conformance === 'soft-limit').length,
  };

  // --- Silent errors ---------------------------------------------------------
  const silentRows = fileStats.silentCatchHits.map((h) => ({
    Severity: CRITICAL_PATH.test(h.file) ? '🔴 CRITICAL' : '🟡 HIGH',
    File: h.file,
    Line: h.line,
    Match: h.match,
    Fix: 'Replace with logger.error + rethrow or typed error result',
  }));

  // --- Any types -------------------------------------------------------------
  const anyRows = fileStats.anyHits.slice(0, 30).map((h) => ({
    Severity: h.count >= 5 ? '🟢 MEDIUM' : '⚪ LOW',
    File: h.file,
    Count: h.count,
    Fix: 'Replace with generics or @kalio/types',
  }));

  // --- Regression review leads ----------------------------------------------
  const regressionRows = (fileStats.regressionReviewLeads ?? []).slice(0, 60).map((h) => ({
    Severity: h.severity === 'HIGH' ? '🟡 HIGH' : h.severity === 'MEDIUM' ? '🟢 MEDIUM' : '⚪ LOW',
    File: h.file,
    Line: h.line,
    Check: h.check,
    Match: h.match,
    Fix: 'Review against AGENTS.md and UI/API centralization rules; suppress only with clear rationale',
  }));

  // --- String-driven business logic leads ------------------------------------
  const stringLogicRows = (fileStats.stringBusinessLogicHits ?? []).slice(0, 80).map((h) => ({
    Severity: h.severity === 'HIGH' ? '🟡 HIGH' : h.severity === 'MEDIUM' ? '🟢 MEDIUM' : '⚪ LOW',
    File: h.file,
    Line: h.line,
    Check: h.check,
    Match: h.match,
    Fix: 'Replace text-driven branching with error codes, enums, discriminated unions, or typed result objects',
  }));

  // --- Circular deps ---------------------------------------------------------
  const circularRows = madgeOutputs.slice(0, 20).map((cycle, i) => ({
    '#': i + 1,
    Severity: cycle.length > 3 ? '🔴 CRITICAL' : '🟡 HIGH',
    Cycle: Array.isArray(cycle) ? cycle.join(' → ') : String(cycle),
    Fix: 'Extract shared types/interfaces to break cycle',
  }));

  // --- Duplicates ------------------------------------------------------------
  const clones = jscpdStats?.duplicates ?? [];
  const dupRows = clones.slice(0, 15).map((d) => ({
    Severity: '🟢 MEDIUM',
    A: `${d.firstFile?.name}:${d.firstFile?.start}`,
    B: `${d.secondFile?.name}:${d.secondFile?.start}`,
    Lines: d.lines ?? d.tokens ?? '?',
    Fix: 'Extract shared helper',
  }));

  // --- Dead code (knip) ------------------------------------------------------
  const deadRows = [
    ...collectKnipRows(knipReports['apps-kalio-api'], 'kalio-api'),
    ...collectKnipRows(knipReports['apps-kalio-web'], 'kalio-web'),
    ...collectKnipRows(knipReports['packages-kalio-types'], '@kalio/types'),
    ...collectKnipRows(knipReports['packages-kalio-sdk'], '@kalio/sdk'),
  ].slice(0, 40);

  // --- Governance and agent docs -------------------------------------------
  const governanceRows = (governance.findings ?? []).map((item) => ({
    Severity: item.severity,
    Target: item.target,
    Check: item.check,
    Message: item.message,
    Fix: item.fix,
  }));

  // --- Summary ---------------------------------------------------------------
  const counts = {
    critical: silentRows.filter((r) => r.Severity.includes('CRITICAL')).length
            + circularRows.filter((r) => r.Severity.includes('CRITICAL')).length
            + governanceRows.filter((r) => r.Severity.includes('CRITICAL')).length,
    high: architectureDebtRows.filter((r) => r.Severity.includes('HIGH')).length
        + silentRows.filter((r) => r.Severity.includes('HIGH')).length
        + circularRows.filter((r) => r.Severity.includes('HIGH')).length
        + governanceRows.filter((r) => r.Severity.includes('HIGH')).length
        + regressionRows.filter((r) => r.Severity.includes('HIGH')).length
        + stringLogicRows.filter((r) => r.Severity.includes('HIGH')).length,
    medium: architectureDebtRows.filter((r) => r.Severity.includes('MEDIUM')).length + anyRows.filter((r) => r.Severity.includes('MEDIUM')).length + dupRows.length + deadRows.filter((r) => r.Severity.includes('MEDIUM')).length + governanceRows.filter((r) => r.Severity.includes('MEDIUM')).length + regressionRows.filter((r) => r.Severity.includes('MEDIUM')).length + stringLogicRows.filter((r) => r.Severity.includes('MEDIUM')).length,
    low: anyRows.filter((r) => r.Severity.includes('LOW')).length + deadRows.filter((r) => r.Severity.includes('LOW')).length + regressionRows.filter((r) => r.Severity.includes('LOW')).length + stringLogicRows.filter((r) => r.Severity.includes('LOW')).length,
  };

  const date = new Date().toISOString().slice(0, 10);

  // --- Prioritized refactor table (top items mapped to skills) ---------------
  const prio = [];
  for (const r of godRows) {
    if (!r.Severity.includes('CRITICAL') && !r.Severity.includes('HIGH')) continue;
    const limits = getLimits(r.File);
    prio.push({
      '#': prio.length + 1,
      Severity: r.Severity,
      Target: r.File,
      Type: r.Type,
      Metric: `${r.Lines} L`,
      Limit: `${limits.soft}/${limits.hard} L`,
      Principle: 'SRP / God Object',
      Fix: r.Fix,
    });
  }
  for (const r of circularRows.filter((x) => x.Severity.includes('CRITICAL'))) {
    prio.push({
      '#': prio.length + 1,
      Severity: r.Severity,
      Target: r.Cycle,
      Type: 'circular',
      Metric: 'circular',
      Limit: '0',
      Principle: 'Module boundaries',
      Fix: r.Fix,
    });
  }
  for (const r of silentRows.filter((x) => x.Severity.includes('CRITICAL'))) {
    prio.push({
      '#': prio.length + 1,
      Severity: r.Severity,
      Target: `${r.File}:${r.Line}`,
      Type: 'silent-catch',
      Metric: 'silent catch',
      Limit: '0',
      Principle: 'Error visibility',
      Fix: r.Fix,
    });
  }
  for (const r of governanceRows.filter((x) => x.Severity.includes('CRITICAL') || x.Severity.includes('HIGH'))) {
    prio.push({
      '#': prio.length + 1,
      Severity: r.Severity,
      Target: r.Target,
      Type: 'governance',
      Metric: r.Check,
      Limit: 'n/a',
      Principle: 'Contributor / agent guidance',
      Fix: r.Fix,
    });
  }
  for (const r of stringLogicRows.filter((x) => x.Severity.includes('HIGH'))) {
    prio.push({
      '#': prio.length + 1,
      Severity: r.Severity,
      Target: `${r.File}:${r.Line}`,
      Type: 'string-business-logic',
      Metric: r.Check,
      Limit: 'typed contract',
      Principle: 'Branch on machine-readable contracts, not message text',
      Fix: r.Fix,
    });
  }

  const nextActions = buildNextActions({
    counts,
    architectureDebtSummary,
    criticalCircularCount: circularRows.filter((r) => r.Severity.includes('CRITICAL')).length,
    criticalSilentCount: silentRows.filter((r) => r.Severity.includes('CRITICAL')).length,
    anyCount: anyRows.length,
  });

  // --- Write JSON ------------------------------------------------------------
  const jsonOut = {
    date,
    taxonomyVersion: 2,
    counts,
    architectureDebtSummary,
    architectureDebtRows,
    godRows,
    silentRows,
    anyRows,
    regressionRows,
    stringLogicRows,
    circularRows,
    dupRows,
    deadRows,
    governanceRows,
    prio,
    nextActions,
  };
  await writeFile(path.join(OUT_DIR, `${date}-report.json`), JSON.stringify(jsonOut, null, 2));

  // --- Write Markdown --------------------------------------------------------
  const md = `# KALIO v2 Code Health Report — ${date}

> Generated by \`scripts/code-audit/aggregate.mjs\` from static-analysis tool output in \`docs/audit/raw/\`.
> Audit taxonomy version: **2**. Size findings are architecture-conformance debt; active release blockers remain CRITICAL.

## File limits (from AGENTS.md)

| Type | Soft | Hard |
|---|---|---|
| Controller / Gateway | 150 | 250 |
| Service | 300 | 400 |
| Module | 80 | 120 |
| Test file | 400 | 600 |
| React Component | 200 | 350 |

## Summary

- 🔴 CRITICAL: **${counts.critical}**
- 🟡 HIGH:     **${counts.high}**
- 🟢 MEDIUM:   **${counts.medium}**
- ⚪ LOW:      **${counts.low}**
- Architecture debt: **${architectureDebtSummary.total}** (${architectureDebtSummary.hard} hard-limit, ${architectureDebtSummary.soft} soft-limit)

## Prioritized refactor queue

${prio.length ? mdTable(['#', 'Severity', 'Target', 'Type', 'Metric', 'Limit', 'Principle', 'Fix'], prio) : '_No CRITICAL/HIGH items — everything fits limits._'}

## Architecture debt (size ranking)

${godRows.length ? `Showing ${godRows.length} of ${architectureDebtRows.length} size findings; the JSON report contains the complete set with owner, status, and next slice.\n\n${mdTable(['Severity', 'Category', 'Conformance', 'File', 'Lines', 'Limit', 'Type', 'Owner', 'Status', 'NextSlice', 'Fix'], godRows)}` : '_None over soft limit._'}

## Silent errors

${silentRows.length ? mdTable(['Severity', 'File', 'Line', 'Match', 'Fix'], silentRows) : '_None detected._'}

## \`any\` types (top 30 files)

${anyRows.length ? mdTable(['Severity', 'File', 'Count', 'Fix'], anyRows) : '_No any types._'}

## Regression review leads

${regressionRows.length ? mdTable(['Severity', 'File', 'Line', 'Check', 'Match', 'Fix'], regressionRows) : '_No regression review leads detected._'}

## String-driven business logic leads

${stringLogicRows.length ? mdTable(['Severity', 'File', 'Line', 'Check', 'Match', 'Fix'], stringLogicRows) : '_No string-driven business logic leads detected._'}

## Circular dependencies (madge)

${circularRows.length ? mdTable(['#', 'Severity', 'Cycle', 'Fix'], circularRows) : '_No cycles detected._'}

## Duplicate code (jscpd)

${dupRows.length ? mdTable(['Severity', 'A', 'B', 'Lines', 'Fix'], dupRows) : '_No duplicates detected (or jscpd not run)._'}

## Dead code (knip)

${deadRows.length ? mdTable(['Severity', 'Package', 'Kind', 'Item'], deadRows) : '_No dead code detected (or knip not run)._'}

## Governance and agent docs

${governanceRows.length ? mdTable(['Severity', 'Target', 'Check', 'Message', 'Fix'], governanceRows) : '_No governance or agent-doc drift detected._'}

## Next actions (suggested order)

${nextActions.map((action, index) => `${index + 1}. ${action}`).join('\n')}
`;

  await writeFile(path.join(OUT_DIR, `${date}-report.md`), md, 'utf8');
  console.log(`✓ Report written: ${path.relative(REPO_ROOT, path.join(OUT_DIR, `${date}-report.md`))}`);
  console.log(`  JSON:           ${path.relative(REPO_ROOT, path.join(OUT_DIR, `${date}-report.json`))}`);
  console.log(`  Totals: 🔴 ${counts.critical}  🟡 ${counts.high}  🟢 ${counts.medium}  ⚪ ${counts.low}`);
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
