import { describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { activateConversationSession } from '../chat/activeConversationSession';
import { buildRAAppRunPrompt, createRAAppHostSession, prepareRAAppLaunchInputs, resolveRAAppExecutionProfile } from './raappExecutionProfile';

vi.mock('../../services/apiClient', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('../chat/activeConversationSession', () => ({ activateConversationSession: vi.fn() }));

describe('RA-App execution profile and generation handoff', () => {
  const current = { id: 'current', executionProfileId: 'openrouter-profile' } as ChatSession;
  it('explicit profile takes precedence over the current session', () => {
    expect(resolveRAAppExecutionProfile('devin-profile', current)).toBe('devin-profile');
  });
  it('inherits the current session profile and fails when neither source is available', () => {
    expect(resolveRAAppExecutionProfile('', current)).toBe('openrouter-profile');
    expect(() => resolveRAAppExecutionProfile('')).toThrow('Select an execution profile');
  });
  it('creates the durable session with the selected profile before activation', async () => {
    const session = { ...current, id: 'app', executionProfileId: 'devin-profile' };
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: session });
    const deps = { addSession: vi.fn(), setActiveSession: vi.fn(), setMessages: vi.fn(), setAgentTurns: vi.fn() };
    expect(await createRAAppHostSession({ personaId: 'ra-apps', executionProfileId: 'devin-profile' }, deps)).toBe(session);
    expect(apiClient.post).toHaveBeenCalledWith('/api/sessions', { personaId: 'ra-apps', executionProfileId: 'devin-profile' });
    expect(activateConversationSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'app', sessions: [session] }));
  });
  it('propagates profile/session creation failures without creating a fallback session', async () => {
    vi.mocked(apiClient.post).mockClear().mockRejectedValueOnce(new Error('Profile unavailable'));
    const deps = { addSession: vi.fn(), setActiveSession: vi.fn(), setMessages: vi.fn(), setAgentTurns: vi.fn() };
    await expect(createRAAppHostSession({ personaId: 'ra-apps', executionProfileId: 'devin-profile' }, deps)).rejects.toThrow('Profile unavailable');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    expect(deps.addSession).not.toHaveBeenCalled();
  });
  it('requests generation through the existing conversation before rendering Q&A', () => {
    expect(buildRAAppRunPrompt('qa-interactive', 'Interactive Q&A')).toContain('Generate missing values using this conversation runtime');
    expect(prepareRAAppLaunchInputs('qa-interactive', { question: 'Which runtime?' })).toBeUndefined();
    const inputs = { question: 'Which runtime?', options: ['OpenRouter', 'Devin'] };
    expect(prepareRAAppLaunchInputs('qa-interactive', inputs)).toBe(inputs);
    expect(buildRAAppRunPrompt('qa-interactive', 'Q&A', '', inputs)).toContain(JSON.stringify(inputs));
  });
});
