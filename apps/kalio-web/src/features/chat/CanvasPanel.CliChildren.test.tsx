import { describe, expect, it } from 'vitest';
import type { CLIChildProjection } from './cliChildProjection.model';
import { buildCliChildPreviews } from './CanvasPanel.CliChildren';

describe('buildCliChildPreviews', () => {
  const projections: Record<string, CLIChildProjection> = {
    'cli-child-b': {
      childSessionId: 'cli-child-b',
      parentSessionId: 'session-1',
      parentCallId: 'call-b',
      agentId: 'codex',
      status: 'running',
      lastOutput: 'output-b',
      toolName: 'spawn_cli_agent',
    },
    'cli-child-a': {
      childSessionId: 'cli-child-a',
      parentSessionId: 'session-1',
      parentCallId: 'call-a',
      agentId: 'copilot',
      status: 'stopped',
      lastOutput: 'output-a',
      toolName: 'run_cli_agent',
    },
    'cli-child-other': {
      childSessionId: 'cli-child-other',
      parentSessionId: 'session-2',
      parentCallId: 'call-other',
      agentId: 'codex',
      status: 'completed',
      lastOutput: 'other',
      toolName: 'spawn_cli_agent',
    },
  };

  it('returns empty list when parent session is missing', () => {
    expect(buildCliChildPreviews(null, projections, new Map())).toEqual([]);
  });

  it('filters projections by parent session and sorts by child session id', () => {
    const titles = new Map([
      ['cli-child-a', 'copilot CLI'],
      ['cli-child-b', 'codex CLI'],
    ]);

    const previews = buildCliChildPreviews('session-1', projections, titles);

    expect(previews.map((preview) => preview.childSessionId)).toEqual(['cli-child-a', 'cli-child-b']);
    expect(previews[0]?.childTitle).toBe('copilot CLI');
    expect(previews[1]?.childTitle).toBe('codex CLI');
  });

  it('ignores projections that do not map to a real child session row', () => {
    const previews = buildCliChildPreviews('session-1', projections, new Map());

    expect(previews).toEqual([]);
  });
});
