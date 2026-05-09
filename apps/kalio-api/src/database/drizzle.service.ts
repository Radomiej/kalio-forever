import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private sqlite!: Database.Database;
  public db!: BetterSQLite3Database<typeof schema>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const dbPath = this.config.get<string>('DATABASE_PATH', './data/kalio.db');
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite, { schema });

    // Run migrations from the migrations folder (idempotent)
    const migrationsFolder = resolve(__dirname, 'migrations');
    try {
      migrate(this.db, { migrationsFolder });
      this.logger.log(`Migrations applied from ${migrationsFolder}`);
    } catch (err) {
      this.logger.warn(`Migration warning (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }

    this.logger.log(`Database connected: ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.sqlite?.close();
    this.logger.log('Database connection closed');
  }
}
