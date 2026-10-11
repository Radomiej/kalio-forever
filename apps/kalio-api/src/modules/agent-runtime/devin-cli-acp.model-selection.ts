import { methods, type ClientConnection, type SessionConfigOption } from '@agentclientprotocol/sdk';

type ConfigOptions = SessionConfigOption[] | null | undefined;

function modelDiagnostic(model: string, selector: SessionConfigOption & { type: 'select' }, source: string): string {
  const values = selector.options.flatMap(option => 'group' in option ? option.options : [option]);
  const clean = (value: string) => value.replace(/[^\p{L}\p{N} ._:/+()\-]/gu, '').slice(0, 100);
  const candidates = values.filter(option => /swe|glm/i.test(`${option.value} ${option.name}`)).slice(0, 12)
    .map(option => ({ value: clean(option.value), name: clean(option.name) }));
  return JSON.stringify({ source, requested: clean(model), selector: clean(selector.id), current: clean(selector.currentValue),
    optionCount: values.length, exactMatches: values.filter(option => option.value === model).length, candidates });
}

function modelSelector(model: string, options: ConfigOptions) {
  const selectors = options?.filter(option => option.category === 'model' || option.id === 'model') ?? [];
  const selector = selectors[0];
  if (selectors.length !== 1 || selector?.type !== 'select' || !selector.id
    || options?.filter(option => option.id === selector.id).length !== 1) {
    throw new Error('Devin ACP model metadata is missing or ambiguous; prompt blocked.');
  }
  const values = selector.options.flatMap(option => 'group' in option ? option.options : [option]);
  if (values.filter(option => option.value === model).length !== 1) {
    throw new Error(`Devin ACP exact model ID is unavailable or ambiguous; prompt blocked. Model selection: ${modelDiagnostic(model, selector, 'selector_validation')}`);
  }
  return selector;
}

export function assertDevinSessionModel(model: string, options: ConfigOptions, source = 'cached_or_update'): void {
  const selector = modelSelector(model, options);
  if (selector.currentValue !== model) {
    throw new Error(`Devin ACP session model differs from the requested exact ID; prompt blocked. Model selection: ${modelDiagnostic(model, selector, source)}`);
  }
}

export async function bindDevinSessionModel(
  connection: ClientConnection, sessionId: string, model: string, options: ConfigOptions,
  beforeSet?: () => void,
): Promise<SessionConfigOption[]> {
  const selector = modelSelector(model, options);
  if (selector.currentValue === model) return structuredClone(options!);
  beforeSet?.();
  const response = await connection.agent.request(methods.agent.session.setConfigOption, {
    sessionId, configId: selector.id, value: model,
  });
  assertDevinSessionModel(model, response.configOptions, 'setter_response');
  if (modelSelector(model, response.configOptions).id !== selector.id) {
    throw new Error('Devin ACP model selector changed during confirmation; prompt blocked.');
  }
  return structuredClone(response.configOptions);
}

export function devinAcpChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !['DEVIN_REFUSAL_FALLBACK', 'KALIO_CONTROL_PLANE_TOKEN'].includes(key.toUpperCase())));
}
