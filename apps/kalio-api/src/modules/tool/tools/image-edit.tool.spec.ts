/**
 * Regression tests for ImageEditTool.
 *
 * Focus: VFS write failure inside execute() must be caught and returned as
 * { error: '...' } instead of propagating as an unhandled exception.
 *
 * Bug: this.vfs.writeBinary() was called outside any try/catch block.
 * If writeFileSync threw (e.g. ENOSPC, permission denied), the error would
 * escape execute() rather than being logged and returned gracefully.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImageEditTool } from './image-edit.tool';
import type { ToolCallRequest } from '@kalio/types';

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
    args: {
      outputPath: 'images/result.png',
      refs: [{ vfsPath: 'images/base.png', role: 'base', label: 'base' }],
      prompt: 'make it prettier',
      ...overrides,
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ImageEditTool — VFS write error handling', () => {
  let tool: ImageEditTool;

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

  it('REGRESSION: VFS write failure returns { error } instead of throwing', async () => {
    mockWriteBinary.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });

    const result = await tool.execute(makeRequest());

    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('ENOSPC');
  });

  it('successful VFS write returns image metadata', async () => {
    mockWriteBinary.mockReturnValue(undefined); // success

    const result = await tool.execute(makeRequest());

    expect(result).toHaveProperty('image_url');
    expect(result).toHaveProperty('path');
    expect(mockWriteBinary).toHaveBeenCalledOnce();
  });
});
