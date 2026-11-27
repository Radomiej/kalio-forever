import { methods, type ClientConnection, type SessionConfigOption } from '@agentclientprotocol/sdk';
import { captureExecutionCurrent, guardedAcpRequest, type ExecutionCurrentCheck } from './devin-cli-acp.execution-guard';

type ConfigOptions = SessionConfigOption[] | null | undefined;

/** Binding/verification failure of the requested exact model. `retryable` marks a plain current-state mismatch that one rebind may heal. */
export class DevinModelBindingError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'DevinModelBindingError';
  }
}

function modelDiagnostic(model: string, selector: SessionConfigOption & { type: 'select' }, source: string, options?: ConfigOptions): string {
  const values = selector.options.flatMap(option => 'group' in option ? option.options : [option]);
  const clean = (value: string) => value.replace(/[^\p{L}\p{N} ._:/+()-]/gu, '').slice(0, 100);
  const candidates = values.filter(option => /swe|glm/i.test(`${option.value} ${option.name}`)).slice(0, 12)
    .map(option => ({ value: clean(option.value), name: clean(option.name) }));
  return JSON.stringify({ source, requested: clean(model), selector: clean(selector.id), current: clean(selector.currentValue),
    thoughtLevel: clean(String(thoughtSelector(options)?.currentValue ?? '')),
    optionCount: values.length, exactMatches: values.filter(option => option.value === model).length, candidates });
}

function getModelSelector(options: ConfigOptions) {
  const selectors = options?.filter(option => option.category === 'model' || option.id === 'model') ?? [];
  const selector = selectors[0];
  if (selectors.length !== 1 || selector?.type !== 'select' || !selector.id
    || options?.filter(option => option.id === selector.id).length !== 1) {
    throw new Error('Devin ACP model metadata is missing or ambiguous; prompt blocked.');
  }
  return selector;
}

/** Only exact values from ACP's model selector are admissible, never reasoning or sidekick labels. */
export function readDevinSelectableModels(options: ConfigOptions): string[] {
  const selector = getModelSelector(options);
  const values = selector.options.flatMap(option => 'group' in option ? option.options : [option]);
  const models = values.map(option => option.value);
  if (models.some(model => !model || model.length > 200 || !/^[\p{L}\p{N}][\p{L}\p{N}._:/+-]*$/u.test(model))
    || new Set(models).size !== models.length) {
    throw new Error('Devin ACP model values are invalid or ambiguous; catalog blocked.');
  }
  return models;
}

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const VARIANT = /^(.+)-(low|medium|high|xhigh|max)$/;

function flatValues(selector: SessionConfigOption & { type: 'select' }) {
  return selector.options.flatMap(option => 'group' in option ? option.options : [option]);
}

function thoughtSelector(options: ConfigOptions) {
  const found = options?.filter(option => option.id === 'thought_level' || option.category === 'thought_level') ?? [];
  const selector = found.length === 1 ? found[0] : undefined;
  return selector?.type === 'select' ? selector : undefined;
}

/** ACP lists one model per family (e.g. swe-2-1-medium); the other `<family>-<level>` ids are that model plus thought_level. */
export function expandDevinModelVariants(models: string[], levelsByModel: ReadonlyMap<string, readonly string[]>): string[] {
  const result = new Set(models);
  for (const model of models) {
    const family = VARIANT.exec(model)?.[1];
    if (!family || model.startsWith('fusion-')) continue;
    for (const level of LEVELS) {
      if (levelsByModel.get(model)?.includes(level)) result.add(`${family}-${level}`);
    }
  }
  return [...result];
}

/** The ACP model value plus the thought level to apply on top (undefined when the id is listed verbatim). */
function resolveModelTarget(model: string, selector: SessionConfigOption & { type: 'select' }) {
  const values = flatValues(selector).map(option => option.value);
  if (values.filter(value => value === model).length === 1) return { value: model, level: undefined };
  const variant = VARIANT.exec(model);
  if (!variant || model.startsWith('fusion-')) return undefined;
  const bases = values.filter(value => !value.startsWith('fusion-') && VARIANT.exec(value)?.[1] === variant[1]);
  return bases.length === 1 ? { value: bases[0], level: variant[2] } : undefined;
}

function modelSelector(model: string, options: ConfigOptions) {
  const selector = getModelSelector(options);
  const target = resolveModelTarget(model, selector);
  if (!target) {
    throw new Error(`Devin ACP exact model ID is unavailable or ambiguous; prompt blocked. Model selection: ${modelDiagnostic(model, selector, 'selector_validation', options)}`);
  }
  return { selector, target };
}

export function assertDevinSessionModel(model: string, options: ConfigOptions, source = 'cached_or_update'): void {
  const { selector, target } = modelSelector(model, options);
  if (selector.currentValue !== target.value || (target.level && thoughtSelector(options)?.currentValue !== target.level)) {
    throw new DevinModelBindingError(`Devin ACP session model differs from the requested exact ID; prompt blocked. Model selection: ${modelDiagnostic(model, selector, source, options)}`, true);
  }
}

export async function bindDevinSessionModel(
  connection: ClientConnection, sessionId: string, model: string, options: ConfigOptions,
  beforeSet?: () => void, assertExecutionCurrent?: ExecutionCurrentCheck,
): Promise<SessionConfigOption[]> {
  const check = captureExecutionCurrent(assertExecutionCurrent); check?.();
  const { selector, target } = modelSelector(model, options);
  let current = options!;
  const set = async (configId: string, value: string) => {
    beforeSet?.();
    const response = await guardedAcpRequest(check, () => connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId, configId, value,
    }));
    return response.configOptions;
  };
  if (selector.currentValue !== target.value) {
    current = await set(selector.id, target.value);
    if (modelSelector(model, current).selector.id !== selector.id) {
      throw new DevinModelBindingError('Devin ACP model selector changed during confirmation; prompt blocked.');
    }
  }
  if (target.level && thoughtSelector(current)?.currentValue !== target.level) {
    const thought = thoughtSelector(current);
    if (!thought || !flatValues(thought).some(option => option.value === target.level)) {
      throw new DevinModelBindingError(`Devin ACP model ${target.value} does not offer thought level ${target.level}; prompt blocked.`);
    }
    current = await set(thought.id, target.level);
  }
  assertDevinSessionModel(model, current, 'setter_response');
  return structuredClone(current);
}
export function devinAcpChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !['DEVIN_REFUSAL_FALLBACK', 'KALIO_CONTROL_PLANE_TOKEN'].includes(key.toUpperCase())));
}
