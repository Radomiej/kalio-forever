# 🧪 Kalio v2 — TDD Build Plan & Agent Execution Guide

> **Version:** 0.1 | **Date:** 2026-04-21
> **Powiązane:** kalio-v2-mvp-spec.md
> **Zasada:** Żaden agent nie pisze kodu feature bez najpierw napisanego failującego testu.

---

## Zasady TDD dla agentów

```
RED   → napisz test który FAILUJE (opisuje oczekiwane zachowanie)
GREEN → napisz minimalny kod który test przechodzi
REFACTOR → uprość kod nie łamiąc testów
GATE  → uruchom pełny suite przed przejściem do kolejnej fazy
```

**Gate command po każdej fazie:**
```bash
turbo typecheck && turbo lint && turbo test && turbo build
```

Jeśli gate failuje → **STOP. Nie idź dalej.** Napraw zanim ruszysz do następnej fazy.

---

## Mapa faz (kolejność jest obligatoryjna)

```
PHASE 0: Monorepo scaffold + @kalio/types + Drizzle schema
    ↓
PHASE 1: LLMModule (MockProvider first — wszystkie e2e tego potrzebują)
    ↓
PHASE 2: ChatModule (sesje, historia, streaming gateway)
    ↓
PHASE 3: VFSModule (real filesystem, path traversal guard)
    ↓
PHASE 4: CredentialsModule (API keys w SQLite)
    ↓
PHASE 5: PersonaModule (persona CRUD, system prompt, skills, KV)
    ↓
PHASE 6: ToolModule (registry, dispatch, HITL gate)
    ↓
PHASE 7: RAAppModule (DSL executor, sandbox, display/interactive)
    ↓
PHASE 8: MCPModule (client manager, discovery, watchdog)
    ↓
PHASE 9: Frontend thin client (React + Zustand + Socket.IO)
    ↓
PHASE 10: E2E integration (Playwright, wszystkie 15 AC)
```

---

## PHASE 0 — Monorepo scaffold + @kalio/types + Drizzle schema

### Cel
Fundament bez którego żaden agent nie może zacząć. Turborepo pipeline + jedyny kontrakt typów + schemat bazy.

### Pliki do stworzenia
```
turbo.json
package.json (root)
pnpm-workspace.yaml
packages/@kalio/types/
  package.json
  src/index.ts          ← JEDYNY kontrakt
apps/kalio-api/
  package.json
  src/database/schema.ts
  src/config/env.schema.ts
apps/kalio-web/
  package.json
```

### TDD Tests — Phase 0

**P0-T01: @kalio/types eksportuje wszystkie wymagane interfejsy**
```typescript
// packages/@kalio/types/src/__tests__/contracts.test.ts
import type {
  ChatMessage, ChatSession, Persona, PersonaKV,
  Tool, ToolCall, ToolResult, ToolConfirmationRequest,
  VFSFile, VFSWriteRequest, VFSReadResult,
  MCPServer, MCPTool,
  RAAppBlock, RAAppMode,
  LLMProvider, LLMStreamChunk,
  Credential,
  SocketEvents
} from '../index';

describe('@kalio/types contracts', () => {
  it('exports ChatMessage with required fields', () => {
    const msg: ChatMessage = {
      id: '1', role: 'user', content: 'hello',
      sessionId: 's1', createdAt: new Date()
    };
    expect(msg.id).toBeDefined();
  });

  it('exports ToolConfirmationRequest with toolName and args', () => {
    const req: ToolConfirmationRequest = {
      toolName: 'vfs_delete', args: { path: '/test.txt' },
      requestId: 'r1', sessionId: 's1'
    };
    expect(req.toolName).toBe('vfs_delete');
  });

  it('exports RAAppMode as display | interactive', () => {
    const mode: RAAppMode = 'interactive';
    expect(['display', 'interactive']).toContain(mode);
  });

  it('exports SocketEvents with all required event names', () => {
    const events: (keyof SocketEvents)[] = [
      'chat:message', 'chat:chunk', 'chat:complete',
      'tool:confirmation_required', 'tool:confirm', 'tool:cancel',
      'tool:result', 'mcp:connected', 'mcp:disconnected'
    ];
    events.forEach(e => expect(e).toBeDefined());
  });
});
```

**P0-T02: Drizzle schema kompiluje się bez błędów**
```typescript
// apps/kalio-api/src/database/__tests__/schema.test.ts
import { db } from '../connection';
import { sessions, messages, personas, credentials, personaKV } from '../schema';

describe('Drizzle schema', () => {
  it('sessions table has required columns', () => {
    expect(sessions).toBeDefined();
    const cols = Object.keys(sessions);
    expect(cols).toContain('id');
    expect(cols).toContain('personaId');
    expect(cols).toContain('createdAt');
  });

  it('messages table references sessions', () => {
    expect(messages).toBeDefined();
  });

  it('credentials table exists', () => {
    expect(credentials).toBeDefined();
  });

  it('personaKV table exists with key/value columns', () => {
    expect(personaKV).toBeDefined();
  });
});
```

**P0-T03: Env validation rejects missing required vars**
```typescript
// apps/kalio-api/src/config/__tests__/env.test.ts
describe('Env validation', () => {
  it('throws on missing DATABASE_PATH', () => {
    const validate = () => validateEnv({ NODE_ENV: 'test' }); // missing DATABASE_PATH
    expect(validate).toThrow();
  });

  it('throws on missing WORKSPACE_ROOT', () => {
    const validate = () => validateEnv({
      NODE_ENV: 'test', DATABASE_PATH: './test.db'
      // missing WORKSPACE_ROOT
    });
    expect(validate).toThrow();
  });

  it('passes with all required vars', () => {
    const validate = () => validateEnv({
      NODE_ENV: 'test',
      DATABASE_PATH: './test.db',
      WORKSPACE_ROOT: './data/workspaces',
      LLM_API_KEY: 'test-key',
      LLM_BASE_URL: 'http://localhost',
      LLM_MODEL: 'test-model',
    });
    expect(validate).not.toThrow();
  });
});
```

**P0-T04: Turborepo build pipeline działa**
```bash
# Gate command — musi przejść zanim Phase 1 się zacznie
turbo typecheck  # zero errors
turbo lint       # zero errors
turbo test       # P0-T01, P0-T02, P0-T03 green
turbo build      # zero errors
```

### ✅ Phase 0 Gate
- [ ] `turbo typecheck` = 0 errors
- [ ] `@kalio/types` eksportuje wszystkie 15+ interfejsów
- [ ] Drizzle schema ma tabele: sessions, messages, personas, credentials, personaKV
- [ ] Env validation fail-fast działa
- [ ] `turbo build` = 0 errors

---

## PHASE 1 — LLMModule

### Cel
MockLLMProvider musi istnieć PRZED jakimkolwiek testem chatu. Bez tego żaden e2e nie ruszy bez prawdziwego API key.

### Pliki do stworzenia
```
apps/kalio-api/src/modules/llm/
  llm.module.ts
  llm.service.ts            ← provider routing
  providers/
    mock-llm.provider.ts    ← MUST be first
    openai-compatible.provider.ts
  interfaces/
    llm-provider.interface.ts
  __tests__/
    llm.service.spec.ts
    mock-provider.spec.ts
```

### TDD Tests — Phase 1

**P1-T01: MockLLMProvider streamuje chunki synchronicznie**
```typescript
// llm/providers/__tests__/mock-provider.spec.ts
import { MockLLMProvider } from '../mock-llm.provider';

describe('MockLLMProvider', () => {
  let provider: MockLLMProvider;

  beforeEach(() => { provider = new MockLLMProvider(); });

  it('streams chunks for given prompt', async () => {
    const chunks: string[] = [];
    await provider.streamComplete(
      [{ role: 'user', content: 'hello' }],
      (chunk) => chunks.push(chunk)
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toBeTruthy();
  });

  it('emits complete event after all chunks', async () => {
    let completed = false;
    await provider.streamComplete(
      [{ role: 'user', content: 'hello' }],
      () => {},
      () => { completed = true; }
    );
    expect(completed).toBe(true);
  });

  it('respects configured mock responses', async () => {
    provider.setMockResponse('test-prompt', 'mocked response');
    const chunks: string[] = [];
    await provider.streamComplete(
      [{ role: 'user', content: 'test-prompt' }],
      (chunk) => chunks.push(chunk)
    );
    expect(chunks.join('')).toBe('mocked response');
  });

  it('emits tool_call when mock configured with tool', async () => {
    provider.setMockToolCall('vfs_write', { path: '/test.txt', content: 'hello' });
    let toolCall: unknown = null;
    await provider.streamComplete(
      [{ role: 'user', content: 'write a file' }],
      () => {},
      () => {},
      (tc) => { toolCall = tc; }
    );
    expect(toolCall).toBeDefined();
    expect((toolCall as any).name).toBe('vfs_write');
  });
});
```

**P1-T02: LLMService wybiera providera na podstawie konfiguracji**
```typescript
// llm/__tests__/llm.service.spec.ts
import { Test } from '@nestjs/testing';
import { LLMService } from '../llm.service';
import { MockLLMProvider } from '../providers/mock-llm.provider';

describe('LLMService', () => {
  let service: LLMService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [LLMService, MockLLMProvider],
    }).compile();
    service = module.get(LLMService);
  });

  it('uses MockLLMProvider in test environment', () => {
    expect(service.getActiveProvider()).toBeInstanceOf(MockLLMProvider);
  });

  it('throws ProviderNotConfiguredError when no credentials', async () => {
    const noCredService = new LLMService(null); // no provider
    await expect(
      noCredService.streamComplete([], () => {})
    ).rejects.toThrow('ProviderNotConfiguredError');
  });

  it('streams complete response before resolving', async () => {
    const chunks: string[] = [];
    await service.streamComplete(
      [{ role: 'user', content: 'hello' }],
      (chunk) => chunks.push(chunk)
    );
    expect(chunks.length).toBeGreaterThan(0);
  });
});
```

**P1-T03: LLMModule is injectable in NestJS DI**
```typescript
// llm/__tests__/llm.module.spec.ts
import { Test } from '@nestjs/testing';
import { LLMModule } from '../llm.module';
import { LLMService } from '../llm.service';

describe('LLMModule', () => {
  it('provides LLMService', async () => {
    const module = await Test.createTestingModule({
      imports: [LLMModule],
    }).compile();
    const service = module.get(LLMService);
    expect(service).toBeDefined();
  });
});
```

### ✅ Phase 1 Gate
- [ ] MockLLMProvider: stream, complete callback, mock responses, mock tool_calls
- [ ] LLMService: provider selection, ProviderNotConfiguredError
- [ ] LLMModule injectable w DI
- [ ] 80%+ coverage dla llm/ module
- [ ] `turbo test` green

---

## PHASE 2 — ChatModule

### Cel
AC-01 (streaming <1s), AC-02 (brak credentials), AC-03 (historia po restarcie).

### Pliki do stworzenia
```
apps/kalio-api/src/modules/chat/
  chat.module.ts
  chat.service.ts           ← historia sesji, message persistence
  chat.gateway.ts           ← @WebSocketGateway — Socket.IO events
  repositories/
    session.repository.ts
    message.repository.ts
  __tests__/
    chat.service.spec.ts
    chat.gateway.spec.ts
    session.repository.spec.ts
```

### TDD Tests — Phase 2

**P2-T01: ChatService tworzy sesję i persystuje wiadomości (AC-03)**
```typescript
// chat/__tests__/chat.service.spec.ts
import { ChatService } from '../chat.service';
import { SessionRepository } from '../repositories/session.repository';
import { MessageRepository } from '../repositories/message.repository';

describe('ChatService', () => {
  let service: ChatService;
  let sessionRepo: SessionRepository;
  let messageRepo: MessageRepository;

  beforeEach(async () => { /* DI setup z test SQLite */ });

  it('creates a new session', async () => {
    const session = await service.createSession({ personaId: 'p1' });
    expect(session.id).toBeDefined();
    expect(session.personaId).toBe('p1');
  });

  it('persists messages to SQLite', async () => {
    const session = await service.createSession({ personaId: 'p1' });
    await service.addMessage({ sessionId: session.id, role: 'user', content: 'hello' });
    const messages = await service.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('hello');
  });

  it('returns messages in insertion order (AC-03)', async () => {
    const session = await service.createSession({ personaId: 'p1' });
    await service.addMessage({ sessionId: session.id, role: 'user', content: 'first' });
    await service.addMessage({ sessionId: session.id, role: 'assistant', content: 'second' });
    const messages = await service.getMessages(session.id);
    expect(messages[0].content).toBe('first');
    expect(messages[1].content).toBe('second');
  });

  it('loads session history after service restart (AC-03)', async () => {
    const session = await service.createSession({ personaId: 'p1' });
    await service.addMessage({ sessionId: session.id, role: 'user', content: 'persisted' });

    // simulate restart — new service instance, same DB
    const newService = new ChatService(sessionRepo, messageRepo);
    const messages = await newService.getMessages(session.id);
    expect(messages[0].content).toBe('persisted');
  });
});
```

**P2-T02: ChatGateway emituje chunks przez Socket.IO (AC-01)**
```typescript
// chat/__tests__/chat.gateway.spec.ts
import { Test } from '@nestjs/testing';
import { ChatGateway } from '../chat.gateway';
import { LLMModule } from '../../llm/llm.module';
import { MockLLMProvider } from '../../llm/providers/mock-llm.provider';
import { createMockSocket } from '../../../test-utils/mock-socket';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockProvider: MockLLMProvider;

  beforeEach(async () => { /* DI setup */ });

  it('emits chat:chunk events during streaming', async () => {
    const socket = createMockSocket();
    mockProvider.setMockResponse('hello', 'world response');

    await gateway.handleMessage(socket, {
      sessionId: 's1', content: 'hello'
    });

    const chunks = socket.emittedEvents.filter(e => e.event === 'chat:chunk');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('emits chat:complete after all chunks', async () => {
    const socket = createMockSocket();
    await gateway.handleMessage(socket, { sessionId: 's1', content: 'hello' });
    const complete = socket.emittedEvents.find(e => e.event === 'chat:complete');
    expect(complete).toBeDefined();
  });

  it('emits chat:error with PROVIDER_NOT_CONFIGURED when no credentials (AC-02)', async () => {
    const socket = createMockSocket();
    const gatewayNoProvider = new ChatGateway(null); // no LLM provider
    await gatewayNoProvider.handleMessage(socket, { sessionId: 's1', content: 'hello' });
    const error = socket.emittedEvents.find(e => e.event === 'chat:error');
    expect(error?.data?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('first chunk arrives within 1000ms (AC-01)', async () => {
    const socket = createMockSocket();
    const start = Date.now();
    let firstChunkTime: number | null = null;
    socket.onEmit('chat:chunk', () => {
      if (!firstChunkTime) firstChunkTime = Date.now() - start;
    });
    await gateway.handleMessage(socket, { sessionId: 's1', content: 'hello' });
    expect(firstChunkTime).toBeLessThan(1000);
  });
});
```

**P2-T03: SessionRepository CRUD**
```typescript
// chat/__tests__/session.repository.spec.ts
describe('SessionRepository', () => {
  it('creates session and returns with id', async () => { /* ... */ });
  it('finds session by id', async () => { /* ... */ });
  it('lists sessions ordered by createdAt desc', async () => { /* ... */ });
  it('returns null for non-existent session', async () => { /* ... */ });
});
```

### ✅ Phase 2 Gate
- [ ] AC-01: first chunk < 1000ms (unit test z Timer)
- [ ] AC-02: inline error PROVIDER_NOT_CONFIGURED przed LLM call
- [ ] AC-03: historia persystuje w SQLite, ładuje po restarcie serwisu
- [ ] ChatGateway emituje: chat:chunk, chat:complete, chat:error
- [ ] 80%+ coverage dla chat/ module

---

## PHASE 3 — VFSModule

### Cel
AC-04 (write na dysk), AC-05 (path traversal denied). To jest security-critical module.

### Pliki do stworzenia
```
apps/kalio-api/src/modules/vfs/
  vfs.module.ts
  vfs.service.ts
  guards/
    path-traversal.guard.ts   ← security-critical
  __tests__/
    vfs.service.spec.ts
    path-traversal.guard.spec.ts
```

### TDD Tests — Phase 3

**P3-T01: VFSService zapisuje plik na dysk (AC-04)**
```typescript
// vfs/__tests__/vfs.service.spec.ts
import { VFSService } from '../vfs.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('VFSService', () => {
  let service: VFSService;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalio-vfs-test-'));
    service = new VFSService({ workspaceRoot: tmpDir });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('writes file to correct path on disk (AC-04)', async () => {
    await service.write({
      conversationId: 'conv-123',
      filePath: 'output.txt',
      content: 'hello world'
    });
    const fullPath = path.join(tmpDir, 'conversations', 'conv-123', 'files', 'output.txt');
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath, 'utf8')).toBe('hello world');
  });

  it('reads file from correct path', async () => {
    await service.write({ conversationId: 'conv-1', filePath: 'data.json', content: '{"x":1}' });
    const result = await service.read({ conversationId: 'conv-1', filePath: 'data.json' });
    expect(result.content).toBe('{"x":1}');
  });

  it('lists files in conversation directory', async () => {
    await service.write({ conversationId: 'conv-1', filePath: 'a.txt', content: 'a' });
    await service.write({ conversationId: 'conv-1', filePath: 'b.txt', content: 'b' });
    const files = await service.list({ conversationId: 'conv-1' });
    expect(files.map(f => f.name)).toContain('a.txt');
    expect(files.map(f => f.name)).toContain('b.txt');
  });

  it('creates parent directories automatically', async () => {
    await service.write({
      conversationId: 'conv-1',
      filePath: 'nested/deep/file.txt',
      content: 'deep'
    });
    const fullPath = path.join(tmpDir, 'conversations', 'conv-1', 'files', 'nested', 'deep', 'file.txt');
    expect(fs.existsSync(fullPath)).toBe(true);
  });

  it('throws VFSFileNotFoundError for missing file', async () => {
    await expect(
      service.read({ conversationId: 'conv-1', filePath: 'missing.txt' })
    ).rejects.toThrow('VFSFileNotFoundError');
  });
});
```

**P3-T02: PathTraversalGuard blokuje wszystkie ataki (AC-05)**
```typescript
// vfs/__tests__/path-traversal.guard.spec.ts
import { PathTraversalGuard } from '../guards/path-traversal.guard';

describe('PathTraversalGuard — security critical', () => {
  const guard = new PathTraversalGuard('/data/workspaces');

  const SAFE_PATHS = [
    'output.txt',
    'nested/file.txt',
    'deeply/nested/path/file.json',
    'file-with-dashes_and_underscores.txt',
  ];

  const ATTACK_PATHS = [
    '../other-conversation/secret.txt',        // basic traversal
    '../../etc/passwd',                         // unix system file
    'nested/../../../etc/passwd',               // nested traversal
    './../secret',                              // dotslash
    '%2e%2e/secret',                            // URL encoded
    '%2e%2e%2fsecret',                          // URL encoded slash
    '..\\windows\\system32',                    // Windows style
    'valid/../../outside',                      // valid start, traversal end
    '\x00etc/passwd',                           // null byte injection
  ];

  SAFE_PATHS.forEach(p => {
    it(`allows safe path: ${p}`, () => {
      expect(() => guard.validate('conv-1', p)).not.toThrow();
    });
  });

  ATTACK_PATHS.forEach(p => {
    it(`blocks attack: ${p}`, () => {
      expect(() => guard.validate('conv-1', p)).toThrow('PATH_TRAVERSAL_DENIED');
    });
  });

  it('blocks write to another conversation directory (AC-05)', () => {
    expect(() => guard.validate('conv-1', '../conv-2/steal.txt')).toThrow('PATH_TRAVERSAL_DENIED');
  });

  it('resolved path stays within conversation root', () => {
    const safe = guard.resolve('conv-1', 'output.txt');
    expect(safe.startsWith('/data/workspaces/conversations/conv-1/')).toBe(true);
  });
});
```

### ✅ Phase 3 Gate
- [ ] AC-04: vfs_write tworzy plik w `{WORKSPACE_ROOT}/conversations/{id}/files/`
- [ ] AC-05: PATH_TRAVERSAL_DENIED dla wszystkich 9 attack patterns
- [ ] VFSService: write, read, list, delete, mkdir
- [ ] Auto-create parent directories
- [ ] 80%+ coverage, PathTraversalGuard 100% branch coverage

---

## PHASE 4 — CredentialsModule

### Cel
Bezpieczne przechowywanie API keys w SQLite. Blokada przed wyciekiem kluczy w logach/response.

### TDD Tests — Phase 4

**P4-T01: CredentialsService CRUD + no-leak**
```typescript
// credentials/__tests__/credentials.service.spec.ts
describe('CredentialsService', () => {
  it('stores credential and returns id (not the key)', async () => {
    const result = await service.create({
      name: 'CometAPI', apiKey: 'sk-secret-key', baseUrl: 'https://api.comet.ai'
    });
    expect(result.id).toBeDefined();
    expect(result).not.toHaveProperty('apiKey'); // never return raw key
  });

  it('retrieves credential for LLM use (internal only)', async () => {
    const id = (await service.create({ name: 'Test', apiKey: 'sk-123' })).id;
    const cred = await service.getForLLM(id);
    expect(cred.apiKey).toBe('sk-123'); // internal use only
  });

  it('lists credentials without exposing apiKey', async () => {
    await service.create({ name: 'Test', apiKey: 'sk-secret' });
    const list = await service.list();
    list.forEach(c => {
      expect(c).not.toHaveProperty('apiKey');
    });
  });

  it('apiKey never appears in serialized JSON response', async () => {
    const id = (await service.create({ name: 'Test', apiKey: 'sk-secret' })).id;
    const cred = await service.findById(id);
    const json = JSON.stringify(cred);
    expect(json).not.toContain('sk-secret');
  });

  it('deletes credential', async () => {
    const id = (await service.create({ name: 'Test', apiKey: 'sk-123' })).id;
    await service.delete(id);
    await expect(service.findById(id)).rejects.toThrow('CredentialNotFoundError');
  });
});
```

### ✅ Phase 4 Gate
- [ ] CRUD kompletny
- [ ] apiKey nigdy nie wycieka w list/findById responses
- [ ] getForLLM działa tylko internal (nie przez controller)
- [ ] 80%+ coverage

---

## PHASE 5 — PersonaModule

### Cel
AC-10 (system prompt + model per sesja), AC-11 (skills isolation).

### TDD Tests — Phase 5

**P5-T01: PersonaService CRUD + config**
```typescript
// persona/__tests__/persona.service.spec.ts
describe('PersonaService', () => {
  it('creates persona with systemPrompt and model', async () => {
    const persona = await service.create({
      name: 'Dev Assistant',
      systemPrompt: 'You are a senior developer.',
      model: 'claude-3-sonnet',
      skills: ['vfs_write', 'terminal_exec'],
    });
    expect(persona.id).toBeDefined();
    expect(persona.systemPrompt).toBe('You are a senior developer.');
  });

  it('getSessionConfig returns correct systemPrompt for session (AC-10)', async () => {
    const persona = await service.create({
      name: 'Test', systemPrompt: 'Be concise.', model: 'gpt-4o', skills: []
    });
    const config = await service.getSessionConfig(persona.id);
    expect(config.systemPrompt).toBe('Be concise.');
    expect(config.model).toBe('gpt-4o');
  });

  it('getAvailableSkills returns only persona skills (AC-11)', async () => {
    const persona = await service.create({
      name: 'Limited', systemPrompt: '', model: 'gpt-4o',
      skills: ['vfs_read', 'web_search'],
    });
    const skills = await service.getAvailableSkills(persona.id);
    expect(skills).toContain('vfs_read');
    expect(skills).toContain('web_search');
    expect(skills).not.toContain('terminal_exec'); // not assigned
    expect(skills).not.toContain('vfs_delete');    // not assigned
  });

  it('KV store per persona: set and get', async () => {
    const persona = await service.create({ name: 'KV Test', systemPrompt: '', model: '', skills: [] });
    await service.kv.set(persona.id, 'user_name', 'Radko');
    const val = await service.kv.get(persona.id, 'user_name');
    expect(val).toBe('Radko');
  });

  it('KV store isolated between personas', async () => {
    const p1 = await service.create({ name: 'P1', systemPrompt: '', model: '', skills: [] });
    const p2 = await service.create({ name: 'P2', systemPrompt: '', model: '', skills: [] });
    await service.kv.set(p1.id, 'secret', 'p1-value');
    const p2Val = await service.kv.get(p2.id, 'secret');
    expect(p2Val).toBeNull();
  });
});
```

### ✅ Phase 5 Gate
- [ ] AC-10: sessionConfig returns exact systemPrompt + model
- [ ] AC-11: getAvailableSkills returns only assigned skills
- [ ] KV store per persona, isolated
- [ ] CRUD kompletny (create, read, update, delete)
- [ ] 80%+ coverage

---

## PHASE 6 — ToolModule

### Cel
AC-06 (tool result <5s), AC-07 (unknown tool no crash), AC-08/09 (HITL gate).

### Pliki do stworzenia
```
apps/kalio-api/src/modules/tool/
  tool.module.ts
  tool.registry.ts          ← rejestruje wszystkie @Tool() klasy
  tool.dispatcher.ts        ← dispatch + HITL gate logic
  decorators/
    tool.decorator.ts       ← @Tool({ name, description, requiresConfirmation })
  tools/
    vfs-read.tool.ts
    vfs-write.tool.ts
    vfs-delete.tool.ts      ← requiresConfirmation: true
    web-search.tool.ts
    terminal-exec.tool.ts   ← requiresConfirmation: true
  __tests__/
    tool.registry.spec.ts
    tool.dispatcher.spec.ts
    hitl.gate.spec.ts
```

### TDD Tests — Phase 6

**P6-T01: ToolRegistry rejestruje i odnajduje narzędzia**
```typescript
// tool/__tests__/tool.registry.spec.ts
describe('ToolRegistry', () => {
  it('registers tool class and finds by name', () => {
    registry.register(VfsWriteTool);
    const tool = registry.find('vfs_write');
    expect(tool).toBeDefined();
  });

  it('returns TOOL_NOT_FOUND for unknown tool (AC-07)', () => {
    const result = registry.find('unknown_tool_xyz');
    expect(result).toBeNull();
  });

  it('lists all registered tools', () => {
    registry.register(VfsWriteTool);
    registry.register(WebSearchTool);
    expect(registry.list().length).toBeGreaterThanOrEqual(2);
  });

  it('filters tools by persona skills (AC-11 integration)', () => {
    registry.register(VfsWriteTool);   // skill: vfs_write
    registry.register(TerminalTool);   // skill: terminal_exec
    const personaTools = registry.listForSkills(['vfs_write']);
    expect(personaTools.map(t => t.name)).toContain('vfs_write');
    expect(personaTools.map(t => t.name)).not.toContain('terminal_exec');
  });
});
```

**P6-T02: ToolDispatcher wykonuje narzędzia i obsługuje błędy**
```typescript
// tool/__tests__/tool.dispatcher.spec.ts
describe('ToolDispatcher', () => {
  it('executes tool and returns result within 5s (AC-06)', async () => {
    const start = Date.now();
    const result = await dispatcher.execute({
      sessionId: 's1',
      toolName: 'vfs_read',
      args: { conversationId: 'conv-1', filePath: 'test.txt' }
    });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.status).toBe('success');
  });

  it('returns TOOL_NOT_FOUND without throwing (AC-07)', async () => {
    const result = await dispatcher.execute({
      sessionId: 's1', toolName: 'nonexistent_tool', args: {}
    });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('TOOL_NOT_FOUND');
    // session continues — no exception propagated
  });

  it('surfaces tool execution errors as tool_result errors', async () => {
    // VFS read on non-existent file
    const result = await dispatcher.execute({
      sessionId: 's1',
      toolName: 'vfs_read',
      args: { conversationId: 'conv-1', filePath: 'does-not-exist.txt' }
    });
    expect(result.status).toBe('error');
    expect(result.errorCode).toBe('VFSFileNotFoundError');
  });
});
```

**P6-T03: HITL Gate — confirmation flow (AC-08, AC-09)**
```typescript
// tool/__tests__/hitl.gate.spec.ts
describe('HITL Gate', () => {
  it('emits tool:confirmation_required for destructive tools (AC-08)', async () => {
    const socket = createMockSocket();
    dispatcher.setSocket(socket);

    // Start execution — should NOT complete yet
    const execPromise = dispatcher.execute({
      sessionId: 's1', toolName: 'vfs_delete',
      args: { conversationId: 'c1', filePath: 'file.txt' }
    });

    // Should have emitted confirmation request
    const req = socket.emittedEvents.find(e => e.event === 'tool:confirmation_required');
    expect(req).toBeDefined();
    expect(req.data.toolName).toBe('vfs_delete');
    expect(req.data.requestId).toBeDefined();

    // Tool should NOT have executed yet
    expect(socket.emittedEvents.find(e => e.event === 'tool:result')).toBeUndefined();

    // Cleanup
    dispatcher.cancel(req.data.requestId);
    await execPromise;
  });

  it('executes tool after confirm signal (AC-08)', async () => {
    const socket = createMockSocket();
    dispatcher.setSocket(socket);

    const execPromise = dispatcher.execute({
      sessionId: 's1', toolName: 'vfs_delete',
      args: { conversationId: 'c1', filePath: 'file.txt' }
    });

    const req = socket.emittedEvents.find(e => e.event === 'tool:confirmation_required');
    // User confirms
    await dispatcher.confirm(req.data.requestId);
    const result = await execPromise;
    expect(result.status).not.toBe('cancelled');
  });

  it('returns TOOL_CANCELLED after cancel signal (AC-09)', async () => {
    const socket = createMockSocket();
    dispatcher.setSocket(socket);

    const execPromise = dispatcher.execute({
      sessionId: 's1', toolName: 'vfs_delete',
      args: { conversationId: 'c1', filePath: 'file.txt' }
    });

    const req = socket.emittedEvents.find(e => e.event === 'tool:confirmation_required');
    // User cancels
    await dispatcher.cancel(req.data.requestId);
    const result = await execPromise;
    expect(result.status).toBe('cancelled');
    expect(result.errorCode).toBe('TOOL_CANCELLED');
  });

  it('non-destructive tools execute without confirmation', async () => {
    const socket = createMockSocket();
    dispatcher.setSocket(socket);

    await dispatcher.execute({
      sessionId: 's1', toolName: 'vfs_read',
      args: { conversationId: 'c1', filePath: 'test.txt' }
    });

    // No confirmation event emitted
    const req = socket.emittedEvents.find(e => e.event === 'tool:confirmation_required');
    expect(req).toBeUndefined();
  });

  it('HITL request times out after 30s if no response', async () => {
    // Test with fake timers
    vi.useFakeTimers();
    const socket = createMockSocket();
    dispatcher.setSocket(socket);

    const execPromise = dispatcher.execute({
      sessionId: 's1', toolName: 'vfs_delete', args: {}
    });

    vi.advanceTimersByTime(31000);
    const result = await execPromise;
    expect(result.errorCode).toBe('HITL_TIMEOUT');
    vi.useRealTimers();
  });
});
```

### ✅ Phase 6 Gate
- [ ] AC-06: tool result w <5s
- [ ] AC-07: unknown tool → error result, sesja nie crashuje
- [ ] AC-08: tool:confirmation_required przed wykonaniem destructive tool
- [ ] AC-09: cancel → TOOL_CANCELLED, tool nie wykonał się
- [ ] Non-destructive tools auto-execute bez dialoga
- [ ] HITL timeout po 30s
- [ ] 80%+ coverage

---

## PHASE 7 — RAAppModule

### Cel
AC-12 (html render bez CSP errors), AC-13 (DSL error inline, sesja nie przerywa).

### TDD Tests — Phase 7

**P7-T01: RAApp DSL parser i executor**
```typescript
// raapp/__tests__/raapp.service.spec.ts
describe('RAAppService', () => {
  it('parses valid html block', () => {
    const block = service.parse({
      type: 'html',
      mode: 'display',
      content: '<h1>Hello</h1>'
    });
    expect(block.type).toBe('html');
    expect(block.mode).toBe('display');
  });

  it('returns ParseError for invalid DSL (AC-13)', () => {
    const result = service.parse('{ invalid json }}}');
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('DSL_PARSE_ERROR');
    // No exception thrown — error is a value
  });

  it('executes display block in sandbox', async () => {
    const result = await service.execute({
      type: 'html', mode: 'display', content: '<p>test</p>'
    }, { sessionId: 's1', conversationId: 'c1' });
    expect(result.status).toBe('ready');
    expect(result.renderedContent).toBeDefined();
  });

  it('interactive block emits tool:confirmation_required for actions', async () => {
    const block = {
      type: 'html', mode: 'interactive',
      actions: [{ label: 'Delete file', tool: 'vfs_delete', args: { filePath: 'x.txt' } }],
      content: '<button data-action="0">Delete</button>'
    };
    const result = await service.execute(block, { sessionId: 's1', conversationId: 'c1' });
    expect(result.requiresHTIL).toBe(true); // interactive mode flagged
  });

  it('sandbox prevents access to node globals', async () => {
    const malicious = {
      type: 'html', mode: 'display',
      content: '<script>require("fs").unlinkSync("/etc/passwd")</script>'
    };
    const result = await service.execute(malicious, { sessionId: 's1', conversationId: 'c1' });
    // Should render but script execution isolated/stripped
    expect(result.status).toBe('ready');
  });
});
```

**P7-T02: RAApp DSL types**
```typescript
describe('RAAppDSL types', () => {
  it('accepts all v1-compatible types', () => {
    const types: RAAppBlock['type'][] = ['html', 'gui'];
    types.forEach(t => expect(t).toBeDefined());
  });

  it('display mode has no interactive actions', () => {
    const block: RAAppBlock = { type: 'html', mode: 'display', content: '<p/>' };
    expect(block.mode).toBe('display');
  });

  it('interactive mode accepts actions array', () => {
    const block: RAAppBlock = {
      type: 'html', mode: 'interactive',
      content: '<p/>',
      actions: [{ label: 'Submit', tool: 'vfs_write', args: {} }]
    };
    expect(block.actions).toHaveLength(1);
  });
});
```

### ✅ Phase 7 Gate
- [ ] AC-12: html block parsed + ready status (CSP test w e2e Phase 10)
- [ ] AC-13: DSL error = error value (nie exception), sesja kontynuuje
- [ ] display vs interactive mode działa
- [ ] Sandbox wykonuje bez dostępu do node globals
- [ ] 80%+ coverage

---

## PHASE 8 — MCPModule

### Cel
AC-14 (hot-add bez restartu), AC-15 (server down → graceful).

### TDD Tests — Phase 8

**P8-T01: MCPClientManager lifecycle**
```typescript
// mcp/__tests__/mcp.service.spec.ts
describe('MCPClientManager', () => {
  it('connects to MCP server and discovers tools (AC-14)', async () => {
    const mockMCPServer = createMockMCPServer([
      { name: 'email_send', description: 'Send email', requiresConfirmation: true }
    ]);

    await manager.connect({ url: mockMCPServer.url, name: 'test-mcp' });
    const tools = manager.getAvailableTools();
    expect(tools.map(t => t.name)).toContain('email_send');
  });

  it('tools available immediately without restart (AC-14)', async () => {
    // Connect after module init — tools available same session
    const mockServer = createMockMCPServer([{ name: 'new_tool', description: '' }]);
    await manager.connect({ url: mockServer.url, name: 'live-mcp' });
    expect(manager.isToolAvailable('new_tool')).toBe(true);
  });

  it('returns MCP_SERVER_UNAVAILABLE when server down (AC-15)', async () => {
    await manager.connect({ url: 'http://dead-server:9999', name: 'dead-mcp' });
    const result = await manager.executeTool('dead-server::some_tool', {});
    expect(result.errorCode).toBe('MCP_SERVER_UNAVAILABLE');
  });

  it('other tools work when one MCP server fails (AC-15)', async () => {
    const goodServer = createMockMCPServer([{ name: 'good_tool', description: '' }]);
    await manager.connect({ url: goodServer.url, name: 'good-mcp' });
    await manager.connect({ url: 'http://dead:9999', name: 'dead-mcp' });

    // good_tool still works
    const result = await manager.executeTool('good_tool', {});
    expect(result.status).not.toBe('unavailable');
  });

  it('watchdog reconnects after server recovers', async () => {
    vi.useFakeTimers();
    const server = createMockMCPServer([]);
    await manager.connect({ url: server.url, name: 'test' });

    server.shutdown();
    expect(manager.getServerStatus('test')).toBe('disconnected');

    server.restart();
    vi.advanceTimersByTime(10000); // watchdog interval
    expect(manager.getServerStatus('test')).toBe('connected');
    vi.useRealTimers();
  });
});
```

### ✅ Phase 8 Gate
- [ ] AC-14: connect → tools available immediately, no restart
- [ ] AC-15: dead server → MCP_SERVER_UNAVAILABLE, innych tools nie dotyka
- [ ] Watchdog reconnect działa
- [ ] 80%+ coverage

---

## PHASE 9 — Frontend thin client

### Cel
FE jest thin — ZERO logiki domenowej. Tylko Socket.IO listener + render.

### Zasady dla agenta
```
❌ NIE implementuj logiki w komponentach React
❌ NIE wywołuj LLM z FE
❌ NIE implementuj tool execution logic w FE
✅ Zustand store = tylko UI state (loading, messages dla render)
✅ Wszystkie dane przychodzą z BE przez Socket.IO events
✅ Komponent = map over store state → JSX
```

### TDD Tests — Phase 9

**P9-T01: ChatStore obsługuje socket events**
```typescript
// store/__tests__/chatStore.test.ts
describe('chatStore', () => {
  it('adds chunk to active message on chat:chunk', () => {
    const { handleChunk } = useChatStore.getState();
    handleChunk({ sessionId: 's1', messageId: 'm1', chunk: 'Hello' });
    handleChunk({ sessionId: 's1', messageId: 'm1', chunk: ' World' });
    const msg = useChatStore.getState().getStreamingMessage('m1');
    expect(msg?.content).toBe('Hello World');
  });

  it('finalizes message on chat:complete', () => {
    const { handleChunk, handleComplete } = useChatStore.getState();
    handleChunk({ sessionId: 's1', messageId: 'm1', chunk: 'Final' });
    handleComplete({ sessionId: 's1', messageId: 'm1' });
    const msg = useChatStore.getState().getMessage('m1');
    expect(msg?.streaming).toBe(false);
  });

  it('sets error state on chat:error', () => {
    useChatStore.getState().handleError({ code: 'PROVIDER_NOT_CONFIGURED', message: 'No key' });
    expect(useChatStore.getState().error?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('shows HITL dialog on tool:confirmation_required', () => {
    useChatStore.getState().handleConfirmationRequired({
      requestId: 'r1', toolName: 'vfs_delete', args: { path: '/test.txt' }, sessionId: 's1'
    });
    expect(useChatStore.getState().pendingConfirmation?.toolName).toBe('vfs_delete');
  });
});
```

**P9-T02: Components są thin (snapshot tests)**
```typescript
// Każdy komponent: render test bez business logic
describe('ChatMessage component', () => {
  it('renders streaming message with cursor', () => {
    const { container } = render(
      <ChatMessage message={{ id: 'm1', content: 'Hello', streaming: true, role: 'assistant' }} />
    );
    expect(container.querySelector('.streaming-cursor')).toBeTruthy();
  });

  it('renders tool confirmation dialog when pending', () => {
    const { getByText } = render(
      <ToolConfirmationDialog
        toolName="vfs_delete"
        args={{ path: '/file.txt' }}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(getByText(/vfs_delete/)).toBeTruthy();
    expect(getByText(/Potwierdź/)).toBeTruthy();
    expect(getByText(/Anuluj/)).toBeTruthy();
  });
});
```

### ✅ Phase 9 Gate
- [ ] Zustand stores obsługują wszystkie Socket events z BE
- [ ] Zero business logic w komponentach
- [ ] HITL dialog renderuje się z toolName + args
- [ ] ChatInput → emit socket event (nie direct function call)
- [ ] `turbo build` dla kalio-web = 0 errors

---

## PHASE 10 — E2E Integration (Playwright)

### Cel
Wszystkie 15 AC z MVP Spec przechodzą w Playwright. To jest **final gate** przed sign-off.

### Setup
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    baseURL: 'http://localhost:5187',
    // MockLLMProvider aktywny przez env var TEST_MODE=true
  },
  webServer: [
    { command: 'turbo dev --filter=kalio-api', port: 3015, env: { TEST_MODE: 'true' } },
    { command: 'turbo dev --filter=kalio-web', port: 5187 }
  ]
});
```

### E2E Tests — wszystkie 15 AC

**E2E-AC01: LLM streaming chunk <1s**
```typescript
test('AC-01: first chunk arrives within 1000ms', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'hello');

  let firstChunkTime: number | null = null;
  page.on('console', msg => {
    if (msg.text().includes('chat:chunk') && !firstChunkTime) {
      firstChunkTime = Date.now();
    }
  });

  const sendTime = Date.now();
  await page.click('[data-testid="send-button"]');
  await page.waitForSelector('[data-testid="streaming-message"]');

  expect(Date.now() - sendTime).toBeLessThan(1000);
});
```

**E2E-AC02: Brak credentials → inline error**
```typescript
test('AC-02: no credentials shows inline error before LLM call', async ({ page }) => {
  // Setup: no credentials configured
  await page.goto('/settings/credentials');
  // ensure no credentials exist

  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'hello');
  await page.click('[data-testid="send-button"]');

  await page.waitForSelector('[data-testid="chat-error"]');
  const errorText = await page.textContent('[data-testid="chat-error"]');
  expect(errorText).toContain('Brak konfiguracji providera');
  // Ensure no LLM call was made (MockLLMProvider call count = 0)
});
```

**E2E-AC03: Historia sesji po restarcie**
```typescript
test('AC-03: session history survives restart', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'remember this message');
  await page.click('[data-testid="send-button"]');
  await page.waitForSelector('[data-testid="message-complete"]');

  const sessionId = await page.getAttribute('[data-testid="session-id"]', 'data-value');

  // Simulate page refresh (BE restart simulated by TEST_MODE reconnect)
  await page.reload();
  await page.goto(`/sessions/${sessionId}`);
  await page.waitForSelector('[data-testid="chat-message"]');

  const messages = await page.$$('[data-testid="chat-message"]');
  expect(messages.length).toBeGreaterThan(0);
  const firstMsg = await messages[0].textContent();
  expect(firstMsg).toContain('remember this message');
});
```

**E2E-AC04 + AC05: VFS**
```typescript
test('AC-04: agent writes file to disk via vfs_write', async ({ page }) => {
  // MockLLMProvider configured to return vfs_write tool call
  await setupMockLLM('write hello to test.txt', {
    toolCall: { name: 'vfs_write', args: { filePath: 'test.txt', content: 'hello' } }
  });

  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'write hello to test.txt');
  await page.click('[data-testid="send-button"]');
  await page.waitForSelector('[data-testid="tool-result-vfs_write"]');

  // Verify via API
  const res = await fetch(`http://localhost:3015/api/test/vfs/${testConversationId}/test.txt`);
  const body = await res.json();
  expect(body.content).toBe('hello');
});
```

**E2E-AC08 + AC09: HITL confirmation**
```typescript
test('AC-08+09: HITL dialog appears for destructive tool', async ({ page }) => {
  await setupMockLLM('delete test.txt', {
    toolCall: { name: 'vfs_delete', args: { filePath: 'test.txt' } }
  });

  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'delete test.txt');
  await page.click('[data-testid="send-button"]');

  // Dialog appears
  await page.waitForSelector('[data-testid="hitl-dialog"]');
  expect(await page.textContent('[data-testid="hitl-tool-name"]')).toContain('vfs_delete');

  // AC-09: cancel
  await page.click('[data-testid="hitl-cancel"]');
  await page.waitForSelector('[data-testid="tool-cancelled"]');
  const cancelMsg = await page.textContent('[data-testid="tool-cancelled"]');
  expect(cancelMsg).toContain('TOOL_CANCELLED');
});
```

**E2E-AC12: RA-App render bez CSP errors**
```typescript
test('AC-12: html block renders without CSP errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await setupMockLLM('show a hello world page', {
    raapp: { type: 'html', mode: 'display', content: '<h1>Hello World</h1>' }
  });

  await page.goto('/');
  await page.fill('[data-testid="chat-input"]', 'show a hello world page');
  await page.click('[data-testid="send-button"]');

  await page.waitForSelector('[data-testid="raapp-iframe"]');

  const cspErrors = consoleErrors.filter(e => e.includes('Content Security Policy'));
  expect(cspErrors).toHaveLength(0);
});
```

**E2E-AC14: MCP hot-add**
```typescript
test('AC-14: MCP tools available without restart', async ({ page }) => {
  await page.goto('/settings/mcp');

  // Add MCP server
  await page.fill('[data-testid="mcp-url-input"]', 'http://localhost:9999/mcp-test');
  await page.click('[data-testid="mcp-connect"]');
  await page.waitForSelector('[data-testid="mcp-connected"]');

  // Navigate to chat — new tools available
  await page.goto('/');
  const toolList = await page.$$('[data-testid="available-tool"]');
  const toolNames = await Promise.all(toolList.map(t => t.getAttribute('data-tool-name')));
  expect(toolNames).toContain('mcp_test_tool');
});
```

### ✅ Phase 10 Gate (FINAL)
- [ ] AC-01 ✅ first chunk <1s
- [ ] AC-02 ✅ inline error przed LLM call
- [ ] AC-03 ✅ historia po restarcie
- [ ] AC-04 ✅ vfs_write na dysk
- [ ] AC-05 ✅ path traversal blocked (unit, nie e2e)
- [ ] AC-06 ✅ tool result <5s
- [ ] AC-07 ✅ unknown tool no crash (unit)
- [ ] AC-08 ✅ HITL dialog
- [ ] AC-09 ✅ HITL cancel
- [ ] AC-10 ✅ persona system prompt
- [ ] AC-11 ✅ persona skills isolation (unit)
- [ ] AC-12 ✅ RA-App bez CSP errors
- [ ] AC-13 ✅ DSL error inline (unit)
- [ ] AC-14 ✅ MCP hot-add
- [ ] AC-15 ✅ MCP server down graceful (unit)

```bash
# FINAL GATE — wszystkie muszą być green
turbo typecheck  # 0 errors
turbo lint       # 0 errors
turbo test       # 80%+ coverage wszystkich modułów
turbo test:e2e   # 15/15 AC
turbo build      # 0 errors
```

---

## Podsumowanie: Test count per phase

| Phase | Unit tests | E2E | AC coverage |
|---|---|---|---|
| 0 — Scaffold | 3 | 0 | P0-T01–T04 |
| 1 — LLMModule | 8 | 0 | — |
| 2 — ChatModule | 10 | 0 | AC-01, AC-02, AC-03 |
| 3 — VFSModule | 8 + 9 security | 0 | AC-04, AC-05 |
| 4 — CredentialsModule | 5 | 0 | — |
| 5 — PersonaModule | 6 | 0 | AC-10, AC-11 |
| 6 — ToolModule | 12 | 0 | AC-06, AC-07, AC-08, AC-09 |
| 7 — RAAppModule | 7 | 0 | AC-12, AC-13 |
| 8 — MCPModule | 5 | 0 | AC-14, AC-15 |
| 9 — Frontend | 8 | 0 | HITL UI, stores |
| 10 — E2E | 0 | 15 | Wszystkie 15 AC |
| **TOTAL** | **~81** | **15** | **15/15 AC** |

---

## Agent handoff checklist

Przed przekazaniem do agenta coding:

- [ ] Ten dokument + kalio-v2-mvp-spec.md w repozytorium
- [ ] `TEST_MODE=true` env var aktywuje MockLLMProvider
- [ ] Mock MCP server dostępny dla Phase 8 testów
- [ ] `turbo.json` ma pipeline: `test → typecheck → lint → build`
- [ ] ESLint rule `import/no-restricted-paths` skonfigurowany dla module boundaries
- [ ] Playwright `data-testid` lista uzgodniona z FE przed Phase 10
