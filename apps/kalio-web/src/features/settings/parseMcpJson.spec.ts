import { describe, it, expect } from 'vitest';
import { parseMcpJson } from './parseMcpJson';

describe('parseMcpJson', () => {
  it('parses VS Code http server format', () => {
    const json = JSON.stringify({
      servers: {
        'my-server': {
          type: 'http',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer sk-abc' },
        },
      },
    });
    const result = parseMcpJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('my-server');
    expect(result[0].dto.transport).toBe('http');
    expect(result[0].dto.url).toBe('https://mcp.example.com/sse');
    expect(result[0].dto.headers).toEqual({ Authorization: 'Bearer sk-abc' });
    expect(result[0].dto.name).toBe('my-server');
  });

  it('parses Claude Desktop stdio server format', () => {
    const json = JSON.stringify({
      mcpServers: {
        playwright: {
          command: 'npx',
          args: ['@playwright/mcp@latest', '--headless'],
          env: { DEBUG: 'true' },
        },
      },
    });
    const result = parseMcpJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('playwright');
    expect(result[0].dto.transport).toBe('stdio');
    expect(result[0].dto.command).toBe('npx');
    expect(result[0].dto.args).toEqual(['@playwright/mcp@latest', '--headless']);
    expect(result[0].dto.env).toEqual({ DEBUG: 'true' });
  });

  it('infers http transport from url field (no type)', () => {
    const json = JSON.stringify({
      servers: {
        srv: { url: 'https://example.com' },
      },
    });
    const result = parseMcpJson(json);
    expect(result[0].dto.transport).toBe('http');
  });

  it('infers stdio transport from command field (no type)', () => {
    const json = JSON.stringify({
      mcpServers: {
        srv: { command: 'python', args: ['server.py'] },
      },
    });
    const result = parseMcpJson(json);
    expect(result[0].dto.transport).toBe('stdio');
  });

  it('treats type=sse as http', () => {
    const json = JSON.stringify({
      servers: {
        srv: { type: 'sse', url: 'https://example.com/sse' },
      },
    });
    const result = parseMcpJson(json);
    expect(result[0].dto.transport).toBe('http');
  });

  it('handles multiple servers and preserves order', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_xxx' } },
        playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
      },
    });
    const result = parseMcpJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('github');
    expect(result[1].key).toBe('playwright');
  });

  it('uses entry name field when present', () => {
    const json = JSON.stringify({
      servers: {
        myid: { name: 'My Custom Name', type: 'http', url: 'https://example.com' },
      },
    });
    const result = parseMcpJson(json);
    expect(result[0].dto.name).toBe('My Custom Name');
  });

  it('skips entries with unknown transport (no url and no command)', () => {
    const json = JSON.stringify({
      servers: {
        unknown: { someField: 'value' },
        valid: { type: 'http', url: 'https://example.com' },
      },
    });
    const result = parseMcpJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('valid');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseMcpJson('not json at all')).toThrow(/Invalid JSON/);
  });

  it('throws when servers/mcpServers key is missing', () => {
    const json = JSON.stringify({ something: { server: { url: 'https://x.com' } } });
    expect(() => parseMcpJson(json)).toThrow(/servers/);
  });

  it('throws when top level is an array', () => {
    expect(() => parseMcpJson('[]')).toThrow();
  });

  it('omits empty headers/env (no keys)', () => {
    const json = JSON.stringify({
      servers: {
        srv: { type: 'http', url: 'https://example.com', headers: {} },
      },
    });
    const result = parseMcpJson(json);
    expect(result[0].dto.headers).toBeUndefined();
  });
});
