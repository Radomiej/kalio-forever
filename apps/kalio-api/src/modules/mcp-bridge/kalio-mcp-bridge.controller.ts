import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  KalioMcpBridgeHttpError,
  KalioMcpBridgeService,
} from './kalio-mcp-bridge.service';

@Controller('mcp/bridge')
export class KalioMcpBridgeController {
  constructor(private readonly bridge: KalioMcpBridgeService) {}

  @All()
  async handle(@Req() request: Request, @Res() response: Response): Promise<void> {
    try {
      await this.bridge.handleRequest(request, response, request.body);
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof KalioMcpBridgeHttpError) {
        response.status(error.statusCode).json({ error: error.message });
        return;
      }
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}
