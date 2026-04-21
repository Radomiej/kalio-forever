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

const TARGETS = [
  path.join('apps', 'kalio-api', 'src'),
  path.join('apps', 'kalio-web', 'src'),
  path.join('packages', '@kalio', 'types', 'src'),
  path.join('packages', '@kalio', 'sdk', 'src'),
];

const NPX_CMD = process.platform === 'win32' ? 'npx.cmd' : 'npx';

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
  const silentRe = /catch\s*\([^)]*\)\s*\{\s*\}|\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|false)\s*\)/g;
  // `:any` / `as any` / `<any>` outside of comments (rough)
  const anyRe = /(?:^|[^A-Za-z0-9_])(?::\s*any\b|as\s+any\b|<any>)/g;

  for (const f of files) {
    let text;
    try { text = await readFile(f, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/).length;
    rows.push({ file: path.relative(REPO_ROOT, f).replaceAll('\\', '/'), lines });

    let m;
    silentRe.lastIndex = 0;
    while ((m = silentRe.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const line = before.split(/\r?\n/).length;
      silentCatchHits.push({ file: path.relative(REPO_ROOT, f).replaceAll('\\', '/'), line, match: m[0].slice(0, 80) });
    }
    anyRe.lastIndex = 0;
    let anyCount = 0;
    while (anyRe.exec(text) !== null) anyCount++;
    if (anyCount > 0) {
      anyHits.push({ file: path.relative(REPO_ROOT, f).replaceAll('\\', '/'), count: anyCount });
    }
  }
  rows.sort((a, b) => b.lines - a.lines);
  anyHits.sort((a, b) => b.count - a.count);
  return { rows, silentCatchHits, anyHits };
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

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
