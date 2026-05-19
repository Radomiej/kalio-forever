import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ID,
  Timestamp,
  LLMStreamChunk,
  LLMConfig,
  LLMProviderType,
  Persona,
  CreatePersonaDto,
  ChatMessage,
  ChatSession,
  CreateSessionDto,
  ToolMeta,
  ToolCallRequest,
  ToolResult,
  ToolConfirmationRequest,
  VFSWriteRequest,
  Credential,
  CreateCredentialDto,
  ToolTimeoutSettings,
  MCPServer,
  RAAppBlock,
  SocketEvents,
} from '../index.js';

describe('@kalio/types contract shape', () => {
  it('keeps primitive aliases aligned with serialized API values', () => {
    expectTypeOf<ID>().toEqualTypeOf<string>();
    expectTypeOf<Timestamp>().toEqualTypeOf<number>();
  });

  it('keeps chat message and session contracts compatible with persisted payloads', () => {
    expectTypeOf<Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt'>>().toEqualTypeOf<{
      id: ID;
      sessionId: ID;
      role: 'user' | 'assistant' | 'tool_result' | 'system';
      content: string;
      createdAt: Timestamp;
    }>();
    expectTypeOf<Pick<ChatSession, 'id' | 'personaId' | 'title' | 'createdAt' | 'updatedAt'>>().toEqualTypeOf<{
      id: ID;
      personaId: ID;
      title: string;
      createdAt: Timestamp;
      updatedAt: Timestamp;
    }>();

    const msg: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
    };
    expect(msg.role).toBe('user');
  });

  it('keeps persona creation inputs narrower than stored persona records', () => {
    expectTypeOf<Pick<CreatePersonaDto, 'name' | 'systemPrompt' | 'model' | 'allowedTools'>>().toEqualTypeOf<{
      name: string;
      systemPrompt: string;
      model: string;
      allowedTools: string[];
    }>();
    expectTypeOf<Pick<Persona, 'id' | 'skillIds' | 'mcpPolicy' | 'createdAt' | 'updatedAt'>>().toEqualTypeOf<{
      id: ID;
      skillIds: string[];
      mcpPolicy: 'allow_all' | 'deny_all' | 'allow_list';
      createdAt: Timestamp;
      updatedAt: Timestamp;
    }>();
  });

  it('keeps tool metadata, calls, results, and confirmations on the shared HITL contract', () => {
    expectTypeOf<ToolMeta>().toEqualTypeOf<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      requiresConfirmation: boolean;
    }>();
    expectTypeOf<Pick<ToolCallRequest, 'sessionId' | 'toolName' | 'args' | 'callId'>>().toEqualTypeOf<{
      sessionId: ID;
      toolName: string;
      args: Record<string, unknown>;
      callId: string;
    }>();
    expectTypeOf<ToolResult['status']>().toEqualTypeOf<'success' | 'error' | 'cancelled'>();
    expectTypeOf<Pick<ToolConfirmationRequest, 'requestId' | 'toolCallId' | 'sessionId' | 'toolName' | 'args' | 'timeoutMs'>>().toEqualTypeOf<{
      requestId: string;
      toolCallId: string;
      sessionId: ID;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
    }>();
  });

  it('Credential never exposes apiKey', () => {
    const cred: Credential = {
      id: 'cred-1',
      name: 'CometAPI',
      provider: 'CometAPI',
      createdAt: Date.now(),
    };
    // apiKey is NOT on the Credential interface — compile-time check via type
    expect('apiKey' in cred).toBe(false);
  });

  it('keeps provider and DTO unions aligned with runtime-supported values', () => {
    const providers: LLMProviderType[] = [
      'openai',
      'openrouter',
      'cometapi',
      'xiaomimimo',
      'ollama',
      'deepseek',
      'bitnet',
      'custom',
      'mock',
    ];
    expect(providers).toContain('bitnet');
    expect(providers).toContain('custom');

    expectTypeOf<Pick<CreateSessionDto, 'personaId' | 'title' | 'kind'>>().toEqualTypeOf<{
      personaId: ID;
      title?: string;
      kind?: 'chat' | 'subagent' | 'cli-agent';
    }>();
    expectTypeOf<Pick<CreateCredentialDto, 'name' | 'provider' | 'apiKey'>>().toEqualTypeOf<{
      name: string;
      provider: string;
      apiKey?: string;
    }>();
  });

  it('keeps cross-feature payload contracts explicit', () => {
    expectTypeOf<VFSWriteRequest>().toEqualTypeOf<{ sessionId: ID; filePath: string; content: string }>();
    expectTypeOf<MCPServer['status']>().toEqualTypeOf<'connecting' | 'connected' | 'disconnected' | 'error' | 'stopped'>();
    expectTypeOf<Pick<RAAppBlock, 'type' | 'mode' | 'content'>>().toEqualTypeOf<{
      type: 'html' | 'gui';
      mode: 'display' | 'interactive';
      content: string;
    }>();
    expectTypeOf<Pick<LLMStreamChunk, 'delta' | 'done' | 'sessionId' | 'messageId'>>().toEqualTypeOf<{
      delta: string;
      done: boolean;
      sessionId: ID;
      messageId: ID;
    }>();
    expectTypeOf<LLMConfig>().toEqualTypeOf<{
      provider: LLMProviderType;
      model: string;
      apiKey: string;
      baseUrl: string;
    }>();
    expectTypeOf<ToolTimeoutSettings>().toEqualTypeOf<{
      webSearchTimeoutMs: number;
      providerLocalTimeoutMs: number;
      providerRemoteTimeoutMs: number;
    }>();
    expectTypeOf<Pick<SocketEvents['chat:send'], 'sessionId' | 'content' | 'personaId'>>().toEqualTypeOf<{
      sessionId: ID;
      content: string;
      personaId: ID;
    }>();
  });
});
