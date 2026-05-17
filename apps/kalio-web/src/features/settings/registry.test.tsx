import { describe, it, expect } from 'vitest';
import { SETTINGS_BLOCKS } from './registry';

describe('settings registry', () => {
  it('labels the llm block as generic settings', () => {
    const llmBlock = SETTINGS_BLOCKS.find((block) => block.id === 'llm');
    expect(llmBlock?.label).toBe('LLM Settings');
  });

  it('registers the HITL approvals block', () => {
    const hitlBlock = SETTINGS_BLOCKS.find((block) => block.id === 'hitl');
    expect(hitlBlock?.label).toBe('HITL Approvals');
  });
});