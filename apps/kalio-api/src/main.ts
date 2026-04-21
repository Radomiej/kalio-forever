import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  const corsOrigins = (process.env['CORS_ORIGIN'] ?? '*').split(',').map((s) => s.trim());
  app.enableCors({ origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins });
  app.setGlobalPrefix('api');

  const port = parseInt(process.env['PORT'] ?? '3016', 10);
  await app.listen(port);
  logger.log(`kalio-api running on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start kalio-api', err);
  process.exit(1);
});
