import { describe, expect, it } from 'vitest';
import { resolveConversationProfileId } from './useConversationRuntimeLabel';

describe('conversation header profile ownership', () => {
  it('shows the explicit launch choice instead of the persisted persona recommendation', () => {
    expect(resolveConversationProfileId(false, 'devin-local-swe2', 'old-profile', 'persona-profile')).toBe('devin-local-swe2');
  });

  it('does not imply that an unselected new chat uses the persona runtime', () => {
    expect(resolveConversationProfileId(false, '', 'old-profile', 'persona-profile')).toBeUndefined();
  });

  it('keeps the established session runtime when a launch draft differs', () => {
    expect(resolveConversationProfileId(true, 'draft-profile', 'session-profile', 'persona-profile')).toBe('session-profile');
    expect(resolveConversationProfileId(true, 'draft-profile', undefined, 'persona-profile')).toBe('persona-profile');
  });
});
