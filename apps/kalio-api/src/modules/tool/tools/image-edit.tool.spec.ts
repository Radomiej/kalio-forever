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
    tool = new ImageEditTool(mockImageConfig, mockVfs);

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
                data: Buffer.from('fake-png').toString('base64'),
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

  it('REGRESSION: requires HITL confirmation because it writes edited files to VFS', () => {
    const metadata = reflector.get(TOOL_METADATA, ImageEditTool);

    expect(metadata.requiresConfirmation).toBe(true);
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
