import { Injectable, Logger, Optional } from '@nestjs/common';
import { AuditService } from '../chat/audit.service';
import type { LocalEmbeddingConfig } from './embedding-credentials.service';
import { LocalTransformersEmbeddingProvider } from './local-transformers-embedding.provider';

export interface LocalEmbeddingAvailability {
  status: 'missing' | 'installing' | 'ready' | 'error';
  installed: boolean;
  model: string;
  dimensions: number;
  backend: LocalEmbeddingConfig['backend'];
  message: string | null;
}

@Injectable()
export class LocalEmbeddingInstallService {
  private readonly logger = new Logger(LocalEmbeddingInstallService.name);
  private readonly states = new Map<string, LocalEmbeddingAvailability>();

  constructor(@Optional() private readonly audit?: AuditService) {}

  async getAvailability(config: LocalEmbeddingConfig): Promise<LocalEmbeddingAvailability> {
    const key = this.getKey(config);
    const cached = this.states.get(key);
    if (cached?.status === 'installing') {
      return cached;
    }

    const provider = this.createProvider(config, false);
    try {
      const installed = await provider.isInstalled();
      const status: LocalEmbeddingAvailability = installed
        ? this.makeAvailability(config, 'ready', true, 'Model installed and ready.')
        : this.makeAvailability(config, 'missing', false, 'Model not installed yet.');
      this.states.set(key, status);
      return status;
    } catch (err) {
      const status = this.makeAvailability(
        config,
        'error',
        false,
        err instanceof Error ? err.message : String(err),
      );
      this.states.set(key, status);
      return status;
    } finally {
      await provider.dispose();
    }
  }

  async install(config: LocalEmbeddingConfig, sessionId?: string): Promise<LocalEmbeddingAvailability> {
    const key = this.getKey(config);
    const current = this.states.get(key);
    if (current?.status === 'installing') {
      return current;
    }

    const installing = this.makeAvailability(config, 'installing', false, 'Installing local model...');
    this.states.set(key, installing);
    await this.audit?.log({
      sessionId,
      type: 'tool_result',
      label: 'memory:local-embedding-install-started',
      data: {
        model: config.model,
        dimensions: config.dimensions,
        backend: config.backend,
      },
    });

    void this.runInstall(key, config, sessionId);
    return installing;
  }

  private async runInstall(key: string, config: LocalEmbeddingConfig, sessionId?: string): Promise<void> {
    const provider = this.createProvider(config, true);
    try {
      await provider.prepare();
      const ready = this.makeAvailability(config, 'ready', true, 'Model installed and ready.');
      this.states.set(key, ready);
      await this.audit?.log({
        sessionId,
        type: 'tool_result',
        label: 'memory:local-embedding-install-ready',
        data: {
          model: config.model,
          dimensions: config.dimensions,
          backend: config.backend,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Local embedding install failed for ${config.model}: ${message}`);
      this.states.set(key, this.makeAvailability(config, 'error', false, message));
      await this.audit?.log({
        sessionId,
        type: 'error',
        label: 'memory:local-embedding-install-failed',
        data: {
          model: config.model,
          dimensions: config.dimensions,
          backend: config.backend,
          error: message,
        },
      });
    } finally {
      await provider.dispose();
    }
  }

  private createProvider(config: LocalEmbeddingConfig, allowRemoteModels: boolean): LocalTransformersEmbeddingProvider {
    return new LocalTransformersEmbeddingProvider({
      model: config.model,
      dimensions: config.dimensions,
      cacheDir: config.cacheDir,
      backend: config.backend,
      allowRemoteModels,
    });
  }

  private getKey(config: LocalEmbeddingConfig): string {
    return [config.model, config.dimensions, config.backend, config.cacheDir].join('|');
  }

  private makeAvailability(
    config: LocalEmbeddingConfig,
    status: LocalEmbeddingAvailability['status'],
    installed: boolean,
    message: string | null,
  ): LocalEmbeddingAvailability {
    return {
      status,
      installed,
      model: config.model,
      dimensions: config.dimensions,
      backend: config.backend,
      message,
    };
  }
}
