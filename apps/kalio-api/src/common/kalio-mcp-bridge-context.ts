import { Injectable } from '@nestjs/common';
import type { LLMToolCall, ToolResult } from '@kalio/types';

export interface NativeToolExecutionOptions {
  abortSignal: AbortSignal;
  onApprovalProgress?: (state: 'waiting' | 'resolved') => void;
}

export type NativeToolDispatch = (call: LLMToolCall, options: NativeToolExecutionOptions) => Promise<ToolResult>;

export interface KalioMcpBridgeTurnContext {
  sessionId: string;
  vfsSessionId?: string;
  turnId?: string;
  promptMessageId?: string;
  dispatchNativeTool?: NativeToolDispatch;
}

interface ActiveContext {
  context: KalioMcpBridgeTurnContext;
  leaseId: symbol;
}

@Injectable()
export class KalioMcpBridgeContextRegistry {
  private readonly contexts = new Map<string, ActiveContext>();

  activate(context: KalioMcpBridgeTurnContext): () => void {
    const leaseId = Symbol(context.sessionId);
    this.contexts.set(context.sessionId, { context, leaseId });
    return () => {
      const current = this.contexts.get(context.sessionId);
      if (current?.leaseId === leaseId) this.contexts.delete(context.sessionId);
    };
  }

  get(sessionId: string): KalioMcpBridgeTurnContext | undefined {
    return this.contexts.get(sessionId)?.context;
  }
}
