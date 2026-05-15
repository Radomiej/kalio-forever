import type {
  ChatMessage,
  CLIAgentResult,
  RAAppBlock,
  RaAppPendingApproval,
  SubagentToolResult,
} from '@kalio/types';
import type { ImageResultData } from './ImageResultRenderer';

export function extractRAAppBlock(data: unknown): RAAppBlock | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if ((d['type'] === 'html' || d['type'] === 'gui') && typeof d['content'] === 'string') {
    return {
      type: d['type'] as 'html' | 'gui',
      mode: (d['mode'] as 'display' | 'interactive') ?? 'display',
      content: (d['renderedContent'] as string | undefined) ?? (d['content'] as string),
      vfsPath: typeof d['vfsPath'] === 'string' ? d['vfsPath'] : undefined,
      pendingApprovals: (d['pendingApprovals'] as RaAppPendingApproval[] | undefined) ?? [],
    };
  }
  return null;
}

export function extractCLIAgentResult(data: unknown): CLIAgentResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d['output'] === 'string' &&
    typeof d['exitCode'] === 'number' &&
    typeof d['durationMs'] === 'number'
  ) {
    return {
      output: d['output'],
      exitCode: d['exitCode'],
      durationMs: d['durationMs'],
      agentId: typeof d['agentId'] === 'string' ? d['agentId'] : 'copilot',
    };
  }
  return null;
}

export function extractImageResult(data: unknown): ImageResultData | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d['output_type'] === 'image' && typeof d['image_url'] === 'string') {
    return d as unknown as ImageResultData;
  }
  return null;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function getChildImageIdentity(image: ImageResultData): string {
  if (typeof image.path === 'string' && image.path.trim().length > 0) {
    return `path:${image.path}`;
  }

  return `inline:${hashString(image.image_url)}`;
}

function isSubagentCopiedFile(data: unknown): data is SubagentToolResult['copiedFiles'][number] {
  if (!data || typeof data !== 'object') return false;
  const file = data as Record<string, unknown>;
  return (
    typeof file['fromPath'] === 'string' &&
    typeof file['toPath'] === 'string' &&
    typeof file['sizeBytes'] === 'number'
  );
}

export function extractSubagentResult(data: unknown): SubagentToolResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d['childSessionId'] !== 'string' ||
    typeof d['parentSessionId'] !== 'string' ||
    (d['vfsMode'] !== 'shared' && d['vfsMode'] !== 'isolated') ||
    typeof d['vfsSessionId'] !== 'string' ||
    !Array.isArray(d['copiedFiles']) ||
    !d['copiedFiles'].every(isSubagentCopiedFile) ||
    typeof d['result'] !== 'string' ||
    typeof d['taskId'] !== 'string' ||
    typeof d['durationMs'] !== 'number'
  ) {
    return null;
  }

  return {
    childSessionId: d['childSessionId'],
    parentSessionId: d['parentSessionId'],
    vfsMode: d['vfsMode'],
    vfsSessionId: d['vfsSessionId'],
    copiedFiles: d['copiedFiles'],
    result: d['result'],
    taskId: d['taskId'],
    durationMs: d['durationMs'],
  };
}

export function extractChildToolPreviews(messages: ChatMessage[]): { raapp: RAAppBlock | null; images: ImageResultData[] } {
  let raapp: RAAppBlock | null = null;
  const images: ImageResultData[] = [];
  const seenImages = new Set<string>();

  for (const message of messages) {
    if (!message || message.role !== 'tool_result') continue;
    try {
      const parsed = JSON.parse(message.content);
      const nextRaapp = extractRAAppBlock(parsed);
      if (nextRaapp) {
        raapp = nextRaapp;
      }

      const image = extractImageResult(parsed);
      if (!image) {
        continue;
      }

      const imageKey = getChildImageIdentity(image);
      if (seenImages.has(imageKey)) {
        continue;
      }

      seenImages.add(imageKey);
      images.push(image);
    } catch {
      // ignore invalid JSON payloads in history lookup
    }
  }

  return { raapp, images };
}