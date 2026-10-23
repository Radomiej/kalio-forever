import { useCallback, useEffect, useState } from 'react';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../services/apiClient';
import type { ArchitectExecutionMode } from './architect.types';
import { DEFAULT_ARCHITECTURE_RUN_LIMITS } from '../architectureRunDefaults';

export function useArchitectRunOptions() {
  const [executionProfileId, setExecutionProfileId] = useState('');
  const [executionProfiles, setExecutionProfiles] = useState<ExecutionProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void getExecutionProfiles().then((profiles) => {
      if (active) setExecutionProfiles(profiles.filter((profile) => profile.enabled));
    }).catch((error: unknown) => {
      console.error('[Architect] Execution profiles could not be loaded', error);
      if (active) setProfilesError('Could not load execution profiles. Retry by reopening Architect.');
    }).finally(() => { if (active) setProfilesLoading(false); });
    return () => { active = false; };
  }, []);
  const [taskPrompt, setTaskPrompt] = useState('Decide the smallest valuable architecture runtime slice.');
  const [maxArchitectureSteps, setMaxArchitectureSteps] = useState(DEFAULT_ARCHITECTURE_RUN_LIMITS.maxArchitectureSteps);
  const [maxArchitectureNodeVisits, setMaxArchitectureNodeVisits] = useState(DEFAULT_ARCHITECTURE_RUN_LIMITS.maxArchitectureNodeVisits);
  const [maxArchitectureSubagentIterations, setMaxArchitectureSubagentIterations] = useState(DEFAULT_ARCHITECTURE_RUN_LIMITS.maxArchitectureSubagentIterations);
  const [executionMode, setExecutionMode] = useState<ArchitectExecutionMode>('subagent_execution');
  const [requireGoalMasterLoopProof, setRequireGoalMasterLoopProof] = useState(false);
  const [requireImplementerWriteProof, setRequireImplementerWriteProof] = useState(false);
  const [projectPath, setProjectPath] = useState('');
  const [autoApproveProjectWrites, setAutoApproveProjectWrites] = useState(false);
  const [autoApproveTerminal, setAutoApproveTerminal] = useState(false);
  const [allowOrchestratorSubagents, setAllowOrchestratorSubagents] = useState(false);

  const runContext = useCallback(() => {
    const trimmedProjectPath = projectPath.trim();
    return {
      maxArchitectureSteps,
      maxArchitectureNodeVisits,
      maxArchitectureSubagentIterations,
      ...(requireGoalMasterLoopProof ? { requireGoalMasterLoopProof: true } : {}),
      ...(requireImplementerWriteProof ? { requireImplementerWriteProof: true } : {}),
      ...(autoApproveProjectWrites ? { autoApproveArchitectureProjectWrites: true } : {}),
      ...(autoApproveTerminal ? { autoApproveArchitectureTerminal: true } : {}),
      ...(allowOrchestratorSubagents ? { allowArchitectureOrchestratorSubagents: true } : {}),
      ...(trimmedProjectPath
        ? {
          projectPath: trimmedProjectPath,
          executionCwd: trimmedProjectPath,
        }
        : {}),
    };
  }, [
    autoApproveTerminal,
    autoApproveProjectWrites,
    allowOrchestratorSubagents,
    maxArchitectureNodeVisits,
    maxArchitectureSteps,
    maxArchitectureSubagentIterations,
    projectPath,
    requireImplementerWriteProof,
    requireGoalMasterLoopProof,
  ]);

  return {
    executionProfileId, setExecutionProfileId, executionProfiles, profilesLoading, profilesError,
    allowOrchestratorSubagents,
    autoApproveTerminal,
    autoApproveProjectWrites,
    executionMode,
    maxArchitectureNodeVisits,
    maxArchitectureSteps,
    maxArchitectureSubagentIterations,
    projectPath,
    requireImplementerWriteProof,
    requireGoalMasterLoopProof,
    runContext,
    setAutoApproveTerminal,
    setAutoApproveProjectWrites,
    setAllowOrchestratorSubagents,
    setMaxArchitectureNodeVisits,
    setMaxArchitectureSteps,
    setMaxArchitectureSubagentIterations,
    setExecutionMode,
    setProjectPath,
    setRequireImplementerWriteProof,
    setRequireGoalMasterLoopProof,
    setTaskPrompt,
    taskPrompt,
  };
}
