import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normalize, resolve, win32 } from 'node:path';
import { nanoid } from 'nanoid';
import type { CreateProjectDto, Project, ProjectKind, UpdateProjectDto } from '@kalio/types';
import { eq } from 'drizzle-orm';
import { DrizzleService } from '../../database/drizzle.service';
import { projects } from '../../database/schema';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

export const SYSTEM_PROJECT_IDS = {
  none: 'system:none',
  external: 'system:external',
  audit: 'system:audit',
  other: 'system:other',
} as const;

export function normalizeProjectPath(path: string): string {
  const trimmedPath = path.trim();
  const normalized = normalizeProjectPathForStorage(path);
  return (process.platform === 'win32' || isWindowsPath(trimmedPath)) ? normalized.toLowerCase() : normalized;
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('//');
}

export function normalizeProjectPathForStorage(path: string): string {
  const trimmedPath = path.trim();
  const normalized = (/^[a-z]:[\\/]/i.test(trimmedPath) || trimmedPath.startsWith('\\\\') || trimmedPath.startsWith('//')
    ? win32.normalize(trimmedPath)
    : normalize(resolve(trimmedPath))
  ).replaceAll('\\', '/');
  if (normalized.length > 1 && !/^[a-z]:\/$/i.test(normalized)) {
    return normalized.replace(/\/+$/, '');
  }
  return normalized;
}

export function projectNameFromPath(path: string): string {
  const segments = normalizeProjectPathForStorage(path).split('/').filter(Boolean);
  return segments.at(-1) ?? 'New project';
}

type ProjectRecord = Project & { normalizedPath: string | null };

@Injectable()
export class ProjectsService {
  constructor(
    private readonly drizzle: DrizzleService,
    private readonly allowedPaths: AllowedPathsService,
  ) {}

  async list(): Promise<Project[]> {
    const records = await this.listRecords();
    return records.map((record) => {
      const { normalizedPath, ...project } = record;
      void normalizedPath;
      return project;
    });
  }

  async get(id: string): Promise<Project> {
    const [project] = (await this.listRecords()).filter((item) => item.id === id);
    if (!project) {
      throw new NotFoundException(`Project not found: ${id}`);
    }
    return project;
  }

  async create(dto: CreateProjectDto): Promise<Project> {
    const path = normalizeProjectPathForStorage(dto.path);
    if (!dto.path.trim()) {
      throw new BadRequestException('Project path is required.');
    }
    const normalizedPath = normalizeProjectPath(path);
    const existing = (await this.listRecords()).find((project) => project.normalizedPath === normalizedPath);
    if (existing) {
      throw new ConflictException({
        message: 'A project with this path already exists.',
        projectId: existing.id,
      });
    }

    await this.allowedPaths.ensurePath(path);
    const name = dto.name.trim() || projectNameFromPath(path);
    const now = new Date();
    const project = {
      id: nanoid(),
      name,
      path,
      normalizedPath,
      kind: 'workspace' as const,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.drizzle.db.insert(projects).values(project);
    return {
      ...project,
      createdAt: now.getTime(),
      updatedAt: now.getTime(),
    };
  }

  async rename(id: string, dto: UpdateProjectDto): Promise<Project> {
    const project = await this.get(id);
    if (project.isSystem) {
      throw new ForbiddenException('System projects cannot be renamed.');
    }
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Project name is required.');
    }
    const updatedAt = new Date();
    await this.drizzle.db.update(projects).set({ name, updatedAt }).where(eq(projects.id, id));
    return { ...project, name, updatedAt: updatedAt.getTime() };
  }

  async assertAssignable(id: string): Promise<Project> {
    return this.get(id);
  }

  private async listRecords(): Promise<ProjectRecord[]> {
    const rows = await this.drizzle.db.select().from(projects);
    return rows.map((row) => this.toProject(row));
  }

  private toProject(row: typeof projects.$inferSelect): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      normalizedPath: row.normalizedPath,
      kind: row.kind as ProjectKind,
      isSystem: row.isSystem,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.getTime() : row.updatedAt,
    };
  }
}
