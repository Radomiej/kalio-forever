import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/modules/chat/interfaces/**/*.ts',
        'src/modules/cli-agent/cli-agent.types.ts',
        'src/modules/cli-agent/adapters/cli-agent.adapter.ts',
        'src/modules/llm/llm.types.ts',
        'src/modules/memory/dto/**/*.ts',
        'src/modules/raapp/gui/guiDslAst.ts',
        'src/modules/relay/relay-command-handlers.interface.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
});
