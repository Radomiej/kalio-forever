import type { ArchitectureExecutionEvent, ArchitectureRun, ArchitectureSchema, ToolMeta } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRegistryService } from './architecture-registry.service';

describe('ArchitectureRoleExecutorService', () => {
  it('prepares branch sessions without invoking live subagents by default', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const service = new ArchitectureRoleExecutorService();

    const result = await service.execute({
      schema,
      run: createRun('session_branches'),
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(result.message).toContain('Pragmatist branch prepared');
    expect(result.data).toMatchObject({
      branchSessionId: 'branch-1',
      personaId: 'dev',
      executionMode: 'session_branches',
    });
  });

  it('delegates explicit subagent execution mode to SubagentRuntimeService', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { priority: 'ship_mvp' },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(result.message).toBe('Subagent result');
    expect(result.data).toMatchObject({
      branchSessionId: 'branch-1',
      executionMode: 'subagent_execution',
      taskId: 'task-1',
      durationMs: 42,
    });
    expect(subagentRuntime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      parentSessionId: 'root-1',
      parentToolCallId: 'architecture:run-1:pragmatist',
      childSessionId: 'branch-1',
      personaId: 'dev',
      maxIterations: 4,
      availableTools: [
        expect.objectContaining({ name: 'vfs_list' }),
        expect.objectContaining({ name: 'vfs_read' }),
      ],
      timeoutMs: 120_000,
      vfsMode: 'shared',
      copyOutputs: false,
    }));
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].availableTools.map((tool) => tool.name)).not.toContain('vfs_write');
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].availableTools.map((tool) => tool.name)).not.toContain('terminal_spawn');
    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.objective).toContain('Architecture: Strategic Decision Council v0.1.0');
    expect(call?.objective).toContain('Slot: Pragmatist (participant)');
    expect(call?.objective).toContain('Task: Pick a strategy.');
    expect(call?.objective).toContain('Context: {"priority":"ship_mvp"}');
    expect(call?.objective).toContain('gather only the smallest evidence batch you need with read/list tools');
    expect(call?.objective).toContain('After any successful file read/list result, produce a final answer with exactly: Recommendation, Evidence, Risk, Next step.');
    expect(call?.objective).toContain('prefer a partial evidence-based conclusion over another read');
  });

  it('turns exhausted architecture read loops into bounded evidence output', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-read',
          toolName: 'fs_read',
          args: { path: 'C:\\Projekty\\target\\src\\App.tsx' },
          sessionId: 'branch-1',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-read',
          toolName: 'fs_read',
          status: 'running',
          data: { path: 'src/App.tsx' },
        } as never);
        return {
          result: 'Sub-agent stopped after 2 tool iterations without producing a final answer. Last assistant text before stopping: Let me inspect one more file.',
          taskId: 'task-1',
          childSessionId: 'branch-1',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 42,
        };
      }),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { projectPath: 'C:\\Projekty\\target' },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(result.message).toContain('Pragmatist completed a bounded evidence pass.');
    expect(result.message).toContain('Recommendation: choose the lowest-risk improvement supported by the collected project evidence.');
    expect(result.message).toContain('Evidence: 1 tool result(s), successful=fs_read.');
    expect(result.message).toContain('Evidence paths: src/App.tsx.');
    expect(result.message).toContain('Risk: the slot did not produce a full narrative before the tool budget ended.');
    expect(result.message).toContain('Next step: pass this evidence to the router/finalizer;');
    expect(result.message).not.toContain('without producing a final answer');
    expect(result.data).toMatchObject({
      boundedToolLoopExhausted: true,
      rawSubagentResult: expect.stringContaining('without producing a final answer'),
      response: expect.stringContaining('bounded evidence pass'),
      toolEvidence: {
        toolCallCount: 1,
        toolResultCount: 1,
        toolNames: ['fs_read'],
        successfulToolNames: ['fs_read'],
        targetPaths: ['C:\\Projekty\\target\\src\\App.tsx'],
      },
    });
  });

  it('summarizes streamed host write and terminal build results as strong tool evidence', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-write',
          toolName: 'fs_write',
          args: { path: 'C:\\Projekty\\TurboProject2\\src\\runtime-proof.ts' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-write',
          toolName: 'fs_write',
          status: 'success',
          data: { path: 'C:\\Projekty\\TurboProject2\\src\\runtime-proof.ts' },
        } as never);
        request.emit?.('tool:start', {
          callId: 'call-build',
          toolName: 'terminal_spawn',
          args: { command: 'npm.cmd', args: ['run', 'build'], cwd: 'C:\\Projekty\\TurboProject2' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-build',
          toolName: 'terminal_spawn',
          status: 'success',
          data: { id: 'term-build' },
        } as never);
        request.emit?.('tool:start', {
          callId: 'call-build-output',
          toolName: 'terminal_output',
          args: { id: 'term-build' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-build-output',
          toolName: 'terminal_output',
          status: 'success',
          data: { id: 'term-build', exitCode: 0 },
        } as never);
        return {
          result: 'Materializer wrote proof and build exited 0.',
          taskId: 'task-materializer',
          childSessionId: 'branch-materializer',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 42,
        };
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'fs_write', description: 'Write host file', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal command', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_output', description: 'Read terminal output', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { projectPath: 'C:\\Projekty\\TurboProject2' },
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    expect(result.data.toolEvidence).toMatchObject({
      toolCallCount: 3,
      toolResultCount: 3,
      toolNames: ['fs_write', 'terminal_spawn', 'terminal_output'],
      successfulToolNames: ['fs_write', 'terminal_spawn', 'terminal_output'],
      targetPaths: [
        'C:\\Projekty\\TurboProject2\\src\\runtime-proof.ts',
        'C:\\Projekty\\TurboProject2',
      ],
    });
  });

  it('allows architecture runs to override subagent iteration budget from context', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          maxArchitectureSubagentIterations: 6,
          maxArchitectureSubagentIterationsBySlot: { [slot.id]: 5 },
        },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].maxIterations).toBe(5);
  });

  it('allows architecture graph runs to use high subagent iteration budgets when explicitly configured', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { maxArchitectureSubagentIterations: 25 },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].maxIterations).toBe(25);
  });

  it('returns partial tool evidence when a subagent errors after CLI work starts', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    const slot = schema?.roleSlots.find((candidate) => candidate.id === 'orchestrator');
    if (!schema || !slot) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-cli',
          toolName: 'run_cli_agent',
          args: { workdir: 'C:\\Projekty\\TurboProject2' },
          sessionId: 'branch-orchestrator',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-cli',
          toolName: 'run_cli_agent',
          status: 'error',
          errorMessage: 'CLI agent timed out after writing files',
          sessionId: 'branch-orchestrator',
        } as never);
        throw new Error('Sub-agent timed out after 1200000ms');
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'run_cli_agent', description: 'Run CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
        context: {
          projectPath: 'C:\\Projekty\\TurboProject2',
          allowArchitectureOrchestratorSubagents: true,
        },
      },
      slot,
      branchSessionId: 'branch-orchestrator',
      personaId: slot.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    expect(result.message).toContain('hit a recoverable branch error');
    expect(result.message).toContain('route_to(implementer');
    expect(result.data.recoverableRuntimeError).toBe('Sub-agent timed out after 1200000ms');
    expect(result.data.toolEvidence).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1,
      toolNames: ['run_cli_agent'],
      targetPaths: ['C:\\Projekty\\TurboProject2'],
    });
  });

  it('allows architecture runs to override subagent timeout budget from context', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          maxArchitectureSubagentTimeoutMs: 600_000,
          maxArchitectureSubagentTimeoutMsBySlot: { [slot.id]: 900_000 },
        },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].timeoutMs).toBe(900_000);
  });

  it('grants VFS write tools only to architecture tool executor slots by default', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-write',
          toolName: 'vfs_write',
          args: { filePath: 'project/proof.md' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-write',
          toolName: 'vfs_write',
          status: 'running',
          data: { filePath: 'project/proof.md' },
        } as never);
        return {
        result: 'Materialized artifacts',
        taskId: 'task-materializer',
        childSessionId: 'branch-materializer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
        };
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_output', description: 'Read terminal output', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write', 'spawn_cli_agent', 'message_cli_agent']);
    expect(call?.maxIterations).toBe(2);
    expect(call?.objective).toContain('Slot: Materializer (tool_executor)');
    expect(call?.objective).toContain('Act as an execution slot, not a planner.');
    expect(call?.objective).toContain('create or update the required artifacts first with vfs_write, fs_write, or a durable CLI child agent');
    expect(call?.objective).toContain('A materializer cannot pass by only inspecting an existing artifact or running build/test commands');
    expect(call?.objective).toContain('build-only work belongs to verifier slots');
    expect(call?.objective).toContain('Do not spend early tool calls on environment probes');
    expect(call?.objective).toContain('After a materializer has visible write evidence');
    expect(call?.objective).toContain('use VFS or host-project reads as evidence unless terminal tools are available');
    expect(call?.objective).toContain('Do not claim runtime proof unless a visible tool result proves it.');
    expect(result.data.toolEvidence).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1,
      toolNames: ['vfs_write'],
      successfulToolNames: ['vfs_write'],
    });
    expect(result.data.stream).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1,
    });
  });

  it('gates materializer read tools when upstream evidence already includes project reads', async () => {
    const schema = getGoalMasterSchema();
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Materializer wrote accessibility polish.',
        taskId: 'task-materializer',
        childSessionId: 'branch-materializer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
        toolEvidence: {
          toolCallCount: 1,
          toolResultCount: 1,
          toolNames: ['fs_write'],
          successfulToolNames: ['fs_write'],
          targetPaths: ['C:\\Projekty\\TurboProject2\\src\\App.tsx'],
        },
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_output', description: 'Read terminal output', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const incomingEvents: ArchitectureExecutionEvent[] = [{
      id: 'event-implementer',
      runId: 'run-1',
      sequence: 1,
      type: 'participant_output',
      message: 'Implementer gathered project evidence.',
      data: {
        toolEvidence: {
          toolCallCount: 1,
          toolResultCount: 1,
          toolNames: ['fs_read'],
          successfulToolNames: ['fs_read'],
          targetPaths: ['C:\\Projekty\\TurboProject2\\src\\App.tsx'],
        },
      },
      createdAt: Date.now(),
    }];
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          projectPath: 'C:\\Projekty\\TurboProject2',
          executionCwd: 'C:\\Projekty\\TurboProject2',
        },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
      incomingEvents,
    });

    const toolNames = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].availableTools.map((tool) => tool.name);
    expect(toolNames).toEqual(['fs_write']);
  });

  it('grants host project read tools to non-executor slots when a local project path is configured', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Inspected project',
        taskId: 'task-project-read',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { projectPath: 'C:\\Projekty\\bitecs-gpu---shared-memory-explorer' },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'fs_list',
      'fs_read',
    ]);
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('fs_write');
    expect(call?.objective).toContain('Local host project path: C:\\Projekty\\bitecs-gpu---shared-memory-explorer');
    expect(call?.objective).toContain('call fs_list or fs_read first');
  });

  it('grants host project write tools only to tool executor slots without auto-approving them by default', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Materialized host project artifact',
        taskId: 'task-host-write',
        childSessionId: 'branch-materializer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { executionCwd: 'C:\\Projekty\\bitecs-gpu---shared-memory-explorer' },
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
      'fs_list',
      'fs_read',
      'fs_write',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write', 'spawn_cli_agent', 'message_cli_agent']);
    expect(call?.objective).toContain('Use fs_write only from tool-executor slots when an approved materialization is required.');
  });

  it('auto-approves host project writes for tool executor slots only when run context opts in', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Materialized host project artifact',
        taskId: 'task-host-write',
        childSessionId: 'branch-materializer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          projectPath: 'C:\\Projekty\\TurboProject2',
          autoApproveArchitectureProjectWrites: true,
        },
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.autoApproveTools).toEqual(['vfs_write', 'spawn_cli_agent', 'message_cli_agent', 'fs_write']);
  });

  it('grants terminal tools to tool executor slots only when an execution cwd is configured', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const verifier = schema.roleSlots.find((slot) => slot.id === 'verifier');
    if (!verifier) throw new Error('Expected verifier slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Verified artifacts',
        taskId: 'task-verifier',
        childSessionId: 'branch-verifier',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_output', description: 'Read terminal output', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { executionCwd: 'C:\\Projekty\\kalio-forever' },
        branchSessionIds: { verifier: 'branch-verifier' },
      },
      slot: verifier,
      branchSessionId: 'branch-verifier',
      personaId: verifier.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
      'fs_list',
      'fs_read',
      'fs_write',
      'terminal_spawn',
      'terminal_output',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write']);
  });

  it('auto-approves terminal spawn for tool executor slots only with explicit architecture terminal opt-in', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const verifier = schema.roleSlots.find((slot) => slot.id === 'verifier');
    if (!verifier) throw new Error('Expected verifier slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Tested artifacts',
        taskId: 'task-verifier',
        childSessionId: 'branch-verifier',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'terminal_spawn', description: 'Run terminal', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          executionCwd: 'C:\\Projekty\\TurboProject2',
          autoApproveArchitectureTerminal: true,
        },
        branchSessionIds: { verifier: 'branch-verifier' },
      },
      slot: verifier,
      branchSessionId: 'branch-verifier',
      personaId: verifier.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.autoApproveTools).toEqual(['vfs_write', 'terminal_spawn']);
  });

  it('grants orchestration slots subagent and CLI-agent delegation tools', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 42,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
        { name: 'run_subagent', description: 'Run subagent', parameters: {}, requiresConfirmation: false },
        { name: 'spawn_subagent', description: 'Spawn subagent', parameters: {}, requiresConfirmation: false },
        { name: 'message_subagent', description: 'Message subagent', parameters: {}, requiresConfirmation: false },
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'message_cli_agent', description: 'Message CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'wait_for', description: 'Wait for async tool', parameters: {}, requiresConfirmation: false },
        { name: 'stop_cli_agent', description: 'Stop CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
        context: {
          projectPath: 'C:\\Projekty\\TurboProject2',
          allowArchitectureOrchestratorSubagents: true,
        },
      },
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'fs_list',
      'fs_read',
      'run_subagent',
      'spawn_subagent',
      'message_subagent',
      'spawn_cli_agent',
      'message_cli_agent',
      'get_cli_agent_status',
      'wait_for',
    ]);
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('stop_cli_agent');
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('fs_write');
    expect(call?.autoApproveTools).toEqual([
      'vfs_write',
      'spawn_cli_agent',
      'message_cli_agent',
    ]);
    expect(call?.objective).toContain('Act as the delivery orchestrator.');
    expect(call?.objective).toContain('Treat CLI agents as delegated sub-agents at the architecture level');
    expect(call?.objective).toContain('Use spawn_cli_agent only when the architecture policy exposes it');
    expect(call?.objective).toContain('Copilot CLI is the implementation sub-agent backend');
    expect(call?.objective).toContain('Codex CLI is the conservative development or code-analysis sub-agent backend');
    expect(call?.objective).toContain('Gemini CLI is the broad analysis or brainstorming sub-agent backend');
    expect(call?.objective).toContain('CLI backend policy:');
    expect(call?.objective).toContain('Allowed CLI backends: gemini, copilot, codex.');
    expect(call?.objective).toContain('set agentId explicitly from this policy');
    expect(result.data.route_to).toEqual({
      targetNodeId: 'implementer',
      response: 'next step ready',
    });
  });

  it('hides CLI-agent tools when architecture context marks CLI agents unavailable', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'run_subagent', description: 'Run subagent', parameters: {}, requiresConfirmation: false },
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'message_cli_agent', description: 'Message CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'stop_cli_agent', description: 'Stop CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
        context: {
          availableCliAgents: [],
          allowArchitectureCliStop: true,
        },
      },
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write']);
    expect(call?.objective).toContain('CLI agents are unavailable for this run.');
    expect(call?.objective).toContain('route to the next architecture node instead');
    expect(call?.objective).not.toContain('Use spawn_cli_agent to create CLI child agents');
    expect(call?.objective).not.toContain('Allowed CLI backends:');
  });

  it('requires Implementer write capability in Goal Guard proof mode', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const implementer = schema.roleSlots.find((slot) => slot.id === 'implementer');
    if (!implementer) throw new Error('Expected implementer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Implementation proof written.',
        taskId: 'task-implementer',
        childSessionId: 'branch-implementer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { implementer: 'branch-implementer' },
        context: { requireGoalMasterLoopProof: true },
      },
      slot: implementer,
      branchSessionId: 'branch-implementer',
      personaId: implementer.defaultPersonaId,
      outgoingNodeIds: ['materializer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write']);
    expect(call?.objective).toContain('Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write');
  });

  it('requires Implementer write capability when strict Implementer proof is enabled alone', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const implementer = schema.roleSlots.find((slot) => slot.id === 'implementer');
    if (!implementer) throw new Error('Expected implementer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Implementation proof written.',
        taskId: 'task-implementer',
        childSessionId: 'branch-implementer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { implementer: 'branch-implementer' },
        context: { requireImplementerWriteProof: true },
      },
      slot: implementer,
      branchSessionId: 'branch-implementer',
      personaId: implementer.defaultPersonaId,
      outgoingNodeIds: ['materializer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write']);
    expect(call?.objective).toContain('Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write');
  });

  it('grants host project write capability to strict Implementer proof runs when project writes are approved', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const implementer = schema.roleSlots.find((slot) => slot.id === 'implementer');
    if (!implementer) throw new Error('Expected implementer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Implementation proof written.',
        taskId: 'task-implementer',
        childSessionId: 'branch-implementer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_write', description: 'Write host files', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { implementer: 'branch-implementer' },
        context: {
          requireImplementerWriteProof: true,
          projectPath: 'C:\\Projekty\\TurboProject2',
          autoApproveArchitectureProjectWrites: true,
        },
      },
      slot: implementer,
      branchSessionId: 'branch-implementer',
      personaId: implementer.defaultPersonaId,
      outgoingNodeIds: ['materializer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
      'fs_list',
      'fs_read',
      'fs_write',
    ]);
    expect(call?.autoApproveTools).toEqual(['vfs_write', 'fs_write']);
    expect(call?.objective).toContain('use fs_write for host project files');
  });

  it('lets materializer slots own durable CLI child materialization and exposes child session evidence downstream', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-cli',
          toolName: 'spawn_cli_agent',
          args: { workdir: 'C:\\Projekty\\TurboProject2' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-cli',
          toolName: 'spawn_cli_agent',
          status: 'running',
          data: {
            childSessionId: 'cli-child-1',
            agentId: 'copilot',
            workdir: 'C:\\Projekty\\TurboProject2',
            status: 'running',
          },
        } as never);
        return {
          result: 'Spawned Copilot materializer child cli-child-1 and reported its status.',
          taskId: 'task-materializer',
          childSessionId: 'branch-materializer',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 42,
        };
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_write', description: 'Write VFS files', parameters: {}, requiresConfirmation: true },
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'message_cli_agent', description: 'Message CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'wait_for', description: 'Wait for async tool', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { projectPath: 'C:\\Projekty\\TurboProject2' },
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'vfs_write',
      'spawn_cli_agent',
      'message_cli_agent',
      'get_cli_agent_status',
      'wait_for',
    ]);
    expect(call?.autoApproveTools).toEqual([
      'vfs_write',
      'spawn_cli_agent',
      'message_cli_agent',
    ]);
    expect(call?.objective).toContain('durable CLI child agent');
    expect(call?.objective).toContain('Do not spawn a second materialization path');
    expect(result.data.toolEvidence).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1,
      toolNames: ['spawn_cli_agent'],
      successfulToolNames: ['spawn_cli_agent'],
      targetPaths: ['C:\\Projekty\\TurboProject2'],
      childCliSessions: [
        {
          childSessionId: 'cli-child-1',
          agentId: 'copilot',
          workdir: 'C:\\Projekty\\TurboProject2',
          status: 'running',
        },
      ],
    });
  });

  it('summarizes failed get_cli_agent_status results as CLI child evidence', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const verifier = schema.roleSlots.find((slot) => slot.id === 'verifier');
    if (!verifier) throw new Error('Expected verifier slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-cli-status',
          toolName: 'get_cli_agent_status',
          args: { childSessionId: 'cli-child-failed' },
          sessionId: 'branch-verifier',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-cli-status',
          toolName: 'get_cli_agent_status',
          status: 'success',
          data: {
            childSessionId: 'cli-child-failed',
            agentId: 'gemini',
            workdir: 'C:\\Projekty\\TurboProject2',
            status: 'failed',
          },
        } as never);
        return {
          result: 'CLI child cli-child-failed failed acceptance verification.',
          taskId: 'task-verifier',
          childSessionId: 'branch-verifier',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 42,
        };
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { verifier: 'branch-verifier' },
      },
      slot: verifier,
      branchSessionId: 'branch-verifier',
      personaId: verifier.defaultPersonaId,
    });

    expect(result.data.toolEvidence).toMatchObject({
      childCliSessions: [
        {
          childSessionId: 'cli-child-failed',
          agentId: 'gemini',
          workdir: 'C:\\Projekty\\TurboProject2',
          status: 'failed',
        },
      ],
    });
  });

  it('does not summarize failed get_cli_agent_status lookups without a runtime snapshot as CLI child evidence', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const materializer = schema.roleSlots.find((slot) => slot.id === 'materializer');
    if (!materializer) throw new Error('Expected materializer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('tool:start', {
          callId: 'call-cli-status-missing',
          toolName: 'get_cli_agent_status',
          args: { childSessionId: 'implementer' },
          sessionId: 'branch-materializer',
          agentRun: undefined as never,
        });
        request.emit?.('tool:result', {
          callId: 'call-cli-status-missing',
          toolName: 'get_cli_agent_status',
          status: 'error',
          errorMessage: 'CLI_AGENT_SESSION_NOT_FOUND: implementer',
        } as never);
        return {
          result: 'Status lookup failed because implementer is not a CLI child session id.',
          taskId: 'task-materializer',
          childSessionId: 'branch-materializer',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 42,
        };
      }),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { materializer: 'branch-materializer' },
      },
      slot: materializer,
      branchSessionId: 'branch-materializer',
      personaId: materializer.defaultPersonaId,
    });

    expect(result.data.toolEvidence).toMatchObject({
      toolCallCount: 1,
      toolResultCount: 1,
      toolNames: ['get_cli_agent_status'],
      successfulToolNames: [],
    });
    expect(result.data.toolEvidence).not.toHaveProperty('childCliSessions');
  });

  it('exposes stop_cli_agent to orchestration slots only with explicit run context opt-in', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'message_cli_agent', description: 'Message CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'stop_cli_agent', description: 'Stop CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
        context: { allowArchitectureCliStop: true },
      },
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toContain('stop_cli_agent');
    expect(call?.autoApproveTools).not.toContain('stop_cli_agent');
  });

  it('hides LLM subagent tools from orchestration slots unless explicitly enabled', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'run_subagent', description: 'Run child subagent', parameters: {}, requiresConfirmation: false },
        { name: 'spawn_subagent', description: 'Spawn child subagent', parameters: {}, requiresConfirmation: false },
        { name: 'message_subagent', description: 'Message child subagent', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);
    const baseInput = {
      schema,
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    };

    await service.execute({
      ...baseInput,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
      },
    });
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].availableTools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(['run_subagent', 'spawn_subagent', 'message_subagent']),
    );
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective).toContain('route_to(targetNodeId, response)');
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective).toContain('do not call run_subagent, spawn_subagent, or message_subagent');

    await service.execute({
      ...baseInput,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
        context: { allowArchitectureOrchestratorSubagents: true },
      },
    });
    expect(vi.mocked(subagentRuntime.runSubagent).mock.calls[1]?.[0].availableTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['run_subagent', 'spawn_subagent', 'message_subagent']),
    );
  });

  it('lets architecture run context override CLI backend policy per slot', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const verifier = schema.roleSlots.find((slot) => slot.id === 'verifier');
    if (!verifier) throw new Error('Expected verifier slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Verifier checked configured backend policy.',
        taskId: 'task-verifier',
        childSessionId: 'branch-verifier',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { verifier: 'branch-verifier' },
        context: {
          cliBackendPolicy: {
            verifier: {
              preferred: 'gemini',
              allowed: ['gemini', 'codex'],
              purpose: 'Use Gemini for broad test analysis before Codex fallback',
            },
          },
        },
      },
      slot: verifier,
      branchSessionId: 'branch-verifier',
      personaId: verifier.defaultPersonaId,
    });

    const objective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    expect(objective).toContain('CLI backend policy:');
    expect(objective).toContain('Use Gemini for broad test analysis before Codex fallback.');
    expect(objective).toContain('Preferred CLI backend: gemini.');
    expect(objective).toContain('Allowed CLI backends: gemini, codex.');
  });

  it('adds user CLI model preferences to CLI-agent tool descriptions without leaking them into generic context', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'message_cli_agent', description: 'Message CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'fs_list', description: 'List host files', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          projectPath: 'C:\\Projekty\\TurboProject2',
          cliAgentToolPreferences: {
            copilot: 'Prefer cheap materialization and avoid large exploratory rewrites.',
            codex: 'Use conservative verification only.',
          },
        },
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
      },
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    const spawn = call?.availableTools.find((tool) => tool.name === 'spawn_cli_agent');
    const status = call?.availableTools.find((tool) => tool.name === 'get_cli_agent_status');
    const fsList = call?.availableTools.find((tool) => tool.name === 'fs_list');
    expect(spawn?.description).toContain('Architecture CLI preferences: copilot: Prefer cheap materialization');
    expect(status?.description).toContain('codex: Use conservative verification only.');
    expect(fsList?.description).toBe('List host files');
    expect(call?.objective).not.toContain('cliAgentToolPreferences');
  });

  it('formats structured CLI preferences with model labels in CLI-agent tool descriptions', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const orchestrator = schema.roleSlots.find((slot) => slot.id === 'orchestrator');
    if (!orchestrator) throw new Error('Expected orchestrator slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, next step ready)',
        taskId: 'task-orchestrator',
        childSessionId: 'branch-orchestrator',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'spawn_cli_agent', description: 'Spawn CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          cliAgentToolPreferences: {
            copilot: {
              model: 'gpt-4.1',
              preference: 'Prefer cheap materialization.',
            },
            gemini: {
              model: 'gemini-2.5-pro',
              preference: 'Use for brainstorming.',
            },
          },
        },
        branchSessionIds: { orchestrator: 'branch-orchestrator' },
      },
      slot: orchestrator,
      branchSessionId: 'branch-orchestrator',
      personaId: orchestrator.defaultPersonaId,
      outgoingNodeIds: ['implementer'],
    });

    const toolDescription = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].availableTools[0]?.description ?? '';
    expect(toolDescription).toContain('copilot (model gpt-4.1): Prefer cheap materialization.');
    expect(toolDescription).toContain('gemini (model gemini-2.5-pro): Use for brainstorming.');
  });

  it('lets Goal Master delegate review checks without granting write-capable CLI tools', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const judge = schema.roleSlots.find((slot) => slot.id === 'goal_master');
    if (!judge) throw new Error('Expected Goal Master slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(final-artifact, accepted)',
        taskId: 'task-judge',
        childSessionId: 'branch-goal',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_list', description: 'List VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'run_subagent', description: 'Run subagent', parameters: {}, requiresConfirmation: false },
        { name: 'spawn_subagent', description: 'Spawn subagent', parameters: {}, requiresConfirmation: false },
        { name: 'message_subagent', description: 'Message subagent', parameters: {}, requiresConfirmation: false },
        { name: 'run_cli_agent', description: 'Run CLI agent', parameters: {}, requiresConfirmation: true },
        { name: 'get_cli_agent_status', description: 'Get CLI status', parameters: {}, requiresConfirmation: false },
        { name: 'wait_for', description: 'Wait for async tool', parameters: {}, requiresConfirmation: false },
        { name: 'stop_cli_agent', description: 'Stop CLI agent', parameters: {}, requiresConfirmation: true },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { goal_master: 'branch-goal' },
      },
      slot: judge,
      branchSessionId: 'branch-goal',
      personaId: judge.defaultPersonaId,
      outgoingNodeIds: ['final-artifact', 'implementer'],
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools.map((tool) => tool.name)).toEqual([
      'vfs_list',
      'vfs_read',
      'run_subagent',
      'get_cli_agent_status',
      'wait_for',
    ]);
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('spawn_subagent');
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('message_subagent');
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('run_cli_agent');
    expect(call?.availableTools.map((tool) => tool.name)).not.toContain('stop_cli_agent');
    expect(call?.objective).toContain('You may delegate focused review checks with synchronous run_subagent and inspect CLI child-session status');
    expect(call?.objective).toContain('do not spawn background review agents from this judge slot');
  });

  it('allows longer subagent execution for synthesis and finalizer slots', async () => {
    const schema = getSchema();
    const finalizer = schema.roleSlots.find((slot) => slot.slotType === 'finalizer');
    if (!finalizer) throw new Error('Expected finalizer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Final answer',
        taskId: 'task-final',
        childSessionId: 'branch-final',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: createRun('subagent_execution'),
      slot: finalizer,
      branchSessionId: 'branch-final',
      personaId: finalizer.defaultPersonaId,
    });

    expect(subagentRuntime.runSubagent).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: 300_000,
    }));
  });

  it('does not grant tools to finalizer slots', async () => {
    const schema = getSchema();
    const finalizer = schema.roleSlots.find((slot) => slot.slotType === 'finalizer');
    if (!finalizer) throw new Error('Expected finalizer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Final answer',
        taskId: 'task-final',
        childSessionId: 'branch-final',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const toolDispatch = {
      getToolMetas: vi.fn((): ToolMeta[] => [
        { name: 'vfs_read', description: 'Read VFS files', parameters: {}, requiresConfirmation: false },
        { name: 'fs_read', description: 'Read host files', parameters: {}, requiresConfirmation: false },
      ]),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime, toolDispatch as never);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: { projectPath: 'C:\\Projekty\\bitecs-gpu---shared-memory-explorer' },
      },
      slot: finalizer,
      branchSessionId: 'branch-final',
      personaId: finalizer.defaultPersonaId,
    });

    const call = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0];
    expect(call?.availableTools).toEqual([]);
    expect(call?.objective).toContain('Do not call tools or start a new investigation.');
    expect(call?.objective).not.toContain('call fs_list or fs_read first');
    expect(call?.objective).not.toContain('Local host project path:');
  });

  it('shows attached VFS file paths in subagent objectives without leaking hydration control keys', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        context: {
          hydrateFromSessionId: 'parent-1',
          hydrateTargetPrefix: 'project',
          hydrateFilePaths: ['project/App.tsx', 'project/README.md'],
          priority: 'ship_mvp',
        },
      },
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    const objective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    expect(objective).toContain('Attached VFS project files:');
    expect(objective).toContain('- project/App.tsx');
    expect(objective).toContain('call vfs_read or vfs_grep_search first');
    expect(objective).toContain('Context: {"priority":"ship_mvp"}');
    expect(objective).not.toContain('hydrateFromSessionId');
  });

  it('wraps subagent streaming events for architecture branch collection', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const parentEvents: Array<{ event: string; delta?: string }> = [];
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async (request) => {
        request.emit?.('agent:start', {
          sessionId: 'branch-1',
          turnId: 'turn-1',
          agentRun: { agentRunId: 'agent-1', agentType: 'subagent' },
        });
        request.emit?.('chat:chunk', {
          sessionId: 'branch-1',
          messageId: 'message-1',
          delta: 'hello ',
          done: false,
        });
        request.emit?.('chat:chunk', {
          sessionId: 'branch-1',
          messageId: 'message-1',
          delta: 'router',
          done: false,
        });
        request.emit?.('chat:complete', {
          sessionId: 'branch-1',
          messageId: 'message-1',
        });
        return {
          result: 'hello router',
          taskId: 'task-1',
          childSessionId: 'branch-1',
          parentSessionId: 'root-1',
          vfsMode: 'shared' as const,
          vfsSessionId: 'root-1',
          copiedFiles: [],
          durationMs: 7,
        };
      }),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    const result = await service.execute({
      schema,
      run: createRun('subagent_execution'),
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
      node: { id: 'agent-1', label: 'Agent 1', kind: 'role', roleSlotId: slot.id },
      emit: (event, data) => {
        const payload: Record<string, unknown> = isRecord(data) ? data : {};
        const delta = payload['delta'];
        parentEvents.push({
          event,
          delta: event === 'chat:chunk' && typeof delta === 'string' ? delta : undefined,
        });
      },
    });

    expect(parentEvents).toEqual([
      { event: 'agent:start', delta: undefined },
      { event: 'chat:chunk', delta: 'hello ' },
      { event: 'chat:chunk', delta: 'router' },
      { event: 'chat:complete', delta: undefined },
    ]);
    expect(result.data.stream).toMatchObject({
      streamGroupId: 'architecture:run-1:agent-1',
      runId: 'run-1',
      nodeId: 'agent-1',
      roleSlotId: 'pragmatist',
      branchSessionId: 'branch-1',
      personaId: 'dev',
      status: 'completed',
      chunkCount: 2,
    });
    expect(result.data.stream).not.toHaveProperty('text');
    expect(result.data.stream).not.toHaveProperty('events');
  });

  it('parses route_to responses that contain parentheses', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(router, Use option (A) and preserve validation notes (required).)',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    const result = await service.execute({
      schema,
      run: createRun('subagent_execution'),
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
      outgoingNodeIds: ['router'],
    });

    expect(result.data.route_to).toEqual({
      targetNodeId: 'router',
      response: 'Use option (A) and preserve validation notes (required).',
    });
  });

  it('applies per-slot context policy before building subagent objectives', async () => {
    const schema = {
      ...getSchema(),
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: true,
        includeBrowserSession: true,
        includePriorDecisions: true,
        perSlotOverrides: {
          pragmatist: {
            includeBrowserSession: false,
            includePriorDecisions: false,
            includeOtherAgentOutputs: false,
          },
          router: {
            contextCompression: 'evidence_only' as const,
          },
        },
      },
    };
    const pragmatist = schema.roleSlots.find((slot) => slot.id === 'pragmatist');
    const router = schema.roleSlots.find((slot) => slot.id === 'router');
    if (!pragmatist || !router) throw new Error('Expected slots');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);
    const run = {
      ...createRun('subagent_execution'),
      branchSessionIds: { pragmatist: 'branch-1', router: 'branch-router' },
      context: {
        priority: 'ship_mvp',
        projectMemory: 'Use existing chat streaming.',
        browserSession: 'Current browser tab contains private page text.',
        priorDecisions: 'Previous ADR selected a single global router.',
        evidence: ['Architecture graph controls output filtering.'],
        notes: 'General scratch note.',
      },
    };

    await service.execute({
      schema,
      run,
      slot: pragmatist,
      branchSessionId: 'branch-1',
      personaId: pragmatist.defaultPersonaId,
      incomingEvents: [
        {
          id: 'event-shadow',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Shadow output must not leak to this slot.',
          nodeId: 'shadow',
          roleSlotId: 'shadow',
          createdAt: 1,
        },
      ],
    });
    await service.execute({
      schema,
      run,
      slot: router,
      branchSessionId: 'branch-router',
      personaId: router.defaultPersonaId,
      incomingEvents: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 2,
          type: 'participant_output',
          message: 'Agent output for router.',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          createdAt: 2,
        },
      ],
    });

    const pragmatistObjective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    const routerObjective = vi.mocked(subagentRuntime.runSubagent).mock.calls[1]?.[0].objective ?? '';
    expect(pragmatistObjective).toContain('Task: Pick a strategy.');
    expect(pragmatistObjective).toContain('"projectMemory":"Use existing chat streaming."');
    expect(pragmatistObjective).toContain('"priority":"ship_mvp"');
    expect(pragmatistObjective).not.toContain('Incoming graph outputs:');
    expect(pragmatistObjective).not.toContain('browserSession');
    expect(pragmatistObjective).not.toContain('priorDecisions');
    expect(pragmatistObjective).not.toContain('Shadow output must not leak');

    expect(routerObjective).toContain('Incoming graph outputs:');
    expect(routerObjective).toContain('Agent output for router.');
    expect(routerObjective).toContain('Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them.');
    expect(routerObjective).toContain('"evidence":["Architecture graph controls output filtering."]');
    expect(routerObjective).not.toContain('projectMemory');
    expect(routerObjective).not.toContain('browserSession');
    expect(routerObjective).not.toContain('priorDecisions');
    expect(routerObjective).not.toContain('notes');
  });

  it('carries tool evidence and incomplete markers into downstream objectives', async () => {
    const schema = getSchema();
    const router = schema.roleSlots.find((slot) => slot.id === 'router');
    if (!router) throw new Error('Expected router slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Router result',
        taskId: 'task-router',
        childSessionId: 'branch-router',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { router: 'branch-router' },
      },
      slot: router,
      branchSessionId: 'branch-router',
      personaId: router.defaultPersonaId,
      incomingEvents: [
        {
          id: 'event-pragmatist',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Sub-agent stopped after 3 tool iterations without producing a final answer.',
          nodeId: 'pragmatist',
          roleSlotId: 'pragmatist',
          data: {
            incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
            toolEvidence: {
              toolCallCount: 4,
              toolResultCount: 4,
              toolNames: ['fs_list', 'fs_read'],
              successfulToolNames: ['fs_list', 'fs_read'],
            },
          },
          createdAt: 2,
        },
      ],
    });

    const objective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    expect(objective).toContain('toolEvidence=4 result(s), successful=fs_list, fs_read');
    expect(objective).toContain('incomplete=Subagent exhausted its tool loop without producing a final answer.');
  });

  it('gives judge slots a strict evidence-only continuation contract', async () => {
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const judge = schema.roleSlots.find((slot) => slot.id === 'goal_master');
    if (!judge) throw new Error('Expected Goal Master slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'route_to(implementer, evidence incomplete)',
        taskId: 'task-judge',
        childSessionId: 'branch-goal',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: createRun('subagent_execution'),
      slot: judge,
      branchSessionId: 'branch-goal',
      personaId: judge.defaultPersonaId,
      outgoingNodeIds: ['final-artifact', 'implementer'],
      incomingEvents: [
        {
          id: 'event-tester',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Tester says evidence is incomplete.',
          nodeId: 'tester',
          roleSlotId: 'tester',
          createdAt: 1,
        },
      ],
    });

    const objective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    expect(objective).toContain('Act as a strict Goal Master judge.');
    expect(objective).toContain('Do not invent previous passes, hidden work, files, tests, or approvals.');
    expect(objective).toContain('Route to the final artifact only when incoming graph outputs prove the goal is complete.');
    expect(objective).toContain('Available next nodes are final-artifact, implementer.');
    expect(objective).toContain('Tester says evidence is incomplete.');
  });

  it('applies per-slot evidence filtering and tool-result overrides when building objectives', async () => {
    const schema = {
      ...getSchema(),
      contextPolicy: {
        includeUserTask: true,
        includeProjectMemory: false,
        includeBrowserSession: false,
        includePriorDecisions: false,
        contextCompression: 'summary' as const,
        includeToolResults: false,
        perSlotOverrides: {
          pragmatist: {
            includeUserTask: false,
            includeToolResults: true,
            includeBrowserSession: false,
          },
          router: {
            contextCompression: 'evidence_only' as const,
            includeToolResults: true,
          },
        },
      },
    };
    const pragmatist = schema.roleSlots.find((slot) => slot.id === 'pragmatist');
    const router = schema.roleSlots.find((slot) => slot.id === 'router');
    if (!pragmatist || !router) {
      throw new Error('Expected slots');
    }
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Subagent result',
        taskId: 'task-1',
        childSessionId: 'branch-1',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);
    const run = {
      ...createRun('subagent_execution'),
      branchSessionIds: { pragmatist: 'branch-1', router: 'branch-router' },
      context: {
        priority: 'ship_mvp',
        projectMemory: 'Release notes are in the shared doc.',
        browserSession: 'Hidden tab with credentials.',
        priorDecisions: 'No browser calls were allowed.',
        evidence: ['Coverage is good.'],
        citations: ['RFC-123'],
        toolResults: [{ name: 'scan', passed: true }],
      },
    };

    await service.execute({
      schema,
      run,
      slot: pragmatist,
      branchSessionId: 'branch-1',
      personaId: pragmatist.defaultPersonaId,
      incomingEvents: [],
    });
    await service.execute({
      schema,
      run,
      slot: router,
      branchSessionId: 'branch-router',
      personaId: router.defaultPersonaId,
      incomingEvents: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Analyst proposes option A.',
          nodeId: 'analyst',
          roleSlotId: 'analyst',
          createdAt: 2,
        },
      ],
    });

    const pragmatistObjective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    const routerObjective = vi.mocked(subagentRuntime.runSubagent).mock.calls[1]?.[0].objective ?? '';
    expect(pragmatistObjective).not.toContain('Task: Pick a strategy.');
    expect(pragmatistObjective).toContain('"priority":"ship_mvp"');
    expect(pragmatistObjective).not.toContain('projectMemory');
    expect(pragmatistObjective).not.toContain('browserSession');
    expect(pragmatistObjective).toContain('"toolResults":[{"name":"scan","passed":true}]');
    expect(routerObjective).toContain('Incoming graph outputs:');
    expect(routerObjective).toContain('Analyst proposes option A.');
    expect(routerObjective).toContain('Task: Pick a strategy.');
    expect(routerObjective).toContain('"evidence":["Coverage is good."]');
    expect(routerObjective).toContain('"citations":["RFC-123"]');
    expect(routerObjective).toContain('"toolResults":[{"name":"scan","passed":true}]');
    expect(routerObjective).not.toContain('projectMemory');
    expect(routerObjective).not.toContain('browserSession');
  });

  it('guards finalizer objectives against unverified tool or file claims', async () => {
    const schema = getSchema();
    const finalizer = schema.roleSlots.find((slot) => slot.slotType === 'finalizer');
    if (!finalizer) throw new Error('Expected finalizer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: 'Final answer',
        taskId: 'task-1',
        childSessionId: 'branch-finalizer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { finalizer: 'branch-finalizer' },
      },
      slot: finalizer,
      branchSessionId: 'branch-finalizer',
      personaId: finalizer.defaultPersonaId,
      incomingEvents: [
        {
          id: 'event-agent',
          runId: 'run-1',
          sequence: 1,
          type: 'participant_output',
          message: 'Only vfs_list returned an empty file list.',
          nodeId: 'agent-1',
          roleSlotId: 'pragmatist',
          createdAt: 2,
        },
      ],
    });

    const objective = vi.mocked(subagentRuntime.runSubagent).mock.calls[0]?.[0].objective ?? '';
    expect(objective).toContain('Produce the final user-facing answer from the incoming graph outputs.');
    expect(objective).toContain('Do not claim files, tools, or capabilities unless incoming outputs explicitly prove them.');
    expect(objective).toContain('fenced JSON finalArtifact object');
  });

  it('projects finalizer JSON contract into structured artifact status data', async () => {
    const schema = getGoalMasterSchema();
    const finalizer = schema.roleSlots.find((slot) => slot.slotType === 'finalizer');
    if (!finalizer) throw new Error('Expected finalizer slot');
    const subagentRuntime: SubagentRuntimePort = {
      runSubagent: vi.fn(async () => ({
        result: [
          'Build verification is incomplete.',
          '```json',
          '{"status":"blocked","blockingReason":"Missing post-change build log.","evidence":["src/runtimeProof.ts exists"]}',
          '```',
        ].join('\n'),
        taskId: 'task-finalizer',
        childSessionId: 'branch-finalizer',
        parentSessionId: 'root-1',
        vfsMode: 'shared' as const,
        vfsSessionId: 'root-1',
        copiedFiles: [],
        durationMs: 1,
      })),
    };
    const service = new ArchitectureRoleExecutorService(subagentRuntime);

    const result = await service.execute({
      schema,
      run: {
        ...createRun('subagent_execution'),
        branchSessionIds: { finalizer: 'branch-finalizer' },
      },
      slot: finalizer,
      branchSessionId: 'branch-finalizer',
      personaId: finalizer.defaultPersonaId,
    });

    expect(result.data).toMatchObject({
      finalArtifactStatus: 'blocked',
      acceptanceStatus: 'blocked',
      blockingReason: 'Missing post-change build log.',
      evidence: ['src/runtimeProof.ts exists'],
    });
  });

  it('falls back to prepared branch output when subagent runtime is unavailable', async () => {
    const schema = getSchema();
    const slot = schema.roleSlots[0];
    if (!slot) throw new Error('Expected slot');
    const service = new ArchitectureRoleExecutorService();

    const result = await service.execute({
      schema,
      run: createRun('subagent_execution'),
      slot,
      branchSessionId: 'branch-1',
      personaId: slot.defaultPersonaId,
    });

    expect(result.message).toContain('Pragmatist branch prepared');
    expect(result.data).toMatchObject({
      branchSessionId: 'branch-1',
      personaId: 'dev',
      executionMode: 'subagent_execution',
      fallbackReason: 'subagent_runtime_unavailable',
    });
  });
});

function getSchema(): ArchitectureSchema {
  const schema = new ArchitectureRegistryService().findOne('strategic-decision-council');
  if (!schema) throw new Error('Expected Strategic Decision Council schema');
  return schema;
}

function getGoalMasterSchema(): ArchitectureSchema {
  const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
  if (!schema) throw new Error('Expected Goal Master Delivery Loop schema');
  return schema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createRun(executionMode: ArchitectureRun['executionMode']): ArchitectureRun {
  return {
    id: 'run-1',
    schemaId: 'strategic-decision-council',
    prompt: 'Pick a strategy.',
    executionMode,
    rootSessionId: 'root-1',
    branchSessionIds: { pragmatist: 'branch-1' },
    status: 'running',
    createdAt: 1,
    updatedAt: 1,
  };
}
