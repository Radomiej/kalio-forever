import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectRunConfig, estimateArchitectureBudget } from './ArchitectRunConfig';
import type { ArchitectSchema } from './architect.types';
import type { LLMConfigWithSource } from '../settings/llm-panel.types';

describe('estimateArchitectureBudget', () => {
  it('keeps small architectures in the low budget class', () => {
    const budget = estimateArchitectureBudget(makeSchema(2, 0, false), 32, 3, 4);

    expect(budget).toMatchObject({
      label: 'low',
      tone: 'ok',
    });
    expect(budget.shortDescription).toContain('~24 turns');
  });

  it('marks deep looped architectures as high budget', () => {
    const budget = estimateArchitectureBudget(makeSchema(19, 3, true), 64, 4, 4);

    expect(budget).toMatchObject({
      label: 'high',
      tone: 'danger',
    });
    expect(budget.description).toContain('19 executable slots');
    expect(budget.description).toContain('3 parallel nodes');
    expect(budget.description).toContain('1 loop edges');
  });

  it('exposes the Goal Master loop proof guard for judge architectures', () => {
    const onRequireGoalMasterLoopProofChange = vi.fn();
    render(
      <ArchitectRunConfig
        activeCredentialId="credential-1"
        llmConfig={{
          provider: 'xiaomimimo',
          model: 'mimo-v2.5-pro',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
          contextWindowSize: 32000,
          maxToolAttempts: 8,
          source: 'db',
        }}
        maxNodeVisits={3}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={false}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running={false}
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onRequireGoalMasterLoopProofChange={onRequireGoalMasterLoopProofChange}
        onRequireImplementerWriteProofChange={vi.fn()}
        onAutoApproveProjectWritesChange={vi.fn()}
        onAutoApproveTerminalChange={vi.fn()}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={vi.fn()}
      />,
    );

    const checkbox = screen.getByTestId('architect-goal-master-loop-proof');
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);
    expect(onRequireGoalMasterLoopProofChange).toHaveBeenCalledWith(true);
  });

  it('exposes strict Implementer write proof for two-agent Goal Guard validation', () => {
    const onRequireImplementerWriteProofChange = vi.fn();
    render(
      <ArchitectRunConfig
        activeCredentialId="credential-1"
        llmConfig={{
          provider: 'xiaomimimo',
          model: 'mimo-v2.5-pro',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
          contextWindowSize: 32000,
          maxToolAttempts: 8,
          source: 'db',
        }}
        maxNodeVisits={3}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={true}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running={false}
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onRequireGoalMasterLoopProofChange={vi.fn()}
        onRequireImplementerWriteProofChange={onRequireImplementerWriteProofChange}
        onAutoApproveProjectWritesChange={vi.fn()}
        onAutoApproveTerminalChange={vi.fn()}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={vi.fn()}
      />,
    );

    const checkbox = screen.getByTestId('architect-implementer-write-proof');
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);
    expect(onRequireImplementerWriteProofChange).toHaveBeenCalledWith(true);
  });

  it('exposes a dedicated Goal Guard AgentFlow start action', () => {
    const onStartGoalGuardFlow = vi.fn();
    render(
      <ArchitectRunConfig
        activeCredentialId="credential-1"
        llmConfig={{
          provider: 'xiaomimimo',
          model: 'mimo-v2.5-pro',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
          contextWindowSize: 32000,
          maxToolAttempts: 8,
          source: 'db',
        }}
        maxNodeVisits={3}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={false}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running={false}
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onRequireGoalMasterLoopProofChange={vi.fn()}
        onRequireImplementerWriteProofChange={vi.fn()}
        onAutoApproveProjectWritesChange={vi.fn()}
        onAutoApproveTerminalChange={vi.fn()}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={onStartGoalGuardFlow}
      />,
    );

    fireEvent.click(screen.getByTestId('architect-start-goal-guard-flow'));

    expect(onStartGoalGuardFlow).toHaveBeenCalledTimes(1);
  });

  it('exposes workdir, write, terminal, and orchestrator-subagent controls', () => {
    const onAutoApproveProjectWritesChange = vi.fn();
    const onAutoApproveTerminalChange = vi.fn();
    const onProjectPathChange = vi.fn();
    const onAllowOrchestratorSubagentsChange = vi.fn();
    render(
      <ArchitectRunConfig
        activeCredentialId="credential-1"
        llmConfig={{
          provider: 'xiaomimimo',
          model: 'mimo-v2.5-pro',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
          contextWindowSize: 32000,
          maxToolAttempts: 8,
          source: 'db',
        }}
        maxNodeVisits={3}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={false}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running={false}
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={onProjectPathChange}
        onRequireGoalMasterLoopProofChange={vi.fn()}
        onRequireImplementerWriteProofChange={vi.fn()}
        onAutoApproveProjectWritesChange={onAutoApproveProjectWritesChange}
        onAutoApproveTerminalChange={onAutoApproveTerminalChange}
        onAllowOrchestratorSubagentsChange={onAllowOrchestratorSubagentsChange}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('architect-project-path'), { target: { value: 'C:\\Projekty\\TurboProject2' } });
    expect(onProjectPathChange).toHaveBeenCalledWith('C:\\Projekty\\TurboProject2');

    fireEvent.click(screen.getByTestId('architect-auto-approve-project-writes'));
    fireEvent.click(screen.getByTestId('architect-auto-approve-terminal'));
    fireEvent.click(screen.getByTestId('architect-allow-orchestrator-subagents'));

    expect(onAutoApproveProjectWritesChange).toHaveBeenCalledWith(true);
    expect(onAutoApproveTerminalChange).toHaveBeenCalledWith(true);
    expect(onAllowOrchestratorSubagentsChange).toHaveBeenCalledWith(true);
  });

  it('shows a stop action while an architecture run is running', () => {
    const onStopRun = vi.fn();
    render(
      <ArchitectRunConfig
        activeCredentialId="credential-1"
        llmConfig={defaultLlmConfig}
        maxNodeVisits={3}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={false}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onRequireGoalMasterLoopProofChange={vi.fn()}
        onRequireImplementerWriteProofChange={vi.fn()}
        onAutoApproveProjectWritesChange={vi.fn()}
        onAutoApproveTerminalChange={vi.fn()}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={vi.fn()}
        onStopRun={onStopRun}
      />,
    );

    fireEvent.click(screen.getByTestId('architect-stop-run'));

    expect(onStopRun).toHaveBeenCalledTimes(1);
  });

  it('keeps Start run disabled until a schema is loaded, while still allowing Goal Guard flow entry', async () => {
    const user = userEvent.setup();
    render(<RunConfigHarness schema={null} />);

    const taskInput = screen.getByRole('textbox', { name: /task/i });
    const startRunButton = screen.getByRole('button', { name: /start run/i });
    const goalGuardButton = screen.getByRole('button', { name: /goal guard/i });

    await user.type(taskInput, 'Deliver the architecture slice.');

    expect(startRunButton).toBeDisabled();
    expect(goalGuardButton).toBeEnabled();
  });

  it('enables and disables the start actions based on the task prompt content', async () => {
    const user = userEvent.setup();
    render(<RunConfigHarness />);

    const taskInput = screen.getByRole('textbox', { name: /task/i });
    const startRunButton = screen.getByRole('button', { name: /start run/i });
    const goalGuardButton = screen.getByRole('button', { name: /goal guard/i });

    expect(startRunButton).toBeDisabled();
    expect(goalGuardButton).toBeDisabled();

    await user.type(taskInput, 'Deliver the architecture slice.');

    expect(startRunButton).toBeEnabled();
    expect(goalGuardButton).toBeEnabled();

    await user.clear(taskInput);

    expect(startRunButton).toBeDisabled();
    expect(goalGuardButton).toBeDisabled();
  });

  it('keeps max step and node visit inputs within the accepted range', async () => {
    render(<RunConfigHarness />);

    const maxStepsInput = screen.getByRole('spinbutton', { name: /steps/i });
    const maxNodeVisitsInput = screen.getByRole('spinbutton', { name: /visits/i });
    const maxSubagentIterationsInput = screen.getByRole('spinbutton', { name: /iters/i });

    fireEvent.change(maxStepsInput, { target: { value: '0' } });
    expect(maxStepsInput).toHaveValue(12);

    fireEvent.change(maxStepsInput, { target: { value: '24' } });
    expect(maxStepsInput).toHaveValue(24);

    fireEvent.change(maxNodeVisitsInput, { target: { value: '0' } });
    expect(maxNodeVisitsInput).toHaveValue(3);

    fireEvent.change(maxNodeVisitsInput, { target: { value: '5' } });
    expect(maxNodeVisitsInput).toHaveValue(5);

    fireEvent.change(maxSubagentIterationsInput, { target: { value: '11' } });
    expect(maxSubagentIterationsInput).toHaveValue(4);

    fireEvent.change(maxSubagentIterationsInput, { target: { value: '10' } });
    expect(maxSubagentIterationsInput).toHaveValue(10);
  });

  it('warns when runtime config is still loading', () => {
    render(
      <ArchitectRunConfig
        activeCredentialId={null}
        llmConfig={null}
        maxNodeVisits={4}
        maxSteps={12}
        maxSubagentIterations={4}
        projectPath=""
        requireGoalMasterLoopProof={false}
        requireImplementerWriteProof={false}
        autoApproveProjectWrites={false}
        autoApproveTerminal={false}
        schema={makeSchema(3, 0, false, 'judge')}
        taskPrompt="Finish the goal."
        personaOverrides={{}}
        running={false}
        onMaxNodeVisitsChange={vi.fn()}
        onMaxStepsChange={vi.fn()}
        onMaxSubagentIterationsChange={vi.fn()}
        onProjectPathChange={vi.fn()}
        onRequireGoalMasterLoopProofChange={vi.fn()}
        onRequireImplementerWriteProofChange={vi.fn()}
        onAutoApproveProjectWritesChange={vi.fn()}
        onAutoApproveTerminalChange={vi.fn()}
        onTaskPromptChange={vi.fn()}
        onStartRun={vi.fn()}
        onStartGoalGuardFlow={vi.fn()}
      />,
    );

    expect(screen.getByTestId('architect-provider-warning')).toHaveTextContent(
      'Real subagent runs need a reachable LLM provider. Runtime config is still loading.',
    );
  });
});

function RunConfigHarness({
  llmConfig = defaultLlmConfig,
  schema = makeSchema(3, 0, false, 'judge'),
}: {
  llmConfig?: LLMConfigWithSource | null;
  schema?: ArchitectSchema | null;
}) {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [maxSteps, setMaxSteps] = useState(12);
  const [maxNodeVisits, setMaxNodeVisits] = useState(3);
  const [maxSubagentIterations, setMaxSubagentIterations] = useState(4);
  const [projectPath, setProjectPath] = useState('');
  const [requireGoalMasterLoopProof, setRequireGoalMasterLoopProof] = useState(false);
  const [requireImplementerWriteProof, setRequireImplementerWriteProof] = useState(false);
  const [autoApproveProjectWrites, setAutoApproveProjectWrites] = useState(false);
  const [autoApproveTerminal, setAutoApproveTerminal] = useState(false);

  return (
    <ArchitectRunConfig
      activeCredentialId="credential-1"
      llmConfig={llmConfig}
      maxNodeVisits={maxNodeVisits}
      maxSteps={maxSteps}
      maxSubagentIterations={maxSubagentIterations}
      projectPath={projectPath}
      requireGoalMasterLoopProof={requireGoalMasterLoopProof}
      requireImplementerWriteProof={requireImplementerWriteProof}
      autoApproveProjectWrites={autoApproveProjectWrites}
      autoApproveTerminal={autoApproveTerminal}
      schema={schema}
      taskPrompt={taskPrompt}
      personaOverrides={{}}
      running={false}
      onMaxNodeVisitsChange={setMaxNodeVisits}
      onMaxStepsChange={setMaxSteps}
      onMaxSubagentIterationsChange={setMaxSubagentIterations}
      onProjectPathChange={setProjectPath}
      onRequireGoalMasterLoopProofChange={setRequireGoalMasterLoopProof}
      onRequireImplementerWriteProofChange={setRequireImplementerWriteProof}
      onAutoApproveProjectWritesChange={setAutoApproveProjectWrites}
      onAutoApproveTerminalChange={setAutoApproveTerminal}
      onTaskPromptChange={setTaskPrompt}
      onStartRun={vi.fn()}
      onStartGoalGuardFlow={vi.fn()}
    />
  );
}

const defaultLlmConfig: LLMConfigWithSource = {
  provider: 'xiaomimimo',
  model: 'mimo-v2.5-pro',
  baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
  contextWindowSize: 32000,
  maxToolAttempts: 8,
  source: 'db',
};

function makeSchema(
  roleCount: number,
  parallelCount: number,
  withLoop: boolean,
  lastSlotType: 'finalizer' | 'judge' = 'finalizer',
): ArchitectSchema {
  const roleSlots = Array.from({ length: roleCount }, (_, index) => ({
    id: `slot-${index}`,
    label: `Slot ${index}`,
    description: `Slot ${index}`,
    slotType: index === roleCount - 1 ? lastSlotType : 'participant' as const,
    defaultPersonaId: `persona.slot-${index}`,
    allowedPersonaTags: [],
    required: true,
    canOverrideAtRunStart: true,
  }));
  const roleNodes = roleSlots.map((slot, index) => ({
    id: `node-${index}`,
    label: `Node ${index}`,
    kind: 'role' as const,
    roleSlotId: slot.id,
    x: index * 80,
    y: index * 120,
    slots: [],
    connections: [],
  }));
  const parallelNodes = Array.from({ length: parallelCount }, (_, index) => ({
    id: `parallel-${index}`,
    label: `Parallel ${index}`,
    kind: 'parallel' as const,
    x: index * 80,
    y: roleCount * 120 + index * 120,
    slots: [],
    connections: [],
  }));
  const edges = roleNodes.slice(1).map((node, index) => ({
    id: `edge-${index}`,
    fromNodeId: roleNodes[index].id,
    toNodeId: node.id,
  }));
  if (withLoop) {
    edges.push({
      id: 'loop',
      fromNodeId: roleNodes[roleNodes.length - 1].id,
      toNodeId: roleNodes[0].id,
    });
  }

  return {
    id: 'budget-test',
    name: 'Budget Test',
    description: 'Budget test schema',
    version: '1.0.0',
    roleSlots,
    nodes: [...roleNodes, ...parallelNodes],
    edges,
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: true,
    },
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    memoryPolicy: {
      persistFinalArtifact: true,
      persistRouterDecision: true,
    },
    outputArtifactSchema: 'BudgetTest',
  };
}
