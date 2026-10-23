const JEV_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_BATCH_QUESTIONS = 32;
const MAX_BATCH_TEXT_LENGTH = 4096;
const MAX_BATCH_REQUEST_BYTES = 65_536;

type JevConnection = Omit<JevDecisionRequest, 'questionId' | 'instructions'>;
type JevQuestion = { type: 'noul' | 'choice'; criteria: Record<string, string>; instructions: string };

export interface JevNoulBatchQuestion {
  questionId: string;
  instructions: string;
  criteria: { true: string; false: string };
}

export interface JevNoulBatchDecision extends JevConnection {
  questions: readonly JevNoulBatchQuestion[];
}

export interface JevNoulBatchResult {
  answers: Record<string, Pick<JevNoulResult, 'probability'>>;
  model?: string;
}

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
  async decideNoulBatch(input: JevNoulBatchDecision): Promise<JevNoulBatchResult> {
    if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > MAX_BATCH_QUESTIONS) {
      throw new Error('Jev batch requires 1–32 questions.');
    }
    const questions: Record<string, JevQuestion> = Object.create(null) as Record<string, JevQuestion>;
    for (const question of input.questions) {
      if (!isRecord(question) || typeof question.questionId !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(question.questionId)
        || Object.hasOwn(questions, question.questionId)
        || !validBatchText(question.instructions) || !isRecord(question.criteria)
        || Object.keys(question.criteria).length !== 2
        || !Object.hasOwn(question.criteria, 'true') || !Object.hasOwn(question.criteria, 'false')
        || !validBatchText(question.criteria.true) || !validBatchText(question.criteria.false)) {
        throw new Error('Jev batch has invalid or duplicate questions or criteria.');
      }
      questions[question.questionId] = {
        type: 'noul', instructions: question.instructions,
        criteria: { true: question.criteria.true, false: question.criteria.false },
      };
    }
    const response = await this.requestQuestions(input, questions, true);
    const ids = Object.keys(questions);
    if (!isRecord(response.answers) || Object.keys(response.answers).length !== ids.length
      || ids.some((id) => !Object.hasOwn(response.answers!, id))) {
      throw new Error('Jev Decisions API response does not contain exactly the requested batch answers.');
    }
    const entries = ids.map((id) => [id, { probability: this.readProbability(this.answerFor(response, id, 'noul')['noul']) }] as const);
    return {
      answers: Object.fromEntries(entries),
      ...(typeof response.model === 'string' ? { model: response.model } : {}),
    };
  }

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
    return this.requestQuestions(input, {
      [input.questionId]: { ...question, instructions: input.instructions },
    });
  }

  private async requestQuestions(
    input: JevConnection,
    questions: Record<string, JevQuestion>,
    boundedBatch = false,
  ): Promise<JevResponse> {
    let requestBody: string;
    try {
      requestBody = JSON.stringify({ model: input.model, questions, state: input.state });
    } catch {
      throw new Error('Jev Decisions API request is not JSON serializable.');
    }
    if (boundedBatch && new TextEncoder().encode(requestBody).byteLength > MAX_BATCH_REQUEST_BYTES) {
      throw new Error('Jev batch request exceeds the 65,536-byte limit.');
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.signal?.reason);
    if (input.signal?.aborted) {
      abortFromCaller();
    } else {
      input.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(new Error('Jev request timed out.')), JEV_TIMEOUT_MS);

    try {
      if (controller.signal.aborted) throw abortedRequest();
      let response: Response;
      try {
        response = await fetch(input.endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
            'Content-Type': 'application/json',
          },
          body: requestBody,
          signal: controller.signal,
        });
      } catch {
        if (controller.signal.aborted) throw abortedRequest();
        throw new Error('Jev Decisions API request failed.');
      }

      if (!response.ok) {
        throw new Error(`Jev Decisions API returned HTTP status ${response.status}.`);
      }

      let body: unknown;
      try {
        body = JSON.parse(await readBoundedResponse(response, controller.signal)) as unknown;
      } catch {
        if (controller.signal.aborted) throw abortedRequest();
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

function validBatchText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_BATCH_TEXT_LENGTH;
}

function abortedRequest(): DOMException {
  return new DOMException('Jev request aborted.', 'AbortError');
}

async function readBoundedResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('Missing decision response body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  let complete = false;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortedRequest());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) throw abortedRequest();
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw abortedRequest();
      if (chunk.done) { complete = true; break; }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new Error('Decision response exceeds the size limit.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', onAbort);
    try {
      if (!complete) await reader.cancel();
    } finally { reader.releaseLock(); }
  }
}
