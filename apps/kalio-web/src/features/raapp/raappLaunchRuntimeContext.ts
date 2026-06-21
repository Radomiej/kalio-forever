import type { ChatSession, RAAppLaunchIntent } from '@kalio/types';

export function buildRAAppLaunchRuntimeContext(
  appId: string,
  appName: string,
  source: RAAppLaunchIntent['source'],
): ChatSession['runtimeContext'] {
  return {
    runtimeKind: 'chat',
    architectureContext: {
      raAppLaunchId: appId,
      raAppLaunchName: appName,
      raAppLaunchSource: source,
    },
  };
}
