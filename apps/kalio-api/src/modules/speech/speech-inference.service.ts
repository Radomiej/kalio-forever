import { Injectable, Logger, OnModuleDestroy, ConflictException, ServiceUnavailableException, RequestTimeoutException } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { SPEECH_WORKER_SOURCE } from './speech-worker-source';

@Injectable()
export class SpeechInferenceService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeechInferenceService.name);
  private active?: { requestId: string; abort: AbortController; child?: ChildProcess };

  reserve(requestId: string): AbortSignal {
    if (this.active) throw new ConflictException({ code: 'SPEECH_BUSY' });
    this.active = { requestId, abort: new AbortController() };
    return this.active.abort.signal;
  }

  release(requestId: string, signal: AbortSignal): void {
    if (this.active?.requestId === requestId && this.active.abort.signal === signal) this.active = undefined;
  }

  async transcribe(root: string, requestId: string, pcm: Buffer, scope?: AbortSignal): Promise<string> {
    const signal = scope ?? this.reserve(requestId);
    if (!this.active || this.active.requestId !== requestId || this.active.abort.signal !== signal || this.active.child) {
      throw new ConflictException({ code: 'SPEECH_BUSY' });
    }
    if (signal.aborted) throw new ConflictException({ code: 'SPEECH_CANCELLED' });
    // Each bounded request owns a process so native buffers die on success/cancel/crash.
    let child: ChildProcess;
    try { child = spawn(process.execPath, ['--input-type=commonjs', '-e', SPEECH_WORKER_SOURCE], {
      windowsHide: true, shell: false, serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { SystemRoot: process.env['SystemRoot'], TEMP: process.env['TEMP'],
        PATH: process.env['PATH'], OMP_NUM_THREADS: '4' },
    }); } catch {
      if (!scope) this.release(requestId, signal);
      this.logger.warn('SPEECH_WORKER_SPAWN_FAILED');
      throw new ServiceUnavailableException({ code: 'SPEECH_WORKER_FAILED' });
    }
    this.active.child = child;
    return new Promise<string>((resolve, reject) => {
      let result: string | undefined;
      let failure: Error | undefined;
      const timer = setTimeout(() => {
        failure = new RequestTimeoutException({ code: 'SPEECH_TIMEOUT' });
        child.kill();
      }, 120000);
      const cancel = () => {
        failure = new ConflictException({ code: 'SPEECH_CANCELLED' });
        child.kill();
      };
      signal.addEventListener('abort', cancel, { once: true });
      child.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && 'text' in message
          && typeof message.text === 'string' && Buffer.byteLength(message.text, 'utf8') <= 32000) result = message.text;
        else failure = new ServiceUnavailableException({ code: 'SPEECH_INFERENCE_FAILED' });
      });
      child.once('error', () => {
        this.logger.warn('SPEECH_WORKER_FAILED');
        failure = new ServiceUnavailableException({ code: 'SPEECH_WORKER_FAILED' });
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (!scope) this.release(requestId, signal);
        if (failure) reject(failure);
        else if (code === 0 && result !== undefined) resolve(result);
        else reject(new ServiceUnavailableException({ code: 'SPEECH_WORKER_FAILED' }));
      });
      const ipcFailure = () => {
        this.logger.warn('SPEECH_WORKER_IPC_FAILED');
        failure = new ServiceUnavailableException({ code: 'SPEECH_WORKER_FAILED' });
        child.kill();
      };
      try { child.send({ root, pcm }, (error) => {
        if (error) {
          ipcFailure();
        }
      }); } catch { ipcFailure(); }
    });
  }

  cancel(requestId: string): boolean {
    if (this.active?.requestId !== requestId) return false;
    this.active.abort.abort();
    return true;
  }

  onModuleDestroy(): void { this.active?.abort.abort(); }
}
