import { describe, it, expect } from 'vitest';
import { SETTINGS_BLOCKS } from './registry';

describe('settings registry', () => {
  it('registers voice settings without changing the default settings tab', () => {
    expect(SETTINGS_BLOCKS[0].id).toBe('llm');
    expect(SETTINGS_BLOCKS.find((block) => block.id === 'voice')?.label).toBe('Voice input');
  });
  it('labels the llm block as generic settings', () => {
    const llmBlock = SETTINGS_BLOCKS.find((block) => block.id === 'llm');
    expect(llmBlock?.label).toBe('LLM Settings');
  });

  it('registers the HITL approvals block', () => {
    const hitlBlock = SETTINGS_BLOCKS.find((block) => block.id === 'hitl');
    expect(hitlBlock?.label).toBe('HITL Approvals');
  });

  it('registers the runtime settings block', () => {
    const runtimeBlock = SETTINGS_BLOCKS.find((block) => block.id === 'runtime');
    expect(runtimeBlock?.label).toBe('Runtime Settings');
  });

  it('registers the audit retention policy block', () => {
    const auditRetentionBlock = SETTINGS_BLOCKS.find((block) => block.id === 'audit-retention');
    expect(auditRetentionBlock?.label).toBe('Audit Retention');
  });
});
