import { Injectable, Logger } from '@nestjs/common';

export interface NativeSystemInput {
  [key: string]: unknown;
}

export interface NativeExecuteResult {
  result: unknown;
  approval_required: boolean;
}

export interface NativeSystem {
  id: string;
  description: string;
  approval_required: boolean;
  input_schema: Record<string, { type: string; description?: string }>;
  handler: (args: NativeSystemInput, sessionCtx: NativeSessionContext) => Promise<unknown>;
}

export interface NativeSessionContext {
  sessionId: string;
}

/**
 * Registry of native backend systems that RA-Apps can invoke via `call_native`.
 *
 * Systems with `approval_required: true` are queued in `__pending_approvals`
 * by EffectsProcessorService and executed only after the user confirms via
 * the `raapp:approve` Socket.IO event.
 */
@Injectable()
export class NativeSystemRegistry {
  private readonly logger = new Logger(NativeSystemRegistry.name);
  private readonly systems = new Map<string, NativeSystem>();

  register(system: NativeSystem): void {
    if (this.systems.has(system.id)) {
      this.logger.warn(`NativeSystem "${system.id}" is already registered — overwriting`);
    }
    this.systems.set(system.id, system);
    this.logger.log(`NativeSystem registered: ${system.id} (approval_required=${system.approval_required})`);
  }

  /**
   * Execute a native system.
   * If `approval_required` is true the handler is NOT called —
   * the caller must surface the approval request to the user and call
   * `executeApproved()` after confirmation.
   */
  async execute(
    id: string,
    args: NativeSystemInput,
    sessionCtx: NativeSessionContext,
  ): Promise<NativeExecuteResult> {
    const system = this.systems.get(id);
    if (!system) {
      throw new Error(`NativeSystem "${id}" not found`);
    }

    if (system.approval_required) {
      this.logger.log(`NativeSystem "${id}" requires approval — queueing (session=${sessionCtx.sessionId})`);
      return { result: null, approval_required: true };
    }

    const result = await system.handler(args, sessionCtx);
    return { result, approval_required: false };
  }

  /**
   * Execute a native system bypassing the approval gate.
   * Called after the user explicitly approves via HITL flow.
   */
  async executeApproved(
    id: string,
    args: NativeSystemInput,
    sessionCtx: NativeSessionContext,
  ): Promise<unknown> {
    const system = this.systems.get(id);
    if (!system) {
      throw new Error(`NativeSystem "${id}" not found`);
    }
    this.logger.log(`NativeSystem "${id}" executing approved (session=${sessionCtx.sessionId})`);
    return system.handler(args, sessionCtx);
  }

  getAll(): NativeSystem[] {
    return Array.from(this.systems.values());
  }

  get(id: string): NativeSystem | undefined {
    return this.systems.get(id);
  }
}
