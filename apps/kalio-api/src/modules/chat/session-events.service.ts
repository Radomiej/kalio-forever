import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import type { ChatSession } from '@kalio/types';

export interface SessionCreatedEvent {
  session: ChatSession;
}

export interface SessionUpdatedEvent {
  session: ChatSession;
}

@Injectable()
export class SessionEventsService {
  private readonly emitter = new EventEmitter();

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
