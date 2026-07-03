import type { LLMStructuredOutputRequest } from '@kalio/types';
import { validateStructuredOutputSchema } from './structured-output-schema.validator';

const WRAPPER_KEYS = ['output', 'result', 'data', 'routerOutput', 'finalArtifact'] as const;
const MAX_VALIDATION_ERRORS = 3;
const MAX_JSON_CANDIDATES = 30;
const MAX_JSON_CANDIDATE_CHARS = 200_000;

export type StructuredOutputRecoveryMode = 'strict' | 'extracted' | 'unwrapped' | 'extracted_unwrapped';

export interface StructuredOutputParseResult {
  value: unknown;
  mode: StructuredOutputRecoveryMode;
}

export interface StructuredOutputParseFailure {
  reason: 'invalid_json' | 'schema_mismatch';
  preview: string;
  details?: string;
}

export function parseStructuredOutputResponse(
  raw: string,
  request: LLMStructuredOutputRequest,
): StructuredOutputParseResult | StructuredOutputParseFailure {
  const trimmed = raw.trim();
  const strictJson = parseJson(trimmed);
  if (strictJson.ok) {
    const normalized = normalizeStructuredOutput(strictJson.value, request);
    if (normalized) {
      return normalized.mode === 'unwrapped'
        ? normalized
        : { value: normalized.value, mode: 'strict' };
    }
    return {
      reason: 'schema_mismatch',
      preview: preview(raw),
      details: validationDetails(strictJson.value, request),
    };
  }

  const validCandidates: StructuredOutputParseResult[] = [];
  let sawParseableCandidate = false;
  let firstValidationDetails: string | undefined;
  for (const candidate of extractedJsonCandidates(trimmed)) {
    const parsed = parseJson(candidate);
    if (!parsed.ok) {
      continue;
    }
    sawParseableCandidate = true;
    const normalized = normalizeStructuredOutput(parsed.value, request);
    if (normalized) {
      validCandidates.push(normalized.mode === 'unwrapped'
        ? { value: normalized.value, mode: 'extracted_unwrapped' }
        : { value: normalized.value, mode: 'extracted' });
      continue;
    }
    firstValidationDetails ??= validationDetails(parsed.value, request);
  }

  if (validCandidates.length === 1) {
    return validCandidates[0]!;
  }
  if (validCandidates.length > 1) {
    return {
      reason: 'schema_mismatch',
      preview: preview(raw),
      details: 'multiple schema-valid JSON candidates found',
    };
  }
  if (sawParseableCandidate) {
    return {
      reason: 'schema_mismatch',
      preview: preview(raw),
      details: firstValidationDetails,
    };
  }

  return {
    reason: 'invalid_json',
    preview: preview(raw),
  };
}

function normalizeStructuredOutput(
  value: unknown,
  request: LLMStructuredOutputRequest,
): StructuredOutputParseResult | null {
  if (matchesSchema(value, request)) {
    return { value, mode: 'strict' };
  }
  if (!isRecord(value)) {
    return null;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    return null;
  }
  const wrapperKey = keys[0]!;
  if (isWrapperKey(wrapperKey) && matchesSchema(value[wrapperKey], request)) {
    return { value: value[wrapperKey], mode: 'unwrapped' };
  }
  return null;
}

function matchesSchema(value: unknown, request: LLMStructuredOutputRequest): boolean {
  return validateStructuredOutputSchema(value, request.schema, 1).length === 0;
}

function validationDetails(value: unknown, request: LLMStructuredOutputRequest): string | undefined {
  const issues = validateStructuredOutputSchema(value, request.schema, MAX_VALIDATION_ERRORS);
  if (issues.length === 0) {
    return undefined;
  }
  return issues
    .map((issue) => `${issue.path} ${issue.message}`)
    .join('; ');
}

function extractedJsonCandidates(raw: string): string[] {
  const candidates: string[] = [];
  const addCandidate = (candidate: string | undefined): void => {
    const trimmed = candidate?.trim();
    if (!trimmed || trimmed.length > MAX_JSON_CANDIDATE_CHARS || candidates.length >= MAX_JSON_CANDIDATES) {
      return;
    }
    candidates.push(trimmed);
  };
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(raw)) !== null) {
    addCandidate(match[1]);
    if (candidates.length >= MAX_JSON_CANDIDATES) {
      return [...new Set(candidates)];
    }
  }

  for (let index = 0; index < raw.length; index++) {
    if (candidates.length >= MAX_JSON_CANDIDATES) {
      break;
    }
    const char = raw[index];
    if (char !== '{' && char !== '[') {
      continue;
    }
    const balanced = balancedJsonSubstring(raw, index);
    addCandidate(balanced ?? undefined);
    if (balanced) {
      index += balanced.length - 1;
    }
  }

  return [...new Set(candidates)];
}

function balancedJsonSubstring(raw: string, startIndex: number): string | null {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < raw.length; index++) {
    const char = raw[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      stack.push('}');
      continue;
    }
    if (char === '[') {
      stack.push(']');
      continue;
    }
    if (char !== '}' && char !== ']') {
      continue;
    }
    if (stack.pop() !== char) {
      return null;
    }
    if (stack.length === 0) {
      return raw.slice(startIndex, index + 1);
    }
  }

  return null;
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown };
  } catch {
    return { ok: false };
  }
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWrapperKey(value: string): value is typeof WRAPPER_KEYS[number] {
  return WRAPPER_KEYS.includes(value as typeof WRAPPER_KEYS[number]);
}
