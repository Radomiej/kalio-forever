import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import type { LLMStructuredOutputRequest } from '@kalio/types';
import Ajv, { type ValidateFunction } from 'ajv';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { LLMService } from './llm.service';

const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 64_000;
const MAX_TOTAL_MESSAGE_CHARS = 128_000;
const MAX_SCHEMA_CHARS = 65_536;
const MAX_SCHEMA_NAME_CHARS = 64;
const MAX_SCHEMA_DESCRIPTION_CHARS = 1_000;
const MIN_OUTPUT_TOKENS = 64;
const MAX_OUTPUT_TOKENS = 8_192;
const DEFAULT_OUTPUT_TOKENS = 2_048;
const MAX_CONCURRENT_REQUESTS = 2;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const structuredOutputAjv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});

interface StructuredLLMRequest {
  messages: ContextManagedLLMMessage[];
  outputSchema: LLMStructuredOutputRequest;
  validateOutput: ValidateFunction;
  maxOutputTokens: number;
}

interface StructuredLLMResponse {
  output: unknown;
  meta: {
    provider: string;
    model: string;
    source: 'db' | 'env';
  };
}

@Controller('v1/llm')
export class StructuredLLMController {
  private readonly logger = new Logger(StructuredLLMController.name);
  private activeRequests = 0;

  constructor(private readonly llm: LLMService) {}

  @Post('structured')
  async generate(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<StructuredLLMResponse> {
    assertAuthorized(authorization);
    const request = parseRequest(body);
    if (this.activeRequests >= MAX_CONCURRENT_REQUESTS) {
      throw new HttpException(
        {
          code: 'EXTERNAL_LLM_BUSY',
          message: 'The external LLM API is busy. Retry after an active request completes.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.activeRequests += 1;
    const requestId = `external-structured-${randomUUID()}`;
    let receivedStructuredOutput = false;
    let structuredOutput: unknown;

    try {
      await this.llm.streamChat(request.messages, [], {
        sessionId: requestId,
        messageId: requestId,
        maxOutputTokens: request.maxOutputTokens,
        structuredOutput: request.outputSchema,
        onChunk: () => undefined,
        onStructuredOutput: (value) => {
          receivedStructuredOutput = true;
          structuredOutput = value;
        },
      });

      if (!receivedStructuredOutput) {
        throw providerHttpException(
          'LLM_BAD_STRUCTURED_OUTPUT',
          HttpStatus.BAD_GATEWAY,
          'The active LLM provider did not return structured output.',
        );
      }

      if (!request.validateOutput(structuredOutput)) {
        const validationPaths = request.validateOutput.errors
          ?.slice(0, 5)
          .map((issue) => issue.instancePath || '/')
          .join(', ') ?? '/';
        this.logger.warn(
          `Structured LLM response failed schema validation at ${validationPaths}`,
        );
        throw providerHttpException(
          'LLM_BAD_STRUCTURED_OUTPUT',
          HttpStatus.BAD_GATEWAY,
          'The active LLM provider returned invalid structured output.',
        );
      }

      const config = await this.llm.getConfig();
      return {
        output: structuredOutput,
        meta: {
          provider: config.provider,
          model: config.model,
          source: config.source,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const code = readProviderErrorCode(error);
      const status = providerHttpStatus(code);
      this.logger.warn(`Structured LLM request failed with ${code}`);
      throw providerHttpException(code, status, providerErrorMessage(code));
    } finally {
      this.activeRequests -= 1;
    }
  }
}

function assertAuthorized(authorization?: string): void {
  const configuredToken = process.env['KALIO_EXTERNAL_API_TOKEN']?.trim();
  if (!configuredToken) {
    throw new HttpException(
      {
        code: 'EXTERNAL_LLM_API_DISABLED',
        message: 'The external LLM API requires KALIO_EXTERNAL_API_TOKEN.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  const providedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!safeTokenEquals(providedToken, configuredToken)) {
    throw new HttpException(
      {
        code: 'EXTERNAL_LLM_UNAUTHORIZED',
        message: 'A valid bearer token is required for the external LLM API.',
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}

function safeTokenEquals(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

function parseRequest(body: unknown): StructuredLLMRequest {
  if (!isRecord(body)) {
    throw badRequest('body', 'Request body must be an object.');
  }

  const messages = parseMessages(body['messages']);
  const outputSchema = parseOutputSchema(body['outputSchema']);
  const validateOutput = compileOutputSchema(outputSchema.schema);
  const maxOutputTokens = parseMaxOutputTokens(body['maxOutputTokens']);

  return { messages, outputSchema, validateOutput, maxOutputTokens };
}

function parseMessages(value: unknown): ContextManagedLLMMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    throw badRequest('messages', `Provide between 1 and ${MAX_MESSAGES} messages.`);
  }

  let totalChars = 0;
  const messages = value.map((entry, index): ContextManagedLLMMessage => {
    if (!isRecord(entry)) {
      throw badRequest('messages', `Message ${index} must be an object.`);
    }
    const role = entry['role'];
    const content = entry['content'];
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) {
      throw badRequest('messages', `Message ${index} has an unsupported role.`);
    }
    if (typeof content !== 'string' || content.trim().length === 0 || content.length > MAX_MESSAGE_CHARS) {
      throw badRequest('messages', `Message ${index} content must be non-empty and at most ${MAX_MESSAGE_CHARS} characters.`);
    }
    totalChars += content.length;
    return { role: role as 'system' | 'user' | 'assistant', content };
  });

  if (totalChars > MAX_TOTAL_MESSAGE_CHARS) {
    throw badRequest('messages', `Combined message content exceeds ${MAX_TOTAL_MESSAGE_CHARS} characters.`);
  }
  return messages;
}

function parseOutputSchema(value: unknown): LLMStructuredOutputRequest {
  if (!isRecord(value)) {
    throw badRequest('outputSchema', 'outputSchema must be an object.');
  }

  const name = value['name'];
  if (
    typeof name !== 'string'
    || name.length === 0
    || name.length > MAX_SCHEMA_NAME_CHARS
    || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)
  ) {
    throw badRequest('outputSchema', 'outputSchema.name must be a valid schema identifier.');
  }

  const schema = value['schema'];
  if (!isRecord(schema)) {
    throw badRequest('outputSchema', 'outputSchema.schema must be a JSON Schema object.');
  }

  let serializedSchema: string;
  try {
    serializedSchema = JSON.stringify(schema);
  } catch (error) {
    throw badRequest(
      'outputSchema',
      `outputSchema.schema must be serializable: ${error instanceof Error ? error.name : 'unknown error'}.`,
    );
  }
  if (serializedSchema.length > MAX_SCHEMA_CHARS) {
    throw badRequest('outputSchema', `outputSchema.schema exceeds ${MAX_SCHEMA_CHARS} characters.`);
  }

  const strict = value['strict'];
  if (strict !== undefined && typeof strict !== 'boolean') {
    throw badRequest('outputSchema', 'outputSchema.strict must be a boolean.');
  }

  const description = value['description'];
  if (
    description !== undefined
    && (typeof description !== 'string' || description.length > MAX_SCHEMA_DESCRIPTION_CHARS)
  ) {
    throw badRequest(
      'outputSchema',
      `outputSchema.description must be at most ${MAX_SCHEMA_DESCRIPTION_CHARS} characters.`,
    );
  }

  return {
    name,
    schema,
    strict: strict ?? true,
    ...(typeof description === 'string' ? { description } : {}),
  };
}

function parseMaxOutputTokens(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_OUTPUT_TOKENS;
  }
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < MIN_OUTPUT_TOKENS
    || value > MAX_OUTPUT_TOKENS
  ) {
    throw badRequest(
      'maxOutputTokens',
      `maxOutputTokens must be an integer between ${MIN_OUTPUT_TOKENS} and ${MAX_OUTPUT_TOKENS}.`,
    );
  }
  return value;
}

function compileOutputSchema(schema: Record<string, unknown>): ValidateFunction {
  try {
    return structuredOutputAjv.compile(schema);
  } catch {
    throw badRequest(
      'outputSchema',
      'outputSchema.schema must be a valid JSON Schema.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function badRequest(field: string, message: string): HttpException {
  return new HttpException({ code: 'INVALID_REQUEST', field, message }, HttpStatus.BAD_REQUEST);
}

function readProviderErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error['code'] === 'string') {
    return error['code'];
  }
  return 'LLM_ERROR';
}

function providerHttpStatus(code: string): HttpStatus {
  switch (code) {
    case 'LLM_RATE_LIMIT':
    case 'LLM_QUOTA':
      return HttpStatus.TOO_MANY_REQUESTS;
    case 'LLM_TIMEOUT':
    case 'LLM_PROVIDER_DOWN':
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.BAD_GATEWAY;
  }
}

function providerErrorMessage(code: string): string {
  switch (code) {
    case 'LLM_RATE_LIMIT':
      return 'The active LLM provider is rate limited.';
    case 'LLM_QUOTA':
      return 'The active LLM provider quota is exhausted.';
    case 'LLM_TIMEOUT':
      return 'The active LLM provider timed out.';
    case 'LLM_PROVIDER_DOWN':
      return 'The active LLM provider is unavailable.';
    case 'LLM_AUTH':
      return 'The active LLM provider rejected its configured credentials.';
    case 'LLM_BAD_STRUCTURED_OUTPUT':
      return 'The active LLM provider returned invalid structured output.';
    default:
      return 'The active LLM provider request failed.';
  }
}

function providerHttpException(code: string, status: HttpStatus, message: string): HttpException {
  return new HttpException({ code, message }, status);
}
