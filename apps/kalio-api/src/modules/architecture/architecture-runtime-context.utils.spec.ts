import { describe, expect, it } from 'vitest';
import {
  buildArchitectureCliAgentContext,
  buildArchitectureVfsEvidenceContext,
} from './architecture-runtime-context.utils';
import type { ArchitectureVfsHydrationResult } from './architecture-vfs-hydration';

describe('architecture runtime context utils', () => {
  it('builds CLI agent context from enabled configs without overwriting existing explicit context', () => {
    expect(buildArchitectureCliAgentContext(
      { availableCliAgents: ['manual'] },
      [{ agentId: 'codex', enabled: true, model: ' gpt-5 ', architecturePreference: ' implementation ' }],
    )).toEqual({ availableCliAgents: ['manual'] });

    expect(buildArchitectureCliAgentContext(
      { projectPath: 'C:/repo' },
      [
        { agentId: 'codex', enabled: true, model: ' gpt-5 ', architecturePreference: ' implementation ' },
        { agentId: 'gemini', enabled: false, model: 'ignored', architecturePreference: 'ignored' },
        { agentId: 'claude', enabled: true, model: '', architecturePreference: ' review ' },
      ],
    )).toEqual({
      projectPath: 'C:/repo',
      availableCliAgents: ['codex', 'claude'],
      architectureCliAgentsEnabled: true,
      cliAgentToolPreferences: {
        codex: { model: 'gpt-5', preference: 'implementation' },
        claude: { preference: 'review' },
      },
    });
  });

  it('builds bounded VFS evidence excerpts from copied files', () => {
    const hydration: ArchitectureVfsHydrationResult = {
      fromSessionId: 'source-session',
      targetPrefix: '',
      requestedPaths: [],
      copiedFiles: [
        { fromPath: 'a.md', toPath: 'a.md', sizeBytes: 4 },
        { fromPath: 'b.md', toPath: 'b.md', sizeBytes: 2000 },
      ],
      skippedPaths: [],
    };
    const files = new Map([
      ['a.md', Buffer.from('abcd')],
      ['b.md', Buffer.from('x'.repeat(2000))],
    ]);

    expect(buildArchitectureVfsEvidenceContext(
      { projectPath: 'C:/repo' },
      {
        rootSessionId: 'root-session',
        hydration,
        readFile: (path) => files.get(path) ?? Buffer.alloc(0),
        maxExcerptBytes: 5,
        maxTotalBytes: 8,
      },
    )).toEqual({
      projectPath: 'C:/repo',
      architectureVfsEvidence: {
        rootSessionId: 'root-session',
        sourceSessionId: 'source-session',
        totalCopiedFiles: 2,
        files: [
          { path: 'a.md', sizeBytes: 4, excerpt: 'abcd', truncated: false },
          { path: 'b.md', sizeBytes: 2000, excerpt: 'xxxx', truncated: true },
        ],
      },
    });
  });
});
