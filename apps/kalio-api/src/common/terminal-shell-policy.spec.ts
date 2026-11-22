import { describe, expect, it } from 'vitest';
import { terminalUsesShell } from './terminal-shell-policy';

describe('terminalUsesShell', () => {
  it.each(['npm.cmd', 'build.bat', 'NPM.CMD', 'C:\\Program Files\\nodejs\\npm.cmd', './build.BAT',
    'npm', 'pnpm', 'yarn', 'npx', 'corepack', 'NPM'])('uses a Windows shell for %s', (command) => {
    expect(terminalUsesShell(command, 'win32')).toBe(true);
  });

  it.each(['rg', 'git', 'node', 'rg.exe', 'npm.exe', 'NPM.EXE', 'C:\\Program Files\\nodejs\\node.exe',
    'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe', './npm', 'C:\\tools\\npm',
    'unknown', 'npm.cmd.exe', 'npm run test', ''])('keeps Windows argv literal for %s', (command) => {
    expect(terminalUsesShell(command, 'win32')).toBe(false);
  });

  it.each(['linux', 'darwin'] as const)('never adds a shell on %s', (platform) => {
    for (const command of ['npm.cmd', 'build.bat', 'npm', 'pnpm', 'yarn', 'npx', 'corepack', 'rg', 'node.exe']) {
      expect(terminalUsesShell(command, platform)).toBe(false);
    }
  });

  it('defaults to the actual host platform', () => {
    expect(terminalUsesShell('npm')).toBe(terminalUsesShell('npm', process.platform));
  });
});
