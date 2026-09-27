import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveRuntimeHost } from '../runtime/runtime-host';

const REQUIRED_PROFILES = new Set(['desktop', 'runtime', 'prod', 'qa']);
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export interface ControlPlaneAuthSettings {
  enabled: boolean;
  token: Buffer | null;
}

export function resolveControlPlaneAuthSettings(
  env: NodeJS.ProcessEnv = process.env,
): ControlPlaneAuthSettings {
  const profile = env['KALIO_INSTALL_PROFILE']?.trim().toLowerCase();
  const isProduction = env['NODE_ENV'] === 'production';
  const requestedMode = env['KALIO_CONTROL_PLANE_AUTH']?.trim().toLowerCase();

  if (requestedMode === 'disabled') {
    if (isProduction || REQUIRED_PROFILES.has(profile ?? '')) {
      throw new Error('KALIO_CONTROL_PLANE_AUTH=disabled is forbidden for secure Kalio profiles.');
    }
    const host = resolveRuntimeHost(env);
    if (!['127.0.0.1', '::1'].includes(host)) {
      throw new Error('Control-plane authentication can only be disabled on loopback.');
    }
    return { enabled: false, token: null };
  }

  const rawToken = env['KALIO_CONTROL_PLANE_TOKEN']?.trim();
  if (!rawToken || !TOKEN_PATTERN.test(rawToken)) {
    throw new Error('KALIO_CONTROL_PLANE_TOKEN must contain exactly 64 hexadecimal characters.');
  }

  return { enabled: true, token: Buffer.from(rawToken, 'hex') };
}

export function isControlPlaneTokenValid(
  authorizationHeader: string | undefined,
  expectedToken: Buffer,
): boolean {
  if (!authorizationHeader) return false;
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(authorizationHeader);
  if (!match) return false;
  const candidate = Buffer.from(match[1], 'hex');
  return candidate.length === expectedToken.length && timingSafeEqual(candidate, expectedToken);
}

function getVfsCookieContext(path: string): { sessionId: string; path: string } | null {
  const match = /^\/api\/sessions\/([A-Za-z0-9_-]{1,128})\/vfs(?:\/|$)/.exec(path);
  return match ? { sessionId: match[1], path: `/api/sessions/${match[1]}/vfs` } : null;
}

function isControlPlaneVfsCookieValid(
  request: Request,
  expectedToken: Buffer,
): boolean {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  const vfsContext = getVfsCookieContext(request.path);
  if (!vfsContext) return false;

  const cookieName = `kalio-vfs-${vfsContext.sessionId}=`;
  const cookie = request.headers.cookie
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(cookieName));
  if (!cookie) return false;
  return isControlPlaneTokenValid(`Bearer ${cookie.slice(cookieName.length)}`, expectedToken);
}

function setControlPlaneVfsCookie(request: Request, response: Response, token: Buffer): void {
  const vfsContext = getVfsCookieContext(request.path);
  if (!vfsContext) return;
  response.append(
    'Set-Cookie',
    `kalio-vfs-${vfsContext.sessionId}=${token.toString('hex')}; Path=${vfsContext.path}; HttpOnly; Secure; SameSite=None`,
  );
}

@Injectable()
export class ControlPlaneAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const settings = resolveControlPlaneAuthSettings();
    if (!settings.enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    if (!settings.token) {
      throw new UnauthorizedException('Unauthorized.');
    }

    if (isControlPlaneTokenValid(request.headers.authorization, settings.token)) {
      setControlPlaneVfsCookie(request, response, settings.token);
      return true;
    }

    if (isControlPlaneVfsCookieValid(request, settings.token)) return true;
    throw new UnauthorizedException('Unauthorized.');
  }
}
