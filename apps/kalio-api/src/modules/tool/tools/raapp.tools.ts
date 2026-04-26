import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { RAAppService } from '../../raapp/raapp.service';
import { RAAppSandboxService } from '../../raapp/raapp-sandbox.service';

@Injectable()
@Tool({
  name: 'raapp_create',
  description:
    'Create an RA-App block from HTML or GUI DSL content and validate it. ' +
    'Returns a ready block descriptor that can be rendered in the chat UI. ' +
    'For interactive mode (mode="interactive"), the HTML can send user selections back to the ' +
    'conversation using: window.parent.postMessage({ type: "kalio_send_message", content: "user answer" }, "*"). ' +
    'This lets users click buttons or options inside the app and have their choice appear as a chat message.',
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

    const result = await this.raapp.execute({ type, mode: mode as 'display' | 'interactive', content });

    if (result.status === 'error') {
      this.logger.warn(`[raapp_create] Execution error: ${result.error?.message}`);
      return {
        status: 'error',
        code: result.error?.code,
        message: result.error?.message,
      };
    }

    return {
      status: 'ready',
      type,
      mode,
      content,
      renderedContent: result.renderedContent,
    };
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
