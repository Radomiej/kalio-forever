import { Injectable, Logger } from '@nestjs/common';
import { runInNewContext } from 'node:vm';

const SANDBOX_TIMEOUT_MS = 5000;

@Injectable()
export class RAAppSandboxService {
  private readonly logger = new Logger(RAAppSandboxService.name);

  async execute(code: string): Promise<string> {
    const sandbox: Record<string, unknown> = { __result: '' };
    try {
      runInNewContext(
        `__result = (function() { ${code} })()`,
        sandbox,
        { timeout: SANDBOX_TIMEOUT_MS },
      );
      return String(sandbox['__result'] ?? '');
    } catch (err) {
      this.logger.error('[Sandbox] Execution error', err);
      throw err;
    }
  }
}
