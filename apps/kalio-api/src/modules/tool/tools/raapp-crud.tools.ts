import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool, ConfirmedTool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { VFSService } from '../../vfs/vfs.service';

// ─── raapp_get ────────────────────────────────────────────────────────────────

@Injectable()
@Tool({
  name: 'raapp_get',
  description:
    'Retrieve the source files of a stored RA-App by its ID. ' +
    'Returns the raw YAML/DSL content of meta.yml, systems.yml, ui.gui, ' +
    'ui.yml, tests.yml, and components.yml (whichever exist). ' +
    'Use this before raapp_edit to inspect the current state.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The RA-App ID to inspect.' },
    },
  },
  requiresConfirmation: false,
})
export class RaAppGetTool {
  private readonly logger = new Logger(RaAppGetTool.name);

  constructor(private readonly raapp: RAAppService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const id = request.args['id'] as string;
    const app = this.raapp.getById(id);
    if (!app) {
      return {
        status: 'error',
        message: `RA-App "${id}" not found. Use list_raapps to discover available IDs.`,
      };
    }

    try {
      const files = await this.raapp.getSourceFiles(id);
      return { status: 'ok', id: app.meta.id, name: app.meta.name, version: app.meta.version, source: app.source, files };
    } catch (err) {
      this.logger.error(`[raapp_get] Failed to read source files for ${id}`, err);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── raapp_edit ───────────────────────────────────────────────────────────────

@Injectable()
@Tool({
  name: 'raapp_edit',
  description:
    'Create or update a VFS working copy for a stored user RA-App. ' +
    'Provide only the files you want to change; unchanged files are preserved in the working copy. ' +
    'The published release is NOT modified in place. ' +
    'After editing, test with raapp_test draft_id and publish with raapp_publish_draft. ' +
    'Core apps (source=core) cannot be edited. ' +
    'Use raapp_get first to fetch the current content before editing.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The RA-App ID to edit.' },
      meta_yml: { type: 'string', description: 'New meta.yml content (optional).' },
      systems_yml: { type: 'string', description: 'New systems.yml content (optional).' },
      ui_gui: { type: 'string', description: 'New ui.gui content (optional).' },
      ui_yml: { type: 'string', description: 'New ui.yml content (optional).' },
      tests_yml: { type: 'string', description: 'New tests.yml content (optional).' },
    },
  },
  requiresConfirmation: false,
})
export class RaAppEditTool {
  private readonly logger = new Logger(RaAppEditTool.name);
  private static readonly DRAFT_FILENAMES = ['meta.yml', 'systems.yml', 'ui.gui', 'ui.yml', 'tests.yml', 'components.yml'] as const;

  constructor(
    private readonly raapp: RAAppService,
    private readonly vfs: VFSService,
  ) {}

  private isMissingDraftFile(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'VFS_FILE_NOT_FOUND';
  }

  private readOptionalDraftFile(sessionId: string, draftBase: string, filename: string): string | null {
    try {
      return this.vfs.readFile(sessionId, `${draftBase}/${filename}`).content;
    } catch (err) {
      if (!this.isMissingDraftFile(err)) {
        throw err;
      }
      return null;
    }
  }

  private loadExistingDraftFiles(sessionId: string, draftBase: string): Record<string, string> | null {
    const meta = this.readOptionalDraftFile(sessionId, draftBase, 'meta.yml');
    if (!meta) return null;

    const files: Record<string, string> = { 'meta.yml': meta };
    for (const filename of RaAppEditTool.DRAFT_FILENAMES) {
      if (filename === 'meta.yml') continue;
      const content = this.readOptionalDraftFile(sessionId, draftBase, filename);
      if (content !== null) files[filename] = content;
    }
    return files;
  }

  async execute(request: ToolCallRequest): Promise<object> {
    const id = request.args['id'] as string;
    const sessionId = request.sessionId;
    const app = this.raapp.getById(id);
    if (!app) {
      return {
        status: 'error',
        message: `RA-App "${id}" not found. Use list_raapps to discover available IDs.`,
      };
    }
    if (app.source === 'core') {
      return {
        status: 'error',
        message: `Core RA-App "${id}" cannot be edited.`,
      };
    }

    const updates: Record<string, string> = {};
    const fileMap: Record<string, string> = {
      meta_yml: 'meta.yml',
      systems_yml: 'systems.yml',
      ui_gui: 'ui.gui',
      ui_yml: 'ui.yml',
      tests_yml: 'tests.yml',
    };
    for (const [argKey, filename] of Object.entries(fileMap)) {
      const val = request.args[argKey];
      if (typeof val === 'string' && val.trim().length > 0) {
        updates[filename] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return { status: 'error', message: 'No file content provided. Pass at least one of: meta_yml, systems_yml, ui_gui, ui_yml, tests_yml.' };
    }

    const draftId = `edit-${id}`;
    const draftBase = `drafts/${draftId}`;

    try {
      const draftFiles = this.loadExistingDraftFiles(sessionId, draftBase);
      const baseFiles = draftFiles ?? await this.raapp.getSourceFiles(id);
      const mergedFiles: Record<string, string> = { ...baseFiles, ...updates };
      const mode = this.readOptionalDraftFile(sessionId, draftBase, '.mode') ?? app.appMode;
      const slug = this.readOptionalDraftFile(sessionId, draftBase, '.raapp-slug') ?? app.meta.id;

      for (const [filename, content] of Object.entries(mergedFiles)) {
        this.vfs.writeFile({ sessionId, filePath: `${draftBase}/${filename}`, content });
      }
      this.vfs.writeFile({ sessionId, filePath: `${draftBase}/.mode`, content: mode });
      this.vfs.writeFile({ sessionId, filePath: `${draftBase}/.raapp-slug`, content: slug });

      return {
        status: 'draft_created',
        id: app.meta.id,
        name: app.meta.name,
        source: 'user_release',
        draft_id: draftId,
        updatedFiles: Object.keys(updates),
        stored_files: Object.keys(mergedFiles),
        next_step: 'Test with raapp_test draft_id, run with raapp_execute_dsl, then publish with raapp_publish_draft.',
      };
    } catch (err) {
      this.logger.error(`[raapp_edit] Failed to update ${id}`, err);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// ─── raapp_delete ─────────────────────────────────────────────────────────────

@Injectable()
@ConfirmedTool({
  name: 'raapp_delete',
  description:
    'Permanently delete a user-uploaded RA-App by its ID. ' +
    'Core apps cannot be deleted. This action is irreversible. ' +
    'Use list_raapps to confirm the ID before deleting.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'The RA-App ID to delete.' },
    },
  },
})
export class RaAppDeleteTool {
  private readonly logger = new Logger(RaAppDeleteTool.name);

  constructor(private readonly raapp: RAAppService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const id = request.args['id'] as string;
    const app = this.raapp.getById(id);
    if (!app) {
      return { status: 'error', message: `RA-App "${id}" not found.` };
    }
    if (app.source === 'core') {
      return { status: 'error', message: `Core RA-App "${id}" cannot be deleted.` };
    }
    try {
      await this.raapp.delete(id);
      return { status: 'ok', deleted: id };
    } catch (err) {
      this.logger.error(`[raapp_delete] Failed to delete ${id}`, err);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
