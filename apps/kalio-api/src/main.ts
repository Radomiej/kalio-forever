import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';
import { SocketIoAdapter } from './adapters/socket-io.adapter';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
// Resolve to project root (three directories up from src/main.ts)
const projectRoot = resolve(__dirname, '..', '..', '..');
config({ path: resolve(projectRoot, envFile) });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');
  app.useWebSocketAdapter(new SocketIoAdapter(app));

  const corsOrigins = (process.env['CORS_ORIGIN'] ?? '*').split(',').map((s) => s.trim());
  app.enableCors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins });
  app.setGlobalPrefix('api');

  // Health check — intentionally outside the 'api' prefix so it stays at /health,
  // but also exposed at /api/health via the adapter directly.
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
  httpAdapter.get('/api/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

  const port = parseInt(process.env['PORT'] ?? '3016', 10);
  await app.listen(port);
  logger.log(`kalio-api running on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start kalio-api', err);
  process.exit(1);
});
