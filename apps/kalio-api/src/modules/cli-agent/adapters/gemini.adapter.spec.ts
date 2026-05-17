import { describe, expect, it } from 'vitest';
import { GeminiAdapter } from './gemini.adapter';

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  it('wraps the Windows npm shim via cmd /c', () => {
    expect(adapter.executable('win32')).toBe('cmd');
    expect(adapter.wrapperArgs('win32')).toEqual(['/c', 'gemini']);
  });

  it('builds a non-interactive invocation with include-directories', () => {
    expect(adapter.buildArgs('fix the failing test', '/repo', ['--model', 'gemini-2.5-pro'])).toEqual([
      '-p', 'fix the failing test',
      '--output-format', 'text',
      '--include-directories', '/repo',
      '--model', 'gemini-2.5-pro',
    ]);
  });

  it('probes the installed Gemini version with --version', () => {
    expect(adapter.probeArgs()).toEqual(['--version']);
  });
});