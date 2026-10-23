import { act, renderHook, waitFor } from '@testing-library/react';
import type { ExecutionProfile } from '@kalio/types';
import { getExecutionProfiles } from '../../services/apiClient';
import { describe, expect, it, vi } from 'vitest';
import { useArchitectRunOptions } from './useArchitectRunOptions';
vi.mock('../../services/apiClient', () => ({ getExecutionProfiles: vi.fn().mockResolvedValue([]) }));

describe('useArchitectRunOptions', () => {
  it('loads only enabled profiles without replacing an explicit selection', async () => {
    const profile: ExecutionProfile = { id: 'devin', name: 'Devin', model: 'swe-2', kind: 'devin-cli-acp', enabled: true, approvalMode: 'kalio_strict', capabilitiesVersion: '1', createdAt: 1, updatedAt: 1 };
    vi.mocked(getExecutionProfiles).mockResolvedValueOnce([profile, { ...profile, id: 'disabled', enabled: false }]);
    const { result } = renderHook(() => useArchitectRunOptions());
    act(() => result.current.setExecutionProfileId('explicit-other'));
    await waitFor(() => expect(result.current.profilesLoading).toBe(false));
    expect(result.current.executionProfiles).toEqual([profile]);
    expect(result.current.executionProfileId).toBe('explicit-other');
  });
  it('reports catalog failure without silently returning to the default', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getExecutionProfiles).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useArchitectRunOptions());
    act(() => result.current.setExecutionProfileId('devin'));
    await waitFor(() => expect(result.current.profilesError).toContain('Could not load'));
    expect(result.current.executionProfileId).toBe('devin');
    expect(result.current.profilesLoading).toBe(false);
    log.mockRestore();
  });
  it('retains explicit execution selection separately from untrusted context', () => {
    const { result } = renderHook(() => useArchitectRunOptions());
    expect(result.current.executionProfileId).toBe('');
    act(() => result.current.setExecutionProfileId('devin-swe-2'));
    expect(result.current.executionProfileId).toBe('devin-swe-2');
    expect(result.current.runContext()).not.toHaveProperty('executionProfileId');
  });
  it('returns defaults without project-specific execution fields', () => {
    const { result } = renderHook(() => useArchitectRunOptions());

    expect(result.current.taskPrompt).toBe('Decide the smallest valuable architecture runtime slice.');
    expect(result.current.runContext()).toEqual({
      maxArchitectureSteps: 64,
      maxArchitectureNodeVisits: 4,
      maxArchitectureSubagentIterations: 30,
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
      maxArchitectureSubagentIterations: 30,
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
