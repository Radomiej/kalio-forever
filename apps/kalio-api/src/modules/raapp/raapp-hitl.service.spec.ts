import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { RAAppHITLService } from './raapp-hitl.service';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import { AuditService } from '../chat/audit.service';
import { DrizzleService } from '../../database/drizzle.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from '../../database/schema';
import type { PendingApproval } from './effects-processor.service';

function makeTestDrizzle(): DrizzleService {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS raapp_pending_approvals (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_call_id TEXT NOT NULL,
      system TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '{}',
      output_path TEXT,
      display_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema });
  const svc = new DrizzleService(null as never);
  (svc as unknown as { db: unknown }).db = db;
  return svc;
}

describe('RAAppHITLService', () => {
  let service: RAAppHITLService;
  let registry: NativeSystemRegistry;
  let drizzleSvc: DrizzleService;
  let hitlPolicy: { resolveApproval: ReturnType<typeof vi.fn> };
  const auditMock = { log: vi.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    drizzleSvc = makeTestDrizzle();
    hitlPolicy = {
      resolveApproval: vi.fn().mockResolvedValue({ status: 'manual', source: 'manual' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAAppHITLService,
        NativeSystemRegistry,
        { provide: DrizzleService, useValue: drizzleSvc },
        { provide: AuditService, useValue: auditMock },
        { provide: HitlPolicyService, useValue: hitlPolicy },
      ],
    }).compile();

    service = module.get(RAAppHITLService);
    registry = module.get(NativeSystemRegistry);
    auditMock.log.mockClear();
  });

  describe('savePendingApprovals()', () => {
    it('returns empty array when no approvals provided', async () => {
      const result = await service.savePendingApprovals('tc-1', 'sess-1', []);
      expect(result).toHaveLength(0);
    });

    it('saves and returns approvals', async () => {
      const approvals: PendingApproval[] = [
        {
          id: 'approval-1',
          system: 'vfs_write',
          args: { path: 'output.txt', content: 'hello' },
          displayLabel: 'Write file',
          outputPath: 'output.writeResult',
        },
      ];
      const saved = await service.savePendingApprovals('tc-1', 'sess-1', approvals);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('approval-1');
      expect(saved[0].system).toBe('vfs_write');
      expect(saved[0].toolCallId).toBe('tc-1');
      expect(saved[0].sessionId).toBe('sess-1');
      expect(saved[0].status).toBe('pending');
    });

    it('saves multiple approvals', async () => {
      const approvals: PendingApproval[] = [
        { id: 'a-1', system: 'vfs_write', args: {}, displayLabel: 'Write' },
        { id: 'a-2', system: 'vfs_delete', args: {}, displayLabel: 'Delete' },
      ];
      const saved = await service.savePendingApprovals('tc-2', 'sess-1', approvals);
      expect(saved).toHaveLength(2);
    });
  });

  describe('executeApproved()', () => {
    it('returns empty array for empty requestIds', async () => {
      const result = await service.executeApproved([], 'sess-1');
      expect(result).toHaveLength(0);
    });

    it('returns empty array when no matching pending approvals found', async () => {
      const result = await service.executeApproved(['nonexistent-id'], 'sess-1');
      expect(result).toHaveLength(0);
    });

    it('executes approval and returns executed status', async () => {
      registry.register({
        id: 'test_write',
        description: 'write test',
        approval_required: true,
        input_schema: {},
        handler: async (args) => ({ written: args['path'] }),
      });

      await service.savePendingApprovals('tc-exec', 'sess-exec', [
        { id: 'exec-1', system: 'test_write', args: { path: 'file.txt' }, displayLabel: 'Write file.txt' },
      ]);

      const results = await service.executeApproved(['exec-1'], 'sess-exec');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('exec-1');
      expect(results[0].status).toBe('executed');
      expect(results[0].result).toEqual({ written: 'file.txt' });
      expect(results[0].toolCallId).toBe('tc-exec');
    });

    it('returns error status when execution fails', async () => {
      registry.register({
        id: 'test_fail',
        description: 'always fails',
        approval_required: true,
        input_schema: {},
        handler: async () => { throw new Error('execution failed'); },
      });

      await service.savePendingApprovals('tc-fail', 'sess-fail', [
        { id: 'fail-1', system: 'test_fail', args: {}, displayLabel: 'Fail op' },
      ]);

      const results = await service.executeApproved(['fail-1'], 'sess-fail');
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('error');
      expect(results[0].error).toBe('execution failed');
    });

    it('does not execute approvals from a different session', async () => {
      registry.register({
        id: 'cross_session',
        description: 'cross session test',
        approval_required: true,
        input_schema: {},
        handler: async () => ({ done: true }),
      });

      await service.savePendingApprovals('tc-x', 'sess-A', [
        { id: 'cross-1', system: 'cross_session', args: {}, displayLabel: 'Cross' },
      ]);

      // Try to execute from sess-B — should not find the approval
      const results = await service.executeApproved(['cross-1'], 'sess-B');
      expect(results).toHaveLength(0);
    });

    it('logs audit entries on success', async () => {
      registry.register({
        id: 'audit_op',
        description: 'audit test op',
        approval_required: true,
        input_schema: {},
        handler: async () => ({}),
      });

      await service.savePendingApprovals('tc-audit', 'sess-audit', [
        { id: 'audit-appr-1', system: 'audit_op', args: {}, displayLabel: 'Audit op' },
      ]);

      await service.executeApproved(['audit-appr-1'], 'sess-audit');
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'raapp_native_approved', sessionId: 'sess-audit' }),
      );
    });
  });

  describe('cancelApprovals()', () => {
    it('returns empty toolCallId for empty requestIds', async () => {
      const { toolCallId } = await service.cancelApprovals([], 'sess-1');
      expect(toolCallId).toBe('');
    });

    it('cancels pending approvals and returns toolCallId', async () => {
      await service.savePendingApprovals('tc-cancel', 'sess-cancel', [
        { id: 'cancel-1', system: 'vfs_write', args: {}, displayLabel: 'Write' },
        { id: 'cancel-2', system: 'vfs_delete', args: {}, displayLabel: 'Delete' },
      ]);

      const { toolCallId } = await service.cancelApprovals(['cancel-1', 'cancel-2'], 'sess-cancel');
      expect(toolCallId).toBe('tc-cancel');
    });

    it('returns empty toolCallId when no matching approvals found', async () => {
      const { toolCallId } = await service.cancelApprovals(['non-existent'], 'sess-x');
      expect(toolCallId).toBe('');
    });
  });

  describe('getPendingForSession()', () => {
    it('returns only pending approvals for the given session', async () => {
      await service.savePendingApprovals('tc-get', 'sess-get', [
        { id: 'get-1', system: 'vfs_write', args: {}, displayLabel: 'Write' },
        { id: 'get-2', system: 'vfs_write', args: {}, displayLabel: 'Write2' },
      ]);
      await service.savePendingApprovals('tc-other', 'sess-other', [
        { id: 'other-1', system: 'vfs_write', args: {}, displayLabel: 'Other' },
      ]);

      const pending = await service.getPendingForSession('sess-get');
      expect(pending).toHaveLength(2);
      expect(pending.every((p) => p.sessionId === 'sess-get')).toBe(true);
    });

    it('returns empty when session has no pending approvals', async () => {
      const pending = await service.getPendingForSession('sess-empty');
      expect(pending).toHaveLength(0);
    });
  });

  describe('resolvePendingApprovals()', () => {
    it('auto-executes the whole batch when the global policy bypasses RA-App approvals', async () => {
      registry.register({
        id: 'test_write',
        description: 'write test',
        approval_required: true,
        input_schema: {},
        handler: async (args) => ({ written: args['path'] }),
      });
      hitlPolicy.resolveApproval.mockResolvedValue({ status: 'approved', source: 'bypass' });

      const result = await service.resolvePendingApprovals('tc-bypass', 'sess-bypass', [
        { id: 'bypass-1', system: 'test_write', args: { path: 'file.txt' }, displayLabel: 'Write file.txt' },
      ]);

      expect(result.pendingApprovals).toEqual([]);
      expect(result.nativeResults).toEqual([
        expect.objectContaining({ id: 'bypass-1', status: 'executed', result: { written: 'file.txt' } }),
      ]);
      await expect(service.getPendingForSession('sess-bypass')).resolves.toHaveLength(0);
    });

    it('falls back to manual when any auto evaluation rejects the RA-App approval batch', async () => {
      hitlPolicy.resolveApproval
        .mockResolvedValueOnce({ status: 'approved', source: 'auto', reason: 'First op is safe.' })
        .mockResolvedValueOnce({ status: 'rejected', source: 'auto', reason: 'Second op is risky.' });

      const approvals: PendingApproval[] = [
        { id: 'auto-1', system: 'test_write', args: { path: 'safe.txt' }, displayLabel: 'Write safe.txt' },
        { id: 'auto-2', system: 'test_delete', args: { path: 'danger.txt' }, displayLabel: 'Delete danger.txt' },
      ];

      const result = await service.resolvePendingApprovals('tc-auto', 'sess-auto', approvals);

      expect(result.nativeResults).toEqual([]);
      expect(result.pendingApprovals).toEqual([
        expect.objectContaining({ id: 'auto-1', system: 'test_write' }),
        expect.objectContaining({ id: 'auto-2', system: 'test_delete' }),
      ]);
      await expect(service.getPendingForSession('sess-auto')).resolves.toHaveLength(2);
    });

    it('returns output patches for auto-executed approvals with output paths', async () => {
      registry.register({
        id: 'test_write',
        description: 'write test',
        approval_required: true,
        input_schema: {},
        handler: async (args) => ({ written: args['path'] }),
      });
      hitlPolicy.resolveApproval.mockResolvedValue({ status: 'approved', source: 'bypass' });

      const result = await service.resolvePendingApprovals('tc-bypass', 'sess-bypass', [
        {
          id: 'bypass-1',
          system: 'test_write',
          args: { path: 'file.txt' },
          outputPath: 'output.writeResult',
          displayLabel: 'Write file.txt',
        },
      ]);

      expect(result.outputPatches).toEqual([
        {
          outputPath: 'output.writeResult',
          value: { written: 'file.txt' },
        },
      ]);
    });
  });
});
