import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { KVStoreService } from '../kv-store.service';

function getKeyArg(args: ToolCallRequest['args']): string {
  const rawKey = args['key'];
  if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
    throw new Error('INVALID_KEY: key must be a non-empty string');
  }
  return rawKey;
}

function getValueArg(args: ToolCallRequest['args']): string {
  const rawValue = args['value'];
  if (typeof rawValue !== 'string') {
    throw new Error('INVALID_VALUE: value must be a string');
  }
  return rawValue;
}

@Injectable()
@Tool({
  name: 'kv_write',
  description: 'Write a key-value pair to the conversation persistent store.',
  parameters: {
    type: 'object',
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', description: 'Key to write.' },
      value: { type: 'string', description: 'String value to store.' },
    },
  },
  requiresConfirmation: true,
})
export class KVWriteTool {
  constructor(private readonly kv: KVStoreService) {}

  async execute(request: ToolCallRequest): Promise<{ key: string; ok: true }> {
    const key = getKeyArg(request.args);
    const value = getValueArg(request.args);
    await this.kv.set(request.sessionId, key, value);
    return { key, ok: true };
  }
}

@Injectable()
@Tool({
  name: 'kv_read',
  description: 'Read a value from the conversation persistent store by key.',
  parameters: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'Key to read.' },
    },
  },
  requiresConfirmation: false,
})
export class KVReadTool {
  constructor(private readonly kv: KVStoreService) {}

  async execute(request: ToolCallRequest): Promise<{ key: string; value: string | null }> {
    const key = getKeyArg(request.args);
    const value = (await this.kv.get(request.sessionId, key)) ?? null;
    return { key, value };
  }
}

@Injectable()
@Tool({
  name: 'kv_list',
  description: 'List all key-value pairs in the conversation persistent store.',
  parameters: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
})
export class KVListTool {
  constructor(private readonly kv: KVStoreService) {}

  async execute(request: ToolCallRequest): Promise<{ entries: Record<string, string> }> {
    return { entries: await this.kv.list(request.sessionId) };
  }
}

@Injectable()
@Tool({
  name: 'kv_delete',
  description: 'Delete a key from the conversation persistent store.',
  parameters: {
    type: 'object',
    required: ['key'],
    properties: {
      key: { type: 'string', description: 'Key to delete.' },
    },
  },
  requiresConfirmation: true,
})
export class KVDeleteTool {
  constructor(private readonly kv: KVStoreService) {}

  async execute(request: ToolCallRequest): Promise<{ key: string; deleted: boolean }> {
    const key = getKeyArg(request.args);
    const deleted = await this.kv.delete(request.sessionId, key);
    return { key, deleted };
  }
}
