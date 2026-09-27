import type { HitlHardRule } from '@kalio/types';
import type { HitlApprovalRequest } from './hitl.types';

const DECISION_PRECEDENCE: Record<HitlHardRule['decision'], number> = {
  deny: 0,
  ask_user: 1,
  allow: 2,
};

export function matchingHitlHardRule(
  request: HitlApprovalRequest,
  rules: HitlHardRule[],
): HitlHardRule | undefined {
  return rules
    .filter((rule) => matchesRule(request, rule))
    .sort((left, right) => DECISION_PRECEDENCE[left.decision] - DECISION_PRECEDENCE[right.decision])[0];
}

function matchesRule(request: HitlApprovalRequest, rule: HitlHardRule): boolean {
  if (rule.kind !== '*' && rule.kind !== request.kind) return false;
  if (rule.name !== '*' && rule.name !== request.name) return false;
  if (rule.executable && !hasExecutable(request.args, rule.executable, rule.decision)) return false;
  if (rule.argumentsContains && !containsArgument(request.args, rule.argumentsContains)) return false;
  return true;
}

function hasExecutable(
  args: Record<string, unknown>,
  expected: string,
  decision: HitlHardRule['decision'],
): boolean {
  return commandValues(args).some((command) => hasExecutableInCommand(command, expected, decision, 0));
}

function commandValues(args: Record<string, unknown>): string[] {
  const commandKeys = new Set(['command', 'cmd', 'script', 'program', 'executable']);
  return Object.entries(args)
    .filter(([key, value]) => commandKeys.has(key.toLowerCase()) && typeof value === 'string')
    .map(([, value]) => value as string);
}

function hasExecutableInCommand(
  command: string,
  expected: string,
  decision: HitlHardRule['decision'],
  depth: number,
): boolean {
  if (depth > 4) return false;
  for (const tokens of tokenizeCommands(command)) {
    const executable = tokens[0];
    if (executable && matchesExecutable(executable, expected)) return true;
    if (!executable) continue;

    const wrapper = normalizeExecutable(executable);
    if (['bash', 'sh', 'zsh', 'cmd', 'powershell', 'pwsh'].includes(wrapper)) {
      const commandFlagIndex = tokens.findIndex((token) => /^\/(?:c|k)$/i.test(token)
        || /^-.*(?:^|-)command(?:$|=)/i.test(token)
        || /^-[a-z]*c[a-z]*$/i.test(token));
      const nested = commandFlagIndex >= 0 ? tokens.slice(commandFlagIndex + 1).join(' ') : '';
      if (nested && hasExecutableInCommand(nested, expected, decision, depth + 1)) return true;
    }
    if (
      ['sudo', 'doas', 'env', 'wsl'].includes(wrapper)
      || (decision === 'deny' && ['command', 'exec'].includes(wrapper))
    ) {
      const markerIndex = tokens.indexOf('--');
      const start = markerIndex >= 0 ? markerIndex + 1 : 1;
      const nested = tokens.slice(start).filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)).join(' ');
      if (nested && hasExecutableInCommand(nested, expected, decision, depth + 1)) return true;
    }
  }
  return false;
}

function tokenizeCommands(command: string): string[][] {
  const commands: string[][] = [];
  let currentCommand: string[] = [];
  let token = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  const flushToken = () => {
    if (token) currentCommand.push(token);
    token = '';
  };
  const flushCommand = () => {
    flushToken();
    if (currentCommand.length > 0) commands.push(currentCommand);
    currentCommand = [];
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (!character) continue;
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      const next = command[index + 1];
      if (next === '"' || next === '\\' || (!quote && (next === ' ' || next === '\t' || next === ';' || next === '&' || next === '|'))) {
        escaped = true;
        continue;
      }
      token += character;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ';' || character === '|' || character === '&' || character === '\n') {
      flushCommand();
      continue;
    }
    if (/\s/.test(character)) {
      flushToken();
      continue;
    }
    token += character;
  }
  flushCommand();
  return commands;
}

function matchesExecutable(value: string, expected: string): boolean {
  const basename = value.split(/[\\/]/).at(-1) ?? value;
  return normalizeExecutable(basename) === normalizeExecutable(expected);
}

function normalizeExecutable(value: string): string {
  return value.trim().toLowerCase().replace(/\.exe$/i, '');
}

function containsArgument(args: Record<string, unknown>, expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return collectStringValues(args).some((value) => value.toLowerCase().includes(normalizedExpected));
}

function collectStringValues(value: unknown, depth = 0): string[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((entry) => collectStringValues(entry, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.entries(value)
    .filter(([key]) => !/(?:api.?key|token|secret|password|credential|authorization)/i.test(key))
    .flatMap(([, entry]) => collectStringValues(entry, depth + 1));
}
