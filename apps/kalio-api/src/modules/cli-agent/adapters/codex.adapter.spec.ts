import { describe, expect, it } from 'vitest';
import { CodexAdapter, defaultCodexCommand } from './codex.adapter';

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('wraps the Windows npm shim via cmd /c', () => {
    expect(adapter.executable('win32')).toBe('cmd');
    expect(adapter.wrapperArgs('win32')).toEqual(['/c', defaultCodexCommand('win32')]);
  });

  it('builds a non-interactive workspace-write exec invocation', () => {
    expect(adapter.buildArgs('fix the failing test', '/repo', ['--skip-git-repo-check'], 'gpt-5.2')).toEqual([
      '-a', 'never',
      'exec',
      '--sandbox', 'workspace-write',
      '--color', 'never',
      '--json',
      '--model', 'gpt-5.2',
      '--skip-git-repo-check',
      'fix the failing test',
    ]);
  });

  it('probes the installed Codex version with --version', () => {
    expect(adapter.probeArgs()).toEqual(['--version']);
  });
});
