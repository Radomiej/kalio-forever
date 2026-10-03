import { describe, expect, it } from 'vitest';
import { parseDevinMcpCatalog } from './devin-cli-mcp-catalog';

describe('Devin 3000.11.1 MCP catalog boundary', () => {
  it('reads enabled and disabled entries without treating command details as names', () => {
    expect(parseDevinMcpCatalog('Configured MCP servers:\n  • kalio-runtime\n    Command: node bridge.js\n  ✗ serena  (disabled)\n    Command: secret-command\n  • remote\n    URL: https://example.invalid/secret\n')).toEqual([
      { name: 'kalio-runtime', disabled: false }, { name: 'serena', disabled: true },
      { name: 'remote', disabled: false },
    ]);
  });

  it.each([
    '', 'Configured MCP servers:', 'Warning: incomplete catalog',
    'Configured MCP servers:\n  • foo',
    'Configured MCP servers:\n  • foo\n    Command: node\n  • foo\n    Command: node',
    'Configured MCP servers:\n  • foo\n    Command: node\n  ? omitted',
    'Configured MCP servers:\n    Command: secret\n  • foo\n    Command: node',
    'Configured MCP servers:\n  ✗ foo\n    Command: node',
    'Configured MCP servers:\n  • foo (disabled)\n    Command: node',
    'Configured MCP servers:\n  • __proto__\n    Command: node',
  ])('fails closed for unknown, ambiguous or incomplete input without echoing it', (input) => {
    expect(() => parseDevinMcpCatalog(input)).toThrow('Devin MCP catalog format is unsupported or incomplete');
  });
});
