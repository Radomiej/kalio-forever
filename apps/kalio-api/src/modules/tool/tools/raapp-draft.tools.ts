import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { EffectsProcessorService } from '../../raapp/effects-processor.service';
import { RAAppHITLService } from '../../raapp/raapp-hitl.service';
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
@Tool({
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
  requiresConfirmation: false,
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

    const mode = (request.args['mode'] as string | undefined) ?? 'display';

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

  async execute(request: ToolCallRequest): Promise<object> {
    const sessionId = request.sessionId;
    const draftId = request.args['draft_id'] as string;
    const inputs = (request.args['inputs'] ?? {}) as Record<string, unknown>;
    const draftBase = `drafts/${draftId}`;

    // Load draft files from VFS
    let uiGui: string | null = null;
    let uiYml: string | null = null;
    let systemsYml: string | null = null;
    let mode: 'display' | 'interactive' = 'display';

    try {
      try { uiGui = this.vfs.readFile(sessionId, `${draftBase}/ui.gui`).content; } catch { /* absent */ }
      try { uiYml = this.vfs.readFile(sessionId, `${draftBase}/ui.yml`).content; } catch { /* absent */ }
      try { systemsYml = this.vfs.readFile(sessionId, `${draftBase}/systems.yml`).content; } catch { /* absent */ }
      try {
        const modeContent = this.vfs.readFile(sessionId, `${draftBase}/.mode`).content.trim();
        if (modeContent === 'interactive') mode = 'interactive';
      } catch { /* use default */ }
    } catch (err) {
      this.logger.error(`[raapp_execute_dsl] VFS read error for draft ${draftId}`, err);
      return {
        status: 'error',
        message: `Could not load draft "${draftId}" from session VFS. Make sure raapp_create_draft was called first.`,
      };
    }

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
