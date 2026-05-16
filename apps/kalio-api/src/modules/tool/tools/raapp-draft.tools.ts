import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { Injectable, Logger } from '@nestjs/common';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import type { ToolCallRequest } from '@kalio/types';
import { ConfirmedTool, Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { EffectsProcessorService } from '../../raapp/effects-processor.service';
import { RAAppHITLService } from '../../raapp/raapp-hitl.service';
import { RAAppVersioningService, deriveSlug } from '../../raapp/raapp-versioning.service';
import type { RAAppMeta } from '../../raapp/raapp.service';
import { archiveDirectoryToZip } from '../../raapp/zip-archive.util';
import { VFSService } from '../../vfs/vfs.service';
import { EntityStore } from '../../raapp/entity-store';

// ─── raapp_create_draft ───────────────────────────────────────────────────────

/**
 * Draft workflow — two-step creation with user review:
 *
 * 1. LLM calls `raapp_create_draft` with YAML/DSL sources.
 * 2. Backend validates and saves a draft to VFS (sessions/{sessionId}/drafts/{draftId}/).
 * 3. Frontend shows the draft DSL to the user for Approve / Edit / Reject.
 * 4. User approves → LLM calls `raapp_execute_dsl` with the draft_id.
 * 5. Backend loads draft from VFS, executes, and returns the final RAAppBlock.
 */
@Injectable()
@ConfirmedTool({
  name: 'raapp_create_draft',
  description:
    'Create a draft RA-App from YAML/DSL source files and store it for user review. ' +
    'The draft is NOT executed immediately — the user must inspect and approve it first, ' +
    'then call raapp_execute_dsl with the returned draft_id. ' +
    'At least one of ui_gui or ui_yml is required. ' +
    'Provide systems_yml if the app uses an effect pipeline or ECS entities. ' +
    'This is the safe creation path — use raapp_create for quick one-off inline apps.',
  parameters: {
    type: 'object',
    required: [],
    properties: {
      meta_yml: {
        type: 'string',
        description:
          'App metadata YAML (id, name, version, description, tags, input_schema, output_type). ' +
          'If omitted a minimal meta block is auto-generated.',
      },
      systems_yml: {
        type: 'string',
        description: 'Effect pipeline YAML (assign, if, call_native, create_entity, set_field …).',
      },
      ui_gui: {
        type: 'string',
        description: 'GUI DSL content (window { … } layout). Preferred over ui_yml for interactive apps.',
      },
      ui_yml: {
        type: 'string',
        description: 'HTML template YAML (type: html, template: |…). Used when ui_gui is not provided.',
      },
      tests_yml: {
        type: 'string',
        description: 'Optional test suite YAML (tests: [{name, input, expect}]).',
      },
      mode: {
        type: 'string',
        enum: ['display', 'interactive'],
        description: 'Render mode. Defaults to "display".',
      },
    },
  },
})
export class RaAppCreateDraftTool {
  private readonly logger = new Logger(RaAppCreateDraftTool.name);

  constructor(
    private readonly vfs: VFSService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const sessionId = request.sessionId;
    const draftId = nanoid(10);
    const draftBase = `drafts/${draftId}`;

    const files: Record<string, string> = {};

    // Auto-generate minimal meta.yml if not provided
    const metaYml = request.args['meta_yml'] as string | undefined;
    files['meta.yml'] = metaYml ?? `id: draft-${draftId}\nname: Draft App\nversion: "1.0.0"\n`;

    const systemsYml = request.args['systems_yml'] as string | undefined;
    if (systemsYml) files['systems.yml'] = systemsYml;

    const uiGui = request.args['ui_gui'] as string | undefined;
    if (uiGui) files['ui.gui'] = uiGui;

    const uiYml = request.args['ui_yml'] as string | undefined;
    if (uiYml) files['ui.yml'] = uiYml;

    const testsYml = request.args['tests_yml'] as string | undefined;
    if (testsYml) files['tests.yml'] = testsYml;

    if (!files['ui.gui'] && !files['ui.yml']) {
      return {
        status: 'error',
        message: 'At least one of ui_gui or ui_yml must be provided for a draft RA-App.',
      };
    }

    const rawMode = (request.args['mode'] as string | undefined) ?? 'display';
    const mode: 'display' | 'interactive' = rawMode === 'interactive' ? 'interactive' : 'display';

    // Persist draft files to session VFS
    try {
      for (const [filename, content] of Object.entries(files)) {
        this.vfs.writeFile({ sessionId, filePath: `${draftBase}/${filename}`, content });
      }
      // Store mode so execute step can pick it up
      this.vfs.writeFile({ sessionId, filePath: `${draftBase}/.mode`, content: mode });
    } catch (err) {
      this.logger.error(`[raapp_create_draft] VFS write error for session ${sessionId}`, err);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // Build a human-readable summary of what was stored
    const dslSummary: Record<string, string> = {};
    for (const [filename, content] of Object.entries(files)) {
      dslSummary[filename] = content.length > 300 ? `${content.slice(0, 300)}…` : content;
    }

    return {
      status: 'draft_created',
      draft_id: draftId,
      mode,
      stored_files: Object.keys(files),
      dsl_summary: dslSummary,
      next_step: 'Show this draft to the user. After approval, call raapp_execute_dsl with the draft_id.',
    };
  }
}

// ─── raapp_execute_dsl ────────────────────────────────────────────────────────

@Injectable()
@Tool({
  name: 'raapp_execute_dsl',
  description:
    'Execute a previously approved RA-App draft. ' +
    'Call this ONLY after the user has reviewed and approved the draft produced by raapp_create_draft. ' +
    'The draft_id is returned by raapp_create_draft. ' +
    'Returns a ready RAAppBlock that is rendered in the chat UI.',
  parameters: {
    type: 'object',
    required: ['draft_id'],
    properties: {
      draft_id: {
        type: 'string',
        description: 'The draft ID returned by raapp_create_draft.',
      },
      inputs: {
        type: 'object',
        description: 'Optional runtime inputs passed to the systems.yml effect pipeline.',
      },
    },
  },
  requiresConfirmation: false,
})
export class RaAppExecuteDslTool {
  private readonly logger = new Logger(RaAppExecuteDslTool.name);

  constructor(
    private readonly raapp: RAAppService,
    private readonly effectsProcessor: EffectsProcessorService,
    private readonly hitl: RAAppHITLService,
    private readonly vfs: VFSService,
  ) {}

  private isMissingDraftFile(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'ENOENT' || code === 'VFS_FILE_NOT_FOUND';
  }

  private readOptionalDraftFile(sessionId: string, draftBase: string, filename: string): string | null {
    const filePath = `${draftBase}/${filename}`;
    try {
      return this.vfs.readFile(sessionId, filePath).content;
    } catch (err) {
      if (!this.isMissingDraftFile(err)) {
        this.logger.warn(
          `[raapp_execute_dsl] Unexpected VFS read error for ${filePath}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      return null;
    }
  }

  async execute(request: ToolCallRequest): Promise<object> {
    const sessionId = request.sessionId;
    const draftId = request.args['draft_id'] as string;
    const inputs = (request.args['inputs'] ?? {}) as Record<string, unknown>;
    const draftBase = `drafts/${draftId}`;

    // Load draft files from VFS
    const uiGui = this.readOptionalDraftFile(sessionId, draftBase, 'ui.gui');
    const uiYml = this.readOptionalDraftFile(sessionId, draftBase, 'ui.yml');
    const systemsYml = this.readOptionalDraftFile(sessionId, draftBase, 'systems.yml');
    let mode: 'display' | 'interactive' = 'display';

    const modeContent = this.readOptionalDraftFile(sessionId, draftBase, '.mode')?.trim();
    if (modeContent === 'interactive') mode = 'interactive';

    if (!uiGui && !uiYml) {
      return {
        status: 'error',
        message: `Draft "${draftId}" has no UI definition (ui.gui or ui.yml). It may have expired or the session changed.`,
      };
    }

    // GUI DSL path
    if (uiGui) {
      const outputData: Record<string, unknown> = { ...inputs };
      let pendingApprovals: import('@kalio/types').RaAppPendingApproval[] = [];

      if (systemsYml) {
        try {
          const entityStore = new EntityStore();
          const effectsResult = await this.effectsProcessor.processSystemsYaml(
            systemsYml,
            inputs,
            { sessionId },
            entityStore,
          );
          Object.assign(outputData, effectsResult.output);
          if (effectsResult.entities.length > 0) {
            outputData['entities'] = effectsResult.entities;
          }
          if (effectsResult.pendingApprovals.length > 0) {
            await this.hitl.savePendingApprovals(request.callId, sessionId, effectsResult.pendingApprovals);
            pendingApprovals = effectsResult.pendingApprovals.map((a) => ({
              id: a.id,
              system: a.system,
              displayLabel: a.displayLabel,
              args: a.args,
            }));
          }
        } catch (err) {
          this.logger.error(`[raapp_execute_dsl] Systems execution error`, err);
          return {
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const result = await this.raapp.execute({ type: 'gui', mode, content: uiGui }, { output: outputData });
      if (result.status === 'error') {
        return { status: 'error', message: result.error?.message };
      }
      return {
        status: 'ready',
        type: 'gui',
        mode,
        content: uiGui,
        renderedContent: result.renderedContent,
        ...(pendingApprovals.length > 0 ? { pendingApprovals } : {}),
      };
    }

    // HTML path (ui_yml)
    const result = await this.raapp.execute({ type: 'html', mode, content: uiYml! });
    if (result.status === 'error') {
      return { status: 'error', message: result.error?.message };
    }
    return {
      status: 'ready',
      type: 'html',
      mode,
      content: uiYml,
      renderedContent: result.renderedContent,
    };
  }
}

// ─── raapp_publish_draft ─────────────────────────────────────────────────────

@Injectable()
@ConfirmedTool({
  name: 'raapp_publish_draft',
  description:
    'Publish a raw VFS RA-App draft into the versioned release lifecycle. ' +
    'Reads files from drafts/<draft_id>, stores them as a versioned draft ZIP, then promotes them to a release. ' +
    'Use bump_type patch|minor|major for existing apps. New apps publish immediately as the first current release.',
  parameters: {
    type: 'object',
    required: ['draft_id'],
    properties: {
      draft_id: {
        type: 'string',
        description: 'The VFS draft ID under drafts/<draft_id>.',
      },
      bump_type: {
        type: 'string',
        enum: ['patch', 'minor', 'major'],
        description: 'Version bump to use when promoting over an existing release. Defaults to minor.',
      },
    },
  },
})
export class RaAppPublishDraftTool {
  private readonly logger = new Logger(RaAppPublishDraftTool.name);

  private resolvePublishSlug(meta: RAAppMeta, slugOverride: string | null): string | null {
    const candidates = [
      slugOverride,
      typeof meta.id === 'string' ? meta.id : null,
      typeof meta.name === 'string' ? deriveSlug(meta.name) : null,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    return null;
  }

  constructor(
    private readonly vfs: VFSService,
    private readonly versioning: RAAppVersioningService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const sessionId = request.sessionId;
    const draftId = request.args['draft_id'] as string | undefined;
    const rawBumpType = (request.args['bump_type'] as string | undefined) ?? 'minor';
    const bumpType: 'patch' | 'minor' | 'major' = rawBumpType === 'patch' || rawBumpType === 'major' ? rawBumpType : 'minor';

    if (!draftId) {
      return { status: 'error', message: 'draft_id is required.' };
    }
    if (!['patch', 'minor', 'major'].includes(rawBumpType)) {
      return { status: 'error', message: `Invalid bump_type: ${rawBumpType}` };
    }

    const draftPrefix = `drafts/${draftId}/`;
    const draftFiles = this.vfs.listFiles(sessionId).files.filter((file) => file.path.startsWith(draftPrefix));
    if (draftFiles.length === 0) {
      return {
        status: 'error',
        message: `Draft "${draftId}" not found in session VFS.`,
      };
    }

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kalio-raapp-publish-'));
    const tmpDir = path.join(tmpRoot, 'draft');
    const tmpZip = path.join(tmpRoot, `${draftId}.zip`);
    try {
      await fs.mkdir(tmpDir, { recursive: true });

      const buffers = new Map<string, Buffer>();
      for (const file of draftFiles) {
        const relativePath = file.path.slice(draftPrefix.length);
        buffers.set(relativePath, this.vfs.readBinary(sessionId, file.path));
      }

      const slugOverride = buffers.get('.raapp-slug')?.toString('utf-8').trim() || null;
      const modeOverride: 'display' | 'interactive' =
        buffers.get('.mode')?.toString('utf-8').trim() === 'interactive' ? 'interactive' : 'display';
      let meta: RAAppMeta | null = null;

      for (const [relativePath, buffer] of buffers.entries()) {
        if (relativePath === '.raapp-slug') {
          continue;
        }

        if (relativePath === '.mode') {
          continue;
        }

        if (relativePath === 'meta.yml') {
          meta = yaml.load(buffer.toString('utf-8')) as RAAppMeta;
          meta.execution = { ...(meta.execution ?? {}), render_as: modeOverride };
          const targetPath = path.join(tmpDir, relativePath);
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, yaml.dump(meta), 'utf-8');
          continue;
        }

        const targetPath = path.join(tmpDir, relativePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, buffer);
      }

      if (!meta) {
        return { status: 'error', message: `Draft "${draftId}" is missing meta.yml.` };
      }

      const slug = this.resolvePublishSlug(meta, slugOverride);
      if (!slug) {
        return {
          status: 'error',
          message: `Draft "${draftId}" must define a non-empty slug via .raapp-slug, meta.yml id, or meta.yml name.`,
        };
      }

      await archiveDirectoryToZip({
        sourceDir: tmpDir,
        zipPath: tmpZip,
        cleanupOnError: async () => {
          await fs.rm(tmpZip, { force: true });
        },
      });
      const buffer = await fs.readFile(tmpZip);

      const savedGroup = await this.versioning.saveAsDraft(slug, buffer);
      const releasedGroup = savedGroup.draft
        ? await this.versioning.approveDraft(slug, bumpType)
        : savedGroup;

      return {
        status: 'published',
        draft_id: draftId,
        slug,
        version: releasedGroup.current.version,
        bumpType,
      };
    } catch (err) {
      this.logger.error(`[raapp_publish_draft] Failed to publish draft ${draftId}`, err);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => { /* best effort */ });
    }
  }
}
