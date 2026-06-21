import type { RAAppLaunchIntent, SessionRuntimeContext } from '@kalio/types';

const RAAPP_LAUNCH_ID_KEY = 'raAppLaunchId';
const RAAPP_LAUNCH_NAME_KEY = 'raAppLaunchName';
const RAAPP_LAUNCH_SOURCE_KEY = 'raAppLaunchSource';

function readArchitectureString(
  runtimeContext: SessionRuntimeContext | null | undefined,
  key: string,
): string {
  const value = runtimeContext?.architectureContext?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function readPendingRAAppLaunchIntent(
  sessionId: string,
  personaId: string,
  runtimeContext: SessionRuntimeContext | null | undefined,
): RAAppLaunchIntent | null {
  const appId = readArchitectureString(runtimeContext, RAAPP_LAUNCH_ID_KEY);
  if (!appId) {
    return null;
  }

  const source = readArchitectureString(runtimeContext, RAAPP_LAUNCH_SOURCE_KEY);
  if (
    source !== 'home_tile'
    && source !== 'raapp_manager'
    && source !== 'quick_chat'
    && source !== 'composer'
    && source !== 'execution_graph'
  ) {
    return null;
  }

  const appName = readArchitectureString(runtimeContext, RAAPP_LAUNCH_NAME_KEY) || appId;

  return {
    targetSessionId: sessionId,
    appId,
    appName,
    personaId,
    prompt: `Run the "${appName}" RA-App for me. Launch it immediately.`,
    source,
  };
}

export function stripPendingRAAppLaunchRuntimeContext(
  runtimeContext: SessionRuntimeContext | null | undefined,
): SessionRuntimeContext {
  const baseRuntimeContext = runtimeContext ?? { runtimeKind: 'chat' as const };
  const architectureContext = { ...(baseRuntimeContext.architectureContext ?? {}) };
  delete architectureContext[RAAPP_LAUNCH_ID_KEY];
  delete architectureContext[RAAPP_LAUNCH_NAME_KEY];
  delete architectureContext[RAAPP_LAUNCH_SOURCE_KEY];

  return Object.keys(architectureContext).length > 0
    ? { ...baseRuntimeContext, architectureContext }
    : { ...baseRuntimeContext, architectureContext: undefined };
}
