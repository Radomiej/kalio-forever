import { describe, expect, it } from 'vitest';
import { parseRawXmlToolCall } from '../raw-tool-call.parser';

describe('parseRawXmlToolCall', () => {
  it('requires an explicit allow-list before converting raw XML text into a tool call', () => {
    expect(parseRawXmlToolCall([
      '<tool_call>',
      '<name>run_cli_agent</name>',
      '<parameters>{"agentId":"gemini","prompt":"Inspect safely."}</parameters>',
      '</tool_call>',
    ].join(''))).toBeNull();
  });

  it('parses JSON object content inside parameters for run_cli_agent', () => {
    const parsed = parseRawXmlToolCall([
      '<tool_call>',
      '<name>run_cli_agent</name>',
      '<parameters>{"agentId":"gemini","workdir":"C:\\\\Projekty\\\\kalio-forever","prompt":"Inspect safely.","timeoutMs":120000}</parameters>',
      '</tool_call>',
    ].join(''), ['run_cli_agent']);

    expect(parsed).toEqual(expect.objectContaining({
      name: 'run_cli_agent',
      args: {
        agentId: 'gemini',
        workdir: 'C:\\Projekty\\kalio-forever',
        prompt: 'Inspect safely.',
        timeoutMs: 120000,
      },
    }));
  });

  it('rejects raw XML tool calls for names other than run_cli_agent', () => {
    expect(parseRawXmlToolCall([
      '<tool_call>',
      '<name>vfs_write</name>',
      '<parameters>',
      '<filePath>README.md</filePath>',
      '<content>unsafe</content>',
      '</parameters>',
      '</tool_call>',
    ].join(''), ['run_cli_agent'])).toBeNull();
  });

  it('rejects MiMo function-style XML for non-compat tools even when the tool is otherwise allowed', () => {
    expect(parseRawXmlToolCall([
      '<tool_call>',
      '<function=vfs_read>',
      '<parameter=filePath>README.md</parameter>',
      '</function>',
      '</tool_call>',
    ].join(''), ['vfs_read'])).toBeNull();
  });

  it('rejects MiMo function-style XML when the tool is not available to the subagent', () => {
    expect(parseRawXmlToolCall([
      '<tool_call>',
      '<function=vfs_write>',
      '<parameter=filePath>README.md</parameter>',
      '<parameter=content>unsafe</parameter>',
      '</function>',
      '</tool_call>',
    ].join(''), ['vfs_read'])).toBeNull();
  });

  it('keeps nested XML parameter values as strings because tool schemas own coercion', () => {
    const parsed = parseRawXmlToolCall([
      '<tool_call>',
      '<name>run_cli_agent</name>',
      '<parameters>',
      '<agentId>gemini</agentId>',
      '<prompt>Inspect issue 001.</prompt>',
      '<timeoutMs>001</timeoutMs>',
      '<dangerous>false</dangerous>',
      '</parameters>',
      '</tool_call>',
    ].join(''), ['run_cli_agent']);

    expect(parsed?.args).toEqual({
      agentId: 'gemini',
      prompt: 'Inspect issue 001.',
      timeoutMs: '001',
      dangerous: 'false',
    });
  });
});
