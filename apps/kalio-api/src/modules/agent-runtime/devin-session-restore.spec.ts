import { describe, expect, it, vi } from 'vitest';
import { methods, type AgentCapabilities, type ClientConnection } from '@agentclientprotocol/sdk';
import { DevinAcpHost } from './devin-cli-acp.host';

function restore(capabilities: AgentCapabilities, request = vi.fn().mockResolvedValue({})) {
  const host = new DevinAcpHost('swe-2') as unknown as {
    capabilities: AgentCapabilities;
    restoreSession(connection: ClientConnection, id: string, workspace: { cwd: string }, servers: []): Promise<void>;
  };
  host.capabilities = capabilities;
  const connection = { agent: { request } } as unknown as ClientConnection;
  return { request, run: () => host.restoreSession(connection, 'persisted', { cwd: 'workspace' }, []) };
}

describe('Devin durable session reattachment', () => {
  it('prefers no-replay resume when both capabilities exist', async () => {
    const test = restore({ loadSession: true, sessionCapabilities: { resume: {} } });
    await test.run();
    expect(test.request).toHaveBeenCalledExactlyOnceWith(methods.agent.session.resume, {
      sessionId: 'persisted', cwd: 'workspace', mcpServers: [],
    });
  });
  it('keeps load-only agents compatible', async () => {
    const test = restore({ loadSession: true });
    await test.run();
    expect(test.request).toHaveBeenCalledOnce();
    expect(test.request.mock.calls[0][0]).toBe(methods.agent.session.load);
  });
  it('supports resume-only agents without requiring history loading', async () => {
    const test = restore({ sessionCapabilities: { resume: {} } });
    await test.run();
    expect(test.request).toHaveBeenCalledOnce();
    expect(test.request.mock.calls[0][0]).toBe(methods.agent.session.resume);
  });
  it('fails explicitly when neither restoration capability exists', async () => {
    const test = restore({});
    await expect(test.run()).rejects.toThrow('does not advertise');
    expect(test.request).not.toHaveBeenCalled();
  });
  it('does not silently replay history after a failed advertised resume', async () => {
    const failure = new Error('resume failed');
    const request = vi.fn().mockRejectedValue(failure);
    const test = restore({ loadSession: true, sessionCapabilities: { resume: {} } }, request);
    await expect(test.run()).rejects.toBe(failure);
    expect(request).toHaveBeenCalledOnce();
  });
});
