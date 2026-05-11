import test from 'node:test';
import assert from 'node:assert/strict';

import { extractSilentCatchHits } from './run-audit.mjs';
import { collectKnipRows } from './aggregate.mjs';

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