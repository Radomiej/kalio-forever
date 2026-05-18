import { nanoid } from 'nanoid';
import type { LLMToolCall } from '@kalio/types';

const TOOL_CALL_PATTERN = /^<tool_call\b[^>]*>([\s\S]*)<\/tool_call>$/i;
const PARAMS_PATTERN = /<parameters\b[^>]*>([\s\S]*?)<\/parameters>/i;
const PARAM_PATTERN = /<([A-Za-z_][\w:-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
const ALLOWED_RAW_XML_TOOL_NAME = 'run_cli_agent';

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
  if (decodedSource.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(decodedSource);
      return isJsonObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  const args: Record<string, unknown> = {};

  for (const match of source.matchAll(PARAM_PATTERN)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined || key === 'parameters') {
      continue;
    }
    args[key] = decodeXmlText(value.trim());
  }

  return args;
}

export function parseRawXmlToolCall(text: string): LLMToolCall | null {
  const trimmed = text.trim();
  const toolCallMatch = TOOL_CALL_PATTERN.exec(trimmed);
  if (!toolCallMatch) {
    return null;
  }

  const body = toolCallMatch[1] ?? '';
  const name = tagContent(body, 'name') ?? tagContent(body, 'tool_name');
  if (name === undefined || name.length === 0) {
    return null;
  }
  const decodedName = decodeXmlText(name);
  if (decodedName !== ALLOWED_RAW_XML_TOOL_NAME) {
    return null;
  }

  const paramsBody = PARAMS_PATTERN.exec(body)?.[1] ?? '';
  return {
    id: `xml-${nanoid()}`,
    name: decodedName,
    args: parseParameters(paramsBody),
  };
}
