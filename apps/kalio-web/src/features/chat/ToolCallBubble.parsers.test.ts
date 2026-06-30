import type { ChatMessage } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  extractChildToolPreviews,
  extractCLIAgentResult,
  extractCLIAgentSessionSnapshot,
  extractSubAgentFlowResult,
  extractWebSearchResult,
  getChildImageIdentity,
} from './ToolCallBubble.parsers';

function toolResult(content: string, id: string): ChatMessage {
  return {
    id,
    sessionId: 'session-1',
    role: 'tool_result',
    content,
    createdAt: Date.now(),
  };
}

describe('ToolCallBubble.parsers', () => {
  it('normalizes CLI agent results and durable snapshots from backend payloads', () => {
    expect(extractCLIAgentResult({
      lastOutput: 'Scanning files...',
      lastExitCode: 0,
      updatedAt: 123,
      childSessionId: 'cli-child-1',
    })).toMatchObject({
      output: 'Scanning files...',
      exitCode: 0,
      durationMs: 0,
      agentId: 'copilot',
      childSessionId: 'cli-child-1',
    });

    expect(extractCLIAgentSessionSnapshot({
      childSessionId: 'cli-child-1',
      agentId: 'codex',
      exitCode: 1,
      workdir: 'C:/repo',
      lastPrompt: 'Inspect the repo',
      updatedAt: 456,
    })).toMatchObject({
      childSessionId: 'cli-child-1',
      agentId: 'codex',
      status: 'failed',
      workdir: 'C:/repo',
      lastPrompt: 'Inspect the repo',
      updatedAt: 456,
      lastExitCode: 1,
    });
  });

  it('rejects invalid sub-agent flow payloads and accepts the bounded runtime shape', () => {
    expect(extractSubAgentFlowResult({
      flowRunId: 'flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      childSessionId: 'child-1',
      status: 'bogus',
      summary: 'Should be rejected',
      decisions: [],
      nextActions: [],
      artifacts: [],
    })).toBeNull();

    expect(extractSubAgentFlowResult({
      flowRunId: 'flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      childSessionId: 'child-1',
      status: 'waiting_on_orchestrator',
      summary: 'Malformed trace should be rejected.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [
        {
          id: 'event-1',
          sequence: '1',
          type: 'router_decision',
          message: 'Bad sequence type.',
          createdAt: 1,
        },
      ],
    })).toBeNull();

    expect(extractSubAgentFlowResult({
      flowRunId: 'flow-1',
      childSessionId: 'child-1',
      status: 'waiting_on_orchestrator',
      summary: 'Unknown lifecycle should be rejected.',
      decisions: [],
      nextActions: [],
      artifacts: [],
      tracePreview: [
        {
          id: 'event-unknown-lifecycle',
          sequence: 1,
          type: 'flow:node_result',
          lifecycle: 'unknown_lifecycle',
          message: 'Bad lifecycle value.',
          createdAt: 1,
        },
      ],
    })).toBeNull();

    expect(extractSubAgentFlowResult({
      flowRunId: 'flow-1',
      childSessionId: 'child-1',
      status: 'waiting_on_orchestrator',
      summary: 'Malformed arrays should be rejected.',
      decisions: ['ok'],
      nextActions: ['ok'],
      artifacts: [123],
    })).toBeNull();

    expect(extractSubAgentFlowResult({
      flowRunId: 'flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      childSessionId: 'child-1',
      status: 'waiting_on_orchestrator',
      summary: 'Waiting for Goal Guard evidence.',
      decisions: ['route_to(implementer, continue)'],
      nextActions: ['Inspect the child AgentFlow trace before retrying.'],
      artifacts: ['report.md'],
      returnToOrchestratorCount: 2,
      tracePreview: [
        {
          id: 'event-1',
          sequence: 1,
          type: 'router_decision',
          lifecycle: 'return_to_orchestrator',
          message: 'Goal Guard rejected the run.',
          nodeId: 'goal-master',
          createdAt: 1,
        },
      ],
      openChatSessionId: 'chat-1',
      openGraphRunId: 'graph-1',
    })).toMatchObject({
      flowRunId: 'flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      childSessionId: 'child-1',
      status: 'waiting_on_orchestrator',
      decisions: ['route_to(implementer, continue)'],
      nextActions: ['Inspect the child AgentFlow trace before retrying.'],
      artifacts: ['report.md'],
      returnToOrchestratorCount: 2,
      tracePreview: [
        expect.objectContaining({
          lifecycle: 'return_to_orchestrator',
        }),
      ],
      openChatSessionId: 'chat-1',
      openGraphRunId: 'graph-1',
    });
  });

  it('deduplicates child previews by image identity and keeps the latest RA-App block', () => {
    const previews = extractChildToolPreviews([
      toolResult('not json', 'bad-json'),
      toolResult(JSON.stringify({
        type: 'html',
        mode: 'display',
        content: '<div>First preview</div>',
        vfsPath: 'design/first.html',
      }), 'raapp-1'),
      toolResult(JSON.stringify({
        output_type: 'image',
        image_url: 'data:image/png;base64,AAAA',
        path: 'images/hero.png',
      }), 'image-1'),
      toolResult(JSON.stringify({
        output_type: 'image',
        image_url: 'data:image/png;base64,BBBB',
        path: 'images/hero.png',
      }), 'image-2'),
      toolResult(JSON.stringify({
        type: 'gui',
        renderedContent: '<div>Latest preview</div>',
        vfsPath: 'design/latest.gui',
      }), 'raapp-2'),
      toolResult(JSON.stringify({
        output_type: 'image',
        image_url: 'data:image/png;base64,CCCC',
      }), 'image-3'),
      toolResult(JSON.stringify({
        output_type: 'image',
        image_url: 'data:image/png;base64,CCCC',
      }), 'image-4'),
    ]);

    expect(previews.raapp).toMatchObject({
      type: 'gui',
      content: '<div>Latest preview</div>',
      vfsPath: 'design/latest.gui',
    });
    expect(previews.images).toHaveLength(2);
    expect(previews.images[0]).toMatchObject({ path: 'images/hero.png' });
    expect(previews.images[1]).toMatchObject({ image_url: 'data:image/png;base64,CCCC' });
    expect(getChildImageIdentity(previews.images[0]!)).toBe('path:images/hero.png');
    expect(getChildImageIdentity(previews.images[1]!)).toMatch(/^inline:/);
  });

  it('extracts web_search v2 offline payloads and rejects malformed variants', () => {
    expect(extractWebSearchResult({
      offline: true,
      results: [
        {
          content: 'Stored web result about TypeScript 5.8',
          citationUrls: ['https://example.com/typescript'],
          blockType: 'paragraph',
          headingPath: ['Release Notes'],
          webResultId: 'web-1',
          blockIndex: 0,
          query: 'TypeScript latest',
          provider: 'perplexity',
          model: 'sonar',
        },
      ],
    })).toEqual({
      offline: true,
      results: [
        {
          content: 'Stored web result about TypeScript 5.8',
          citationUrls: ['https://example.com/typescript'],
          blockType: 'paragraph',
          headingPath: ['Release Notes'],
          webResultId: 'web-1',
          blockIndex: 0,
          query: 'TypeScript latest',
          provider: 'perplexity',
          model: 'sonar',
        },
      ],
    });

    expect(extractWebSearchResult({
      offline: false,
      results: [],
    })).toEqual({
      offline: false,
      results: [],
    });

    expect(extractWebSearchResult({
      offline: true,
      results: [{ content: 'missing fields' }],
    })).toBeNull();

    expect(extractWebSearchResult({
      answer: 'legacy blob',
      citations: [],
    })).toBeNull();
  });
});
