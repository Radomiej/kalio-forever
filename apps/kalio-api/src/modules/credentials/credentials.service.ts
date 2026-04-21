import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { Credential, CreateCredentialDto } from '@kalio/types';
import { DrizzleService } from '../../database/drizzle.service';
import { credentials } from '../../database/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<Credential[]> {
    const rows = await this.drizzle.db.select().from(credentials);
    return rows.map(({ apiKey: _omit, ...rest }) => ({
      ...rest,
      createdAt: rest.createdAt instanceof Date ? rest.createdAt.getTime() : rest.createdAt,
    }));
  }

  async create(dto: CreateCredentialDto): Promise<Credential> {
    const id = nanoid();
    const now = Date.now();
    await this.drizzle.db.insert(credentials).values({
      id,
      name: dto.name,
      provider: dto.provider,
      apiKey: dto.apiKey,
      baseUrl: dto.baseUrl,
      model: dto.model,
      createdAt: now,
    });
    const { apiKey: _omit, ...row } = (await this.drizzle.db.select().from(credentials).where(eq(credentials.id, id)).then((r) => r[0]))!;
    return { ...row, createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt };
  }

  async remove(id: string): Promise<void> {
    await this.drizzle.db.delete(credentials).where(eq(credentials.id, id));
  }

  async getApiKey(credentialId: string): Promise<string | null> {
    const row = await this.drizzle.db.select().from(credentials).where(eq(credentials.id, credentialId)).then((r) => r[0]);
    return row?.apiKey ?? null;
  }
}
