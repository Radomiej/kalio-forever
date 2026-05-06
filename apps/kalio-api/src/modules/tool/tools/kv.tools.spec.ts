import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './kv.tools';
import type { KVStoreService } from '../kv-store.service';
import type { ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-kv'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

function makeKVService(): Partial<KVStoreService> {
  return {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  };
}

const reflector = new Reflector();

// ── KVWriteTool ───────────────────────────────────────────────────────────────

describe('KVWriteTool', () => {
  let tool: KVWriteTool;
  let kv: Partial<KVStoreService>;

  beforeEach(() => {
    kv = makeKVService();
    tool = new KVWriteTool(kv as KVStoreService);
  });

  describe('@Tool() decorator (REGRESSION)', () => {
    it('MUST have requiresConfirmation=true for persistent KV writes', () => {
      const metadata = reflector.get(TOOL_METADATA, KVWriteTool);

      expect(metadata.requiresConfirmation).toBe(true);
    });
  });

  describe('positive scenarios', () => {
    it('calls kv.set with sessionId, key, value and returns { key, ok: true }', async () => {
      (kv.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await tool.execute(makeRequest('kv_write', { key: 'name', value: 'Alice' }));

      expect(kv.set).toHaveBeenCalledWith('sess-kv', 'name', 'Alice');
      expect(result).toEqual({ key: 'name', ok: true });
    });

    it('overwrites existing key without error', async () => {
      (kv.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      await tool.execute(makeRequest('kv_write', { key: 'counter', value: '1' }));
      await tool.execute(makeRequest('kv_write', { key: 'counter', value: '2' }));

      expect(kv.set).toHaveBeenCalledTimes(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty string value', async () => {
      (kv.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await tool.execute(makeRequest('kv_write', { key: 'empty', value: '' }));

      expect(kv.set).toHaveBeenCalledWith('sess-kv', 'empty', '');
      expect(result.ok).toBe(true);
    });

    it('handles key with special characters', async () => {
      (kv.set as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
      const result = await tool.execute(makeRequest('kv_write', { key: 'some:key.path', value: 'v' }));

      expect(result.key).toBe('some:key.path');
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if kv.set throws', async () => {
      (kv.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV_WRITE_FAILED'));

      await expect(tool.execute(makeRequest('kv_write', { key: 'x', value: 'y' }))).rejects.toThrow('KV_WRITE_FAILED');
    });
  });
});

// ── KVReadTool ────────────────────────────────────────────────────────────────

describe('KVReadTool', () => {
  let tool: KVReadTool;
  let kv: Partial<KVStoreService>;

  beforeEach(() => {
    kv = makeKVService();
    tool = new KVReadTool(kv as KVStoreService);
  });

  describe('positive scenarios', () => {
    it('returns { key, value } when key exists', async () => {
      (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue('Alice');

      const result = await tool.execute(makeRequest('kv_read', { key: 'name' }));

      expect(result).toEqual({ key: 'name', value: 'Alice' });
    });

    it('passes sessionId and key to kv.get', async () => {
      (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue('v');

      await tool.execute(makeRequest('kv_read', { key: 'mykey' }, 'sess-other'));

      expect(kv.get).toHaveBeenCalledWith('sess-other', 'mykey');
    });
  });

  describe('edge cases', () => {
    it('returns null value when key does not exist', async () => {
      (kv.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await tool.execute(makeRequest('kv_read', { key: 'missing' }));

      expect(result).toEqual({ key: 'missing', value: null });
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if kv.get throws', async () => {
      (kv.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV_IO_ERROR'));

      await expect(tool.execute(makeRequest('kv_read', { key: 'x' }))).rejects.toThrow('KV_IO_ERROR');
    });
  });
});

// ── KVListTool ────────────────────────────────────────────────────────────────

describe('KVListTool', () => {
  let tool: KVListTool;
  let kv: Partial<KVStoreService>;

  beforeEach(() => {
    kv = makeKVService();
    tool = new KVListTool(kv as KVStoreService);
  });

  describe('positive scenarios', () => {
    it('returns all entries from kv.list', async () => {
      (kv.list as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Alice', age: '30' });

      const result = await tool.execute(makeRequest('kv_list'));

      expect(result.entries).toEqual({ name: 'Alice', age: '30' });
    });

    it('passes sessionId to kv.list', async () => {
      (kv.list as ReturnType<typeof vi.fn>).mockResolvedValue({});

      await tool.execute(makeRequest('kv_list', {}, 'sess-xyz'));

      expect(kv.list).toHaveBeenCalledWith('sess-xyz');
    });
  });

  describe('edge cases', () => {
    it('returns empty object when store is empty', async () => {
      (kv.list as ReturnType<typeof vi.fn>).mockResolvedValue({});

      const result = await tool.execute(makeRequest('kv_list'));

      expect(result.entries).toEqual({});
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if kv.list throws', async () => {
      (kv.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV_LIST_ERROR'));

      await expect(tool.execute(makeRequest('kv_list'))).rejects.toThrow('KV_LIST_ERROR');
    });
  });
});

// ── KVDeleteTool ──────────────────────────────────────────────────────────────

describe('KVDeleteTool', () => {
  let tool: KVDeleteTool;
  let kv: Partial<KVStoreService>;

  beforeEach(() => {
    kv = makeKVService();
    tool = new KVDeleteTool(kv as KVStoreService);
  });

  describe('@Tool() decorator (REGRESSION)', () => {
    it('MUST have requiresConfirmation=true for persistent KV deletes', () => {
      const metadata = reflector.get(TOOL_METADATA, KVDeleteTool);

      expect(metadata.requiresConfirmation).toBe(true);
    });
  });

  describe('positive scenarios', () => {
    it('returns { key, deleted: true } when key was present', async () => {
      (kv.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const result = await tool.execute(makeRequest('kv_delete', { key: 'name' }));

      expect(result).toEqual({ key: 'name', deleted: true });
    });

    it('passes sessionId and key to kv.delete', async () => {
      (kv.delete as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      await tool.execute(makeRequest('kv_delete', { key: 'thekey' }, 'sess-del'));

      expect(kv.delete).toHaveBeenCalledWith('sess-del', 'thekey');
    });
  });

  describe('edge cases', () => {
    it('returns { key, deleted: false } when key was not present', async () => {
      (kv.delete as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const result = await tool.execute(makeRequest('kv_delete', { key: 'nonexistent' }));

      expect(result).toEqual({ key: 'nonexistent', deleted: false });
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if kv.delete throws', async () => {
      (kv.delete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('KV_DELETE_ERROR'));

      await expect(tool.execute(makeRequest('kv_delete', { key: 'x' }))).rejects.toThrow('KV_DELETE_ERROR');
    });
  });
});
