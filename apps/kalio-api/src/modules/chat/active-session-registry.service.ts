import { Injectable } from '@nestjs/common';

@Injectable()
export class ActiveSessionRegistry {
  private readonly activeSessionIds = new Set<string>();

  markActive(sessionId: string): void {
    this.activeSessionIds.add(sessionId);
  }

  markInactive(sessionId: string): void {
    this.activeSessionIds.delete(sessionId);
  }

  isActive(sessionId: string): boolean {
    return this.activeSessionIds.has(sessionId);
  }
}
