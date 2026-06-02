import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useArchitectRunOptions } from './useArchitectRunOptions';

describe('useArchitectRunOptions', () => {
  it('returns defaults without project-specific execution fields', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    expect(result.current.taskPrompt).toBe('Decide the smallest valuable architecture runtime slice.');
    expect(result.current.runContext()).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 4,
    });
  });

  it('adds project execution fields only when project path is provided', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    act(() => {
      result.current.setProjectPath('  C:/Projekty/kalio-forever  ');
      result.current.setAutoApproveProjectWrites(true);
      result.current.setAutoApproveTerminal(true);
    });

    expect(result.current.runContext()).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 4,
      projectPath: 'C:/Projekty/kalio-forever',
      executionCwd: 'C:/Projekty/kalio-forever',
      autoApproveArchitectureProjectWrites: true,
      autoApproveArchitectureTerminal: true,
    });
  });

  it('includes requireGoalMasterLoopProof only when toggled on', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    expect(result.current.runContext()).not.toHaveProperty('requireGoalMasterLoopProof');

    act(() => {
      result.current.setRequireGoalMasterLoopProof(true);
    });

    expect(result.current.runContext()).toEqual(expect.objectContaining({
      requireGoalMasterLoopProof: true,
    }));
  });

  it('includes requireImplementerWriteProof only when toggled on', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    expect(result.current.runContext()).not.toHaveProperty('requireImplementerWriteProof');

    act(() => {
      result.current.setRequireImplementerWriteProof(true);
    });

    expect(result.current.runContext()).toEqual(expect.objectContaining({
      requireImplementerWriteProof: true,
    }));
  });

  it('keeps orchestrator subagents disabled unless explicitly toggled on', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    expect(result.current.runContext()).not.toHaveProperty('allowArchitectureOrchestratorSubagents');

    act(() => {
      result.current.setAllowOrchestratorSubagents(true);
    });

    expect(result.current.runContext()).toEqual(expect.objectContaining({
      allowArchitectureOrchestratorSubagents: true,
    }));
  });
});
