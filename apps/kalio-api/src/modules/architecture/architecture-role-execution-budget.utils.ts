type MaxIterationsInput = {
  slotId: string;
  context?: Record<string, unknown>;
  nodeMaxToolAttempts?: number;
  personaMaxToolAttempts?: number | null;
  globalMaxToolAttempts?: number;
};

type ContextBudgetInput = {
  slotId: string;
  context?: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 1_200_000;
const DEFAULT_MAX_ITERATIONS = 30;
const MIN_MAX_ITERATIONS = 1;
const MAX_MAX_ITERATIONS = 100;

export function architectureRoleTimeoutMs(input: ContextBudgetInput): number {
  return maxArchitectureSubagentTimeoutMsFromContext(input) ?? DEFAULT_TIMEOUT_MS;
}

export function maxArchitectureSubagentTimeoutMsFromContext(input: ContextBudgetInput): number | undefined {
  const perSlot = input.context?.['maxArchitectureSubagentTimeoutMsBySlot'];
  if (isRecord(perSlot)) {
    const value = perSlot[input.slotId];
    if (isBoundedTimeoutMs(value)) {
      return value;
    }
  }
  const value = input.context?.['maxArchitectureSubagentTimeoutMs'];
  return isBoundedTimeoutMs(value) ? value : undefined;
}

export function architectureRoleMaxIterations(input: MaxIterationsInput): number {
  if (typeof input.nodeMaxToolAttempts === 'number') {
    return clampMaxIterations(input.nodeMaxToolAttempts);
  }
  if (typeof input.personaMaxToolAttempts === 'number') {
    return clampMaxIterations(input.personaMaxToolAttempts);
  }
  const configured = maxArchitectureSubagentIterationsFromContext({
    context: input.context,
    slotId: input.slotId,
  });
  if (configured !== undefined) {
    return configured;
  }
  if (typeof input.globalMaxToolAttempts === 'number' && Number.isFinite(input.globalMaxToolAttempts)) {
    return clampMaxIterations(input.globalMaxToolAttempts);
  }
  return DEFAULT_MAX_ITERATIONS;
}

export function maxArchitectureSubagentIterationsFromContext(input: ContextBudgetInput): number | undefined {
  const perSlot = input.context?.['maxArchitectureSubagentIterationsBySlot'];
  if (isRecord(perSlot)) {
    const value = perSlot[input.slotId];
    if (isBoundedIterationCount(value)) {
      return value;
    }
  }
  const value = input.context?.['maxArchitectureSubagentIterations'];
  return isBoundedIterationCount(value) ? value : undefined;
}

function clampMaxIterations(value: number): number {
  return Math.max(MIN_MAX_ITERATIONS, Math.min(MAX_MAX_ITERATIONS, Math.round(value)));
}

function isBoundedTimeoutMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_TIMEOUT_MS
    && value <= MAX_TIMEOUT_MS;
}

function isBoundedIterationCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_MAX_ITERATIONS
    && value <= MAX_MAX_ITERATIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
