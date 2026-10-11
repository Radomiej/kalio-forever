import { describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../database/app-settings.service';
import type { CredentialsService } from '../modules/credentials/credentials.service';
import { DecisionSettingsService } from './decision-settings.service';

function setup() {
  const values = new Map<string, string>();
  const settings = { get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
  const credentials = {
    findAll: vi.fn().mockResolvedValue([{ id: 'first', provider: 'openrouter', createdAt: 1 }, { id: 'second', provider: 'openrouter', createdAt: 2 }]),
    getProviderConfigForCredential: vi.fn(async (id: string) => ({ provider: 'openrouter', apiKey: id === 'first' ? '' : 'secret' })),
  };
  const service = new DecisionSettingsService(settings as unknown as AppSettingsService, credentials as unknown as CredentialsService);
  return { service, settings, credentials, values };
}

describe('DecisionSettingsService', () => {
  it('automatically selects the first usable OpenRouter credential without exposing its key', async () => {
    const { service } = setup();
    expect(await service.getConfig()).toMatchObject({ provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: 'second' });
    expect(JSON.stringify(await service.getConfig())).not.toContain('secret');
    expect(await service.resolve()).toMatchObject({ apiKey: 'secret', endpoint: 'https://openrouter.ai/api/alpha/decisions' });
  });

  it('persists native TypeSafe configuration and rejects mismatched credentials', async () => {
    const { service, credentials } = setup();
    await expect(service.updateConfig({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'second', endpoint: '' })).rejects.toThrow();
    credentials.getProviderConfigForCredential.mockResolvedValue({ provider: 'typesafe', apiKey: 'native-key' });
    await service.updateConfig({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'second', endpoint: '' });
    expect(await service.resolve()).toMatchObject({ model: 'jev-1.13.0', endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'native-key' });
  });

  it('supports a keyless local Decisions server and validates remote endpoint safety', async () => {
    const { service } = setup();
    await service.updateConfig({ provider: 'custom', model: 'local-decision', credentialId: null, endpoint: 'http://127.0.0.1:9090/decide' });
    expect(await service.resolve()).toMatchObject({ apiKey: '', model: 'local-decision', endpoint: 'http://127.0.0.1:9090/decide' });
    for (const endpoint of ['http://remote.example/decide', 'https://user:pass@remote.example/decide', 'https://remote.example/decide?key=secret']) {
      await expect(service.updateConfig({ provider: 'custom', model: 'local', credentialId: null, endpoint })).rejects.toThrow();
    }
  });

  it('does not replace an explicitly selected missing credential with another secret', async () => {
    const { service, values, credentials } = setup();
    values.set('decision.config', JSON.stringify({ provider: 'openrouter', model: 'typesafe/jev-1.13', credentialId: 'deleted', endpoint: '' }));
    credentials.getProviderConfigForCredential.mockResolvedValue(null as never);
    await expect(service.resolve()).rejects.toThrow();
  });
  it('uses native TypeSafe when no usable OpenRouter exists, but never overrides a saved provider', async () => {
    const { service, credentials, values } = setup();
    credentials.findAll.mockResolvedValue([{ id: 'native', provider: 'typesafe', createdAt: 1 }]);
    credentials.getProviderConfigForCredential.mockResolvedValue({ provider: 'typesafe', apiKey: 'native-key' });
    expect(await service.getConfig()).toMatchObject({ provider: 'typesafe', model: 'jev-1.13.0', credentialId: 'native' });
    values.set('decision.config', JSON.stringify({ provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' }));
    expect(await service.getConfig()).toMatchObject({ provider: 'openrouter', credentialId: null });
    await expect(service.resolve()).rejects.toThrow('Add a compatible provider credential');
  });

  it('rejects malformed configurations before persisting anything', async () => {
    const { service, settings } = setup();
    const config = { provider: 'openrouter', credentialId: null, model: 'typesafe/jev-1.13', endpoint: '' };
    for (const input of [null, [], { ...config, provider: 'chat' }, { ...config, model: '' }, { ...config, credentialId: 42 }, { ...config, endpoint: null }]) {
      await expect(service.updateConfig(input as never)).rejects.toThrow();
    }
    expect(settings.set).not.toHaveBeenCalled();
  });

});
