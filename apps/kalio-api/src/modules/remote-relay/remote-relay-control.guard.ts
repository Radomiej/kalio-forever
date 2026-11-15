import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
@Injectable()
export class RemoteRelayControlGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = process.env['KALIO_CONTROL_PLANE_TOKEN'] ?? '';
    const authorization = request.header('authorization') ?? '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!isLoopback(request.socket.remoteAddress) || !/^[a-f0-9]{64}$/i.test(expected)
      || !/^[a-f0-9]{64}$/i.test(supplied)) throw new UnauthorizedException();
    const left = Buffer.from(expected.toLowerCase(), 'hex');
    const right = Buffer.from(supplied.toLowerCase(), 'hex');
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new UnauthorizedException();
    return true;
  }
}
