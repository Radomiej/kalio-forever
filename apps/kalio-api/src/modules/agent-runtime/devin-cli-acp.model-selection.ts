import { methods, type ClientConnection, type SessionConfigOption } from '@agentclientprotocol/sdk';

type ConfigOptions = SessionConfigOption[] | null | undefined;

function modelSelector(model: string, options: ConfigOptions) {
  const selectors = options?.filter(option => option.category === 'model' || option.id === 'model') ?? [];
  const selector = selectors[0];
  if (selectors.length !== 1 || selector?.type !== 'select' || !selector.id
    || options?.filter(option => option.id === selector.id).length !== 1) {
    throw new Error('Devin ACP model metadata is missing or ambiguous; prompt blocked.');
  }
  const values = selector.options.flatMap(option => 'group' in option ? option.options : [option]);
  if (values.filter(option => option.value === model).length !== 1) {
    throw new Error('Devin ACP exact model ID is unavailable or ambiguous; prompt blocked.');
  }
  return selector;
}

export function assertDevinSessionModel(model: string, options: ConfigOptions): void {
  if (modelSelector(model, options).currentValue !== model) {
    throw new Error('Devin ACP session model differs from the requested exact ID; prompt blocked.');
  }
}

export async function bindDevinSessionModel(
  connection: ClientConnection, sessionId: string, model: string, options: ConfigOptions,
): Promise<SessionConfigOption[]> {
  const selector = modelSelector(model, options);
  if (selector.currentValue === model) return structuredClone(options!);
  const response = await connection.agent.request(methods.agent.session.setConfigOption, {
    sessionId, configId: selector.id, value: model,
  });
  assertDevinSessionModel(model, response.configOptions);
  if (modelSelector(model, response.configOptions).id !== selector.id) {
    throw new Error('Devin ACP model selector changed during confirmation; prompt blocked.');
  }
  return structuredClone(response.configOptions);
}

export function devinAcpChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    !['DEVIN_REFUSAL_FALLBACK', 'KALIO_CONTROL_PLANE_TOKEN'].includes(key.toUpperCase())));
}
