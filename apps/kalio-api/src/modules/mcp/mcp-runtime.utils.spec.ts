import { describe, expect, it } from 'vitest';
import { configToMcpHandle } from './mcp-runtime.utils';

describe('configToMcpHandle', () => {
  it('preserves the project MCP server tool allowlist and denylist', () => {
    const handle = configToMcpHandle('playwright-orchestrator', {
      url: 'http://127.0.0.1:3333/mcp',
      enabled_tools: ['browser_snapshot', 'audit_wcag21'],
      disabled_tools: ['browser_run_code_unsafe'],
    });

    expect(handle.enabledTools).toStrictEqual(['browser_snapshot', 'audit_wcag21']);
    expect(handle.disabledTools).toStrictEqual(['browser_run_code_unsafe']);
  });
});
