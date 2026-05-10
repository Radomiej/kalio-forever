import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import { RaAppEditTool } from './raapp-crud.tools';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-1',
    sessionId: 'sess-1',
    toolName: 'raapp_edit',
    args,
  };
}

describe('RaAppEditTool', () => {
  let raapp: {
    getById: ReturnType<typeof vi.fn>;
    getSourceFiles: ReturnType<typeof vi.fn>;
  };
  let vfs: {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
  };
  let tool: RaAppEditTool;

  beforeEach(() => {
    raapp = {
      getById: vi.fn().mockReturnValue({
        id: 'my-app',
        source: 'user',
        appMode: 'interactive',
        meta: { id: 'my-app', name: 'My App', version: '1.2.0' },
      }),
      getSourceFiles: vi.fn().mockResolvedValue({
        'meta.yml': 'id: my-app\nname: My App\nversion: "1.2.0"\n',
        'ui.gui': 'window { label { text = "release" } }',
        'tests.yml': 'tests:\n  - name: release\n',
      }),
    };
    vfs = {
      readFile: vi.fn((_sessionId: string, filePath: string) => {
        const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
        err.code = 'VFS_FILE_NOT_FOUND';
        throw err;
      }),
      writeFile: vi.fn(),
    };

    tool = new (RaAppEditTool as unknown as { new (...args: unknown[]): RaAppEditTool })(
      raapp as never,
      vfs as never,
    );
  });

  it('creates a VFS working copy instead of editing the release ZIP in place', async () => {
    const result = await tool.execute(makeRequest({
      id: 'my-app',
      ui_gui: 'window { label { text = "draft" } }',
    }));

    expect(result).toMatchObject({
      status: 'draft_created',
      source: 'user_release',
      draft_id: 'edit-my-app',
      updatedFiles: ['ui.gui'],
    });
    expect(raapp.getSourceFiles).toHaveBeenCalledWith('my-app');
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/ui.gui',
      content: 'window { label { text = "draft" } }',
    });
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/.mode',
      content: 'interactive',
    });
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/.raapp-slug',
      content: 'my-app',
    });
  });

  it('updates the existing VFS working copy on subsequent edits instead of resetting from release', async () => {
    vfs.readFile.mockImplementation((sessionId: string, filePath: string) => {
      if (filePath.endsWith('meta.yml')) {
        return { sessionId, filePath, content: 'id: my-app\nname: My App\nversion: "1.2.0"\n' };
      }
      if (filePath.endsWith('ui.gui')) {
        return { sessionId, filePath, content: 'window { label { text = "already drafted" } }' };
      }
      if (filePath.endsWith('tests.yml')) {
        return { sessionId, filePath, content: 'tests:\n  - name: old\n' };
      }
      if (filePath.endsWith('.mode')) {
        return { sessionId, filePath, content: 'interactive' };
      }
      if (filePath.endsWith('.raapp-slug')) {
        return { sessionId, filePath, content: 'my-app' };
      }
      const err = new Error(`missing: ${filePath}`) as NodeJS.ErrnoException;
      err.code = 'VFS_FILE_NOT_FOUND';
      throw err;
    });

    await tool.execute(makeRequest({
      id: 'my-app',
      tests_yml: 'tests:\n  - name: updated\n',
    }));

    expect(raapp.getSourceFiles).not.toHaveBeenCalled();
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/ui.gui',
      content: 'window { label { text = "already drafted" } }',
    });
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/tests.yml',
      content: 'tests:\n  - name: updated\n',
    });
  });

  it('accepts components_yml updates for the VFS working copy', async () => {
    const result = await tool.execute(makeRequest({
      id: 'my-app',
      components_yml: 'globals:\n  hp:\n    type: number\n    default: 100\n',
    }));

    expect(result).toMatchObject({
      status: 'draft_created',
      draft_id: 'edit-my-app',
      updatedFiles: ['components.yml'],
    });
    expect(vfs.writeFile).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      filePath: 'drafts/edit-my-app/components.yml',
      content: 'globals:\n  hp:\n    type: number\n    default: 100\n',
    });
  });
});