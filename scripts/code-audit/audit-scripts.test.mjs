import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpawnCommand, extractSilentCatchHits } from './run-audit.mjs';
import { collectKnipRows } from './aggregate.mjs';
import { extractRegressionReviewLeads } from './regression-checks.mjs';
import { extractStringBusinessLogicHits } from './string-business-logic-checks.mjs';

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

test('buildSpawnCommand avoids shell true with args on Windows', () => {
  const spawnCommand = buildSpawnCommand(
    'npx.cmd',
    ['--yes', 'madge', '--extensions', 'ts,tsx', '--json', 'apps/kalio-api/src'],
    'win32',
  );

  assert.equal(spawnCommand.command.endsWith('cmd.exe'), true);
  assert.deepEqual(spawnCommand.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(spawnCommand.args[3], /--extensions ts,tsx --json/);
  assert.equal(spawnCommand.shell, false);
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

test('extractStringBusinessLogicHits detects message-text branching', () => {
  const text = [
    "const stopped = error.message === CLI_AGENT_STOPPED_ERROR;",
    "if (error.message.toLowerCase().includes('timed out')) return 'timeout';",
    "if (message.includes('final-artifact')) return 'done';",
    "return logger.error(error.message);",
  ].join('\n');

  const hits = extractStringBusinessLogicHits(text, 'apps/kalio-api/src/modules/subagent-runtime.service.ts');

  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.check, hit.severity]),
    [
      [1, 'error-message-branch', 'HIGH'],
      [2, 'normalized-error-message-branch', 'HIGH'],
      [3, 'message-text-branch', 'HIGH'],
    ],
  );
});

test('extractStringBusinessLogicHits detects free-form text parsing branches', () => {
  const text = [
    "if (prompt.toLowerCase().includes('architecture review')) return true;",
    "const shouldFinalize = content.startsWith('FINAL:');",
    "const sameRun = sessionId.includes('-finalizer');",
    "if ('done'.equals(statusMessage)) return true;",
  ].join('\n');

  const hits = extractStringBusinessLogicHits(text, 'apps/kalio-web/src/store/runtime-panel.ts');

  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.check, hit.severity]),
    [
      [1, 'normalized-free-form-text-branch', 'MEDIUM'],
      [2, 'free-form-text-branch', 'MEDIUM'],
      [3, 'identifier-fragment-branch', 'MEDIUM'],
      [4, 'string-equals-branch', 'MEDIUM'],
    ],
  );
});

test('extractStringBusinessLogicHits treats runtime ID-derived control-flow as high severity', () => {
  const text = "if (toolCallId.startsWith('architecture:')) return 'running';";

  const hits = extractStringBusinessLogicHits(
    text,
    'apps/kalio-web/src/features/chat/graph/executionGraphHydration.ts',
  );

  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.check, hit.severity]),
    [[1, 'identifier-fragment-branch', 'HIGH']],
  );
});

test('extractStringBusinessLogicHits ignores typed-contract style status comparisons', () => {
  const text = [
    "if (status === 'pending') return false;",
    "const shouldShow = panel !== 'chat';",
    "if (message.role === 'assistant') return false;",
    "const errorMessage = typeof d['errorMessage'] === 'string' ? d['errorMessage'] : undefined;",
    "return { errorMessage: typeof d['toolResultErrorMessage'] === 'string' ? d['toolResultErrorMessage'] : undefined };",
    "if (isWorkflowError(error, 'TIMEOUT')) return 'retry';",
    "if (failure.code === 'RATE_LIMITED') return 'retry';",
    "if (reasonCode === 'max_steps') return 'waiting';",
    "if (runtimeDecision?.reasonCode === 'final_artifact_accepted') return true;",
  ].join('\n');

  const hits = extractStringBusinessLogicHits(text, 'apps/kalio-web/src/store/runtime-panel.ts');

  assert.equal(hits.length, 0);
});

test('extractStringBusinessLogicHits ignores test files', () => {
  const text = "expect(prompt.toLowerCase().includes('architecture')).toBe(true);";

  const hits = extractStringBusinessLogicHits(text, 'apps/kalio-web/src/store/runtime-panel.test.ts');

  assert.equal(hits.length, 0);
});
