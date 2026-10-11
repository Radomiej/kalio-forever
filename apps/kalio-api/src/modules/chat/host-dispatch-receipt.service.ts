import { Inject, Injectable } from '@nestjs/common';
import type { HostRuntimeReceiptIdentity } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { MCPService } from '../mcp/mcp.service';
import { TOOL_REGISTRY } from './chat.tokens';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { PersistedRuntimeEvidenceReader } from './persisted-runtime-evidence-reader';
import { createHostDispatchReceiptRecorder } from './host-dispatch-receipts';
import { createHostDispatchRegistryAuthority } from './host-dispatch-registry-authority';
import { createHostDispatchPersistenceAuthority } from './host-dispatch-persistence-authority';

/** Concrete host composition. No model input can supply authority ports. */
@Injectable()
export class HostDispatchReceiptService {
  readonly recorder: ReturnType<typeof createHostDispatchReceiptRecorder>;

  /** Execution facts only; inventory labels and BUILD claims are not authority. */
  async readDispatchFactsExact(identity: HostRuntimeReceiptIdentity, callId: string, signal?: AbortSignal) {
    const stored = await this.recorder.readExact({ ...identity, callId }, signal);
    if (!stored) return null;
    const { key, payload } = stored;
    return Object.freeze({
      identity: Object.freeze({ runId: key.runId, sessionId: key.sessionId, turnId: key.turnId, promptMessageId: key.promptMessageId }),
      callId: key.callId, requestedName: payload.requestedName, argsSha256: payload.argsSha256,
      canonicalName: payload.enteredTarget ? payload.canonicalName : null, target: payload.enteredTarget?.kind ?? null,
      approval: payload.enteredTarget ? payload.approval : null, hitlCommit: payload.hitlCommit,
      resultMessageId: payload.result.messageId, resultStatus: payload.result.status,
      contentSha256: payload.result.contentSha256,
    });
  }

  constructor(drizzle: DrizzleService, @Inject(TOOL_REGISTRY) entries: ToolRegistryEntry[],
    durableReader: PersistedRuntimeEvidenceReader, mcp: MCPService) {
    const registry = createHostDispatchRegistryAuthority(() => entries);
    this.recorder = createHostDispatchReceiptRecorder(drizzle.db, {
      ...registry,
      ...createHostDispatchPersistenceAuthority(drizzle.db),
      durableReader,
      async readRegisteredTargetExact(target, signal) {
        if (signal?.aborted) throw new Error('HOST_DISPATCH_REGISTRY_ABORTED');
        if (target.kind === 'kalio_registry') return registry.readRegisteredTargetExact(target, signal);
        const matches = mcp.getAllTools().filter(tool => {
          const resolved = mcp.resolveToolName(tool.name);
          return resolved?.serverKey === target.serverKey && resolved.originalName === target.originalName;
        });
        if (matches.length !== 1) return null;
        return { canonicalName: matches[0]!.name,
          target: { kind: 'external_mcp', serverKey: target.serverKey, originalName: target.originalName } };
      },
    });
  }
}
