import type { ArchitectureRuntimeContext } from '@kalio/types';

export const DEFAULT_ARCHITECTURE_RUN_LIMITS = {
  maxArchitectureSteps: 64,
  maxArchitectureNodeVisits: 4,
  maxArchitectureSubagentIterations: 30,
} satisfies Pick<
  ArchitectureRuntimeContext,
  'maxArchitectureSteps' | 'maxArchitectureNodeVisits' | 'maxArchitectureSubagentIterations'
>;

export function buildArchitectureRunLimitContext(): Pick<
  ArchitectureRuntimeContext,
  'maxArchitectureSteps' | 'maxArchitectureNodeVisits' | 'maxArchitectureSubagentIterations'
> {
  return { ...DEFAULT_ARCHITECTURE_RUN_LIMITS };
}
