import { describe, expect, it } from 'vitest';
import type { HitlApprovalRequest, HitlHardRule } from './hitl.types';
import { matchingHitlHardRule } from './hitl-rules.utils';

const request: HitlApprovalRequest = {
  kind: 'tool',
  sessionId: 'session-1',
  name: 'terminal_spawn',
  args: { command: 'ansible-playbook deploy.yml --check' },
};

function rule(overrides: Partial<HitlHardRule>): HitlHardRule {
  return {
    id: 'rule-1',
    kind: '*',
    name: '*',
    decision: 'allow',
    ...overrides,
  };
}

describe('matchingHitlHardRule', () => {
  it.each(['deny', 'ask_user'] as const)('matches %s selectors against split shell arguments', decision => {
    expect(matchingHitlHardRule({ ...request, args: { command: 'cmd', args: ['/c', 'del file.txt'] } },
      [rule({ executable: 'del', decision })])).toHaveProperty('decision', decision);
    expect(matchingHitlHardRule({ ...request, args: { command: 'powershell', args: ['-Command', 'Remove-Item', 'file.txt'] } },
      [rule({ executable: 'Remove-Item', decision })])).toHaveProperty('decision', decision);
  });
  it('does not turn an executable mentioned in a normal program argument into an allow match', () => {
    expect(matchingHitlHardRule({ ...request, args: { command: 'echo', args: ['del file.txt'] } },
      [rule({ executable: 'del', decision: 'allow' })])).toBeUndefined();
  });
  it('uses deny then ask_user then allow precedence, independent of row order', () => {
    const rules = [
      rule({ id: 'allow', decision: 'allow' }),
      rule({ id: 'ask', decision: 'ask_user' }),
      rule({ id: 'deny', decision: 'deny' }),
    ];

    expect(matchingHitlHardRule(request, rules)?.id).toBe('deny');
    expect(matchingHitlHardRule(request, rules.slice(0, 2))?.id).toBe('ask');
  });

  it('matches operation kind, exact tool name, executable basename, and argument substring', () => {
    expect(matchingHitlHardRule(request, [rule({
      kind: 'tool',
      name: 'terminal_spawn',
      executable: 'ANSIBLE-PLAYBOOK',
      argumentsContains: '--check',
      decision: 'deny',
    })])?.decision).toBe('deny');
    expect(matchingHitlHardRule(request, [rule({
      kind: 'raapp_native',
      name: 'terminal_spawn',
      decision: 'deny',
    })])).toBeUndefined();
  });

  it('does not match an executable rule when the operation has no command argument', () => {
    expect(matchingHitlHardRule({ ...request, args: { path: 'deploy.yml' } }, [rule({
      executable: 'ansible-playbook',
      decision: 'deny',
    })])).toBeUndefined();
  });

  it('matches denied executables in quoted Windows paths and shell wrappers', () => {
    const denyRule = rule({ executable: 'ansible-playbook', decision: 'deny' });
    for (const command of [
      '& "C:\\Program Files\\Ansible\\ansible-playbook.exe" deploy.yml',
      "bash -lc 'ansible-playbook deploy.yml'",
      'cmd /c ansible-playbook deploy.yml',
    ]) {
      expect(matchingHitlHardRule({ ...request, args: { command } }, [denyRule]), command).toBeDefined();
    }
  });

  it('matches allow only when the operation runs the named executable', () => {
    const allowRule = rule({ executable: 'ansible-playbook', decision: 'allow' });
    expect(matchingHitlHardRule({ ...request, args: { command: 'ansible-playbook deploy.yml' } }, [allowRule])).toBeDefined();
    expect(matchingHitlHardRule({ ...request, args: { command: 'echo ansible-playbook' } }, [allowRule])).toBeUndefined();
  });
});
