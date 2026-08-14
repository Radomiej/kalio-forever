import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from './audit.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';

describe('RuntimeAuditLogger', () => {
  it('logs typed runtime_event rows without raw prompt bodies', async () => {
    const audit = {
      log: vi.fn(async () => 'audit-runtime-1'),
    } satisfies Pick<AuditService, 'log'>;
    const logger = new RuntimeAuditLogger(audit as unknown as AuditService);

    await logger.log({
      eventName: 'workflow.node.failed',
      sessionId: 'session-1',
      runId: 'run-1',
      nodeId: 'router',
      turnId: 'turn-1',
      status: 'failed',
      reasonCode: 'RUNTIME_ERROR',
      errorCode: 'CONTRACT_VIOLATION',
      durationMs: 123,
      data: {
        prompt: 'this prompt must not be persisted',
        message: 'safe diagnostic',
      },
    });

    expect(audit.log).toHaveBeenCalledWith({
      sessionId: 'session-1',
      type: 'runtime_event',
      label: 'workflow.node.failed',
      durationMs: 123,
      data: {
        domain: 'runtime',
        eventName: 'workflow.node.failed',
        runId: 'run-1',
        nodeId: 'router',
        turnId: 'turn-1',
        status: 'failed',
        reasonCode: 'RUNTIME_ERROR',
        errorCode: 'CONTRACT_VIOLATION',
        message: 'safe diagnostic',
      },
    });
  });
});
