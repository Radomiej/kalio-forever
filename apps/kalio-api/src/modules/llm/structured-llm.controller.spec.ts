import { HttpException, HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMService } from './llm.service';
import { StructuredLLMController } from './structured-llm.controller';

describe('StructuredLLMController', () => {
  let controller: StructuredLLMController;
  const mockLLMService = {
    getConfig: vi.fn(),
    streamChat: vi.fn(),
  };

  const validBody = {
    messages: [
      { role: 'system', content: 'Return a plan.' },
      { role: 'user', content: 'Revenue by region.' },
    ],
    outputSchema: {
      name: 'data_analyst_plan',
      description: 'A deterministic analysis plan',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          dimensions: { type: 'array', items: { type: 'string' } },
        },
        required: ['dimensions'],
        additionalProperties: false,
      },
    },
    maxOutputTokens: 2048,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StructuredLLMController],
      providers: [{ provide: LLMService, useValue: mockLLMService }],
    }).compile();

    controller = module.get(StructuredLLMController);
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('KALIO_EXTERNAL_API_TOKEN', 'test-external-token');
    mockLLMService.getConfig.mockResolvedValue({
      provider: 'mock',
      apiKey: '',
      baseUrl: '',
      model: 'mock-model',
      source: 'env',
    });
  });

  const generate = (
    body: unknown,
    authorization = 'Bearer test-external-token',
  ) => controller.generate(body, authorization);

  it('delegates a bounded structured request without exposing provider secrets', async () => {
    const output = { dimensions: ['region'] };
    mockLLMService.streamChat.mockImplementation(
      async (
        _messages: unknown,
        _tools: unknown,
        options: { onStructuredOutput?: (value: unknown) => void },
      ) => {
        options.onStructuredOutput?.(output);
        return [];
      },
    );

    await expect(generate(validBody)).resolves.toEqual({
      output,
      meta: {
        provider: 'mock',
        model: 'mock-model',
        source: 'env',
      },
    });

    expect(mockLLMService.streamChat).toHaveBeenCalledTimes(1);
    const [messages, tools, options] = mockLLMService.streamChat.mock.calls[0] ?? [];
    expect(messages).toEqual(validBody.messages);
    expect(tools).toEqual([]);
    expect(options).toEqual(expect.objectContaining({
      maxOutputTokens: 2048,
      structuredOutput: validBody.outputSchema,
      onChunk: expect.any(Function),
      onStructuredOutput: expect.any(Function),
      sessionId: expect.stringMatching(/^external-structured-/),
      messageId: expect.stringMatching(/^external-structured-/),
    }));
  });

  it.each([
    [{}, 'messages'],
    [{ ...validBody, messages: [] }, 'messages'],
    [{ ...validBody, messages: [{ role: 'tool', content: 'not allowed' }] }, 'messages'],
    [{ ...validBody, messages: [{ role: 'user', content: '' }] }, 'messages'],
    [{ ...validBody, outputSchema: { ...validBody.outputSchema, name: '' } }, 'outputSchema'],
    [{ ...validBody, outputSchema: { ...validBody.outputSchema, schema: [] } }, 'outputSchema'],
    [{ ...validBody, maxOutputTokens: 63 }, 'maxOutputTokens'],
    [{ ...validBody, maxOutputTokens: 32769 }, 'maxOutputTokens'],
  ])('rejects malformed input %#', async (body, expectedField) => {
    await expect(generate(body)).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === HttpStatus.BAD_REQUEST
      && JSON.stringify(error.getResponse()).includes(expectedField)
    ));
    expect(mockLLMService.streamChat).not.toHaveBeenCalled();
  });

  it('rejects requests whose serialized schema exceeds the endpoint limit', async () => {
    const body = {
      ...validBody,
      outputSchema: {
        ...validBody.outputSchema,
        schema: {
          type: 'object',
          description: 'x'.repeat(70_000),
        },
      },
    };

    await expect(generate(body)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(mockLLMService.streamChat).not.toHaveBeenCalled();
  });

  it('returns 502 when the provider completes without structured output', async () => {
    mockLLMService.streamChat.mockResolvedValue([]);

    await expect(generate(validBody)).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === HttpStatus.BAD_GATEWAY
      && JSON.stringify(error.getResponse()).includes('LLM_BAD_STRUCTURED_OUTPUT')
    ));
  });

  it.each([
    ['LLM_RATE_LIMIT', HttpStatus.TOO_MANY_REQUESTS],
    ['LLM_QUOTA', HttpStatus.TOO_MANY_REQUESTS],
    ['LLM_TIMEOUT', HttpStatus.SERVICE_UNAVAILABLE],
    ['LLM_PROVIDER_DOWN', HttpStatus.SERVICE_UNAVAILABLE],
    ['LLM_AUTH', HttpStatus.BAD_GATEWAY],
    ['LLM_BAD_STRUCTURED_OUTPUT', HttpStatus.BAD_GATEWAY],
    ['LLM_ERROR', HttpStatus.BAD_GATEWAY],
  ])('maps provider error %s to HTTP %s', async (code, status) => {
    mockLLMService.streamChat.mockRejectedValue(Object.assign(new Error('provider detail'), { code }));

    await expect(generate(validBody)).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === status
      && JSON.stringify(error.getResponse()).includes(code)
      && !JSON.stringify(error.getResponse()).includes('provider detail')
    ));
  });

  it('keeps the endpoint disabled when no external API token is configured', async () => {
    vi.stubEnv('KALIO_EXTERNAL_API_TOKEN', '');

    await expect(generate(validBody)).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(mockLLMService.streamChat).not.toHaveBeenCalled();
  });

  it('requires the configured bearer token and allows a matching caller', async () => {
    vi.stubEnv('KALIO_EXTERNAL_API_TOKEN', 'integration-secret');
    mockLLMService.streamChat.mockImplementation(
      async (
        _messages: unknown,
        _tools: unknown,
        options: { onStructuredOutput?: (value: unknown) => void },
      ) => {
        options.onStructuredOutput?.({ dimensions: ['region'] });
        return [];
      },
    );

    await expect(generate(validBody, 'Bearer wrong')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
    await expect(generate(
      validBody,
      'Bearer integration-secret',
    )).resolves.toMatchObject({
      output: { dimensions: ['region'] },
    });
  });

  it('rejects provider output that does not match the requested schema', async () => {
    mockLLMService.streamChat.mockImplementation(
      async (
        _messages: unknown,
        _tools: unknown,
        options: { onStructuredOutput?: (value: unknown) => void },
      ) => {
        options.onStructuredOutput?.({ wrong: true });
        return [];
      },
    );

    await expect(generate(validBody)).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === HttpStatus.BAD_GATEWAY
      && JSON.stringify(error.getResponse()).includes('LLM_BAD_STRUCTURED_OUTPUT')
    ));
  });

  it('enforces JSON Schema constraints beyond the legacy structural subset', async () => {
    mockLLMService.streamChat.mockImplementation(
      async (
        _messages: unknown,
        _tools: unknown,
        options: { onStructuredOutput?: (value: unknown) => void },
      ) => {
        options.onStructuredOutput?.({ value: 'too-long' });
        return [];
      },
    );

    await expect(generate({
      ...validBody,
      outputSchema: {
        ...validBody.outputSchema,
        schema: {
          type: 'object',
          properties: {
            value: { type: 'string', maxLength: 3 },
          },
          required: ['value'],
          additionalProperties: false,
        },
      },
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === HttpStatus.BAD_GATEWAY
      && JSON.stringify(error.getResponse()).includes('LLM_BAD_STRUCTURED_OUTPUT')
    ));
  });

  it('rejects an invalid JSON Schema before calling the provider', async () => {
    await expect(generate({
      ...validBody,
      outputSchema: {
        ...validBody.outputSchema,
        schema: {
          type: 'not-a-json-schema-type',
        },
      },
    })).rejects.toSatisfy((error: unknown) => (
      error instanceof HttpException
      && error.getStatus() === HttpStatus.BAD_REQUEST
      && JSON.stringify(error.getResponse()).includes('outputSchema')
    ));
    expect(mockLLMService.streamChat).not.toHaveBeenCalled();
  });

  it('rejects requests above the external concurrency cap', async () => {
    let releaseRequests: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    mockLLMService.streamChat.mockImplementation(
      async (
        _messages: unknown,
        _tools: unknown,
        options: { onStructuredOutput?: (value: unknown) => void },
      ) => {
        options.onStructuredOutput?.({ dimensions: ['region'] });
        await pending;
        return [];
      },
    );

    const first = generate(validBody);
    const second = generate(validBody);
    await expect(generate(validBody)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    releaseRequests?.();
    await Promise.all([first, second]);
  });
});
