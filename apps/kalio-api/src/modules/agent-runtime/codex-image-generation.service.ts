import { Injectable, Logger } from '@nestjs/common';
import type { NativeImageGenerator, NativeImageRequest, NativeImageResult } from '@kalio/types';
import sharp from 'sharp';
import { CodexAppServerHost } from './codex-app-server.host';
import { ExecutionProfileService } from './execution-profile.service';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';
import { runCodexImageTurn } from './codex-image-turn';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

@Injectable()
export class CodexImageGenerationService implements NativeImageGenerator {
  private readonly logger = new Logger(CodexImageGenerationService.name);
  constructor(
    private readonly host: CodexAppServerHost,
    private readonly profiles: ExecutionProfileService,
    private readonly mcpPolicy: CodexMcpPolicyService,
  ) {}

  async generate(request: NativeImageRequest): Promise<NativeImageResult> {
    if (request.abortSignal?.aborted) throw new Error('ChatGPT image generation cancelled.');
    const profile = await this.profiles.assertEnabled(request.executionProfileId);
    if (profile.kind !== 'codex-app-server' || (profile.provider && profile.provider !== 'openai')) throw new Error('Select an enabled ChatGPT / Codex execution profile for image generation.');
    const authProfileId = profile.authProfileId?.trim() || profile.id;
    const policy = await this.mcpPolicy.get(authProfileId);
    if (policy.inheritConfiguredMcp) throw new Error('Disable inherited MCP servers for the selected Codex integration in Settings, or select a separate integration without inherited MCP servers, before generating images.');
    const connection = await this.host.getConnection(authProfileId, 'read-only');
    const account = await connection.request('account/read', { refreshToken: false });
    if (!record(account) || !record(account['account']) || account['account']['type'] !== 'chatgpt') throw new Error('Sign in with ChatGPT in the selected Codex integration before generating images. API-key login is billed separately.');
    if (request.abortSignal?.aborted) throw new Error('ChatGPT image generation cancelled.');
    const response = await connection.request('thread/start', {
      model: profile.model || null, modelProvider: 'openai', ephemeral: true,
      approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [],
      baseInstructions: 'Generate or edit exactly one image using the built-in image generation tool and supplied image inputs. Do not call shell, filesystem, browser, MCP, or other tools. Return the generated image, not instructions or code.',
      config: {
        'features.image_generation': true, 'features.shell_tool': false,
        'features.unified_exec': false, 'features.apply_patch_freeform': false,
        'features.multi_agent': false, 'features.js_repl': false,
        'features.plugins': false, 'web_search': 'disabled',
      },
    });
    const thread = record(response) && record(response['thread']) ? response['thread'] : undefined;
    if (typeof thread?.['id'] !== 'string') throw new Error('ChatGPT returned no image thread id.');
    const threadId = thread['id'];
    this.host.registerThread(authProfileId, threadId);
    try {
      const result = await runCodexImageTurn(connection, threadId,
        `Use native image generation to create or edit one image. Requested size: ${request.size}; quality: ${request.quality}.\n${(request.references ?? []).map((ref, index) => `Image ${index + 1}: ${ref.role} — ${ref.label}`).join('\n')}\nImage instruction:\n${request.prompt}`, request.abortSignal, 180_000, request.references?.map(ref => ref.dataUrl));
      if (result.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result)) throw new Error('ChatGPT returned invalid or oversized image data.');
      const input = Buffer.from(result, 'base64');
      if (input.toString('base64') !== result || input.length > MAX_IMAGE_BYTES) throw new Error('ChatGPT returned invalid image data.');
      const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 }).toFormat(request.outputFormat).toBuffer({ resolveWithObject: true });
      return { bytes: data, mimeType: `image/${info.format}`, format: info.format, model: profile.model, width: info.width, height: info.height };
    } finally {
      this.host.unregisterThread(authProfileId, threadId);
      void connection.request('thread/unsubscribe', { threadId }).catch(error => {
        this.logger.warn(`Image thread cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
}
