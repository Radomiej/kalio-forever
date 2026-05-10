import { describe, expect, it } from 'vitest';
import {
  CORE_OS_PROMPT_LARGE,
  CORE_OS_PROMPT_SMALL,
  DEFAULT_SYSTEM_PROMPT,
  SECURITY_INJECTION_GUARD_PROMPT,
  TOOL_CALLING_PROMPT,
  getCoreOsPrompt,
  getToolCallingPrompt,
  isSmallModel,
} from './modelPrompts';

describe('modelPrompts', () => {
  it('keeps the core prompt aliases aligned', () => {
    expect(CORE_OS_PROMPT_SMALL).toBe(CORE_OS_PROMPT_LARGE);
    expect(DEFAULT_SYSTEM_PROMPT).toBe(CORE_OS_PROMPT_LARGE);
  });

  it('returns the same core prompt for any model', () => {
    expect(getCoreOsPrompt()).toBe(CORE_OS_PROMPT_LARGE);
    expect(getCoreOsPrompt('gpt-4o-mini')).toBe(CORE_OS_PROMPT_LARGE);
  });

  it('returns the strict tool-calling prompt for any model', () => {
    const prompt = getToolCallingPrompt('claude-sonnet');

    expect(prompt).toBe(TOOL_CALLING_PROMPT);
    expect(prompt).toContain('ONE JSON object');
    expect(prompt).toContain('ACT FIRST, DESCRIBE AFTER');
  });

  it('documents that no small-model specialization is enabled yet', () => {
    expect(isSmallModel('gpt-4o-mini')).toBe(false);
    expect(SECURITY_INJECTION_GUARD_PROMPT).toBe('');
  });
});
