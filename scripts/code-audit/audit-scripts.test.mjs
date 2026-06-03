import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSilentCatchHits } from './run-audit.mjs';
import { collectKnipRows } from './aggregate.mjs';
import { extractRegressionReviewLeads } from './regression-checks.mjs';

test('extractSilentCatchHits detects comment-only catch bodies', () => {
  const text = [
    "load().catch(() => { /* non-fatal */ });",
    "cleanup().catch(() => {/* best effort */});",
  ].join('\n');

  const hits = extractSilentCatchHits(text, 'apps/kalio-web/src/App.tsx');

  assert.equal(hits.length, 2);
  assert.deepEqual(
    hits.map((hit) => hit.line),
    [1, 2],
  );
});

test('collectKnipRows includes unused files nested under issues', () => {
  const rows = collectKnipRows(
    {
      issues: [
        {
          file: 'src/features/settings/PersonasPanel.tsx',
          files: [{ name: 'src/features/settings/PersonasPanel.tsx' }],
          exports: [],
          dependencies: [],
        },
      ],
    },
    'kalio-web',
  );

  assert.deepEqual(rows, [
    {
      Severity: '🟢 MEDIUM',
      Package: 'kalio-web',
      Kind: 'unused file',
      Item: 'src/features/settings/PersonasPanel.tsx',
    },
  ]);
});

test('extractRegressionReviewLeads detects Portal-style review leads', () => {
  const text = [
    "const label = locale === 'pl' ? 'Zapisz' : 'Save';",
    '<button aria-label="Clear audit search" title="Clear" />',
    "window.confirm('Clear all audit log entries?');",
    '// TODO: remove temporary workaround',
  ].join('\n');

  const hits = extractRegressionReviewLeads(text, 'apps/kalio-web/src/features/audit/AuditLogPanel.tsx');

  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.check]),
    [
      [1, 'locale-branch'],
      [2, 'literal-aria-label'],
      [2, 'literal-title'],
      [3, 'browser-confirm'],
      [4, 'temporary-marker'],
      [4, 'todo-marker'],
      [4, 'workaround-marker'],
    ],
  );
});
