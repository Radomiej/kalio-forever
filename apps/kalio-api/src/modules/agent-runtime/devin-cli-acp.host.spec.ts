import { describe, expect, it } from 'vitest';
import { buildDevinCliLaunchSpec, isDevinCliModel, parseDevinCliProbe } from './devin-cli-acp.host';

describe('Devin CLI ACP host contract', () => {
  it('launches the exact host executable and model lane without a shell wrapper', () => {
    expect(buildDevinCliLaunchSpec('glm-5-2', 'C:\\Users\\Radomiej\\AppData\\Local\\devin\\cli\\bin\\devin.exe')).toEqual({
      command: 'C:\\Users\\Radomiej\\AppData\\Local\\devin\\cli\\bin\\devin.exe',
      args: ['--model', 'glm-5-2', 'acp'],
    });
    expect(isDevinCliModel('swe-1-7')).toBe(true);
    expect(isDevinCliModel('claude-sonnet-4-6')).toBe(false);
  });

  it('recognizes authenticated ACP support and only the free model lanes', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.2.17 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in (via Devin)', exitCode: 0 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      models: { text: 'glm-5-2 GLM-5.2 High [Free]\nswe-1-7 SWE-1.7 Max [Free]\nclaude-sonnet', exitCode: 0 },
    })).toEqual({
      executable: 'devin.exe',
      version: '3000.2.17',
      authenticated: true,
      acp: true,
      models: ['glm-5-2', 'swe-1-7'],
    });
  });

  it('does not report authentication when the CLI probe exits with an error', () => {
    expect(parseDevinCliProbe('devin.exe', {
      version: { text: 'devin 3000.2.17 (build)', exitCode: 0 },
      authStatus: { text: 'Logged in\nPermissionDenied: rolling file appender', exitCode: 101 },
      acpHelp: { text: 'Usage: devin acp\nRun as an ACP agent', exitCode: 0 },
      models: { text: 'glm-5-2 swe-1-7', exitCode: 0 },
    })).toMatchObject({ authenticated: false, acp: true, models: ['glm-5-2', 'swe-1-7'] });
  });
});
