import { describe, expect, it } from 'vitest';
import type { ExecutionGraphNode } from './executionGraphModel';
import { applyGraphNodeLayout, estimateGraphNodeHeight, getGraphNodeHeading, getGraphNodeMetadata } from './executionGraphNodePresentation';

function makeNode(overrides: Partial<ExecutionGraphNode>): ExecutionGraphNode {
  return {
    id: 'node-1',
    kind: 'turn',
    title: 'Turn',
    subtitle: 'RaBuilder',
    detail: 'Turn completed',
    status: 'success',
    column: 0,
    row: 0,
    x: 0,
    y: 0,
    width: 220,
    height: 132,
    payload: {
      kind: 'turn',
      turn: {} as never,
      textPreview: 'Built the calculator.',
      toolCount: 2,
      thinkingCount: 1,
      thinkingPreviews: [],
      actorLabel: 'RaBuilder',
      modelLabel: 'gpt-4.1',
    },
    ...overrides,
  };
}

describe('executionGraphNodePresentation', () => {
  it('moves duplicate grid-cell nodes to the next free row before placing cards', () => {
    const first = makeNode({ id: 'node-1', column: 2, row: 1, height: 100 });
    const second = makeNode({ id: 'node-2', column: 2, row: 1, height: 100 });

    applyGraphNodeLayout([first, second]);

    expect(first.row).toBe(1);
    expect(second.row).toBe(2);
    expect(first.y).not.toBe(second.y);
  });

  it('keeps context-heavy subagent cards compact while preserving extra detail space', () => {
    const sharedContext = 'Design a polished execution graph that preserves orchestration readability while keeping previews, child turns, and tools legible at a glance. '.repeat(2);

    const turnNode = makeNode({
      detail: `${sharedContext} Completed the orchestration turn with previews and grouped outcomes.`,
    });

    const subagentNode = makeNode({
      kind: 'subagent',
      title: 'RaBuilder',
      subtitle: sharedContext,
      detail: 'isolated VFS - The calculator is built and live! Here is what changed.',
      payload: {
        kind: 'subagent',
        childExecutionKind: 'sub_agent',
        result: {
          result: 'Built the calculator in the child session.',
          taskId: 'task-1',
          childSessionId: 'child-session-1',
          parentSessionId: 'session-1',
          vfsMode: 'isolated',
          vfsSessionId: 'child-session-1',
          copiedFiles: [
            { fromPath: 'index.html', toPath: 'calculator/index.html', sizeBytes: 4200 },
            { fromPath: 'styles.css', toPath: 'calculator/styles.css', sizeBytes: 1800 },
          ],
          durationMs: 3210,
        },
        transcript: [],
        copiedFiles: [
          { fromPath: 'index.html', toPath: 'calculator/index.html', sizeBytes: 4200 },
          { fromPath: 'styles.css', toPath: 'calculator/styles.css', sizeBytes: 1800 },
        ],
        actorLabel: 'RaBuilder',
        modelLabel: 'gpt-4.1',
        inputPrompt: sharedContext,
      },
    });

    expect(estimateGraphNodeHeight(subagentNode)).toBeGreaterThanOrEqual(260);
    expect(estimateGraphNodeHeight(subagentNode)).toBeLessThanOrEqual(estimateGraphNodeHeight(turnNode) + 16);
  });

  it('gives preview-heavy tool nodes more height than plain tool nodes without oversized cards', () => {
    const plainTool = makeNode({
      kind: 'tool',
      title: 'design_preview',
      subtitle: 'Execution step',
      detail: undefined,
      payload: {
        kind: 'tool',
        toolName: 'design_preview',
        args: {
          filePath: 'calculator/index.html',
          mode: 'desktop',
          persona: 'UX Designer',
        },
        activity: null,
        result: null,
        confirmationRequired: false,
      },
    });

    const previewTool = makeNode({
      kind: 'tool',
      title: 'design_preview',
      subtitle: 'Execution step',
      detail: undefined,
      payload: {
        kind: 'tool',
        toolName: 'design_preview',
        args: {
          filePath: 'calculator/index.html',
          mode: 'desktop',
          persona: 'UX Designer',
        },
        activity: null,
        result: {
          status: 'ready',
          type: 'html',
          renderedContent: '<main><h1>Preview</h1><p>Calculator</p></main>',
          vfsPath: 'calculator/index.html',
        },
        confirmationRequired: false,
      },
    });

    expect(estimateGraphNodeHeight(previewTool)).toBeGreaterThanOrEqual(estimateGraphNodeHeight(plainTool) + 40);
    expect(estimateGraphNodeHeight(previewTool)).toBeLessThanOrEqual(260);
  });

  it('formats tool metadata with human-readable labels for prominent fields', () => {
    const toolNode = makeNode({
      kind: 'tool',
      title: 'run_subagent',
      subtitle: 'Execution step',
      payload: {
        kind: 'tool',
        toolName: 'run_subagent',
        args: {
          inputPrompt: 'Polish the execution graph layout',
          filePath: 'calculator/index.html',
          vfsMode: 'isolated',
        },
        activity: null,
        result: null,
        confirmationRequired: false,
      },
    });

    expect(getGraphNodeMetadata(toolNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Prompt', value: 'Polish the execution graph...' }),
      expect.objectContaining({ label: 'File', value: 'calculator/index.html' }),
      expect.objectContaining({ label: 'VFS', value: 'isolated' }),
    ]));
  });

  it('falls back to the node title when a subtitle headline is missing', () => {
    const turnNode = makeNode({
      subtitle: '',
    });

    expect(getGraphNodeHeading(turnNode)).toEqual({
      eyebrow: 'Turn',
      headline: 'Turn',
      supporting: 'Turn completed',
    });
  });

  it('keeps confirmation warnings and hides architecture-only tool arguments from metadata', () => {
    const toolNode = makeNode({
      kind: 'tool',
      title: 'run_subagent',
      subtitle: 'Execution step',
      payload: {
        kind: 'tool',
        toolName: 'run_subagent',
        args: {
          architectureRunId: 'run-123',
          childSessionId: 'child-session-1',
          command: 'pnpm test',
          customList: ['alpha', 'beta', 'gamma'],
          details: { alpha: 1, beta: 2, gamma: 3 },
          nodeId: 'node-1',
          prompt: 'Review the execution graph',
        },
        activity: null,
        result: null,
        confirmationRequired: true,
      },
    });

    expect(getGraphNodeMetadata(toolNode)).toEqual([
      expect.objectContaining({ label: 'Approval', value: 'Accept required', tone: 'warning' }),
      expect.objectContaining({ label: 'Prompt', value: 'Review the execution graph', tone: 'default' }),
      expect.objectContaining({ label: 'Command', value: 'pnpm test', tone: 'default' }),
      expect.objectContaining({ label: 'Custom List', value: 'alpha, beta', tone: 'default' }),
      expect.objectContaining({ label: 'Details', value: 'alpha, beta, ...', tone: 'default' }),
    ]);
  });

  it('surfaces orchestration nesting level for subagent cards', () => {
    const subagentNode = makeNode({
      kind: 'subagent',
      column: 3,
      payload: {
        kind: 'subagent',
        childExecutionKind: 'sub_agent',
        result: {
          result: 'Nested review complete.',
          taskId: 'task-1',
          childSessionId: 'child-session-1',
          parentSessionId: 'session-1',
          vfsMode: 'isolated',
          vfsSessionId: 'child-session-1',
          copiedFiles: [],
          durationMs: 3210,
        },
        transcript: [],
        copiedFiles: [],
        actorLabel: 'UX Reviewer',
        modelLabel: 'mimo-v2.5-pro',
        inputPrompt: 'Review nested orchestration.',
      },
    });

    expect(getGraphNodeMetadata(subagentNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Level', value: '2' }),
    ]));
  });

  it('summarizes architecture tool proof with result counts', () => {
    const architectureNode = makeNode({
      kind: 'architecture-run',
      payload: {
        kind: 'architecture-run',
        summary: {
          runId: 'run-1',
          schemaId: 'architecture-run',
          status: 'completed',
          trace: [],
          routeHops: [],
        },
        route: {
          eventId: 'event-1',
          source: 'runtime_fallback',
          fromNodeId: 'materializer',
          toNodeId: 'verifier',
          toolEvidence: {
            toolCallCount: 2,
            toolResultCount: 2,
            toolNames: ['vfs_write', 'vfs_read'],
            successfulToolNames: ['vfs_write', 'vfs_read'],
          },
        },
      },
    });

    expect(getGraphNodeMetadata(architectureNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Proof', value: '2 results / vfs_write, vfs_read' }),
    ]));
  });

  it('formats CLI child cards with running state and compact workdir labels', () => {
    const cliNode = makeNode({
      kind: 'cli-agent',
      title: 'Codex CLI',
      subtitle: 'Running child session',
      detail: 'codex - C:/workspace/project - Ready to inspect',
      column: 2,
      payload: {
        kind: 'cli-agent',
        childExecutionKind: 'cli_agent',
        snapshot: {
          childSessionId: 'cli-child-1',
          parentSessionId: 'session-1',
          agentId: 'codex',
          workdir: 'C:/workspace/project',
          status: 'running',
          lastPrompt: 'Inspect repo',
          updatedAt: 1,
          startedAt: 1,
          activeCallId: 'call-1',
          lastExitCode: 0,
          lastOutput: 'Ready to inspect',
        },
        transcript: [],
        inputPrompt: 'Inspect repo',
      },
    });

    expect(getGraphNodeHeading(cliNode)).toEqual({
      eyebrow: 'Codex CLI',
      headline: 'Running child session',
      supporting: 'codex - C:/workspace/project - Ready to inspect',
    });
    expect(getGraphNodeMetadata(cliNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Level', value: '1' }),
      expect.objectContaining({ label: 'Agent', value: 'codex' }),
      expect.objectContaining({ label: 'Status', value: 'running', tone: 'warning' }),
      expect.objectContaining({ label: 'Workdir', value: 'project' }),
      expect.objectContaining({ label: 'Exit', value: '0' }),
    ]));
  });

  it('formats AgentFlow and final answer labels on the fields users actually read', () => {
    const flowNode = makeNode({
      kind: 'agent-flow',
      title: 'Sub AgentFlow',
      subtitle: 'flow-1 / running',
      detail: 'Goal Guard flow started.',
      payload: {
        kind: 'agent-flow',
        childExecutionKind: 'sub_agentflow',
        result: {
          flowRunId: 'flow-1',
          childSessionId: 'flow-child-1',
          openChatSessionId: 'flow-child-1',
          openGraphRunId: 'flow-1',
          status: 'running',
          summary: 'Goal Guard flow started.',
          decisions: [],
          nextActions: [],
          artifacts: [],
          tracePreview: [{ id: 'trace-1', sequence: 1, type: 'goal_guard:resume', message: 'Still running', createdAt: 1 }],
        },
        childSessionId: 'flow-child-1',
        graphRunId: 'flow-1',
        inputPrompt: 'Verify delivery',
      },
    });

    const finalNode = makeNode({
      kind: 'final-answer',
      title: 'Final response',
      subtitle: 'Last chat reply',
      payload: {
        kind: 'final-answer',
        message: {
          id: 'reply-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'Done.',
          createdAt: 1,
        },
        turn: {} as never,
      },
    });

    expect(getGraphNodeHeading(flowNode)).toEqual({
      eyebrow: 'Sub AgentFlow',
      headline: 'flow-1 / running',
      supporting: 'Goal Guard flow started.',
    });
    expect(getGraphNodeMetadata(flowNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Status', value: 'running', tone: 'warning' }),
      expect.objectContaining({ label: 'Graph', value: 'flow-1' }),
      expect.objectContaining({ label: 'Events', value: '1' }),
    ]));

    expect(getGraphNodeHeading(finalNode)).toEqual({
      eyebrow: 'Final response',
      headline: 'Last chat reply',
      supporting: 'Turn completed',
    });
    expect(getGraphNodeMetadata(finalNode)).toEqual([
      expect.objectContaining({ label: 'Outcome', value: 'Last chat reply', tone: 'accent' }),
    ]);
  });

  it('surfaces incomplete architecture route evidence as a warning chip', () => {
    const architectureNode = makeNode({
      kind: 'architecture-run',
      payload: {
        kind: 'architecture-run',
        summary: {
          runId: 'run-1',
          schemaId: 'architecture-run',
          status: 'running',
          trace: [],
          routeHops: [],
        },
        route: {
          eventId: 'event-1',
          source: 'runtime_fallback',
          fromNodeId: 'goal-master',
          toNodeId: 'implementer',
          incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
        },
      },
    });

    expect(getGraphNodeMetadata(architectureNode)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Incomplete', value: 'needs final', tone: 'warning' }),
    ]));
  });
});
