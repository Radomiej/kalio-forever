import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { resolve, normalize, sep } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { DrizzleService } from '../../database/drizzle.service';
import { allowedPaths } from '../../database/schema';
import type { AllowedPath, CreateAllowedPathDto } from '@kalio/types';

@Injectable()
export class AllowedPathsService {
  constructor(private readonly drizzle: DrizzleService) {}

  async findAll(): Promise<AllowedPath[]> {
    const rows = await this.drizzle.db.select().from(allowedPaths);
    return rows.map((r) => ({
      id: r.id,
      path: r.path,
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : r.createdAt,
    }));
  }

  async create(dto: CreateAllowedPathDto): Promise<AllowedPath> {
    const resolved = this.normalizeAndValidate(dto.path);
    if (!existsSync(resolved)) {
      throw new BadRequestException(`Path does not exist: ${dto.path}`);
    }
    const stat = statSync(resolved);
    if (!stat.isDirectory()) {
      throw new BadRequestException(`Path is not a directory: ${dto.path}`);
    }

    const id = nanoid();
    const now = new Date();
    await this.drizzle.db.insert(allowedPaths).values({
      id,
      path: resolved,
      createdAt: now,
    });
    return { id, path: resolved, createdAt: now.getTime() };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.drizzle.db.select().from(allowedPaths).where(eq(allowedPaths.id, id)).then((r) => r[0]);
    if (!existing) throw new NotFoundException(`Allowed path ${id} not found`);
    await this.drizzle.db.delete(allowedPaths).where(eq(allowedPaths.id, id));
  }

  /** Check if an absolute path lies within any of the configured allowed roots */
  async isAllowed(targetPath: string): Promise<boolean> {
    const resolved = this.normalizeAndValidate(targetPath);
    const rows = await this.drizzle.db.select().from(allowedPaths);
    for (const row of rows) {
      const root = this.normalizeAndValidate(row.path);
      if (resolved.startsWith(root + sep) || resolved === root) {
        return true;
      }
    }
    return false;
  }

  /** Get all configured roots */
  async getRoots(): Promise<string[]> {
    const rows = await this.drizzle.db.select().from(allowedPaths);
    return rows.map((r) => this.normalizeAndValidate(r.path));
  }

  private normalizeAndValidate(p: string): string {
    return normalize(resolve(p));
  }
}
