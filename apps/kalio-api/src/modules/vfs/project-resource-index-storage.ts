import type { ProjectResourceIndexStoragePort } from '@kalio/types';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function exists(filename: string): boolean {
  try { fs.statSync(filename); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** VFS owns paths and allocation; the common SQLite factory still owns database opens. */
export class ProjectResourceIndexStorage implements ProjectResourceIndexStoragePort {
  constructor(private readonly root: string) {}

  private filename(projectId: string, spaceId: string): string {
    return join(this.root, 'project-resources', hash(projectId), `${hash(spaceId)}.db`);
  }

  exists(projectId: string, spaceId: string): boolean {
    return exists(this.filename(projectId, spaceId));
  }

  prepare(projectId: string, spaceId: string): string {
    const filename = this.filename(projectId, spaceId);
    const base = join(this.root, 'project-resources');
    if (!exists(filename) && exists(base)) {
      const projects = fs.readdirSync(base, { withFileTypes: true });
      if (projects.length > 32) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
      let databases = 0;
      for (const project of projects) {
        if (!project.isDirectory() || project.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(project.name)) {
          throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
        }
        const files = fs.readdirSync(join(base, project.name));
        if (files.length > 64) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
        databases += files.filter(file => file.endsWith('.db')).length;
      }
      if (databases >= 16) throw new Error('PROJECT_RESOURCE_STORAGE_LIMIT');
    }
    fs.mkdirSync(dirname(filename), { recursive: true });
    return filename;
  }
}
