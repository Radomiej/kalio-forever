import Ajv, { type ValidateFunction } from 'ajv';
import type { LLMStructuredOutputRequest } from '@kalio/types';
import type { DevinAcpToolActivity } from './devin-cli-acp.host';

/** Maximum raw UTF-16 code units in the final post-tool answer, including whitespace. */
export const DEVIN_FINAL_JSON_MAX_CHARS = 65_536;

export class DevinStructuredOutputError extends Error {
  constructor(readonly code: 'LLM_BAD_STRUCTURED_OUTPUT' | 'LLM_STRUCTURED_OUTPUT_SCHEMA_INVALID', message: string,
    readonly safeToRepair = false) {
    super(message);
  }
}

/** ACP has no schema field here: prompt JSON, then validate locally without recovery. */
export class DevinStructuredOutput {
  readonly instruction: string;
  private readonly validate: ValidateFunction;
  private text = '';
  private overflow = false;
  private readonly pending = new Set<string>();
  private readonly terminal = new Set<string>();
  private ambiguous = false;
  private sealed = false;

  constructor(request: LLMStructuredOutputRequest) {
    try {
      const schemaText = JSON.stringify(request.schema);
      const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: false,
        coerceTypes: false, useDefaults: false, removeAdditional: false });
      this.validate = ajv.compile(JSON.parse(schemaText) as Record<string, unknown>);
      if ('$async' in this.validate) throw new Error('Async schemas are unsupported');
      this.instruction = [
        'KALIO FINAL JSON CONTRACT (host-validated, not native ACP constrained generation):',
        `Schema name: ${request.name}`,
        `Schema: ${schemaText}`,
        `After all tools finish, return exactly one complete JSON value, at most ${DEVIN_FINAL_JSON_MAX_CHARS} characters.`,
        'Match the schema exactly. No prose, Markdown fences or wrapper objects around the final JSON.',
      ].join('\n');
    } catch {
      throw new DevinStructuredOutputError('LLM_STRUCTURED_OUTPUT_SCHEMA_INVALID', 'Devin structured output schema is invalid or unsupported.');
    }
  }

  onText(text: string): void {
    if (this.sealed) this.ambiguous = true;
    if (this.pending.size > 0 || this.overflow) return;
    if (this.text.length + text.length > DEVIN_FINAL_JSON_MAX_CHARS) {
      this.text = '';
      this.overflow = true;
      return;
    }
    this.text += text;
  }

  onTool(activity: DevinAcpToolActivity): void {
    if (this.sealed) this.ambiguous = true;
    // Every update invalidates preceding text, even a late duplicate completion.
    this.text = '';
    this.overflow = false;
    const id = activity.toolCallId;
    if (!id.trim()) this.ambiguous = true;
    if (activity.status === 'completed' || activity.status === 'failed') {
      this.pending.delete(id);
      this.terminal.add(id);
    } else {
      // Missing status can be a metadata-only terminal update. Preserve terminal
      // identity, but a terminal ID restarting is ambiguous and must not route.
      if (this.terminal.has(id)) {
        if (activity.status != null) this.ambiguous = true;
      } else {
        this.pending.add(id);
      }
    }
  }

  result(): unknown {
    this.sealed = true;
    if (this.pending.size > 0 || this.ambiguous || this.overflow) {
      throw new DevinStructuredOutputError('LLM_BAD_STRUCTURED_OUTPUT', 'Devin final JSON has unresolved tool activity or exceeds the size limit.');
    }
    let value: unknown;
    try {
      value = JSON.parse(this.text) as unknown;
    } catch {
      throw new DevinStructuredOutputError('LLM_BAD_STRUCTURED_OUTPUT', 'Devin final answer must be one complete JSON value.', this.terminal.size === 0);
    }
    if (!this.validate(value)) {
      throw new DevinStructuredOutputError('LLM_BAD_STRUCTURED_OUTPUT', 'Devin final JSON does not match the requested schema.', this.terminal.size === 0);
    }
    return value;
  }
}
