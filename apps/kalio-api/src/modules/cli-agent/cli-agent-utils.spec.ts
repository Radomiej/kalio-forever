import { describe, expect, it } from 'vitest';
import {
  extractCodexAgentMessage,
  normalizeTimeoutMs,
  quotePowerShellArg,
} from './cli-agent-utils';

describe('cli-agent-utils', () => {
  describe('normalizeTimeoutMs', () => {
    it('caps timeout above maximum for any agent', () => {
      expect(normalizeTimeoutMs('copilot', 2_000_000)).toBe(1_200_000);
    });

    it('enforces minimum timeout for slow agents', () => {
      expect(normalizeTimeoutMs('gemini', 60_000)).toBe(180_000);
    });

    it('keeps requested timeout for non-slow agents below cap', () => {
      expect(normalizeTimeoutMs('copilot', 45_000)).toBe(45_000);
    });
  });

  describe('quotePowerShellArg', () => {
    it('wraps value in single quotes and escapes embedded quotes', () => {
      expect(quotePowerShellArg("don't inject | shell")).toBe(\"'don''t inject | shell'\");
    });

    it('is safe on empty string', () => {
      expect(quotePowerShellArg('')).toBe(\"''\");
    });
  });

  describe('extractCodexAgentMessage', () => {
    it('returns last agent_message text from JSON event lines', () => {
      const output = [
        '{"type":"thinking"}',
        'ignored text',
        '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
        '{"type":"item.completed","item":{"type":"assistant","text":"skip me"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"final answer"}}',
      ].join('\n');

      expect(extractCodexAgentMessage(output)).toBe('final answer');
    });

    it('returns null when there is no agent_message item', () => {
      expect(
        extractCodexAgentMessage('{"type":"item.completed","item":{"type":"assistant","text":"hi"}}'),
      ).toBeNull();
    });
  });
});
