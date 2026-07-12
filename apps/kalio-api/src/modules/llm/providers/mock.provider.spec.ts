import { describe, expect, it, vi } from 'vitest';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';
import { MockLLMProvider } from './mock.provider';

describe('MockLLMProvider', () => {
  it('REGRESSION: throws a deterministic 429-like error when the last user prompt requests mock quota exhaustion', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please simulate provider failure [[mock:error:429]]',
      },
    ];

    await expect(
      provider.streamChat(messages, [], { sessionId: 'session-1', messageId: 'message-1', onChunk }),
    ).rejects.toThrow(/429|quota exhausted|Too Many Requests/i);
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('REGRESSION: emits malformed architecture router structured output for workflow failure e2e', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onStructuredOutput = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Slot: Router\nForce contract failure [[mock:architecture:router:malformed-output]]',
      },
    ];

    const toolCalls = await provider.streamChat(messages, [], {
      sessionId: 'session-1',
      messageId: 'message-1',
      onChunk,
      onStructuredOutput,
      structuredOutput: {
        name: 'architecture_router_output',
        schema: {},
      },
    });

    expect(toolCalls).toEqual([]);
    expect(onChunk).not.toHaveBeenCalled();
    expect(onStructuredOutput).toHaveBeenCalledWith(expect.objectContaining({
      nextAction: 'route_to',
      targetNodeId: 123,
    }));
  });

  it('REGRESSION: returns a deterministic raapp_create tool call without arg-progress chunks for fallback UX e2e', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger fallback tool intent [[mock:tool:raapp_create:no-arg-progress]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'raapp_create', description: 'Create an app', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'raapp_create',
        args: expect.objectContaining({
          type: 'html',
          mode: 'interactive',
        }),
      }),
    ]);
  });

  it('streams deterministic arg-progress before the standard raapp_create mock tool call', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger tool intent [[mock:tool:raapp_create]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'raapp_create', description: 'Create an app', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledTimes(1);
    expect(onToolArgChunk).toHaveBeenCalledWith('raapp_create', expect.any(Number));
    expect(onToolArgChunk.mock.calls[0]?.[1]).toBeGreaterThan(0);
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'raapp_create',
        args: expect.objectContaining({
          type: 'html',
          mode: 'interactive',
        }),
      }),
    ]);
  });

  it('REGRESSION: launches an explicit RAApp intent through run_raapp instead of echoing the prompt', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Run the "Visual Calculator" RA-App for me. Launch it immediately.',
          'Use run_raapp with the exact id "visual-calculator" now.',
          'Do not choose a different RA-App id unless this exact id is missing.',
        ].join('\n'),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_raapp', description: 'Run app', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('run_raapp', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'run_raapp',
        args: { id: 'visual-calculator' },
      }),
    ]);
  });

  it('REGRESSION: stops explicit RAApp mock launch after run_raapp has already completed', async () => {
    const provider = new MockLLMProvider({ delay: vi.fn().mockResolvedValue(undefined) });
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Use run_raapp with the exact id "visual-calculator" now.',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'run_raapp', args: { id: 'visual-calculator' } }],
      },
      {
        role: 'tool',
        content: '{"name":"run_raapp","id":"visual-calculator","ok":true}',
        toolCallId: 'call-1',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_raapp', description: 'Run app', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 'run_raapp completed for visual-calculator.' }),
    );
  });

  it('returns a deterministic run_sub_agentflow tool call for Talk-started AgentFlow e2e', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Start the two-agent delivery loop [[mock:tool:run_sub_agentflow]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('run_sub_agentflow', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'run_sub_agentflow',
        args: expect.objectContaining({
          flowId: 'goal_guard_delivery_loop',
          startMode: 'blocking',
          returnMode: 'summary',
          maxSteps: 50,
        }),
      }),
    ]);
  });

  it('stops repeating run_sub_agentflow after a prior AgentFlow tool result exists', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Start the two-agent delivery loop [[mock:tool:run_sub_agentflow]]',
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          flowRunId: 'run-from-talk',
          childSessionId: 'arch-run-from-talk-root',
          status: 'done',
          summary: 'Goal Guard accepted deterministic VFS evidence.',
        }),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Goal Guard AgentFlow result is available'),
      done: false,
    }));
  });

  it('stops repeating run_sub_agentflow after a prior AgentFlow tool_result exists', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages = [
      {
        role: 'user',
        content: 'Start the two-agent delivery loop [[mock:tool:run_sub_agentflow]]',
      },
      {
        role: 'tool_result',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          flowRunId: 'run-from-talk',
          childSessionId: 'arch-run-from-talk-root',
          status: 'done',
          summary: 'Goal Guard accepted deterministic VFS evidence.',
        }),
      },
    ] as unknown as ContextManagedLLMMessage[];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Goal Guard AgentFlow result is available'),
      done: false,
    }));
  });

  it('stops repeating run_sub_agentflow after a prior architecture runtime tool_result exists', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages = [
      {
        role: 'user',
        content: [
          'Use the Goal Guard delivery loop and accept only if evidence exists.',
          '[[mock:tool:run_sub_agentflow]]',
          '[[mock:goal-guard-vfs-success]]',
          '[[mock:script]]',
          'when("Slot: Orchestrator") return("route_to(implementer, run one implementation pass before guard review)")',
          'when("Slot: Finalizer") return("Goal Guard accepted deterministic VFS evidence.")',
          '[[/mock:script]]',
        ].join('\n'),
      },
      {
        role: 'tool_result',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId: 'run-from-talk',
          rootSessionId: 'arch-run-from-talk-root',
          status: 'completed',
          summary: 'Goal Guard accepted deterministic VFS evidence.',
        }),
      },
    ] as unknown as ContextManagedLLMMessage[];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Goal Guard AgentFlow result is available'),
      done: false,
    }));
  });

  it('does not treat plain tool text as a prior AgentFlow result', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Start the two-agent delivery loop [[mock:tool:run_sub_agentflow]]',
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: 'This diagnostic text mentions "flowRunId" and "childSessionId", but it is not a tool result object.',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('run_sub_agentflow', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'run_sub_agentflow',
      }),
    ]);
  });

  it('returns final text when prior AgentFlow result exists and history contains the embedded Goal Guard script', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Run the two-agent Dev/Implementer <-> Goal Guard delivery loop.',
          '[[mock:goal-guard-vfs-success]]',
          '[[mock:script]]',
          'when("Slot: Orchestrator") return("route_to(implementer, run one implementation pass)")',
          '[[/mock:script]]',
        ].join('\n'),
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          flowRunId: 'run-from-talk',
          childSessionId: 'arch-run-from-talk-root',
          status: 'done',
          summary: 'Goal Guard accepted deterministic VFS evidence.',
        }),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_sub_agentflow', description: 'Run child flow', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Goal Guard AgentFlow result is available'),
      done: false,
    }));
  });

  it('returns a deterministic vfs_write tool call without arg-progress chunks for HITL e2e', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger HITL tool intent [[mock:tool:vfs_write:no-arg-progress]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_write',
        args: {
          filePath: 'e2e/mock-tool-trigger.txt',
          content: 'mock-trigger-confirmation',
        },
      }),
    ]);
  });

  it('REGRESSION: stops repeating deterministic vfs_write after the HITL tool result exists', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger HITL tool intent [[mock:tool:vfs_write:no-arg-progress]]',
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          name: 'vfs_write',
          result: {
            filePath: 'e2e/mock-tool-trigger.txt',
            bytesWritten: 25,
          },
        }),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('vfs_write completed'),
      done: false,
    }));
  });

  it('does not treat plain tool text as a prior vfs_write result', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger HITL tool intent [[mock:tool:vfs_write:no-arg-progress]]',
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: 'Not JSON: {"name":"vfs_write"} mentioned e2e/mock-tool-trigger.txt in a diagnostic message.',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_write',
      }),
    ]);
  });

  it('returns a deterministic run_subagent tool call that will trigger child HITL', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please delegate this with child HITL [[mock:tool:run_subagent:hitl]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_subagent', description: 'Run a reasoning child', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('run_subagent', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'run_subagent',
        args: expect.objectContaining({
          inputPrompt: expect.stringContaining('[[mock:tool:vfs_write:no-arg-progress]]'),
          vfsMode: 'shared',
        }),
      }),
    ]);
    expect(toolCalls[0]?.args['autoApproveTools']).toBeUndefined();
  });

  it('lets a structured architecture router execute run_subagent before returning its decision', async () => {
    const provider = new MockLLMProvider();
    const onStructuredOutput = vi.fn();
    const toolCalls = await provider.streamChat(
      [{ role: 'user', content: 'Slot: Orchestrator [[mock:tool:run_subagent:hitl]]' }],
      [{ name: 'run_subagent', description: 'Run a reasoning child', parameters: {} }],
      {
        sessionId: 'router-session', messageId: 'router-message', onChunk: vi.fn(),
        onStructuredOutput, structuredOutput: { name: 'architecture_router_output', schema: {} },
      },
    );

    expect(toolCalls).toEqual([expect.objectContaining({ name: 'run_subagent' })]);
    expect(onStructuredOutput).not.toHaveBeenCalled();
  });

  it('returns a deterministic run_subagent tool call that auto-approves child vfs_write', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please delegate this with child auto-approval [[mock:tool:run_subagent:auto-approve]]',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_subagent', description: 'Run a reasoning child', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('run_subagent', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'run_subagent',
        args: expect.objectContaining({
          inputPrompt: expect.stringContaining('[[mock:tool:vfs_write:no-arg-progress]]'),
          autoApproveTools: ['vfs_write'],
          vfsMode: 'isolated',
        }),
      }),
    ]);
  });

  it('stops repeating deterministic run_subagent after the child HITL tool result exists', async () => {
    const provider = new MockLLMProvider({ delay: vi.fn().mockResolvedValue(undefined) });
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please delegate this with child HITL [[mock:tool:run_subagent:hitl]]',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-subagent-1',
            name: 'run_subagent',
            args: {
              taskType: 'reasoning',
              inputPrompt: 'Please inspect the issue. [[mock:tool:vfs_write:no-arg-progress]]',
              vfsMode: 'shared',
            },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"name":"run_subagent","ok":true,"sessionId":"child-session-1"}',
        toolCallId: 'call-subagent-1',
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'run_subagent', description: 'Run a reasoning child', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(onChunk).toHaveBeenCalledWith(
      expect.objectContaining({ delta: 'run_subagent completed for child HITL scenario.' }),
    );
  });

  it('returns deterministic fs_write tool call with prompt-provided path and content', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Please write proof to the host workspace [[mock:tool:fs_write]]',
          '[[mock:fs_write_path=C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts]]',
          '[[mock:fs_write_content=export const runtimeProofDemo61 = "agentflow-demo61";]]',
        ].join('\n'),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'fs_write', description: 'Write to host filesystem', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).toHaveBeenCalledWith('fs_write', expect.any(Number));
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'fs_write',
        args: {
          path: 'C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts',
          content: 'export const runtimeProofDemo61 = "agentflow-demo61";',
        },
      }),
    ]);
  });

  it('stops repeating fs_write after a prior host write tool result exists', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Please write proof to the host workspace [[mock:tool:fs_write]]',
          '[[mock:fs_write_path=C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts]]',
          '[[mock:fs_write_content=export const runtimeProofDemo61 = "agentflow-demo61";]]',
        ].join('\n'),
      },
      {
        role: 'tool_result',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          name: 'fs_write',
          result: {
            path: 'C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts',
            bytesWritten: 61,
          },
        }),
      } as unknown as ContextManagedLLMMessage,
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'fs_write', description: 'Write to host filesystem', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('fs_write completed'),
      done: false,
    }));
  });

  it('stops repeating fs_write when prior assistant tool call exists before normalized tool result', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Please write proof to the host workspace [[mock:tool:fs_write]]',
          '[[mock:fs_write_path=C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts]]',
          '[[mock:fs_write_content=export const runtimeProofDemo61 = "agentflow-demo61";]]',
        ].join('\n'),
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'mock-tool-1',
            name: 'fs_write',
            args: {
              path: 'C:\\Projekty\\TurboProject2-demo61\\src\\runtime-proof-demo61.ts',
              content: 'export const runtimeProofDemo61 = "agentflow-demo61";',
            },
          },
        ],
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'fs_write', description: 'Write to host filesystem', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('fs_write completed'),
      done: false,
    }));
  });

  it('does not treat assistant tool-call content as the target vfs_write path', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: 'Please trigger HITL tool intent [[mock:tool:vfs_write:no-arg-progress]]',
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-vfs-write-other',
            name: 'vfs_write',
            args: {
              content: 'mentions e2e/mock-tool-trigger.txt in text only',
            },
          },
        ],
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolArgChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_write',
      }),
    ]);
  });

  it('returns deterministic Goal Guard VFS tool calls before scripted text actions', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();
    const implementerMessages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Goal Master Delivery Loop v0.1.0',
          'Slot: Implementer (tool_executor)',
          'Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.',
          'Task: build proof [[mock:goal-guard-vfs-success]]',
          '[[mock:script]]',
          'when("Slot: Implementer") return("script should not bypass tool evidence")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    const implementerCalls = await provider.streamChat(
      implementerMessages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(implementerCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_write',
        args: expect.objectContaining({
          filePath: 'e2e/goal-guard-proof.json',
        }),
      }),
    ]);

    const verifierCalls = await provider.streamChat(
      [
        {
          role: 'user',
          content: [
            'Architecture: Goal Master Delivery Loop v0.1.0',
            'Slot: Verifier (tool_executor)',
            'Task: verify proof [[mock:goal-guard-vfs-success]]',
          ].join('\n'),
        },
      ],
      [{ name: 'vfs_read', description: 'Read from VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk, onToolArgChunk },
    );

    expect(verifierCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_read',
        args: { filePath: 'e2e/goal-guard-proof.json' },
      }),
    ]);
  });

  it('writes deterministic Goal Guard proof from Implementer when strict proof mode is enabled', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const onToolArgChunk = vi.fn();

    const toolCalls = await provider.streamChat(
      [
        {
          role: 'user',
          content: [
            'Architecture: Goal Master Delivery Loop v0.1.0',
            'Slot: Implementer (participant)',
            'Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.',
            'Task: build proof [[mock:goal-guard-vfs-success]]',
          ].join('\n'),
        },
      ],
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk, onToolArgChunk },
    );

    expect(onChunk).not.toHaveBeenCalled();
    expect(toolCalls).toEqual([
      expect.objectContaining({
        name: 'vfs_write',
        args: expect.objectContaining({
          filePath: 'e2e/goal-guard-proof.json',
        }),
      }),
    ]);
  });

  it('REGRESSION: stops repeating deterministic Goal Guard VFS tool calls after tool results exist', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Goal Master Delivery Loop v0.1.0',
          'Slot: Implementer (tool_executor)',
          'Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.',
          'Task: build proof [[mock:goal-guard-vfs-success]]',
        ].join('\n'),
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          name: 'vfs_write',
          status: 'success',
          result: {
            path: 'e2e/goal-guard-proof.json',
            bytesWritten: 75,
          },
        }),
      },
    ];

    const implementerCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(implementerCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('vfs_write evidence'),
      done: false,
    }));

    onChunk.mockClear();

    const verifierCalls = await provider.streamChat(
      [
        {
          role: 'user',
          content: [
            'Architecture: Goal Master Delivery Loop v0.1.0',
            'Slot: Verifier (tool_executor)',
            'Task: verify proof [[mock:goal-guard-vfs-success]]',
          ].join('\n'),
        },
        {
          role: 'tool',
          toolCallId: 'mock-tool-2',
          content: JSON.stringify({
            name: 'vfs_read',
            status: 'success',
            result: {
              filePath: 'e2e/goal-guard-proof.json',
              content: '{"status":"implemented"}',
            },
          }),
        },
      ],
      [{ name: 'vfs_read', description: 'Read from VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(verifierCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Verifier confirmed'),
      done: false,
    }));
  });

  it('REGRESSION: stops repeating Goal Guard VFS tool calls after runtime dispatcher tool results exist', async () => {
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Goal Master Delivery Loop v0.1.0',
          'Slot: Implementer (tool_executor)',
          'Implementation proof mode: the Implementer must create or update at least one artifact with vfs_write before completing.',
          'Task: build proof [[mock:goal-guard-vfs-success]]',
        ].join('\n'),
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'mock-tool-1',
            name: 'vfs_write',
            args: {
              filePath: 'e2e/goal-guard-proof.json',
              content: '{"status":"implemented"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'mock-tool-1',
        content: JSON.stringify({
          path: 'e2e/goal-guard-proof.json',
          bytesWritten: 75,
        }),
      },
    ];

    const implementerCalls = await provider.streamChat(
      messages,
      [{ name: 'vfs_write', description: 'Write to VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(implementerCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('vfs_write evidence'),
      done: false,
    }));

    onChunk.mockClear();

    const verifierCalls = await provider.streamChat(
      [
        {
          role: 'user',
          content: [
            'Architecture: Goal Master Delivery Loop v0.1.0',
            'Slot: Verifier (tool_executor)',
            'Task: verify proof [[mock:goal-guard-vfs-success]]',
          ].join('\n'),
        },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'mock-tool-2',
              name: 'vfs_read',
              args: { filePath: 'e2e/goal-guard-proof.json' },
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'mock-tool-2',
          content: JSON.stringify({
            path: 'e2e/goal-guard-proof.json',
            content: '{"status":"implemented"}',
          }),
        },
      ],
      [{ name: 'vfs_read', description: 'Read from VFS', parameters: {} }],
      { sessionId: 'session-1', messageId: 'message-2', onChunk },
    );

    expect(verifierCalls).toEqual([]);
    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({
      delta: expect.stringContaining('Verifier confirmed'),
      done: false,
    }));
  });

  it('runs directed mock scripts with wait and return actions selected by prompt content', async () => {
    const delay = vi.fn().mockResolvedValue(undefined);
    const provider = new MockLLMProvider({ delay });
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Demo',
          'Slot: Router',
          '[[mock:script]]',
          'when("Slot: Router") wait(4) return("route_to(final-artifact, scripted router answer)")',
          'when("Slot: Finalizer") return("scripted final answer")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    const toolCalls = await provider.streamChat(
      messages,
      [],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(toolCalls).toEqual([]);
    expect(delay).toHaveBeenCalledWith(4);
    expect(onChunk).toHaveBeenNthCalledWith(1, {
      delta: 'route_to(final-artifact, scripted router answer)',
      done: false,
      sessionId: 'session-1',
      messageId: 'message-1',
    });
    expect(onChunk).toHaveBeenLastCalledWith({
      delta: '',
      done: true,
      sessionId: 'session-1',
      messageId: 'message-1',
    });
  });

  it('matches script cases against runtime prompt text, not the script body', async () => {
    const provider = new MockLLMProvider({ delay: vi.fn().mockResolvedValue(undefined) });
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Demo',
          'Slot: Finalizer',
          '[[mock:script]]',
          'when("Slot: Router") return("router should not win")',
          'when("Slot: Finalizer") return("finalizer wins")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    await provider.streamChat(
      messages,
      [],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(onChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delta: 'finalizer wins',
    }));
  });

  it('does not split semicolons inside scripted return strings', async () => {
    const provider = new MockLLMProvider({ delay: vi.fn().mockResolvedValue(undefined) });
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Demo',
          'Slot: Router',
          '[[mock:script]]',
          'when("Slot: Router") wait(1) return("first;second")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    await provider.streamChat(
      messages,
      [],
      { sessionId: 'session-1', messageId: 'message-1', onChunk },
    );

    expect(onChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delta: 'first;second',
    }));
  });

  it('skips default script waits when KALIO_MOCK_LLM_FAST is enabled', async () => {
    vi.stubEnv('KALIO_MOCK_LLM_FAST', '1');
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Demo',
          'Slot: Finalizer',
          '[[mock:script]]',
          'when("Slot: Finalizer") wait(5000) return("fast finalizer")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    try {
      await expect(Promise.race([
        provider.streamChat(
          messages,
          [],
          { sessionId: 'session-1', messageId: 'message-1', onChunk },
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error('mock wait was not skipped')), 100)),
      ])).resolves.toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(onChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delta: 'fast finalizer',
    }));
  });

  it('honors scripted hold waits when KALIO_MOCK_LLM_FAST is enabled', async () => {
    vi.stubEnv('KALIO_MOCK_LLM_FAST', '1');
    vi.useFakeTimers();
    const provider = new MockLLMProvider();
    const onChunk = vi.fn();
    const messages: ContextManagedLLMMessage[] = [
      {
        role: 'user',
        content: [
          'Architecture: Demo',
          'Slot: Finalizer',
          '[[mock:script]]',
          'when("Slot: Finalizer") hold(5000) return("held finalizer")',
          '[[/mock:script]]',
        ].join('\n'),
      },
    ];

    try {
      const stream = provider.streamChat(
        messages,
        [],
        { sessionId: 'session-1', messageId: 'message-1', onChunk },
      );

      await vi.advanceTimersByTimeAsync(4_999);
      expect(onChunk).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(stream).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }

    expect(onChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delta: 'held finalizer',
    }));
  });

  it('emits architecture slot fallback responses immediately in fast mock mode', async () => {
    vi.stubEnv('KALIO_MOCK_LLM_FAST', '1');
    const delay = vi.fn().mockResolvedValue(undefined);
    const provider = new MockLLMProvider({ delay });
    const onChunk = vi.fn();

    try {
      await provider.streamChat(
        [{
          role: 'user',
          content: `Architecture: Demo\nSlot: Finalizer\n${'large context '.repeat(200)}`,
        }],
        [],
        { sessionId: 'session-1', messageId: 'message-1', onChunk },
      );
    } finally {
      vi.unstubAllEnvs();
    }

    expect(delay).not.toHaveBeenCalled();
    expect(onChunk).toHaveBeenNthCalledWith(1, expect.objectContaining({
      delta: expect.stringContaining('[MockLLM] Echo: Architecture: Demo'),
    }));
    expect(onChunk).toHaveBeenLastCalledWith(expect.objectContaining({ done: true }));
  });
});
