import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException, UnsupportedMediaTypeException } from '@nestjs/common';
import { DecisionDesktopAuth, DESKTOP_DECISION_HEADER } from './decision-desktop-auth';

export interface DecisionAuthRequest {
  /** Raw socket peer, never Express trust-proxy IP. */
  ip: string | undefined;
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

const TTL = 3_600_000;
const HEX = /^[a-f0-9]{64}$/i;
const FRONTEND_PORTS: Record<string, string> = { '3016': '5188', '3316': '5288', '4016': '6188' };

function loopback(ip: string | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export class DecisionAuthService {
  private readonly origins: string[];
  private readonly bearer: Buffer | null;
  private readonly sessions = new Map<string, { token: Buffer; expiresAt: number }>();
  private readonly desktop: DecisionDesktopAuth;
  readonly cookieName: string;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly now: () => number = Date.now) {
    this.desktop = new DecisionDesktopAuth(env, now);
    const listeningPort = env['PORT'] ?? '3016';
    // Packaged runtimes serve the UI on the API listener; dev/preview use a Host-preserving proxy.
    const port = env['KALIO_SERVE_UI'] === 'true'
      ? (/^[1-9]\d{0,4}$/.test(listeningPort) && Number(listeningPort) <= 65535 ? listeningPort : undefined)
      : FRONTEND_PORTS[listeningPort];
    const configured = env['KALIO_DECISION_FRONTEND_ORIGINS'];
    const defaults = port ? `http://localhost:${port},http://127.0.0.1:${port}` : '';
    this.origins = (configured ?? defaults).split(',').filter(Boolean);
    if (this.origins.length > 4 || this.origins.some((origin) => {
      try {
        const url = new URL(origin);
        return url.origin !== origin || !['http:', 'https:'].includes(url.protocol)
          || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.port;
      } catch { return true; }
    }) || new Set(this.origins.map((origin) => new URL(origin).port)).size > 1) this.origins = [];
    this.cookieName = `kalio-decision-auth-${this.origins.length ? new URL(this.origins[0]).port : 'unavailable'}`;
    const raw = env['KALIO_CONTROL_PLANE_TOKEN'];
    if (raw !== undefined && !HEX.test(raw)) throw new Error('KALIO_CONTROL_PLANE_TOKEN must contain exactly 64 hexadecimal characters.');
    this.bearer = raw ? Buffer.from(raw, 'hex') : null;
  }

  private origin(request: DecisionAuthRequest): string | null {
    if (!loopback(request.ip)) return null;
    const host = request.headers['host'];
    const header = request.headers['origin'];
    if (typeof host !== 'string') return null;
    if (typeof header === 'string') return this.origins.find((origin) => origin === header && new URL(origin).host === host) ?? null;
    if (header !== undefined || request.method !== 'GET' || request.headers['sec-fetch-site'] !== 'same-origin') return null;
    return this.origins.find((origin) => new URL(origin).host === host) ?? null;
  }

  requireJson(request: DecisionAuthRequest): void {
    const contentType = request.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      throw new UnsupportedMediaTypeException({ code: 'DECISION_JSON_REQUIRED' });
    }
  }

  requireBrowserOrigin(request: DecisionAuthRequest): void {
    if (request.headers[DESKTOP_DECISION_HEADER] !== undefined) return this.desktop.requireOrigin(request);
    if (!this.origins.length) throw new ServiceUnavailableException({ code: 'DECISION_AUTH_UNAVAILABLE' });
    if (!this.origin(request)) throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
  }

  createSession(request: DecisionAuthRequest): string {
    if (request.headers[DESKTOP_DECISION_HEADER] !== undefined) throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
    if (!this.origins.length) throw new ServiceUnavailableException({ code: 'DECISION_AUTH_UNAVAILABLE' });
    if (request.method !== 'POST') throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
    const origin = this.origin(request);
    if (!origin) throw new ForbiddenException({ code: 'DECISION_ORIGIN_DENIED' });
    this.requireJson(request);
    let session = this.sessions.get(origin);
    if (!session || session.expiresAt <= this.now()) {
      session = { token: randomBytes(32), expiresAt: this.now() + TTL };
      this.sessions.set(origin, session);
    }
    return session.token.toString('hex');
  }

  createDesktopSession(request: DecisionAuthRequest): string {
    this.requireJson(request);
    return this.desktop.createSession(request);
  }

  cookie(request: DecisionAuthRequest, token: string): string {
    const origin = this.origin(request);
    const session = origin ? this.sessions.get(origin) : undefined;
    const maxAge = session ? Math.max(0, Math.floor((session.expiresAt - this.now()) / 1000)) : 0;
    return `${this.cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${origin?.startsWith('https:') ? '; Secure' : ''}`;
  }

  isAuthorized(request: DecisionAuthRequest): boolean {
    if (request.headers[DESKTOP_DECISION_HEADER] !== undefined) return this.desktop.isAuthorized(request);
    if (!['GET', 'PUT'].includes(request.method) || !loopback(request.ip)) return false;
    const authorization = request.headers['authorization'];
    if (authorization !== undefined) {
      const host = request.headers['host'];
      const allowedHost = typeof host === 'string' && (this.origins.some((origin) => new URL(origin).host === host)
        || ['localhost', '127.0.0.1', '[::1]'].some((name) => host === `${name}:${this.env['PORT'] ?? '3016'}`));
      const match = typeof authorization === 'string' ? /^Bearer ([a-f0-9]{64})$/i.exec(authorization) : null;
      if (!allowedHost || !match || !this.bearer || (request.headers['origin'] !== undefined && !this.origin(request))) return false;
      return timingSafeEqual(Buffer.from(match[1], 'hex'), this.bearer);
    }
    const origin = this.origin(request);
    const session = origin ? this.sessions.get(origin) : undefined;
    const cookie = request.headers['cookie'];
    if (!session || session.expiresAt <= this.now() || typeof cookie !== 'string' || cookie.length > 8192) return false;
    const values = cookie.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${this.cookieName}=`));
    if (values.length !== 1) return false;
    const token = values[0].slice(this.cookieName.length + 1);
    return HEX.test(token) && timingSafeEqual(Buffer.from(token, 'hex'), session.token);
  }

  /** Browser capability prerequisite only; not human/session identity or launch authority. */
  isBrowserDecisionAuthorized(request: DecisionAuthRequest): boolean {
    if (request.headers[DESKTOP_DECISION_HEADER] !== undefined) {
      try { this.requireJson(request); } catch { return false; }
      return request.method === 'PUT' && this.desktop.isAuthorized(request);
    }
    if (request.method !== 'PUT' || request.headers['authorization'] !== undefined
      || typeof request.headers['origin'] !== 'string' || !this.origin(request)) return false;
    try {
      this.requireJson(request);
    } catch { return false; }
    return this.isAuthorized(request);
  }
}
