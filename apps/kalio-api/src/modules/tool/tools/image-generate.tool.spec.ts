import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageGenerateTool } from './image-generate.tool';
import type { ToolCallRequest } from '@kalio/types';

const mockGenerate = vi.fn();
const mockGetConfig = vi.fn();
const mockGetApiKey = vi.fn();
const mockWriteBinary = vi.fn();

const mockImageGenerationService = {
  generate: mockGenerate,
} as unknown as import('../../image/image-generation.service').ImageGenerationService;

const mockImageConfigService = {
  getConfig: mockGetConfig,
  getApiKey: mockGetApiKey,
} as unknown as import('../../image/image-config.service').ImageConfigService;

const mockVfsService = {
  writeBinary: mockWriteBinary,
} as unknown as import('../../vfs/vfs.service').VFSService;

function makeRequest(args: Partial<ToolCallRequest['args']> = {}): ToolCallRequest {
  return {
    callId: 'call-image-generate',
    toolName: 'image_generate',
    sessionId: 'child-session',
    vfsSessionId: 'shared-session',
    args: {
      prompt: 'cute sea otter',
      filename: 'sea-otter.png',
      ...args,
    },
  };
}

describe('ImageGenerateTool', () => {
  let tool: ImageGenerateTool;

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new ImageGenerateTool(mockImageGenerationService, mockImageConfigService, mockVfsService);
    mockGetConfig.mockResolvedValue({ provider: 'cometapi', model: 'gpt-image-1', baseUrl: 'https://api.cometapi.com/v1' });
    mockGetApiKey.mockResolvedValue('key-123');
    mockGenerate.mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      dataUrl: 'data:image/png;base64,cG5nLWJ5dGVz',
      model: 'gpt-image-1',
      size: '1024x1024',
      format: 'png',
    });
  });

  it('uses vfsSessionId when saving generated images and building download URLs', async () => {
    const result = await tool.execute(makeRequest());

    expect(mockWriteBinary).toHaveBeenCalledWith('shared-session', 'images/sea-otter.png', expect.any(Buffer));
    expect(result).toMatchObject({
      path: 'images/sea-otter.png',
      download_url: '/api/sessions/shared-session/vfs/download?path=images%2Fsea-otter.png',
    });
  });

  it('throws when generation fails instead of returning { error }', async () => {
    mockGenerate.mockRejectedValue(new Error('Image generation failed: no available channel'));

    await expect(tool.execute(makeRequest())).rejects.toThrow('Image generation failed: no available channel');
  });

  it('allows mock stock model without API key and still saves the image', async () => {
    mockGetConfig.mockResolvedValue({ provider: 'auto', model: 'mock-stock', baseUrl: '' });
    mockGetApiKey.mockResolvedValue(null);

    const result = await tool.execute(makeRequest({ model: 'mock-stock', filename: 'mock-cat.png' }));

    expect(mockGenerate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'mock-stock',
    }));
    expect(mockWriteBinary).toHaveBeenCalledWith('shared-session', 'images/mock-cat.png', expect.any(Buffer));
    expect(result).toMatchObject({
      path: 'images/mock-cat.png',
      download_url: '/api/sessions/shared-session/vfs/download?path=images%2Fmock-cat.png',
    });
  });
});