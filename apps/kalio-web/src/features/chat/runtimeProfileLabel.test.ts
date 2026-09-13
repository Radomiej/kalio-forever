import { describe, expect, it } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import { resolveRuntimeProfileLabel } from './runtimeProfileLabel';

function profile(overrides: Partial<ExecutionProfile>): ExecutionProfile {
  return {
    id: 'profile-1',
    name: 'Profile',
    kind: 'direct-llm',
    provider: 'openai',
    model: 'profile-model',
    reasoningEffort: 'high',
    approvalMode: 'kalio_strict',
    enabled: true,
    capabilitiesVersion: '1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('resolveRuntimeProfileLabel', () => {
  it('prefers the Claude profile over the persona model', () => {
    expect(resolveRuntimeProfileLabel({
      executionProfileId: 'claude-local',
      profile: profile({
        id: 'claude-local',
        name: 'Claude Code - Local Login',
        kind: 'claude-agent-sdk',
        model: 'claude-sonnet-4-6',
      }),
      personaModel: 'gpt-5.6-luna',
    })).toEqual({ provider: 'Claude Code', model: 'claude-sonnet-4-6' });
  });

  it('labels Codex profiles as Codex and keeps their profile model', () => {
    expect(resolveRuntimeProfileLabel({
      executionProfileId: 'codex-luna',
      profile: profile({
        id: 'codex-luna',
        kind: 'codex-app-server',
        model: 'gpt-5.6-luna',
      }),
      personaModel: 'persona-model',
    })).toEqual({ provider: 'Codex', model: 'gpt-5.6-luna' });
  });

  it('labels a host-local Devin profile separately from Devin Cloud', () => {
    expect(resolveRuntimeProfileLabel({
      executionProfileId: 'devin-local-glm-5-2',
      profile: profile({
        id: 'devin-local-glm-5-2',
        kind: 'devin-cli-acp',
        model: 'glm-5-2',
      }),
    })).toEqual({ provider: 'Devin CLI', model: 'glm-5-2' });
  });

  it('falls back to the configured provider and model when no profile is loaded', () => {
    expect(resolveRuntimeProfileLabel({
      executionProfileId: undefined,
      profile: undefined,
      provider: 'mock',
      backendModel: 'mock',
    })).toEqual({ provider: 'Local LLM', model: null });
  });
});
