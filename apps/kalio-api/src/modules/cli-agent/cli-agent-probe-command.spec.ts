import { describe, expect, it } from 'vitest';
import { resolveWindowsProbeCommand } from './cli-agent-probe-command';

describe('resolveWindowsProbeCommand', () => {
  const roots = ['C:/npm/node_modules/@github/copilot'];
  it('resolves native Copilot without a shell or npm loader', () => {
    const resolve = (id: string) => {
      expect(id).toBe('@github/copilot-win32-x64');
      return 'C:/npm/copilot.exe';
    };
    expect(resolveWindowsProbeCommand('copilot', 'x64', roots, resolve))
      .toEqual({ executable: 'C:/npm/copilot.exe', args: [] });
  });
  it('uses the installed native Claude executable', () => {
    expect(resolveWindowsProbeCommand('claude', 'x64', ['C:/npm/node_modules/@anthropic-ai/claude-code'],
      () => 'C:/npm/claude.exe')).toEqual({ executable: 'C:/npm/claude.exe', args: [] });
  });
  it('resolves Codex native binary from its platform package', () => {
    const ids: string[] = [];
    const result = resolveWindowsProbeCommand('codex', 'x64', ['C:/npm/codex'], (id) => {
      ids.push(id);
      return id.endsWith('package.json') ? 'C:/npm/platform/package.json' : 'C:/npm/platform/codex.exe';
    });
    expect(ids[0]).toBe('@openai/codex-win32-x64/package.json');
    expect(ids[1]?.replaceAll('\\', '/')).toBe('C:/npm/platform/vendor/x86_64-pc-windows-msvc/bin/codex.exe');
    expect(result).toEqual({ executable: 'C:/npm/platform/codex.exe', args: [] });
  });
  it('runs Gemini bundle using system Node, without cmd', () => {
    const result = resolveWindowsProbeCommand('gemini', 'x64', ['C:/npm/gemini'], () => 'C:/npm/gemini/bundle/gemini.js');
    expect(result).toEqual({ executable: process.execPath, args: ['C:/npm/gemini/bundle/gemini.js'] });
  });
  it('returns no override for absent packages, unsupported architecture or unknown agents', () => {
    const missing = () => { throw Object.assign(new Error('missing'), { code: 'MODULE_NOT_FOUND' }); };
    expect(resolveWindowsProbeCommand('copilot', 'x64', roots, missing)).toBeNull();
    expect(resolveWindowsProbeCommand('copilot', 'ia32', roots, missing)).toBeNull();
    expect(resolveWindowsProbeCommand('unknown', 'x64', roots, missing)).toBeNull();
  });
  it('does not hide unrelated resolver failures', () => {
    expect(() => resolveWindowsProbeCommand('copilot', 'x64', roots,
      () => { throw new Error('unexpected resolver failure'); })).toThrow('unexpected resolver failure');
  });
});
