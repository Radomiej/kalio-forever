import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.enableCors({ origin: process.env['CORS_ORIGIN'] ?? '*' });
  app.setGlobalPrefix('api');

  const port = parseInt(process.env['PORT'] ?? '3016', 10);
  await app.listen(port);
  logger.log(`kalio-api running on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start kalio-api', err);
  process.exit(1);
});
