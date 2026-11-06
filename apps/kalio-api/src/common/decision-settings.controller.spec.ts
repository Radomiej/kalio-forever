import { describe, expect, it, vi } from 'vitest';
import type { DecisionSettingsPort } from '@kalio/types';
import { DecisionSettingsController } from './decision-settings.controller';

describe('decision purpose HTTP validation', () => {
  const config = { provider: 'ollama', model: 'fixture:1', credentialId: null, endpoint: 'http://127.0.0.1:11434/api/chat' };
  function setup() {
    const port = { getConfig: vi.fn(), updateConfig: vi.fn() };
    return { port, controller: new DecisionSettingsController(port as unknown as DecisionSettingsPort) };
  }
  it('preserves omitted purpose as goals and accepts an explicit tools override', () => {
    const { controller, port } = setup();
    controller.getConfig();
    expect(port.getConfig).toHaveBeenCalledWith('goals');
    controller.updateConfig(config, { purpose: 'tools' });
    expect(port.updateConfig).toHaveBeenCalledWith(config, 'tools');
  });
  it.each([null, [], { purpose: '' }, { purpose: ['tools', 'goals'] }, { purpose: {} }, { purpose: 'unknown' }, { extra: 'x' }])('rejects invalid query before settings access', query => {
    const { controller, port } = setup();
    expect(() => controller.getConfig(query)).toThrow();
    expect(() => controller.updateConfig(config, query)).toThrow();
    expect(port.getConfig).not.toHaveBeenCalled();
    expect(port.updateConfig).not.toHaveBeenCalled();
  });
  it.each([null, [], { ...config, confidence: 0.95 }, { ...config, purpose: 'tools' }, { ...config, provider: 'other' }, { ...config, credentialId: 5 }])('rejects malformed body without persistence', input => {
    const { controller, port } = setup();
    expect(() => controller.updateConfig(input, { purpose: 'tools' })).toThrow();
    expect(port.updateConfig).not.toHaveBeenCalled();
  });
});
