import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import type { VFSService } from '../../vfs/vfs.service';
import { DesignPreviewTool } from './design-preview.tool';

function makeRequest(
  args: Record<string, unknown> = {},
  sessionId = 'sess-abc',
  vfsSessionId?: string,
): ToolCallRequest {
  return {
    callId: 'call-1',
    sessionId,
    vfsSessionId,
    toolName: 'design_preview',
    args,
  };
}

describe('DesignPreviewTool', () => {
  let tool: DesignPreviewTool;
  let vfs: Partial<VFSService>;

  beforeEach(() => {
    vfs = {
      readFile: vi.fn(),
    };
    tool = new DesignPreviewTool(vfs as VFSService);
  });

  it('returns a VFS-backed html RA-App block for an existing html file', async () => {
    (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: 'sess-abc',
      filePath: 'design/preview.html',
      content: '<!doctype html><html><body>Preview</body></html>',
    });

    const result = await tool.execute(makeRequest({ filePath: 'design/preview.html' }));

    expect(vfs.readFile).toHaveBeenCalledWith('sess-abc', 'design/preview.html');
    expect(result).toEqual({
      status: 'ready',
      type: 'html',
      mode: 'display',
      content: '',
      vfsPath: 'design/preview.html',
    });
  });

  it('uses vfsSessionId when provided', async () => {
    (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: 'vfs-child',
      filePath: 'design/preview.html',
      content: '<!doctype html><html><body>Preview</body></html>',
    });

    await tool.execute(makeRequest({ filePath: 'design/preview.html' }, 'parent-session', 'vfs-child'));

    expect(vfs.readFile).toHaveBeenCalledWith('vfs-child', 'design/preview.html');
  });

  it('rejects empty file paths', async () => {
    await expect(tool.execute(makeRequest({ filePath: '   ' }))).rejects.toThrow(
      'INVALID_FILE_PATH: filePath must be a non-empty string',
    );
  });

  it('rejects non-html preview targets', async () => {
    (vfs.readFile as ReturnType<typeof vi.fn>).mockReturnValue({
      sessionId: 'sess-abc',
      filePath: 'design/preview.json',
      content: '{"ok":true}',
    });

    await expect(tool.execute(makeRequest({ filePath: 'design/preview.json' }))).rejects.toThrow(
      'INVALID_PREVIEW_FILE: filePath must point to an .html or .htm file',
    );
  });

  it('rejects interactive mode because VFS-backed previews are display-only', async () => {
    await expect(tool.execute(makeRequest({ filePath: 'design/preview.html', mode: 'interactive' }))).rejects.toThrow(
      'INVALID_MODE: design_preview currently supports only "display" mode',
    );
  });

  it('returns a structured tool error when the preview file is missing in VFS', async () => {
    (vfs.readFile as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('VFS_FILE_NOT_FOUND: design/missing.html not found in session sess-abc');
    });

    const result = await tool.execute(makeRequest({ filePath: 'design/missing.html' }));

    expect(result).toEqual({
      status: 'error',
      message: 'VFS_FILE_NOT_FOUND: design/missing.html not found in session sess-abc',
    });
  });
});
