import { BadRequestException, Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DecisionAuthService } from './decision-auth.service';
import { decisionAuthRequest } from './decision-auth.guard';

@Controller('decision')
export class DecisionAuthController {
  constructor(private readonly auth: DecisionAuthService) {}

  @Post('desktop-auth')
  @HttpCode(200)
  desktopBootstrap(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): { token: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw new BadRequestException({ code: 'DECISION_AUTH_BODY_INVALID' });
    }
    const token = this.auth.createDesktopSession(decisionAuthRequest(req));
    res.setHeader('Cache-Control', 'no-store');
    return { token };
  }

  @Post('auth')
  @HttpCode(204)
  bootstrap(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: unknown): void {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
      throw new BadRequestException({ code: 'DECISION_AUTH_BODY_INVALID' });
    }
    const request = decisionAuthRequest(req);
    const token = this.auth.createSession(request);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', this.auth.cookie(request, token));
  }
}
