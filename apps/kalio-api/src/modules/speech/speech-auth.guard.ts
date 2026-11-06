import { CanActivate, ConflictException, ExecutionContext, Injectable, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { decisionAuthRequest } from '../../common/decision-auth.guard';

@Injectable()
export class SpeechAuthGuard implements CanActivate {
  private uploadInFlight = false;
  constructor(private readonly auth: DecisionAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const upload = /^\/api\/speech\/transcriptions\/[A-Za-z0-9_-]{1,80}$/.test(req.path);
    const allowed = req.method === 'GET' ? req.path === '/api/speech/status'
      : req.method === 'PUT' && (upload || /^\/api\/speech\/(?:install(?:\/cancel)?|transcriptions\/[A-Za-z0-9_-]{1,80}\/cancel)$/.test(req.path));
    if (!allowed) throw new UnauthorizedException({ code: 'SPEECH_AUTH_REQUIRED' });
    const request = decisionAuthRequest(req);
    // Local browser capability only: speech must never silently cross a remote API.
    this.auth.requireBrowserOrigin(request);
    if (!this.auth.isAuthorized(request)) throw new UnauthorizedException({ code: 'SPEECH_AUTH_REQUIRED' });
    if (req.method === 'PUT') {
      if (upload) {
        if (!/^multipart\/form-data;\s*boundary=[\w'()+,\-./:=? ]{1,200}$/i.test(req.headers['content-type'] ?? '')) {
          throw new UnsupportedMediaTypeException({ code: 'SPEECH_MULTIPART_REQUIRED' });
        }
      } else this.auth.requireJson(request);
    }
    if (upload) {
      if (this.uploadInFlight) throw new ConflictException({ code: 'SPEECH_BUSY' });
      this.uploadInFlight = true;
      const response = context.switchToHttp().getResponse<Response>();
      const release = () => {
        this.uploadInFlight = false;
        response.removeListener('close', release);
        response.removeListener('finish', release);
      };
      response.once('close', release);
      response.once('finish', release);
    }
    return true;
  }
}
