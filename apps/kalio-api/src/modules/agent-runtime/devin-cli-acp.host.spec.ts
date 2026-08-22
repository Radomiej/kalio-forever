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
      version: 'devin 3000.2.17 (build)',
      authStatus: 'Logged in (via Devin)',
      acpHelp: 'Usage: devin acp\nRun as an ACP agent',
      models: 'glm-5-2 GLM-5.2 High [Free]\nswe-1-7 SWE-1.7 Max [Free]\nclaude-sonnet',
    })).toEqual({
      executable: 'devin.exe',
      version: '3000.2.17',
      authenticated: true,
      acp: true,
      models: ['glm-5-2', 'swe-1-7'],
    });
  });
});
