import { Injectable } from '@nestjs/common';

export interface KalioMcpBridgeTurnContext {
  sessionId: string;
  vfsSessionId?: string;
  turnId?: string;
  promptMessageId?: string;
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
