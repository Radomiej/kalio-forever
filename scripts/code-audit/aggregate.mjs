#!/usr/bin/env node
/**
 * Aggregate raw audit outputs into a single prioritized tech-debt report.
 * Reads docs/audit/raw/* (produced by run-audit.mjs) and writes:
 *   - docs/audit/<date>-report.json
 *   - docs/audit/<date>-report.md
 *
 * Severity rules (aligned with AGENTS.md):
 *   🔴 CRITICAL — file > hard limit (Controller 250, Service 400, Module 120, React 350), OR silent catch in critical path, OR > 3 circular cycles
 *   🟡 HIGH     — file > soft limit (Controller 150, Service 300, Module 80, React 200), OR silent catch in non-critical path, OR circular dep
 *   🟢 MEDIUM   — any-type hotspot (≥ 5 per file), duplicate clone, unused export
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

function sev(file, lines) {
  const limits = getLimits(file);
  if (lines > limits.hard) return '🔴 CRITICAL';
  if (lines > limits.soft) return '🟡 HIGH';
  return '🟢 MEDIUM';
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

async function main() {
  const fileStats = await readJson('file-stats.json', { rows: [], silentCatchHits: [], anyHits: [] });
  
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
  const godRows = fileStats.rows
    .filter((r) => {
      const limits = getLimits(r.file);
      return r.lines > limits.soft;
    })
    .slice(0, 25)
    .map((r) => {
      const limits = getLimits(r.file);
      return {
        Severity: sev(r.file, r.lines),
        File: r.file,
        Lines: r.lines,
        Limit: `${limits.soft}/${limits.hard}`,
        Type: getFileType(r.file),
        Fix: r.lines > limits.hard
          ? 'Split — extract domain/hook modules per SRP'
          : 'Plan split before next feature add',
      };
    });

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
  function knipRows(report, pkg) {
    const rows = [];
    const files = report?.files ?? [];
    for (const f of files) {
      rows.push({ Severity: '🟢 MEDIUM', Package: pkg, Kind: 'unused file', Item: f });
    }
    const issues = report?.issues ?? [];
    for (const issue of issues) {
      for (const ex of issue.exports ?? []) {
        rows.push({ Severity: '⚪ LOW', Package: pkg, Kind: 'unused export', Item: `${issue.file}:${ex.name}` });
      }
      for (const dep of issue.dependencies ?? []) {
        rows.push({ Severity: '🟢 MEDIUM', Package: pkg, Kind: 'unused dep', Item: dep.name ?? String(dep) });
      }
    }
    return rows;
  }
  const deadRows = [
    ...knipRows(knipReports['apps-kalio-api'], 'kalio-api'),
    ...knipRows(knipReports['apps-kalio-web'], 'kalio-web'),
    ...knipRows(knipReports['packages-kalio-types'], '@kalio/types'),
    ...knipRows(knipReports['packages-kalio-sdk'], '@kalio/sdk'),
  ].slice(0, 40);

  // --- Summary ---------------------------------------------------------------
  const counts = {
    critical: godRows.filter((r) => r.Severity.includes('CRITICAL')).length
            + silentRows.filter((r) => r.Severity.includes('CRITICAL')).length
            + circularRows.filter((r) => r.Severity.includes('CRITICAL')).length,
    high: godRows.filter((r) => r.Severity.includes('HIGH')).length
        + silentRows.filter((r) => r.Severity.includes('HIGH')).length
        + circularRows.filter((r) => r.Severity.includes('HIGH')).length,
    medium: anyRows.filter((r) => r.Severity.includes('MEDIUM')).length + dupRows.length + deadRows.filter((r) => r.Severity.includes('MEDIUM')).length,
    low: anyRows.filter((r) => r.Severity.includes('LOW')).length + deadRows.filter((r) => r.Severity.includes('LOW')).length,
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

  // --- Write JSON ------------------------------------------------------------
  const jsonOut = { date, counts, godRows, silentRows, anyRows, circularRows, dupRows, deadRows, prio };
  await writeFile(path.join(OUT_DIR, `${date}-report.json`), JSON.stringify(jsonOut, null, 2));

  // --- Write Markdown --------------------------------------------------------
  const md = `# KALIO v2 Code Health Report — ${date}

> Generated by \`scripts/code-audit/aggregate.mjs\` from static-analysis tool output in \`docs/audit/raw/\`.
> Severity follows AGENTS.md architecture rules.

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

## Prioritized refactor queue

${prio.length ? mdTable(['#', 'Severity', 'Target', 'Type', 'Metric', 'Limit', 'Principle', 'Fix'], prio) : '_No CRITICAL/HIGH items — everything fits limits._'}

## God Objects (size ranking)

${godRows.length ? mdTable(['Severity', 'File', 'Lines', 'Limit', 'Type', 'Fix'], godRows) : '_None over soft limit._'}

## Silent errors

${silentRows.length ? mdTable(['Severity', 'File', 'Line', 'Match', 'Fix'], silentRows) : '_None detected._'}

## \`any\` types (top 30 files)

${anyRows.length ? mdTable(['Severity', 'File', 'Count', 'Fix'], anyRows) : '_No any types._'}

## Circular dependencies (madge)

${circularRows.length ? mdTable(['#', 'Severity', 'Cycle', 'Fix'], circularRows) : '_No cycles detected._'}

## Duplicate code (jscpd)

${dupRows.length ? mdTable(['Severity', 'A', 'B', 'Lines', 'Fix'], dupRows) : '_No duplicates detected (or jscpd not run)._'}

## Dead code (knip)

${deadRows.length ? mdTable(['Severity', 'Package', 'Kind', 'Item'], deadRows) : '_No dead code detected (or knip not run)._'}

## Next actions (suggested order)

1. Tackle top-3 CRITICAL rows in the **Prioritized refactor queue**.
2. Break CRITICAL circular deps before further extraction (prevents re-introducing cycles).
3. Fix CRITICAL silent catches on critical path — highest incident risk.
4. Schedule HIGH-severity God Objects for next-touch refactor.
5. Opportunistically reduce \`any\` usage using \`@kalio/types\`.
`;

  await writeFile(path.join(OUT_DIR, `${date}-report.md`), md, 'utf8');
  console.log(`✓ Report written: ${path.relative(REPO_ROOT, path.join(OUT_DIR, `${date}-report.md`))}`);
  console.log(`  JSON:           ${path.relative(REPO_ROOT, path.join(OUT_DIR, `${date}-report.json`))}`);
  console.log(`  Totals: 🔴 ${counts.critical}  🟡 ${counts.high}  🟢 ${counts.medium}  ⚪ ${counts.low}`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
