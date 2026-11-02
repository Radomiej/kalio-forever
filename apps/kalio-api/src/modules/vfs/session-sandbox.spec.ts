import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { sessions } from '../../database/schema';
import type { DrizzleService } from '../../database/drizzle.service';
import { VFSService } from './vfs.service';
import { FsListTool } from '../tool/tools/fs-list.tool';
import { FsReadTool } from '../tool/tools/fs-read.tool';
import { FsWriteTool } from '../tool/tools/fs-write.tool';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { SessionManagerService } from '../chat/session-manager.service';
import { readExecutionCwd } from '../chat/chat-input.helpers';
import { ContextAssemblyService } from '../chat/context-assembly.service';
import { FileSearchTool, GrepSearchTool } from '../tool/tools/file-search.tools';
import { ChatService } from '../chat/chat.service';

describe('durable no-project session sandbox', () => {
  let temp: string;
  let client: Database.Database;
  let database: DrizzleService;
  let vfs: VFSService;
  let allowed: AllowedPathsService;
  const request = (toolName: string, path: string, sessionId = 'chat-1'): ToolCallRequest => ({
    callId: 'call-1', sessionId, toolName, args: { path, content: 'sandbox content' },
  });
  const open = () => {
    client = new Database(join(temp, 'sessions.db'));
    database = { db: drizzle(client) } as unknown as DrizzleService;
    vfs = new VFSService(new ConfigService({ WORKSPACE_ROOT: join(temp, 'workspaces') }), database);
  };
  const root = () => realpathSync(join(temp, 'workspaces', 'sessions', 'chat-1', 'files'));

  beforeEach(() => {
    temp = mkdtempSync(join(tmpdir(), 'kalio-session-sandbox-'));
    open();
    client.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, persona_id TEXT NOT NULL, title TEXT NOT NULL, kind TEXT,
      parent_session_id TEXT, parent_turn_id TEXT, parent_tool_call_id TEXT,
      project_id TEXT, execution_profile_id TEXT, external_thread_id TEXT,
      toolset_fingerprint TEXT, policy_fingerprint TEXT, runtime_binding_version INTEGER,
      runtime_context TEXT, archived_at INTEGER, created_at INTEGER, updated_at INTEGER
    )`);
    database.db.insert(sessions).values({
      id: 'chat-1', personaId: 'default', title: 'New Chat', projectId: 'system:none',
      createdAt: new Date(), updatedAt: new Date(),
    }).run();
    allowed = { isAllowed: vi.fn().mockResolvedValue(true), ensurePath: vi.fn() } as unknown as AllowedPathsService;
  });

  afterEach(() => {
    client.close();
    rmSync(temp, { recursive: true, force: true });
  });

  it('creates a sandbox before a durable turn, supplies provider cwd and prompt, and reuses it after reload/restart', async () => {
    expect(existsSync(join(temp, 'workspaces', 'sessions', 'chat-1', 'files'))).toBe(false);
    const manager = new SessionManagerService(
      { ensureSession: vi.fn().mockResolvedValue(undefined) } as never,
      {} as never, {} as never, {} as never, vfs,
    );
    await manager.ensureSession('chat-1', 'default');
    const first = await database.db.select().from(sessions).where(eq(sessions.id, 'chat-1')).get();
    expect(readExecutionCwd(first?.runtimeContext ?? undefined)).toBe(root());
    expect(first?.runtimeContext?.architectureContext?.['projectPath']).toBeUndefined();
    const assembly = new ContextAssemblyService(
      { getSessionConfig: vi.fn().mockResolvedValue(null) } as never,
      {} as never,
      { decide: vi.fn().mockResolvedValue({ tools: [], warnings: [] }) } as never,
    );
    const prompt = await assembly.assembleForSessionRuntime('default', first!.runtimeContext!);
    expect(prompt.effectiveSystemPrompt).toContain(`Execution working directory: ${root()}`);
    expect(prompt.effectiveSystemPrompt).toContain('session sandbox as the default root');
    vfs.writeFile({ sessionId: 'chat-1', filePath: 'saved.txt', content: 'durable' });
    const cwd = root();
    client.close();
    open();
    await vfs.prepareSessionSandbox('chat-1');
    const restored = database.db.select().from(sessions).where(eq(sessions.id, 'chat-1')).get();
    expect(readExecutionCwd(restored?.runtimeContext ?? undefined)).toBe(cwd);
    expect(vfs.readFile('chat-1', 'saved.txt').content).toBe('durable');
  });

  it('resolves relative fs_list/read/write inside its sandbox without global allowed paths', async () => {
    await vfs.prepareSessionSandbox('chat-1');
    await new FsWriteTool(allowed, vfs).execute(request('fs_write', 'nested/note.txt'));
    const listing = await new FsListTool(allowed, vfs).execute(request('fs_list', '.'));
    expect(listing.path).toBe(root());
    expect(listing.entries).toContainEqual({ path: 'nested', type: 'directory' });
    const nested = await new FsListTool(allowed, vfs).execute(request('fs_list', 'nested'));
    expect(nested.entries[0]?.path).toBe('note.txt');
    expect((await new FsReadTool(allowed, vfs).execute(request('fs_read', 'nested/note.txt'))).content).toBe('sandbox content');
    expect((await new FsListTool(allowed, vfs).execute(request('fs_list', root()))).path).toBe(root());
    expect(allowed.isAllowed).not.toHaveBeenCalled();
    expect(allowed.ensurePath).not.toHaveBeenCalled();
  });

  it('denies traversal, server cwd, other session sandboxes and missing sessions even with broad global access', async () => {
    await vfs.prepareSessionSandbox('chat-1');
    const sibling = vfs.ensureSessionSandbox('chat-2');
    for (const path of ['..', '../..', '..\\..', sibling, process.cwd()]) {
      for (const [name, tool] of [
        ['fs_list', new FsListTool(allowed, vfs)],
        ['fs_read', new FsReadTool(allowed, vfs)],
        ['fs_write', new FsWriteTool(allowed, vfs)],
      ] as const) await expect(tool.execute(request(name, path))).rejects.toThrow('ACCESS_DENIED');
    }
    await expect(new FsListTool(allowed, vfs).execute(request('fs_list', '.', 'missing'))).rejects.toThrow('SESSION_NOT_FOUND');
  });

  it('rejects junction escapes for reads, missing write descendants and recursive listings', async () => {
    await vfs.prepareSessionSandbox('chat-1');
    const outside = join(temp, 'server');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'server secret');
    symlinkSync(outside, join(root(), 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(new FsReadTool(allowed, vfs).execute(request('fs_read', 'escape/secret.txt'))).rejects.toThrow('ACCESS_DENIED');
    await expect(new FsWriteTool(allowed, vfs).execute(request('fs_write', 'escape/new/note.txt'))).rejects.toThrow('ACCESS_DENIED');
    const recursive = request('fs_list', '.');
    recursive.args['recursive'] = true;
    await expect(new FsListTool(allowed, vfs).execute(recursive)).rejects.toThrow('ACCESS_DENIED');
  });

  it('repairs stale server context without trusting persisted projectPath or cwd', async () => {
    database.db.update(sessions).set({ runtimeContext: {
      runtimeKind: 'chat', architectureContext: { projectPath: process.cwd(), executionCwd: process.cwd(), preserved: true },
    } }).where(eq(sessions.id, 'chat-1')).run();
    await vfs.prepareSessionSandbox('chat-1');
    const row = database.db.select().from(sessions).where(eq(sessions.id, 'chat-1')).get();
    expect(row?.runtimeContext?.architectureContext).toEqual({ executionCwd: root(), preserved: true });
  });

  it('confines search defaults and explicit scopes to the sandbox even when global access is broad', async () => {
    await vfs.prepareSessionSandbox('chat-1');
    vfs.writeFile({ sessionId: 'chat-1', filePath: 'note.txt', content: 'unique sandbox text' });
    const files = new FileSearchTool(allowed, database, vfs);
    const grep = new GrepSearchTool(allowed, database, vfs);
    const fileRequest = request('file_search', '.');
    fileRequest.args = { pattern: '**/*.txt' };
    expect((await files.execute(fileRequest)).files).toEqual([join(root(), 'note.txt')]);
    const grepRequest = request('grep_search', '.');
    grepRequest.args = { query: 'unique sandbox' };
    expect((await grep.execute(grepRequest)).matches[0]?.text).toBe('unique sandbox text');
    for (const path of ['..', process.cwd(), vfs.ensureSessionSandbox('chat-2')]) {
      await expect(files.execute({ ...fileRequest, args: { ...fileRequest.args, path } })).rejects.toThrow('ACCESS_DENIED');
      await expect(grep.execute({ ...grepRequest, args: { ...grepRequest.args, workdir: path } })).rejects.toThrow('ACCESS_DENIED');
    }
    expect(allowed.isAllowed).not.toHaveBeenCalled();
  });

  it('rejects redirected sandbox roots and VFS junction escapes', async () => {
    await vfs.prepareSessionSandbox('chat-1');
    const sibling = vfs.ensureSessionSandbox('chat-2');
    symlinkSync(sibling, join(root(), 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => vfs.writeFile({ sessionId: 'chat-1', filePath: 'escape/new.txt', content: 'escape' })).toThrow('ACCESS_DENIED');
    expect(() => vfs.listFiles('chat-1')).toThrow('ACCESS_DENIED');
    rmSync(root(), { recursive: true, force: true });
    symlinkSync(sibling, join(temp, 'workspaces', 'sessions', 'chat-1', 'files'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(vfs.prepareSessionSandbox('chat-1')).rejects.toThrow('ACCESS_DENIED');
    expect(() => vfs.listFiles('chat-1')).toThrow('ACCESS_DENIED');
  });

  it('passes the durable sandbox cwd and prompt through ChatService on first turn and session reuse', async () => {
    const repo = {
      ensureSession: vi.fn().mockResolvedValue(undefined), saveMessage: vi.fn().mockResolvedValue(undefined),
    };
    const manager = new SessionManagerService(repo as never, {} as never, {} as never, {} as never, vfs);
    const assembly = new ContextAssemblyService(
      { getSessionConfig: vi.fn().mockResolvedValue(null) } as never, {} as never,
      { decide: vi.fn().mockResolvedValue({ tools: [], warnings: [] }) } as never,
    );
    const runAgentLoop = vi.fn().mockResolvedValue({ finalText: 'done', lastMessageId: 'answer' });
    const service = new ChatService(
      manager, { getMaxToolAttempts: async () => 5 } as never, { log: vi.fn() } as never,
      { runAgentLoop } as never, {} as never,
      { get: async (id: string) => database.db.select().from(sessions).where(eq(sessions.id, id)).get(),
        registerRuntimeProjectPathForSession: vi.fn() } as never,
      undefined, assembly,
    );
    const emit = vi.fn();
    await service.handleTurn('chat-1', 'First durable turn', 'default', emit);
    await service.handleTurn('chat-1', 'Follow-up after session readback', 'default', emit);
    expect(runAgentLoop).toHaveBeenCalledTimes(2);
    for (const [input] of runAgentLoop.mock.calls) {
      expect(input.cwd).toBe(root());
      expect(input.effectiveSystemPrompt).toContain(root());
    }
    expect(emit.mock.calls.filter(([event]) => event === 'chat:error')).toEqual([]);
  });

  it('keeps project execution scope and allowed-path checks', async () => {
    database.db.update(sessions).set({ projectId: 'real-project', runtimeContext: {
      runtimeKind: 'chat', architectureContext: { projectPath: temp, executionCwd: temp },
    } }).where(eq(sessions.id, 'chat-1')).run();
    await vfs.prepareSessionSandbox('chat-1');
    expect(existsSync(join(temp, 'workspaces', 'sessions', 'chat-1', 'files'))).toBe(false);
    await new FsListTool(allowed, vfs).execute(request('fs_list', '.'));
    expect(allowed.isAllowed).toHaveBeenCalledWith(resolve(temp));
    vi.mocked(allowed.isAllowed).mockResolvedValue(false);
    await expect(new FsListTool(allowed, vfs).execute(request('fs_list', '.'))).rejects.toThrow('ACCESS_DENIED');
  });
});
