import { useCallback, useState } from 'react';

export function useArchitectRunOptions() {
  const [taskPrompt, setTaskPrompt] = useState('Decide the smallest valuable architecture runtime slice.');
  const [maxArchitectureSteps, setMaxArchitectureSteps] = useState(64);
  const [maxArchitectureNodeVisits, setMaxArchitectureNodeVisits] = useState(4);
  const [maxArchitectureSubagentIterations, setMaxArchitectureSubagentIterations] = useState(4);
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
    allowOrchestratorSubagents,
    autoApproveTerminal,
    autoApproveProjectWrites,
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
    setProjectPath,
    setRequireImplementerWriteProof,
    setRequireGoalMasterLoopProof,
    setTaskPrompt,
    taskPrompt,
  };
}
