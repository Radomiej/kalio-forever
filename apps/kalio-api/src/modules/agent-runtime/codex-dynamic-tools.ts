import type { ToolMeta, ToolResult } from '@kalio/types';
import { readToolImage } from '../../common/utils/tool-image-content';

export function toDynamicTool(meta: ToolMeta): Record<string, unknown> {
  return {
    type: 'function',
    name: meta.name,
    description: meta.name === 'fs_read'
      ? `${meta.description} Returns raw file text, not a JSON object or JSON-encoded string.`
      : meta.description,
    inputSchema: meta.parameters,
  };
}

export function toDynamicToolResponse(result: Partial<ToolResult>, toolName = ''): Record<string, unknown> {
  const image = result.status === 'success' ? readToolImage(toolName, result.data) : undefined;
  const fileText = toolName === 'fs_read' && result.data && typeof result.data === 'object'
    && 'content' in result.data && typeof result.data.content === 'string' ? result.data.content : undefined;
  const text = result.status === 'success'
    ? fileText ?? image?.text ?? JSON.stringify(result.data ?? null)
    : result.errorMessage ?? result.errorCode ?? 'Tool execution failed.';
  return {
    contentItems: [{ type: 'inputText', text }, ...(image?.image ? [{ type: 'inputImage', imageUrl: image.imageUrl }] : [])],
    success: result.status === 'success',
  };
}
