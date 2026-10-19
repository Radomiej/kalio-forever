import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { DecisionAuthRequest } from './decision-auth.service';

export const DESKTOP_DECISION_HEADER = 'x-kalio-decision-session';
const ORIGINS = new Set(['http://tauri.localhost', 'tauri://localhost']);

/** Desktop WebViews cannot use the browser's same-origin HttpOnly cookie lane. */
export class DecisionDesktopAuth {
  private readonly sessions = new Map<string, { token: Buffer; expiresAt: number }>();
  private readonly enabled: boolean;
  constructor(env: NodeJS.ProcessEnv, private readonly now: () => number) {
    this.enabled = env['KALIO_DECISION_DESKTOP_AUTH'] === 'true' && env['PORT'] === '4516';
  }

  origin(request: DecisionAuthRequest): string | null {
    const origin = request.headers['origin'];
    return this.enabled && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip ?? '')
      && request.headers['host'] === '127.0.0.1:4516' && typeof origin === 'string' && ORIGINS.has(origin)
      && request.headers['authorization'] === undefined && request.headers['cookie'] === undefined ? origin : null;
  }

  requireOrigin(request: DecisionAuthRequest): void {
    if (!this.origin(request)) throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
  }

  createSession(request: DecisionAuthRequest): string {
    this.requireOrigin(request);
    if (request.method !== 'POST' || request.headers[DESKTOP_DECISION_HEADER] !== undefined) {
      throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
    }
    const origin = this.origin(request)!;
    let session = this.sessions.get(origin);
    if (!session || session.expiresAt <= this.now()) {
      session = { token: randomBytes(32), expiresAt: this.now() + 3_600_000 };
      this.sessions.set(origin, session);
    }
    return session.token.toString('hex');
  }

  isAuthorized(request: DecisionAuthRequest): boolean {
    const origin = this.origin(request);
    const session = origin ? this.sessions.get(origin) : undefined;
    const token = request.headers[DESKTOP_DECISION_HEADER];
    return ['GET', 'PUT'].includes(request.method) && !!session && session.expiresAt > this.now()
      && typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token)
      && timingSafeEqual(Buffer.from(token, 'hex'), session.token);
  }
}
