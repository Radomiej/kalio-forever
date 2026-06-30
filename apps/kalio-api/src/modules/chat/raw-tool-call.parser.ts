import { nanoid } from 'nanoid';
import type { LLMToolCall } from '@kalio/types';

const TOOL_CALL_PATTERN = /^<tool_call\b[^>]*>([\s\S]*)<\/tool_call>$/i;
const PARAMS_PATTERN = /<parameters\b[^>]*>([\s\S]*?)<\/parameters>/i;
const PARAM_PATTERN = /<([A-Za-z_][\w:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
const FUNCTION_PATTERN = /<function=([A-Za-z_][\w:-]*)\b[^>]*>([\s\S]*?)<\/function>/i;
const PARAMETER_ASSIGN_PATTERN = /<parameter=([A-Za-z_][\w:-]*)\b[^>]*>([\s\S]*?)<\/parameter>/g;
export const RAW_XML_TOOL_CALL_COMPAT_TOOL_NAME = 'run_cli_agent';

function decodeXmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tagContent(source: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i').exec(source);
  return match?.[1]?.trim();
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseParameters(source: string): Record<string, unknown> {
  const decodedSource = decodeXmlText(source.trim());
  try {
    const parsed: unknown = JSON.parse(decodedSource);
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch (error) {
    void error;
    // Parameter XML is a legacy provider fallback, so invalid JSON falls through to tag parsing.
  }

  const args: Record<string, unknown> = {};

  for (const match of source.matchAll(PARAMETER_ASSIGN_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) {
      continue;
    }
    args[key] = decodeXmlText(value.trim());
  }

  for (const match of source.matchAll(PARAM_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined || key === 'parameters' || key === 'parameter') {
      continue;
    }
    args[key] = decodeXmlText(value.trim());
  }

  return args;
}

function allowedToolNamesSet(allowedToolNames?: Iterable<string>): ReadonlySet<string> {
  return new Set(allowedToolNames ?? []);
}

export function parseRawXmlToolCall(text: string, allowedToolNames?: Iterable<string>): LLMToolCall | null {
  const trimmed = text.trim();
  const toolCallMatch = TOOL_CALL_PATTERN.exec(trimmed);
  if (!toolCallMatch) {
    return null;
  }

  const body = toolCallMatch[1] ?? '';
  const functionMatch = FUNCTION_PATTERN.exec(body);
  const name = functionMatch?.[1] ?? tagContent(body, 'name') ?? tagContent(body, 'tool_name');
  if (name === undefined || name.length === 0) {
    return null;
  }
  const decodedName = decodeXmlText(name);
  // TODO: legacy fallback - raw XML exists only for providers that emit textual tool markup instead of typed tool_call chunks.
  if (
    decodedName !== RAW_XML_TOOL_CALL_COMPAT_TOOL_NAME
    || !allowedToolNamesSet(allowedToolNames).has(decodedName)
  ) {
    return null;
  }

  const paramsBody = functionMatch?.[2] ?? PARAMS_PATTERN.exec(body)?.[1] ?? '';
  return {
    id: `xml-${nanoid()}`,
    name: decodedName,
    args: parseParameters(paramsBody),
  };
}
