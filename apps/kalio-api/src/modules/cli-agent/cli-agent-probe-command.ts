import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';

interface ProbeCommand { executable: string; args: string[]; env?: Record<string, string> }
type ModuleResolver = (id: string, options: { paths: string[] }) => string;

/** Resolve installed packages, never parse or execute arbitrary shim contents. */
export function resolveWindowsProbeCommand(
  agentId: string, arch: string, roots: string[], resolve: ModuleResolver,
): ProbeCommand | null {
  if (arch !== 'x64' && arch !== 'arm64') return null;
  let moduleId: string;
  if (agentId === 'copilot') moduleId = `@github/copilot-win32-${arch}`;
  else if (agentId === 'claude') moduleId = './bin/claude.exe';
  else if (agentId === 'codex') moduleId = `@openai/codex-win32-${arch}/package.json`;
  else if (agentId === 'gemini') moduleId = './bundle/gemini.js';
  else return null;
  for (const root of roots) {
    try {
      let executable = resolve(moduleId, { paths: [root] });
      if (agentId === 'codex') {
        const target = arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'aarch64-pc-windows-msvc';
        executable = resolve(join(dirname(executable), 'vendor', target, 'bin', 'codex.exe'), { paths: [root] });
      }
      if (agentId === 'gemini' && executable.endsWith('.js')) {
        // Version checks need no memory tuning, IPC supervisor, or relaunch loop.
        return { executable: process.execPath, args: [executable], env: { GEMINI_CLI_NO_RELAUNCH: 'true' } };
      }
      if (executable.toLowerCase().endsWith('.exe')) return { executable, args: [] };
    } catch (error: unknown) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'MODULE_NOT_FOUND') throw error;
      // TODO: legacy fallback — platform package may be absent; retain the adapter shim.
    }
  }
  return null;
}

export function installedWindowsProbeCommand(agentId: string): ProbeCommand | null {
  const packageName = agentId === 'copilot' ? '@github/copilot'
    : agentId === 'claude' ? '@anthropic-ai/claude-code'
      : agentId === 'codex' ? '@openai/codex'
        : agentId === 'gemini' ? '@google/gemini-cli' : null;
  if (!packageName) return null;
  const roots = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
    .map(directory => join(directory, 'node_modules', packageName));
  const resolver = createRequire(__filename);
  return resolveWindowsProbeCommand(agentId, process.arch, roots, (id, options) =>
    resolver.resolve(id.startsWith('./') ? join(options.paths[0]!, id) : id, options));
}
