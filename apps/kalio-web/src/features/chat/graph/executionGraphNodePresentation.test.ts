import { describe, expect, it } from 'vitest';
import type { ExecutionGraphNode } from './executionGraphModel';
import { estimateGraphNodeHeight, getGraphNodeMetadata } from './executionGraphNodePresentation';

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
      actorLabel: 'RaBuilder',
      modelLabel: 'gpt-4.1',
    },
    ...overrides,
  };
}

describe('executionGraphNodePresentation', () => {
  it('allocates meaningfully more height to context-heavy subagent cards than comparable turn cards', () => {
    const sharedContext = 'Design a polished execution graph that preserves orchestration readability while keeping previews, child turns, and tools legible at a glance. '.repeat(2);

    const turnNode = makeNode({
      detail: `${sharedContext} Completed the orchestration turn with previews and grouped outcomes.`,
    });

    const subagentNode = makeNode({
      kind: 'subagent',
      title: 'RaBuilder',
      subtitle: sharedContext,
      detail: 'isolated VFS • The calculator is built and live! Here is what changed.',
      payload: {
        kind: 'subagent',
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

    expect(estimateGraphNodeHeight(subagentNode)).toBeGreaterThan(estimateGraphNodeHeight(turnNode) + 24);
  });

  it('gives preview-heavy tool nodes substantially more height than plain tool nodes', () => {
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

    expect(estimateGraphNodeHeight(previewTool)).toBeGreaterThanOrEqual(estimateGraphNodeHeight(plainTool) + 96);
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
});