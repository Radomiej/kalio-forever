import type { ExecutionProfile } from './index';

/** Read-only runtime identity boundary; does not grant launch or tool authority. */
export const EXECUTION_PROFILE_LOOKUP = Symbol('EXECUTION_PROFILE_LOOKUP');
export interface ExecutionProfileLookupPort {
  assertEnabled(id: string): Promise<ExecutionProfile>;
}
