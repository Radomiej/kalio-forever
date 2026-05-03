import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { RAAppSandboxService } from '../../raapp/raapp-sandbox.service';
import { EffectsProcessorService } from '../../raapp/effects-processor.service';
import { RAAppHITLService } from '../../raapp/raapp-hitl.service';

@Injectable()
@Tool({
  name: 'raapp_create',
  description:
    'Create an RA-App block from HTML or GUI DSL content and validate it. ' +
    'Returns a ready block descriptor that can be rendered in the chat UI. ' +
    'For interactive mode (mode="interactive"), the HTML can send user selections back to the ' +
    'conversation using: window.parent.postMessage({ type: "kalio_send_message", content: "user answer" }, "*"). ' +
    'This lets users click buttons or options inside the app and have their choice appear as a chat message. ' +
    'Use this ONLY when building a custom one-off app. For stored apps use run_raapp instead.',
  parameters: {
    type: 'object',
    required: ['type', 'content'],
    properties: {
      type: {
        type: 'string',
        enum: ['html', 'gui'],
        description: 'Block type: "html" for raw HTML, "gui" for GUI DSL',
      },
      content: {
        type: 'string',
        description: 'The HTML string or GUI DSL YAML content',
      },
      mode: {
        type: 'string',
        enum: ['display', 'interactive'],
        description: 'Render mode. Defaults to "display".',
      },
      title: {
        type: 'string',
        description: 'Optional human-readable app title to store in catalog metadata.',
      },
    },
  },
  requiresConfirmation: false,
})
export class RaAppCreateTool {
  private readonly logger = new Logger(RaAppCreateTool.name);

  constructor(private readonly raapp: RAAppService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const type = request.args['type'] as 'html' | 'gui';
    const content = request.args['content'] as string;
    const mode = (request.args['mode'] as string | undefined) ?? 'display';
    const title = request.args['title'] as string | undefined;

    const result = await this.raapp.execute({ type, mode: mode as 'display' | 'interactive', content });

    if (result.status === 'error') {
      this.logger.warn(`[raapp_create] Execution error: ${result.error?.message}`);
      return {
        status: 'error',
        code: result.error?.code,
        message: result.error?.message,
      };
    }

    const saved = await this.raapp.saveGeneratedApp({
      type,
      content,
      mode: mode as 'display' | 'interactive',
      sessionId: request.sessionId,
      ...(title !== undefined && { title }),
    });

    return {
      status: 'ready',
      type,
      mode,
      content,
      renderedContent: result.renderedContent,
      storedAppId: saved.id,
    };
  }
}

@Injectable()
@Tool({
  name: 'run_raapp',
  description:
    'Run a stored RA-App by its ID. The app is rendered in the chat UI as an interactive or display block. ' +
    'Call list_raapps first to discover available app IDs and their descriptions. ' +
    'For apps with input_schema, pass inputs via the "inputs" parameter (e.g. for qa-interactive: { question, options, allow_custom }). ' +
    'GUI DSL apps use [output.key] bindings — inputs are passed as { output: { ...your inputs } } automatically.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        description: 'The stored RA-App ID to run (e.g. "qa-interactive").',
      },
      inputs: {
        type: 'object',
        description: 'Input data for the app (matched to its input_schema). For qa-interactive: { question: string, options: string[], allow_custom?: boolean }',
      },
    },
  },
  requiresConfirmation: false,
})
export class RunRaAppTool {
  private readonly logger = new Logger(RunRaAppTool.name);

  constructor(
    private readonly raapp: RAAppService,
    private readonly effectsProcessor: EffectsProcessorService,
    private readonly hitl: RAAppHITLService,
  ) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const id = request.args['id'] as string;
    const inputs = (request.args['inputs'] ?? {}) as Record<string, unknown>;
    const sessionId = request.sessionId;
    const app = this.raapp.getById(id);

    if (!app) {
      const available = this.raapp.getAll().map((a) => a.id);
      return {
        status: 'error',
        message: `RA-App "${id}" not found. Available IDs: ${available.length > 0 ? available.join(', ') : '(none stored yet)'}`,
      };
    }

    // GUI DSL app (ui.gui)
    if (app.guiContent) {
      // Flatten array inputs into indexed keys: options[0..N] → output.option_0..N
      const outputData: Record<string, unknown> = { ...inputs };
      if (Array.isArray(inputs['options'])) {
        (inputs['options'] as unknown[]).forEach((opt, i) => {
          outputData[`option_${i}`] = opt;
        });
        delete outputData['options'];
      }
      // Execute system effects (including call_native) to compute derived outputs
      let pendingApprovals: import('@kalio/types').RaAppPendingApproval[] = [];
      if (app.systemsContent) {
        const effectsResult = await this.effectsProcessor.processSystemsYaml(
          app.systemsContent,
          inputs,
          { sessionId },
        );
        Object.assign(outputData, effectsResult.output);

        if (effectsResult.pendingApprovals.length > 0) {
          await this.hitl.savePendingApprovals(request.callId, sessionId, effectsResult.pendingApprovals);
          pendingApprovals = effectsResult.pendingApprovals.map((a) => ({
            id: a.id,
            system: a.system,
            displayLabel: a.displayLabel,
            args: a.args,
          }));
        }
      }
      const data = { output: outputData };
      const result = await this.raapp.execute({ type: 'gui', mode: app.appMode, content: app.guiContent }, data);
      if (result.status === 'error') {
        this.logger.warn(`[run_raapp] GUI DSL error: ${result.error?.message}`);
        return { status: 'error', message: result.error?.message };
      }
      return {
        status: 'ready',
        type: 'gui',
        mode: app.appMode,
        content: app.guiContent,
        renderedContent: result.renderedContent,
        ...(pendingApprovals.length > 0 ? { pendingApprovals } : {}),
      };
    }

    // HTML app (main.html / index.html)
    if (!app.htmlContent) {
      return {
        status: 'error',
        message: `RA-App "${id}" has no renderable content (missing main.html, index.html, or ui.gui in the zip).`,
      };
    }

    const result = await this.raapp.execute({ type: 'html', mode: app.appMode, content: app.htmlContent });
    if (result.status === 'error') {
      this.logger.warn(`[run_raapp] Execution error: ${result.error?.message}`);
      return { status: 'error', message: result.error?.message };
    }

    return {
      status: 'ready',
      type: 'html',
      mode: app.appMode,
      content: app.htmlContent,
      renderedContent: result.renderedContent,
    };
  }
}

@Injectable()
@Tool({
  name: 'list_raapps',
  description: 'List all stored RA-Apps with their IDs, names, and descriptions. Use this before run_raapp to find the right ID.',
  parameters: { type: 'object', properties: {} },
  requiresConfirmation: false,
})
export class ListRaAppsTool {
  constructor(private readonly raapp: RAAppService) {}

  execute(_request: ToolCallRequest): Promise<object> {
    const apps = this.raapp.getAll().map((a) => ({
      id: a.id,
      name: a.meta.name,
      description: a.meta.description ?? '',
      tool_description: a.meta.tool_description ?? '',
      input_schema: a.meta.input_schema ?? null,
      tags: a.meta.tags ?? [],
      mode: a.appMode,
      source: a.source,
    }));
    return Promise.resolve({ count: apps.length, apps });
  }
}

@Injectable()
@Tool({
  name: 'raapp_compile',
  description:
    'Validate and compile GUI DSL code in a sandboxed VM. ' +
    'Returns the result of executing the DSL or an error with details. ' +
    'Use this to check DSL code before embedding it in the chat.',
  parameters: {
    type: 'object',
    required: ['code'],
    properties: {
      code: {
        type: 'string',
        description: 'GUI DSL JavaScript code to compile and execute in sandbox',
      },
    },
  },
  requiresConfirmation: false,
})
export class RaAppCompileTool {
  private readonly logger = new Logger(RaAppCompileTool.name);

  constructor(private readonly sandbox: RAAppSandboxService) {}

  async execute(request: ToolCallRequest): Promise<object> {
    const code = request.args['code'] as string;

    try {
      const output = await this.sandbox.execute(code);
      return { status: 'ok', output };
    } catch (err) {
      this.logger.warn(`[raapp_compile] Sandbox error: ${err instanceof Error ? err.message : err}`);
      return {
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown sandbox error',
      };
    }
  }
}
