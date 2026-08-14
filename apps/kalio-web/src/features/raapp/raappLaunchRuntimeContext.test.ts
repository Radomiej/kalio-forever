import { describe, expect, it } from 'vitest';
import { buildRAAppLaunchRuntimeContext } from './raappLaunchRuntimeContext';

describe('buildRAAppLaunchRuntimeContext', () => {
  it('serializes optional manager inputs into the one-shot launch context', () => {
    expect(buildRAAppLaunchRuntimeContext('calculator', 'Calculator', 'raapp_manager', { value: 5 })).toEqual({
      runtimeKind: 'chat',
      architectureContext: {
        raAppLaunchId: 'calculator',
        raAppLaunchName: 'Calculator',
        raAppLaunchSource: 'raapp_manager',
        raAppLaunchInputs: '{"value":5}',
      },
    });
  });

  it('does not add an empty inputs marker', () => {
    expect(buildRAAppLaunchRuntimeContext('calculator', 'Calculator', 'home_tile')).toEqual({
      runtimeKind: 'chat',
      architectureContext: {
        raAppLaunchId: 'calculator',
        raAppLaunchName: 'Calculator',
        raAppLaunchSource: 'home_tile',
      },
    });
  });
});
