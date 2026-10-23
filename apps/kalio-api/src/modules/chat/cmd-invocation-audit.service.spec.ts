import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CmdInvocationAuditService } from './cmd-invocation-audit.service';

describe('CmdInvocationAuditService', () => {
  const audit = { log: vi.fn().mockResolvedValue('audit-id') };
  let service: CmdInvocationAuditService;

  beforeEach(() => {
    audit.log.mockClear();
    service = new CmdInvocationAuditService(audit as never);
  });

  it('records a Windows cmd launch with identifiers but never the command payload', async () => {
    await service.recordInvocation({
      command: 'C:\\Windows\\System32\\cmd.exe',
      source: 'cli-agent.probe',
      launcher: 'execFile',
      agentId: 'codex',
      sessionId: 'session-1',
      turnId: 'turn-1',
      callId: 'call-1',
    }, 'win32');

    expect(audit.log).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-1',
      type: 'runtime_event',
      label: 'process.cmd.invocation',
      data: {
        domain: 'process',
        eventName: 'process.cmd.invocation',
        source: 'cli-agent.probe',
        mechanism: 'cmd',
        launcher: 'execFile',
        platform: 'win32',
        agentId: 'codex',
        turnId: 'turn-1',
        callId: 'call-1',
      },
    });
  });

  it('records the implicit cmd shell used by terminal_spawn without storing its command', async () => {
    await service.recordInvocation({
      command: 'npm',
      shell: true,
      source: 'terminal.spawn',
      launcher: 'spawn',
      sessionId: 'session-2',
      callId: 'call-2',
    }, 'win32');

    expect(audit.log).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-2',
      type: 'runtime_event',
      label: 'process.cmd.invocation',
      data: {
        domain: 'process',
        eventName: 'process.cmd.invocation',
        source: 'terminal.spawn',
        mechanism: 'shell',
        launcher: 'spawn',
        platform: 'win32',
        callId: 'call-2',
      },
    });
  });

  it('attributes a Devin CLI status command without storing its executable', async () => {
    await service.recordInvocation({
      command: 'cmd.exe',
      source: 'devin.cli.probe',
      launcher: 'execFile',
    }, 'win32');

    expect(audit.log).toHaveBeenCalledExactlyOnceWith({
      sessionId: undefined,
      type: 'runtime_event',
      label: 'process.cmd.invocation',
      data: {
        domain: 'process',
        eventName: 'process.cmd.invocation',
        source: 'devin.cli.probe',
        mechanism: 'cmd',
        launcher: 'execFile',
        platform: 'win32',
      },
    });
  });

  it('ignores ordinary executables and command shells on non-Windows platforms', async () => {
    await service.recordInvocation({ command: 'node', source: 'cli-agent.run', launcher: 'spawn' }, 'win32');
    await service.recordInvocation({ command: 'cmd.exe', source: 'cli-agent.run', launcher: 'spawn' }, 'linux');

    expect(audit.log).not.toHaveBeenCalled();
  });

  it('keeps an audit storage failure from blocking the command invocation', async () => {
    audit.log.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.recordInvocation({
      command: 'cmd.exe',
      source: 'cli-agent.run',
      launcher: 'spawn',
    }, 'win32')).resolves.toBeUndefined();
  });
});
