import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import { RaAppCreateDraftTool, RaAppExecuteDslTool, RaAppPublishDraftTool } from './raapp-draft.tools';

function makeRequest(): ToolCallRequest {
  return {
    callId: 'call-1',
    sessionId: 'sess-1',
    toolName: 'raapp_execute_dsl',
    args: { draft_id: 'draft-1', inputs: {} },
  };
}

const reflector = new Reflector();

describe('RA-App draft tool metadata', () => {
  it('raapp_create_draft requires confirmation because it persists draft files in VFS', () => {
    const metadata = reflector.get(TOOL_METADATA, RaAppCreateDraftTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });

  it('raapp_publish_draft requires confirmation because it persists a release', () => {
    const metadata = reflector.get(TOOL_METADATA, RaAppPublishDraftTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });
});

describe('RaAppExecuteDslTool', () => {
  let raapp: { execute: ReturnType<typeof vi.fn> };
  let effectsProcessor: { processSystemsYaml: ReturnType<typeof vi.fn> };
  let hitl: { savePendingApprovals: ReturnType<typeof vi.fn>; resolvePendingApprovals: ReturnType<typeof vi.fn> };
  let vfs: { readFile: ReturnType<typeof vi.fn> };
  let tool: RaAppExecuteDslTool;

  beforeEach(() => {
    raapp = {
      execute: vi.fn().mockResolvedValue({ status: 'ready', renderedContent: '{"ok":true}' }),
    };
    effectsProcessor = {
      processSystemsYaml: vi.fn().mockResolvedValue({ output: {}, pendingApprovals: [], entities: [] }),
    };
    hitl = {
      savePendingApprovals: vi.fn().mockResolvedValue(undefined),
      resolvePendingApprovals: vi.fn().mockResolvedValue({ pendingApprovals: [], nativeResults: [] }),
    };
    vfs = {
      readFile: vi.fn((sessionId: string, filePath: string) => {
        if (filePath.endsWith('ui.gui')) return { sessionId, filePath, content: 'window { label { text = "Hello" } }' };
        const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
        err.code = 'VFS_FILE_NOT_FOUND';
        throw err;
      }),
    };
    tool = new RaAppExecuteDslTool(
      raapp as never,
      effectsProcessor as never,
      hitl as never,
      vfs as never,
    );
  });

  it('does not warn for missing optional draft files', async () => {
    const warnSpy = vi.spyOn(tool['logger'], 'warn');

    const result = await tool.execute(makeRequest());

    expect(result).toMatchObject({ status: 'ready', type: 'gui' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns for unexpected VFS read errors and still executes when GUI file is available', async () => {
    const warnSpy = vi.spyOn(tool['logger'], 'warn').mockImplementation(() => undefined);
    vfs.readFile.mockImplementation((sessionId: string, filePath: string) => {
      if (filePath.endsWith('ui.gui')) return { sessionId, filePath, content: 'window { label { text = "Hello" } }' };
      if (filePath.endsWith('systems.yml')) {
        const err = new Error('permission denied') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
      err.code = 'VFS_FILE_NOT_FOUND';
      throw err;
    });

    const result = await tool.execute(makeRequest());

    expect(result).toMatchObject({ status: 'ready', type: 'gui' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[raapp_execute_dsl] Unexpected VFS read error for drafts/draft-1/systems.yml'),
      expect.any(Error),
    );
  });

  it('returns nativeResults without pendingApprovals when draft GUI approvals resolve server-side', async () => {
    vfs.readFile.mockImplementation((sessionId: string, filePath: string) => {
      if (filePath.endsWith('ui.gui')) return { sessionId, filePath, content: 'window { label { text = "Hello" } }' };
      if (filePath.endsWith('systems.yml')) return { sessionId, filePath, content: 'systems: []' };
      const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
      err.code = 'VFS_FILE_NOT_FOUND';
      throw err;
    });
    effectsProcessor.processSystemsYaml.mockResolvedValue({
      output: {},
      pendingApprovals: [
        { id: 'approval-1', system: 'test_write', args: { path: 'draft.txt' }, displayLabel: 'Write draft.txt' },
      ],
      entities: [],
    });
    hitl.resolvePendingApprovals.mockResolvedValue({
      pendingApprovals: [],
      nativeResults: [
        { id: 'approval-1', system: 'test_write', status: 'executed', result: { path: 'draft.txt' } },
      ],
    });

    const result = await tool.execute(makeRequest()) as Record<string, unknown>;

    expect(hitl.resolvePendingApprovals).toHaveBeenCalledWith(
      'call-1',
      'sess-1',
      expect.arrayContaining([expect.objectContaining({ id: 'approval-1' })]),
    );
    expect(result.pendingApprovals).toBeUndefined();
    expect(result.nativeResults).toEqual([
      expect.objectContaining({ id: 'approval-1', status: 'executed' }),
    ]);
  });
});

describe('RaAppPublishDraftTool', () => {
  let vfs: {
    listFiles: ReturnType<typeof vi.fn>;
    readBinary: ReturnType<typeof vi.fn>;
  };
  let versioning: {
    saveAsDraft: ReturnType<typeof vi.fn>;
    approveDraft: ReturnType<typeof vi.fn>;
  };
  let tool: RaAppPublishDraftTool;

  beforeEach(() => {
    vfs = {
      listFiles: vi.fn().mockReturnValue({
        sessionId: 'sess-1',
        files: [
          { sessionId: 'sess-1', path: 'drafts/draft-1/meta.yml', sizeBytes: 10, updatedAt: 1 },
          { sessionId: 'sess-1', path: 'drafts/draft-1/ui.gui', sizeBytes: 20, updatedAt: 1 },
          { sessionId: 'sess-1', path: 'drafts/draft-1/.raapp-slug', sizeBytes: 6, updatedAt: 1 },
        ],
      }),
      readBinary: vi.fn((_sessionId: string, filePath: string) => {
        if (filePath.endsWith('meta.yml')) return Buffer.from('id: my-app\nname: My App\nversion: "1.2.0"\n');
        if (filePath.endsWith('ui.gui')) return Buffer.from('window { label { text = "Hello" } }');
        if (filePath.endsWith('.raapp-slug')) return Buffer.from('my-app');
        throw new Error(`unexpected read: ${filePath}`);
      }),
    };
    versioning = {
      saveAsDraft: vi.fn().mockResolvedValue({
        slug: 'my-app',
        name: 'My App',
        source: 'user',
        current: {
          version: '1.2.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 1,
          meta: { id: 'my-app', name: 'My App', version: '1.2.0' },
        },
        draft: {
          version: '1.2.0',
          status: 'draft',
          zipPath: '/tmp/draft.zip',
          createdAt: 1,
          meta: { id: 'my-app', name: 'My App', version: '1.2.0' },
        },
        history: [],
      }),
      approveDraft: vi.fn().mockResolvedValue({
        slug: 'my-app',
        name: 'My App',
        source: 'user',
        current: {
          version: '1.3.0',
          status: 'current',
          zipPath: '/tmp/current.zip',
          createdAt: 2,
          meta: { id: 'my-app', name: 'My App', version: '1.3.0' },
        },
        history: [],
      }),
    };
    tool = new RaAppPublishDraftTool(vfs as never, versioning as never);
  });

  it('publishes a VFS draft into the versioned release lifecycle', async () => {
    const result = await tool.execute({
      callId: 'call-2',
      sessionId: 'sess-1',
      toolName: 'raapp_publish_draft',
      args: { draft_id: 'draft-1', bump_type: 'minor' },
    });

    expect(versioning.saveAsDraft).toHaveBeenCalledWith('my-app', expect.any(Buffer));
    expect(versioning.approveDraft).toHaveBeenCalledWith('my-app', 'minor');
    expect(result).toMatchObject({
      status: 'published',
      draft_id: 'draft-1',
      slug: 'my-app',
      version: '1.3.0',
      bumpType: 'minor',
    });
  });

  it('rejects publish when neither slug override nor meta id/name produce a non-empty slug', async () => {
    vfs.listFiles.mockReturnValue({
      sessionId: 'sess-1',
      files: [
        { sessionId: 'sess-1', path: 'drafts/draft-1/meta.yml', sizeBytes: 10, updatedAt: 1 },
        { sessionId: 'sess-1', path: 'drafts/draft-1/ui.gui', sizeBytes: 20, updatedAt: 1 },
      ],
    });
    vfs.readBinary.mockImplementation((_sessionId: string, filePath: string) => {
      if (filePath.endsWith('meta.yml')) return Buffer.from('id: ""\nname: ""\nversion: "1.0.0"\n');
      if (filePath.endsWith('ui.gui')) return Buffer.from('window { label { text = "Hello" } }');
      throw new Error(`unexpected read: ${filePath}`);
    });

    const result = await tool.execute({
      callId: 'call-3',
      sessionId: 'sess-1',
      toolName: 'raapp_publish_draft',
      args: { draft_id: 'draft-1', bump_type: 'minor' },
    });

    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/slug|meta\.yml|name|id/i),
    });
    expect(versioning.saveAsDraft).not.toHaveBeenCalled();
  });
});