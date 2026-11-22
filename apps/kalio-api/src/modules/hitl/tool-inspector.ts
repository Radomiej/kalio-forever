import type { HitlHardRule } from '@kalio/types';
import { matchingHitlHardRule } from './hitl-rules.utils';
import type { HitlApprovalRequest } from './hitl.types';
import { TOOL_INSPECTOR_CATALOG } from './tool-inspector.catalog';

const TERMINAL_NAMES = new Set(['terminal_spawn', 'terminal_exec', 'terminal_execute']);
const COMMAND_KEYS = new Set(['command', 'cmd', 'script', 'program', 'executable']);
const MALFORMED = {
  status: 'manual', source: 'manual',
  reason: 'inspector.input: Malformed or oversized terminal invocation requires manual review.',
} as const;

/** A null result means no catalog decision, never an assurance of safe execution. */
export function inspectToolOperation(request: HitlApprovalRequest): {
  status: 'rejected' | 'manual'; source: 'rule' | 'manual'; reason: string;
} | null {
  if (request.kind !== 'tool') return null;
  const terminal = TERMINAL_NAMES.has(request.name);
  if (!terminal && request.name !== 'fs_delete' && request.name !== 'vfs_delete') return null;
  if (terminal && !validTerminalArgs(request.args)) return { ...MALFORMED };
  // The shared matcher parses split executables, but substring selectors inspect
  // individual strings. Supply a bounded argv projection for multi-word selectors.
  const argv = terminal ? request.args['args'] : undefined;
  const inspected = terminal && Array.isArray(argv)
    ? { ...request, args: { ...request.args, inspectorArgv: argv.join(' ') } }
    : request;
  // Restrictive matching supplies all executable/wrapper/argv parsing. No allow rules.
  const entries = TOOL_INSPECTOR_CATALOG.filter(entry => terminal || entry.selector.name === request.name);
  // Windows script launchers are restrictive variants only. User allow matching
  // and the shared matcher remain unchanged.
  const rules = entries.flatMap<HitlHardRule>(entry => {
    const rule = { id: entry.id, ...entry.selector };
    return 'executable' in rule
      ? [rule, { ...rule, executable: `${rule.executable}.cmd` }, { ...rule, executable: `${rule.executable}.bat` }]
      : [rule];
  });
  const match = matchingHitlHardRule(inspected, rules);
  if (!match) return null;
  const entry = entries.find(candidate => candidate.id === match.id);
  if (!entry) return null;
  return {
    status: match.decision === 'deny' ? 'rejected' : 'manual',
    source: match.decision === 'deny' ? 'rule' : 'manual',
    reason: `${entry.id}: ${entry.description}`,
  };
}

function validTerminalArgs(args: unknown): args is Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  let nodes = 0;
  let characters = 0;
  function bounded(value: unknown, depth: number): boolean {
    if (++nodes > 1024 || depth > 6) return false;
    if (typeof value === 'string') {
      characters += value.length;
      return value.length <= 16384 && characters <= 32768 && !value.includes('\0');
    }
    if (value === null || typeof value !== 'object') return true;
    const keys = Object.keys(value);
    if (keys.length > 256) return false;
    return keys.every(key => key.length <= 256 && bounded((value as Record<string, unknown>)[key], depth + 1));
  }
  if (!bounded(args, 0)) return false;
  const record = args as Record<string, unknown>;
  let commands = 0;
  for (const [key, value] of Object.entries(record)) {
    if (!COMMAND_KEYS.has(key.toLowerCase())) continue;
    if (typeof value !== 'string' || !value.trim()) return false;
    commands += 1;
  }
  if (!commands) return false;
  if (typeof record['cwd'] !== 'string' || !record['cwd'].trim() || record['cwd'].length > 4096) return false;
  if ('args' in record && (!Array.isArray(record['args']) || record['args'].length > 256
    || !record['args'].every(value => typeof value === 'string'))) return false;
  return true;
}
