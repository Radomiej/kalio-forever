import { describe, it, expect } from 'vitest';
import type {
  ID,
  Timestamp,
  LLMMessage,
  LLMStreamChunk,
  LLMToolCall,
  LLMConfig,
  LLMProviderType,
  Persona,
  PersonaKV,
  PersonaSessionConfig,
  CreatePersonaDto,
  UpdatePersonaDto,
  ChatMessage,
  ChatSession,
  CreateSessionDto,
  ToolMeta,
  ToolCallRequest,
  ToolResult,
  ToolConfirmationRequest,
  VFSFile,
  VFSWriteRequest,
  VFSReadResult,
  VFSListResult,
  Credential,
  CreateCredentialDto,
  MCPServer,
  MCPTool,
  RAAppBlock,
  RAAppResult,
  RAAppAction,
  SocketEvents,
} from '../index.js';

describe('@kalio/types — P0-T01 contract shape', () => {
  it('exports ID and Timestamp as string/number', () => {
    const id: ID = 'abc123';
    const ts: Timestamp = Date.now();
    expect(typeof id).toBe('string');
    expect(typeof ts).toBe('number');
  });

  it('ChatMessage has required fields', () => {
    const msg: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
    };
    expect(msg.id).toBeDefined();
    expect(msg.role).toBe('user');
  });

  it('ChatSession has required fields', () => {
    const session: ChatSession = {
      id: 'sess-1',
      personaId: 'persona-1',
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(session.personaId).toBeDefined();
  });

  it('Persona has skills array', () => {
    const persona: Persona = {
      id: 'p-1',
      name: 'Assistant',
      systemPrompt: 'You are helpful.',
      model: 'gpt-4o-mini',
      skills: ['vfs_write', 'web_search'],
      mcpPolicy: 'allow_all',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(Array.isArray(persona.skills)).toBe(true);
  });

  it('ToolMeta includes requiresConfirmation flag', () => {
    const tool: ToolMeta = {
      name: 'vfs_write',
      description: 'Write a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      requiresConfirmation: false,
    };
    expect(typeof tool.requiresConfirmation).toBe('boolean');
  });

  it('ToolResult has status union type', () => {
    const result: ToolResult = {
      callId: 'call-1',
      status: 'success',
      data: { written: true },
    };
    expect(['success', 'error', 'cancelled']).toContain(result.status);
  });

  it('ToolConfirmationRequest has timeoutMs', () => {
    const req: ToolConfirmationRequest = {
      requestId: 'req-1',
      sessionId: 'sess-1',
      toolName: 'rm_file',
      toolCallId: 'call-1',
      args: { path: '/foo.txt' },
      timeoutMs: 30000,
    };
    expect(req.timeoutMs).toBe(30000);
  });

  it('VFSWriteRequest has sessionId and filePath', () => {
    const req: VFSWriteRequest = {
      sessionId: 'sess-1',
      filePath: 'output.txt',
      content: 'hello world',
    };
    expect(req.sessionId).toBeDefined();
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

  it('MCPServer has status union', () => {
    const server: MCPServer = {
      id: 'mcp-1',
      name: 'My MCP',
      url: 'http://localhost:9000',
      status: 'connected',
      transport: 'stdio',
      createdAt: Date.now(),
    };
    expect(['connecting', 'connected', 'disconnected', 'error']).toContain(server.status);
  });

  it('RAAppBlock has type and mode', () => {
    const block: RAAppBlock = {
      type: 'html',
      mode: 'display',
      content: '<h1>Hello</h1>',
    };
    expect(block.type).toBe('html');
    expect(block.mode).toBe('display');
  });

  it('LLMStreamChunk has delta and done flag', () => {
    const chunk: LLMStreamChunk = {
      delta: 'Hello',
      done: false,
      sessionId: 'sess-1',
      messageId: 'msg-1',
    };
    expect(chunk.done).toBe(false);
  });

  it('LLMConfig has provider, model, apiKey, baseUrl', () => {
    const config: LLMConfig = {
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
    };
    expect(config.model).toBeDefined();
    expect(config.provider).toBeDefined();
  });

  it('SocketEvents chat:send has required fields', () => {
    type SendEvent = SocketEvents['chat:send'];
    const event: SendEvent = {
      sessionId: 's1',
      content: 'hi',
      personaId: 'p1',
    };
    expect(event.content).toBeDefined();
  });

  it('CreateCredentialDto has apiKey (write-only)', () => {
    const dto: CreateCredentialDto = {
      name: 'Test',
      provider: 'OpenRouter',
      apiKey: 'sk-test',
    };
    expect(dto.apiKey).toBeDefined();
  });
});
