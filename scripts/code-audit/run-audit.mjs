#!/usr/bin/env node
/**
 * KALIO v2 code audit runner.
 * Executes a set of JS/TS static-analysis tools via npx and captures raw JSON/text
 * output under docs/audit/raw/ for later aggregation.
 *
 * Tools:
 *  - built-in scanner → per-file complexity + silent catches + any-type detection
 *  - madge            → circular dependency detection
 *  - jscpd            → copy/paste / duplicate detector
 *  - knip             → unused files / exports / deps
 *
 * Silent-error and `any`-type sweeps are done inline via ripgrep-like regex scan
 * over the TS source since they are linter-trivial patterns.
 *
 * Runs cross-platform (Windows / *nix). No shell-specific syntax.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = path.join(REPO_ROOT, 'docs', 'audit', 'raw');
// Governance thresholds are intentionally stricter than the general file-size
// rules because these files act as root-level coordination docs. Once they get
// too large, agents and humans both drift from them more easily.
const AGENTS_DOC_HIGH_LINE_LIMIT = 300;
const AGENTS_DOC_MEDIUM_LINE_LIMIT = 220;
const ROOT_COPILOT_SHIM_MAX_LINES = 40;

const TARGETS = [
  path.join('apps', 'kalio-api', 'src'),
  path.join('apps', 'kalio-web', 'src'),
  path.join('packages', '@kalio', 'types', 'src'),
  path.join('packages', '@kalio', 'sdk', 'src'),
];

const GOVERNANCE_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'AGENTS.md',
  '.github/copilot-instructions.md',
  '.copilot-instructions.md',
];

const NPX_CMD = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const EMPTY_BLOCK_CONTENT = String.raw`(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*`;
const SILENT_CATCH_PATTERN =
  String.raw`catch(?:\s*\([^)]*\))?\s*\{\s*${EMPTY_BLOCK_CONTENT}\}` +
  String.raw`|\.catch\s*\(\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:\{\s*${EMPTY_BLOCK_CONTENT}\}|null|undefined|false)\s*\)`;
const ANY_TYPE_RE = /(?:^|[^A-Za-z0-9_])(?::\s*any\b|as\s+any\b|<any>)/g;

/**
 * Run a command, capture stdout+stderr, never throw.
 * Returns { code, stdout, stderr }.
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      // Windows requires shell=true when invoking .cmd shims (npx.cmd);
      // otherwise Node throws EINVAL on spawn.
      shell: process.platform === 'win32',
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function writeRaw(name, content) {
  const file = path.join(RAW_DIR, name);
  await writeFile(file, content, 'utf8');
  console.log(`  → ${path.relative(REPO_ROOT, file)} (${content.length} B)`);
}

function lineCount(text) {
  return text.split(/\r?\n/).length;
}

export function extractSilentCatchHits(text, relativeFile = '') {
  const hits = [];
  const silentCatchRe = new RegExp(SILENT_CATCH_PATTERN, 'g');
  let m;
  while ((m = silentCatchRe.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const line = before.split(/\r?\n/).length;
    hits.push({ file: relativeFile, line, match: m[0].slice(0, 80) });
  }
  return hits;
}

export function countAnyHits(text) {
  ANY_TYPE_RE.lastIndex = 0;
  let anyCount = 0;
  while (ANY_TYPE_RE.exec(text) !== null) anyCount++;
  return anyCount;
}

/** Recursively walk a directory, returning *.ts / *.tsx files (skip tests, node_modules, dist). */
async function walkTsFiles(root) {
  const out = [];
  const skipDirs = new Set(['node_modules', 'dist', 'build', '.next', 'coverage', 'e2e']);
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        if (!/\.(ts|tsx)$/.test(e.name)) continue;
        if (/\.test\.|\.spec\./.test(e.name)) continue;
        if (full.includes(`${path.sep}tests${path.sep}`)) continue;
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** Compute line count + simple pattern counts per file. */
async function fileStats(files) {
  const rows = [];
  let silentCatchHits = [];
  let anyHits = [];

  for (const f of files) {
    let text;
    try { text = await readFile(f, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/).length;
    rows.push({ file: path.relative(REPO_ROOT, f).replaceAll('\\', '/'), lines });

    const relativeFile = path.relative(REPO_ROOT, f).replaceAll('\\', '/');
    silentCatchHits.push(...extractSilentCatchHits(text, relativeFile));
    const anyCount = countAnyHits(text);
    if (anyCount > 0) {
      anyHits.push({ file: relativeFile, count: anyCount });
    }
  }
  rows.sort((a, b) => b.lines - a.lines);
  anyHits.sort((a, b) => b.count - a.count);
  return { rows, silentCatchHits, anyHits };
}

async function governanceDocStats() {
  const docs = {};
  const findings = [];

  for (const relPath of GOVERNANCE_DOCS) {
    const absPath = path.join(REPO_ROOT, relPath);
    try {
      const text = await readFile(absPath, 'utf8');
      docs[relPath] = {
        exists: true,
        lines: lineCount(text),
        text,
      };
    } catch {
      docs[relPath] = {
        exists: false,
        lines: 0,
        text: '',
      };
      findings.push({
        severity: '🟡 HIGH',
        target: relPath,
        check: 'missing-required-doc',
        message: `Required governance or agent-instruction file is missing: ${relPath}`,
        fix: 'Restore the file or remove the dependency on it from project guidance',
      });
    }
  }

  const readme = docs['README.md']?.text ?? '';
  const contributing = docs['CONTRIBUTING.md']?.text ?? '';
  const codeOfConduct = docs['CODE_OF_CONDUCT.md']?.text ?? '';
  const agents = docs['AGENTS.md']?.text ?? '';
  const repoCopilot = docs['.github/copilot-instructions.md']?.text ?? '';
  const rootCopilot = docs['.copilot-instructions.md']?.text ?? '';

  if (readme) {
    for (const linkedDoc of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'AGENTS.md']) {
      if (!readme.includes(linkedDoc)) {
        findings.push({
          severity: '🟢 MEDIUM',
          target: 'README.md',
          check: 'missing-governance-link',
          message: `README.md does not link ${linkedDoc}`,
          fix: 'Link core contributor and governance docs from the README',
        });
      }
    }
  }

  if (contributing) {
    const contributingChecks = [
      {
        ok: /AGENTS\.md/.test(contributing),
        check: 'missing-agents-link',
        message: 'CONTRIBUTING.md should point contributors to AGENTS.md',
        fix: 'Link AGENTS.md from CONTRIBUTING.md',
      },
      {
        ok: /CODE_OF_CONDUCT\.md/.test(contributing),
        check: 'missing-code-of-conduct-link',
        message: 'CONTRIBUTING.md should point contributors to CODE_OF_CONDUCT.md',
        fix: 'Link CODE_OF_CONDUCT.md from CONTRIBUTING.md',
      },
      {
        ok: /pnpm\s+audit(?::report)?/.test(contributing),
        check: 'missing-audit-command',
        message: 'CONTRIBUTING.md does not mention the audit command',
        fix: 'Document pnpm audit / pnpm audit:report in CONTRIBUTING.md',
      },
    ];

    for (const item of contributingChecks) {
      if (!item.ok) {
        findings.push({
          severity: '🟢 MEDIUM',
          target: 'CONTRIBUTING.md',
          check: item.check,
          message: item.message,
          fix: item.fix,
        });
      }
    }
  }

  if (codeOfConduct) {
    const cocChecks = [
      {
        ok: /##\s+Enforcement Responsibilities/i.test(codeOfConduct),
        check: 'missing-enforcement-responsibilities',
        message: 'CODE_OF_CONDUCT.md is missing an enforcement responsibilities section',
      },
      {
        ok: /##\s+Scope/i.test(codeOfConduct),
        check: 'missing-scope-section',
        message: 'CODE_OF_CONDUCT.md is missing a scope section',
      },
      {
        ok: /privacy and security of the reporter/i.test(codeOfConduct),
        check: 'missing-reporter-privacy-language',
        message: 'CODE_OF_CONDUCT.md does not state reporter privacy expectations',
      },
    ];

    for (const item of cocChecks) {
      if (!item.ok) {
        findings.push({
          severity: '🟡 HIGH',
          target: 'CODE_OF_CONDUCT.md',
          check: item.check,
          message: item.message,
          fix: 'Adopt the missing Contributor Covenant 2.1 section',
        });
      }
    }
  }

  if (agents) {
    const agentLines = docs['AGENTS.md'].lines;
    if (agentLines > AGENTS_DOC_HIGH_LINE_LIMIT) {
      findings.push({
        severity: '🟡 HIGH',
        target: 'AGENTS.md',
        check: 'oversized-agent-doc',
        message: `AGENTS.md is ${agentLines} lines; large root instruction files are harder to keep current`,
        fix: 'Prune the root file or move details into nested docs/skills where appropriate',
      });
    } else if (agentLines > AGENTS_DOC_MEDIUM_LINE_LIMIT) {
      findings.push({
        severity: '🟢 MEDIUM',
        target: 'AGENTS.md',
        check: 'long-agent-doc',
        message: `AGENTS.md is ${agentLines} lines; review for stale or duplicated instructions`,
        fix: 'Trim generic boilerplate and keep root instructions focused on repo-specific rules',
      });
    }
  }

  if (repoCopilot && rootCopilot) {
    const rootCopilotLines = docs['.copilot-instructions.md'].lines;
    if (rootCopilotLines > ROOT_COPILOT_SHIM_MAX_LINES) {
      findings.push({
        severity: '🟡 HIGH',
        target: '.copilot-instructions.md',
        check: 'duplicate-copilot-instructions',
        message: `Root .copilot-instructions.md is ${rootCopilotLines} lines while .github/copilot-instructions.md also exists`,
        fix: 'Keep the root file as a short compatibility shim that points to the canonical .github copy',
      });
    }

    if (!/\.github\/copilot-instructions\.md/.test(rootCopilot)) {
      findings.push({
        severity: '🟡 HIGH',
        target: '.copilot-instructions.md',
        check: 'missing-canonical-pointer',
        message: 'Root .copilot-instructions.md does not point to .github/copilot-instructions.md',
        fix: 'Point the root file at the canonical .github/copilot-instructions.md to avoid drift',
      });
    }
  }

  if (repoCopilot && !/AGENTS\.md/.test(repoCopilot)) {
    findings.push({
      severity: '🟢 MEDIUM',
      target: '.github/copilot-instructions.md',
      check: 'missing-agents-reference',
      message: '.github/copilot-instructions.md should explicitly point agents to AGENTS.md',
      fix: 'Add a short pointer to AGENTS.md near the top of the file',
    });
  }

  return {
    docs: Object.fromEntries(
      Object.entries(docs).map(([relPath, meta]) => [relPath, { exists: meta.exists, lines: meta.lines }]),
    ),
    findings,
  };
}

async function step(title, fn) {
  console.log(`\n▶ ${title}`);
  const t0 = Date.now();
  try {
    await fn();
    console.log(`  ✓ done in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`  ✗ ${title} failed:`, err?.message ?? err);
  }
}

async function main() {
  console.log('KALIO v2 Code Audit');
  console.log(`Repo: ${REPO_ROOT}`);
  await ensureDir(RAW_DIR);

  // 1. File sizes + silent errors + any-types (built-in, no external deps)
  await step('Scanning TS/TSX files (size / silent-catch / any)', async () => {
    const allFiles = [];
    for (const t of TARGETS) {
      const targetPath = path.join(REPO_ROOT, t);
      try {
        allFiles.push(...await walkTsFiles(targetPath));
      } catch (err) {
        console.log(`  ⚠ Skipping ${t}: ${err.message}`);
      }
    }
    const s = await fileStats(allFiles);
    await writeRaw('file-stats.json', JSON.stringify(s, null, 2));
  });

  await step('Scanning governance and agent docs', async () => {
    const governanceStats = await governanceDocStats();
    await writeRaw('docs-governance.json', JSON.stringify(governanceStats, null, 2));
  });

  // 2. madge — circular deps
  await step('madge (circular dependencies)', async () => {
    // Run for each package separately to respect their tsconfig
    for (const pkg of ['apps/kalio-api', 'apps/kalio-web', 'packages/@kalio/types', 'packages/@kalio/sdk']) {
      const tsconfig = path.join(pkg, 'tsconfig.json');
      const srcPath = path.join(pkg, 'src');
      const args = ['--yes', 'madge', '--circular', '--extensions', 'ts,tsx', '--ts-config', tsconfig, '--json', srcPath];
      const r = await run(NPX_CMD, args);
      const outFile = `madge-circular-${pkg.replace(/[\/\\]/g, '-')}.json`;
      await writeRaw(outFile, r.stdout || '[]');
    }
  });

  // 3. jscpd — duplicates
  await step('jscpd (duplicate code)', async () => {
    const outDir = path.join(RAW_DIR, 'jscpd');
    await ensureDir(outDir);
    const args = [
      '--yes', 'jscpd',
      ...TARGETS,
      '--reporters', 'json',
      '--output', outDir,
      '--ignore', '**/*.test.*,**/*.spec.*,**/tests/**,**/e2e/**',
      '--min-tokens', '60',
      '--silent',
    ];
    const r = await run(NPX_CMD, args);
    if (r.stderr) await writeRaw('jscpd.stderr.log', r.stderr);
  });

  // 4. knip — dead code
  await step('knip (unused files/exports/deps)', async () => {
    // Run from each package so knip picks up local tsconfig/package.json.
    for (const pkg of ['apps/kalio-api', 'apps/kalio-web', 'packages/@kalio/types', 'packages/@kalio/sdk']) {
      const pkgPath = path.join(REPO_ROOT, pkg);
      const r = await run(NPX_CMD, ['--yes', 'knip', '--reporter', 'json', '--no-exit-code'], {
        cwd: pkgPath,
      });
      const outFile = `knip-${pkg.replace(/[\/\\]/g, '-')}.json`;
      await writeRaw(outFile, r.stdout || '{}');
      if (r.stderr) await writeRaw(`${outFile}.stderr.log`, r.stderr);
    }
  });

  console.log('\n✓ Audit raw output written to', path.relative(REPO_ROOT, RAW_DIR));
  console.log('Next: node scripts/code-audit/aggregate.mjs');
}

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
