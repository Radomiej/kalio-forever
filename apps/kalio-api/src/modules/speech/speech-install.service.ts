import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { SpeechRuntimeStorageService } from '../vfs/speech-runtime-storage.service';
import { SPEECH_MODEL, SPEECH_MODEL_FILES, SPEECH_RUNTIME_PACKAGES, type SpeechAvailability } from './speech-catalog';

@Injectable()
export class SpeechInstallService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeechInstallService.name);
  private root: string | null = null;
  private inspection?: Promise<void>;
  private abort?: AbortController;
  private installTask?: Promise<void>;
  private state: SpeechAvailability = {
    status: 'missing', installed: false, model: SPEECH_MODEL, backend: 'sherpa-onnx-cpu',
    downloadedBytes: 0, totalBytes: [...SPEECH_MODEL_FILES, ...SPEECH_RUNTIME_PACKAGES].reduce((sum, file) => sum + file.bytes, 0),
    phase: null, errorCode: null, maxDurationSeconds: 60,
  };

  constructor(private readonly storage: SpeechRuntimeStorageService) {}

  async status(): Promise<SpeechAvailability> {
    if (!this.abort && !this.root) {
      this.inspection ??= this.inspect().finally(() => { this.inspection = undefined; });
      await this.inspection;
    }
    return { ...this.state };
  }

  private async inspect(): Promise<void> {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      this.state = { ...this.state, status: 'error', errorCode: 'SPEECH_PLATFORM_UNSUPPORTED' };
      return;
    }
    try {
      this.root = await this.storage.installedRoot(SPEECH_MODEL_FILES);
      if (this.root) this.state = { ...this.state, installed: true, status: 'ready', phase: null, errorCode: null };
      else if (this.state.status !== 'error') this.state = { ...this.state, installed: false, status: 'missing' };
    } catch {
      this.state = { ...this.state, status: 'error', errorCode: 'SPEECH_INSTALL_INVALID' };
    }
  }

  async install(): Promise<SpeechAvailability> {
    await this.status();
    if (this.abort || this.root || this.state.errorCode === 'SPEECH_PLATFORM_UNSUPPORTED') return { ...this.state };
    const abort = new AbortController();
    this.abort = abort;
    this.state = { ...this.state, status: 'installing', installed: false, downloadedBytes: 0, phase: 'runtime', errorCode: null };
    this.installTask = this.runInstall(abort);
    return { ...this.state };
  }

  private async runInstall(abort: AbortController): Promise<void> {
    const timeout = setTimeout(() => abort.abort(), 30 * 60 * 1000);
    try {
      this.root = await this.storage.install(SPEECH_MODEL_FILES, SPEECH_RUNTIME_PACKAGES, abort.signal, (phase, bytes) => {
        this.state.downloadedBytes += bytes;
        this.state.status = phase === 'verifying' ? 'verifying' : 'installing';
        if (phase !== 'verifying') this.state.phase = phase;
      });
      this.state = { ...this.state, status: 'ready', installed: true, phase: null, errorCode: null };
    } catch (error) {
      const code = error instanceof Error && /^SPEECH_[A-Z_]+$/.test(error.message) ? error.message : 'SPEECH_INSTALL_FAILED';
      this.logger.warn(abort.signal.aborted ? 'SPEECH_INSTALL_CANCELLED' : code);
      this.state = { ...this.state, status: 'error', installed: false, phase: null,
        errorCode: abort.signal.aborted ? 'SPEECH_INSTALL_CANCELLED' : code };
    } finally {
      clearTimeout(timeout);
      this.abort = undefined;
    }
  }

  async cancel(): Promise<SpeechAvailability> {
    this.abort?.abort();
    await this.installTask;
    return this.status();
  }

  async installedRoot(): Promise<string | null> { await this.status(); return this.root; }
  async onModuleDestroy(): Promise<void> { await this.cancel(); }
}
