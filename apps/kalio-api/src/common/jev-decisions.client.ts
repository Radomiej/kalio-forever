const JEV_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 65_536;

export interface JevDecisionRequest {
  apiKey: string;
  endpoint: string;
  model: string;
  questionId: string;
  instructions: string;
  state: Record<string, unknown>;
  signal?: AbortSignal;
}

export type JevNoulDecision = JevDecisionRequest;

export interface JevChoiceDecision extends JevDecisionRequest {
  criteria: Record<string, string>;
}

export interface JevNoulResult {
  probability: number;
  model?: string;
}

export interface JevChoiceResult {
  choice: string;
  confidence: number;
  model?: string;
}

interface JevResponse {
  answers?: Record<string, unknown>;
  model?: unknown;
}

export class JevDecisionsClient {
  async decideNoul(input: JevNoulDecision): Promise<JevNoulResult> {
    const response = await this.request(input, {
      type: 'noul',
      criteria: {
        true: 'The answer is yes: allow the requested operation.',
        false: 'The answer is no: do not allow the requested operation.',
      },
    });
    const answer = this.answerFor(response, input.questionId, 'noul');
    const probability = this.readProbability(answer['noul']);
    return {
      probability,
      ...(typeof response.model === 'string' ? { model: response.model } : {}),
    };
  }

  async decideChoice(input: JevChoiceDecision): Promise<JevChoiceResult> {
    const response = await this.request(input, {
      type: 'choice',
      criteria: input.criteria,
    });
    const answer = this.answerFor(response, input.questionId, 'choice');
    const choice = answer['choice'];
    const confidence = this.readProbability(answer['confidence']);
    if (typeof choice !== 'string' || !Object.hasOwn(input.criteria, choice)) {
      throw new Error('Jev Decisions API returned an invalid choice.');
    }
    return {
      choice,
      confidence,
      ...(typeof response.model === 'string' ? { model: response.model } : {}),
    };
  }

  private async request(
    input: JevDecisionRequest,
    question: { type: 'noul' | 'choice'; criteria: Record<string, string> },
  ): Promise<JevResponse> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) {
      abortFromCaller();
    } else {
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error('Jev request timed out.')), JEV_TIMEOUT_MS);

    try {
      const response = await fetch(input.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          questions: {
            [input.questionId]: {
              ...question,
              instructions: input.instructions,
            },
          },
          state: input.state,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Jev Decisions API returned HTTP status ${response.status}.`);
      }

      let body: unknown;
      try {
        body = JSON.parse(await readBoundedResponse(response)) as unknown;
      } catch {
        throw new Error('Jev Decisions API returned invalid JSON.');
      }
      if (!isRecord(body)) {
        throw new Error('Jev Decisions API returned an invalid response.');
      }
      return body;
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private answerFor(
    response: JevResponse,
    questionId: string,
    expectedType: 'noul' | 'choice',
  ): Record<string, unknown> {
    const answer = response.answers?.[questionId];
    if (!isRecord(answer)) {
      throw new Error('Jev Decisions API response is missing the requested answer.');
    }
    if (answer['type'] !== expectedType) {
      throw new Error('Jev Decisions API returned an invalid decision type.');
    }
    return answer;
  }

  private readProbability(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Jev Decisions API returned an invalid probability or confidence.');
    }
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) throw new Error('Missing decision response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Decision response exceeds the size limit.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
