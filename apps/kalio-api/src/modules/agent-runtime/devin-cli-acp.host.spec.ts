import { describe, expect, it } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { buildDevinCliLaunchSpec, DevinAcpHost, parseDevinCliProbe } from './devin-cli-acp.host';

describe('Devin CLI ACP host contract', () => {
  it('launches exact dynamically discovered model tokens without a shell wrapper', () => {
    expect(buildDevinCliLaunchSpec('glm-5-2', 'C:\\Users\\Radomiej\\AppData\\Local\\devin\\cli\\bin\\devin.exe')).toEqual({
      command: 'C:\\Users\\Radomiej\\AppData\\Local\\devin\\cli\\bin\\devin.exe',
      args: ['--model', 'glm-5-2', 'acp'],
    });
    expect(buildDevinCliLaunchSpec('swe-2-high', 'devin.exe')).toEqual({
      command: 'devin.exe',
      args: ['--model', 'swe-2-high', 'acp'],
    });
    expect(() => buildDevinCliLaunchSpec('  ')).toThrow('model is required');
  });

  it('recognizes authenticated ACP support and returns the dynamic catalog state', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.11.1 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in (via Devin)', exitCode: 0 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      modelCatalog: { models: ['glm-5.2', 'glm-5-2', 'swe-2-high'], status: 'ready', discoveredAt: 1, stale: false },
    })).toEqual({
      executable: 'devin.exe',
      version: '3000.11.1',
      authenticated: true,
      acp: true,
      models: ['glm-5.2', 'glm-5-2', 'swe-2-high'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 1,
    });
  });

  it('does not report authentication when the auth probe exits with an error', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.11.1 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in\nPermissionDenied: rolling file appender', exitCode: 101 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      modelCatalog: { models: ['glm-5-2', 'swe-2-high'], status: 'ready', discoveredAt: 1, stale: false },
    })).toMatchObject({ authenticated: false, acp: true, models: ['glm-5-2', 'swe-2-high'] });
  });

  it('preserves ACP structured tool input for the Kalio permission boundary', () => {
    let activity: unknown;
    const host = new DevinAcpHost('swe-2-high') as unknown as {
      sessions: Map<string, { active: { onToolActivity: (value: unknown) => void } }>;
      handleSessionUpdate: (params: SessionNotification) => void;
    };
    host.sessions.set('session-1', { active: { onToolActivity: (value) => { activity = value; } } });

    host.handleSessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'functions.mcp_call_tool:1',
        name: 'mcp_call_tool',
        title: 'Calling fs_list from kalio-runtime',
        kind: 'execute',
        status: 'pending',
        rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
        rawOutput: { error: 'Permission denied' },
        content: [{ type: 'content', content: { type: 'text', text: 'Permission denied' } }],
      },
    } as unknown as SessionNotification);

    expect(activity).toMatchObject({
      toolCallId: 'functions.mcp_call_tool:1',
      name: 'mcp_call_tool',
      rawInput: { server: 'kalio-runtime', tool: 'fs_list' },
      rawOutput: { error: 'Permission denied' },
      content: [{ type: 'content', content: { type: 'text', text: 'Permission denied' } }],
    });
  });
});
