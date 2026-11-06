import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { ChatSession } from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';

export interface SessionCreatedEvent {
  session: ChatSession;
}

export interface SessionUpdatedEvent {
  session: ChatSession;
}

@Injectable()
export class SessionEventsService {
  private readonly emitter = new EventEmitter();

  onRuntimeEvent(listener: EmitFn): () => void {
    this.emitter.on('runtime', listener);
    return () => { this.emitter.off('runtime', listener); };
  }

  readonly emitRuntimeEvent: EmitFn = (event, data) => {
    this.emitter.emit('runtime', event, data);
  };

  onSessionCreated(listener: (event: SessionCreatedEvent) => void): () => void {
    this.emitter.on('session:created', listener);
    return () => this.emitter.off('session:created', listener);
  }

  onSessionUpdated(listener: (event: SessionUpdatedEvent) => void): () => void {
    this.emitter.on('session:updated', listener);
    return () => this.emitter.off('session:updated', listener);
  }

  emitSessionCreated(session: ChatSession): void {
    this.emitter.emit('session:created', { session } satisfies SessionCreatedEvent);
  }

  emitSessionUpdated(session: ChatSession): void {
    this.emitter.emit('session:updated', { session } satisfies SessionUpdatedEvent);
  }
}
