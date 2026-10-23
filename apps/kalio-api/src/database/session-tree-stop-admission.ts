import { ConflictException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { sessions } from './schema';
import type { KalioDrizzleDatabase, SqliteMutationResult } from './sqlite-runtime';

export interface SessionTreeStopClaim { release(): void }

/** Single-process topology ownership, shared by every adapter using the same DB.
 * Parent links are immutable. Do not use across multiple backend writer processes.
 * Execution fences/drains are separate and remain owned by the chat pipeline. */
class SessionTreeStopAdmission {
  private readonly claims = new Map<string, { identity: object; ancestors: readonly string[] }>();

  constructor(private readonly db: KalioDrizzleDatabase) {}

  claim(rootSessionId: string): SessionTreeStopClaim {
    const ancestors = this.ancestors(rootSessionId);
    for (const [root, claim] of this.claims) {
      if (ancestors.includes(root) || claim.ancestors.includes(rootSessionId)) this.conflict();
    }
    const identity = {};
    this.claims.set(rootSessionId, { identity, ancestors });
    return { release: () => {
      if (this.claims.get(rootSessionId)?.identity === identity) this.claims.delete(rootSessionId);
    } };
  }

  /** Infrastructure-only: audited callbacks must directly call synchronous SQL .run().
   * This is not a sandbox for arbitrary callbacks; rejecting a returned Promise is too late. */
  runIfAdmitted(parentSessionId: string | null | undefined, mutation: () => SqliteMutationResult): SqliteMutationResult {
    if (parentSessionId) {
      const ancestors = this.ancestors(parentSessionId);
      if (ancestors.some(id => this.claims.has(id))) this.conflict();
    }
    return mutation();
  }

  private ancestors(sessionId: string): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    let current: string | null = sessionId;
    while (current !== null) {
      if (visited.has(current)) throw new ConflictException('SESSION_TREE_ANCESTRY_INVALID');
      visited.add(current);
      const row = this.db.select({ id: sessions.id, parent: sessions.parentSessionId })
        .from(sessions).where(eq(sessions.id, current)).get();
      if (!row) throw new NotFoundException('Session ancestry is unavailable.');
      result.push(row.id);
      current = row.parent;
    }
    return result;
  }

  private conflict(): never {
    throw new ConflictException({ code: 'SESSION_TREE_STOP_IN_PROGRESS', message: 'SESSION_TREE_STOP_IN_PROGRESS' });
  }
}

const admissions = new WeakMap<KalioDrizzleDatabase, SessionTreeStopAdmission>();
export function sessionTreeStopAdmission(db: KalioDrizzleDatabase): SessionTreeStopAdmission {
  let admission = admissions.get(db);
  if (!admission) { admission = new SessionTreeStopAdmission(db); admissions.set(db, admission); }
  return admission;
}
