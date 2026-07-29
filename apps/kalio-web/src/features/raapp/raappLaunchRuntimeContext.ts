import type { ChatSession, RAAppLaunchIntent } from '@kalio/types';

export function buildRAAppLaunchRuntimeContext(
  appId: string,
  appName: string,
  source: RAAppLaunchIntent['source'],
  inputs?: Record<string, unknown>,
): ChatSession['runtimeContext'] {
  return {
    runtimeKind: 'chat',
    architectureContext: {
      raAppLaunchId: appId,
      raAppLaunchName: appName,
      raAppLaunchSource: source,
      ...(inputs ? { raAppLaunchInputs: JSON.stringify(inputs) } : {}),
    },
  };
}
