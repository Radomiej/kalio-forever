import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';

process.env.DATABASE_PATH ??= path.join(os.tmpdir(), 'kalio-app-module-test.db');
process.env.MEMORY_DB_PATH ??= path.join(os.tmpdir(), 'kalio-app-module-test-memory');
process.env.WORKSPACE_ROOT ??= path.join(os.tmpdir(), 'kalio-app-module-test-workspace');
process.env.CREDENTIALS_MASTER_KEY ??= 'ci-test-master-key-32-chars-minimum';
process.env.LLM_PROVIDER ??= 'mock';

describe('AppModule', () => {
  it('is constructible', async () => {
    const { AppModule } = await import('./app.module');

    expect(new AppModule()).toBeInstanceOf(AppModule);
  });
});
