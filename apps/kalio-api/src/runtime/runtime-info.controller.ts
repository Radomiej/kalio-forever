import { Controller, Get } from '@nestjs/common';
import { resolveSqliteDriver } from '../database/sqlite-runtime';
import { isEmbeddedUiEnabled, resolveRuntimeHost } from './runtime-host';

@Controller('runtime')
export class RuntimeInfoController {
  @Get('info')
  getInfo() {
    return {
      status: 'ok',
      runtime: 'kalio',
      version: process.env['KALIO_RUNTIME_VERSION'] ?? 'development',
      apiProtocolVersion: process.env['KALIO_API_PROTOCOL_VERSION'] ?? '1',
      databaseSchemaVersion: process.env['KALIO_DATABASE_SCHEMA_VERSION'] ?? '1',
      sqliteDriver: resolveSqliteDriver(),
      profile: process.env['KALIO_INSTALL_PROFILE'] ?? 'development',
      pid: process.pid,
      host: resolveRuntimeHost(),
      port: parseInt(process.env['PORT'] ?? '3016', 10),
      embeddedUi: isEmbeddedUiEnabled(),
    };
  }
}
