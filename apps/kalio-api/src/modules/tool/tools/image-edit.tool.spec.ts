/**
 * Regression tests for ImageEditTool.
 *
 * Focus: image_edit must throw on operational failures so ToolDispatchService
 * can surface a real error result, and it must honor request.vfsSessionId
 * for shared/isolated subagent VFS routing.
 *
 * Bug: this.vfs.writeBinary() was called outside any try/catch block.
 * If writeFileSync threw (e.g. ENOSPC, permission denied), the error would
 * escape execute() rather than being logged and returned gracefully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ImageEditTool } from './image-edit.tool';
import { ImageEditingService } from '../../image/image-editing.service';
import type { ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGetApiKey = vi.fn().mockResolvedValue('test-key');
const mockGetConfig = vi.fn().mockResolvedValue({
  provider: 'cometapi',
  baseUrl: null,
});
const mockReadBinary = vi.fn();
const mockWriteBinary = vi.fn();
const mockListFiles = vi.fn().mockReturnValue({ files: [] });

const mockImageConfig = {
  getApiKey: mockGetApiKey,
  getConfig: mockGetConfig,
} as unknown as import('../../image/image-config.service').ImageConfigService;

const mockVfs = {
  readBinary: mockReadBinary,
  writeBinary: mockWriteBinary,
  listFiles: mockListFiles,
} as unknown as import('../../vfs/vfs.service').VFSService;

function makeRequest(overrides: Partial<ToolCallRequest['args']> = {}): ToolCallRequest {
  return {
    callId: 'call-test',
    toolName: 'image_edit',
    sessionId: 'session-1',
    vfsSessionId: 'vfs-shared',
    args: {
      outputPath: 'images/result.png',
      refs: [{ vfsPath: 'images/base.png', role: 'base', label: 'base' }],
      prompt: 'make it prettier',
      ...overrides,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageEditTool', () => {
  let tool: ImageEditTool;
  const reflector = new Reflector();

  beforeEach(() => {
    vi.clearAllMocks();
    tool = new ImageEditTool(mockImageConfig, mockVfs, new ImageEditingService({ generate: vi.fn() }));

    // Default: readBinary returns a valid PNG buffer
    mockReadBinary.mockReturnValue(Buffer.from('fake-png'));

    // Stub global fetch for Gemini call
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
                mimeType: 'image/png',
              },
            }],
          },
        }],
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('edits via ChatGPT and saves a versioned image without reading an API key', async () => {
    mockGetConfig.mockResolvedValueOnce({ provider: 'chatgpt', executionProfileId: 'native' });
    const generate = vi.fn().mockResolvedValue({ bytes: Buffer.from('native-edited'), mimeType: 'image/png', model: 'native-model', format: 'png', width: 1, height: 1 });
    tool = new ImageEditTool(mockImageConfig, mockVfs, new ImageEditingService({ generate }));
    mockWriteBinary.mockReturnValue(undefined);
    const result = await tool.execute(makeRequest({ iterationOf: 'images/base.png' }));
    expect(mockGetApiKey).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ executionProfileId: 'native', prompt: expect.stringContaining('EDIT TASK: make it prettier'), references: expect.arrayContaining([expect.objectContaining({ role: 'base' })]) }));
    expect(result).toMatchObject({ model: 'native-model', iteratedFrom: 'images/base.png' });
  });

  it('REGRESSION: requires HITL confirmation because it writes edited files to VFS', () => {
    const metadata = reflector.get(TOOL_METADATA, ImageEditTool);

    expect(metadata.requiresConfirmation).toBe(true);
  });

  it('keeps reference order aligned with numbered prompt and saves PNG under a PNG extension', async () => {
    mockGetConfig.mockResolvedValueOnce({ provider: 'chatgpt', executionProfileId: 'native' });
    const generate = vi.fn().mockResolvedValue({ bytes: Buffer.from('edited'), mimeType: 'image/png', model: 'native', format: 'png', width: 1, height: 1 });
    mockWriteBinary.mockReturnValue(undefined);
    tool = new ImageEditTool(mockImageConfig, mockVfs, new ImageEditingService({ generate }));
    const result = await tool.execute(makeRequest({ outputPath: 'images/result.jpg', refs: [
      { vfsPath: 'base.png', role: 'base', label: 'base' },
      { vfsPath: 'style.png', role: 'style', label: 'style' },
    ] }));
    expect(generate.mock.calls[0]![0].references.map((ref: { role: string }) => ref.role)).toEqual(['style', 'base']);
    expect(generate.mock.calls[0]![0].prompt).toContain('Image 1 [style]');
    expect(result).toMatchObject({ path: expect.stringMatching(/\.png$/) });
  });

  it('REGRESSION: VFS write failure throws so ToolDispatchService can emit status=error', async () => {
    mockWriteBinary.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    await expect(tool.execute(makeRequest())).rejects.toThrow('ENOSPC');
  });

  it('uses vfsSessionId for reads, versioning, writes, and download URLs', async () => {
    mockListFiles.mockReturnValue({ files: [{ path: 'images/result-v1.png' }] });
    mockWriteBinary.mockReturnValue(undefined); // success

    const result = await tool.execute(makeRequest());

    expect(result).toHaveProperty('image_url');
    expect(result).toMatchObject({
      path: 'images/result-v2.png',
      download_url: '/api/sessions/vfs-shared/vfs/download?path=images%2Fresult-v2.png',
    });
    expect(mockReadBinary).toHaveBeenCalledWith('vfs-shared', 'images/base.png');
    expect(mockListFiles).toHaveBeenCalledWith('vfs-shared');
    expect(mockWriteBinary).toHaveBeenCalledWith('vfs-shared', 'images/result-v2.png', expect.any(Buffer));
  });
});
