import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageViewTool } from './image-view.tool';
import type { ToolCallRequest } from '@kalio/types';

const mockReadBinary = vi.fn();

const mockVfsService = {
  readBinary: mockReadBinary,
} as unknown as import('../../vfs/vfs.service').VFSService;

function makeRequest(args: Partial<ToolCallRequest['args']> = {}): ToolCallRequest {
  return {
    callId: 'call-image-view',
    toolName: 'image_view',
    sessionId: 'child-session',
    vfsSessionId: 'shared-session',
    args: {
      path: 'images/sea-otter.png',
      ...args,
    },
  };
}

describe('ImageViewTool', () => {
  let tool: ImageViewTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new ImageViewTool(mockVfsService);
    mockReadBinary.mockReturnValue(Buffer.from('png-bytes'));
  });

  it('uses vfsSessionId when reading images', async () => {
    const result = await tool.execute(makeRequest());

    expect(mockReadBinary).toHaveBeenCalledWith('shared-session', 'images/sea-otter.png');
    expect(result).toMatchObject({ path: 'images/sea-otter.png', output_type: 'image' });
  });

  it('throws when the image does not exist instead of returning { error }', async () => {
    const error = new Error('VFS_FILE_NOT_FOUND: images/sea-otter.png not found in session shared-session');
    (error as NodeJS.ErrnoException).code = 'VFS_FILE_NOT_FOUND';
    mockReadBinary.mockImplementation(() => {
      throw error;
    });

    await expect(tool.execute(makeRequest())).rejects.toThrow('Image not found: images/sea-otter.png');
  });

  it.each([
    { label: 'path is empty', args: { path: '' }, error: 'INVALID_PATH' },
    { label: 'path is whitespace', args: { path: '   ' }, error: 'INVALID_PATH' },
    { label: 'path is numeric', args: { path: 123 }, error: 'INVALID_PATH' },
    { label: 'quality is unsupported', args: { quality: 'ultra' }, error: 'INVALID_QUALITY' },
  ])('rejects malformed image_view input when $label (REGRESSION)', async ({ args, error }) => {
    await expect(tool.execute(makeRequest(args))).rejects.toThrow(error);
    expect(mockReadBinary).not.toHaveBeenCalled();
  });

  it('rejects non-image extensions instead of defaulting them to image/png (REGRESSION)', async () => {
    await expect(tool.execute(makeRequest({ path: 'documents/report.txt' }))).rejects.toThrow(
      'File is not an image: documents/report.txt',
    );
  });
});