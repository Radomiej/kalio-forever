import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { resolve, normalize, sep, dirname, basename } from 'node:path';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { DrizzleService } from '../../database/drizzle.service';
import { allowedPaths } from '../../database/schema';
import type { AllowedPath, CreateAllowedPathDto } from '@kalio/types';

interface AllowedPathResolutionOptions {
  allowMissingPath?: boolean;
}

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
  async isAllowed(targetPath: string, options: AllowedPathResolutionOptions = {}): Promise<boolean> {
    const resolved = this.normalizeAndValidate(targetPath, options);
    const rows = await this.drizzle.db.select().from(allowedPaths);
    for (const row of rows) {
      const root = this.normalizeAndValidate(row.path);
      if (this.isPathWithinRoot(resolved, root)) {
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

  private normalizeAndValidate(p: string, options: AllowedPathResolutionOptions = {}): string {
    const abs = normalize(resolve(p));
    if (options.allowMissingPath) {
      return this.resolveThroughDeepestExistingParent(abs);
    }

    try {
      return realpathSync(abs);
    } catch {
      // Path does not exist yet — fall back to the normalised path.
      // This handles pre-flight checks on paths that haven't been created.
      return abs;
    }
  }

  private resolveThroughDeepestExistingParent(abs: string): string {
    if (existsSync(abs)) {
      return realpathSync(abs);
    }

    const missingSegments: string[] = [];
    let current = abs;

    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) {
        return abs;
      }
      missingSegments.unshift(basename(current));
      current = parent;
    }

    const existingParent = realpathSync(current);
    return normalize(resolve(existingParent, ...missingSegments));
  }

  private isPathWithinRoot(targetPath: string, rootPath: string): boolean {
    const normalizedTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath;
    const normalizedRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;

    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + sep);
  }
}
