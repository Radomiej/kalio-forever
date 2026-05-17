import { BOARD_PADDING_X, BOARD_PADDING_Y, COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, basename } from './executionGraphModel.helpers';
import type { ExecutionGraphNode } from './executionGraphModel';

export interface GraphNodeMetadataItem {
  label: string;
  value: string;
  tone: 'default' | 'accent' | 'warning';
}

type GraphNodePresentationInput = Pick<ExecutionGraphNode, 'kind' | 'title' | 'subtitle' | 'detail' | 'payload'>;

function estimateLines(value: string | undefined, charsPerLine: number, maxLines: number): number {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 0;
  }

  return Math.min(Math.ceil(normalized.length / charsPerLine), maxLines);
}

function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 30) {
      return normalized;
    }
    return `${normalized.slice(0, 27)}...`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 2).map((entry) => formatMetadataValue(entry)).join(', ');
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) {
      return '{}';
    }
    return `${keys.slice(0, 2).join(', ')}${keys.length > 2 ? ', ...' : ''}`;
  }

  return '-';
}

function hasInlinePreview(node: GraphNodePresentationInput): boolean {
  if (node.payload.kind === 'artifact') {
    return node.payload.artifact.kind === 'raapp' || node.payload.artifact.kind === 'image';
  }

  if (node.payload.kind !== 'tool' || !node.payload.result || typeof node.payload.result !== 'object') {
    return false;
  }

  const candidate = node.payload.result as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? candidate.type : null;
  const vfsPath = typeof candidate.vfsPath === 'string'
    ? candidate.vfsPath
    : typeof candidate.path === 'string'
      ? candidate.path
      : null;

  if (candidate.status === 'ready' && (type === 'html' || type === 'gui')) {
    return true;
  }

  if (!vfsPath) {
    return false;
  }

  return /\.(html|png|jpg|jpeg|gif|webp|svg)$/i.test(vfsPath);
}

export function getGraphNodeHeading(node: GraphNodePresentationInput): {
  eyebrow: string;
  headline: string;
  supporting: string | null;
} {
  const headlineUsesSubtitle = node.kind === 'prompt' || node.kind === 'turn' || node.kind === 'subagent' || node.kind === 'final-answer';
  const headline = headlineUsesSubtitle ? node.subtitle : node.title;
  const eyebrow = headlineUsesSubtitle ? node.title : node.subtitle;

  return {
    eyebrow,
    headline: headline || node.title,
    supporting: node.detail ?? null,
  };
}

export function getGraphNodeMetadata(node: GraphNodePresentationInput): GraphNodeMetadataItem[] {
  switch (node.payload.kind) {
    case 'prompt':
      return node.detail ? [{ label: 'Scope', value: node.detail, tone: 'accent' }] : [];
    case 'turn': {
      const items: GraphNodeMetadataItem[] = [
        { label: 'Tools', value: String(node.payload.toolCount), tone: 'accent' },
        { label: 'Thinking', value: String(node.payload.thinkingCount), tone: 'accent' },
      ];

      if (node.payload.actorLabel) {
        items.unshift({ label: 'Agent', value: node.payload.actorLabel, tone: 'accent' });
      }

      if (node.payload.modelLabel) {
        items.splice(Math.min(items.length, 1), 0, { label: 'Model', value: node.payload.modelLabel, tone: 'accent' });
      }

      return items;
    }
    case 'tool': {
      const args: GraphNodeMetadataItem[] = Object.entries(node.payload.args)
        .slice(0, 4)
        .map(([label, value]) => ({ label, value: formatMetadataValue(value), tone: 'default' }));

      if (node.payload.confirmationRequired) {
        args.unshift({ label: 'Approval', value: 'Accept required', tone: 'warning' });
      }

      return args;
    }
    case 'tool-group':
      return [{ label: 'Grouped', value: `${node.payload.tools.length} tools`, tone: 'accent' }];
    case 'subagent': {
      const items: GraphNodeMetadataItem[] = [];

      if (node.payload.actorLabel) {
        items.push({ label: 'Persona', value: node.payload.actorLabel, tone: 'accent' });
      }

      if (node.payload.modelLabel) {
        items.push({ label: 'Model', value: node.payload.modelLabel, tone: 'accent' });
      }

      items.push({ label: 'VFS', value: node.payload.result.vfsMode, tone: 'default' });
      items.push({ label: 'Files', value: String(node.payload.copiedFiles.length), tone: 'default' });

      return items;
    }
    case 'artifact': {
      const items: GraphNodeMetadataItem[] = [
        { label: 'Type', value: node.payload.artifact.kind, tone: 'accent' },
      ];

      if (node.payload.artifact.path) {
        items.push({ label: 'Path', value: basename(node.payload.artifact.path), tone: 'default' });
      }

      return items;
    }
    case 'final-answer':
      return [{ label: 'Outcome', value: 'Last chat reply', tone: 'accent' }];
  }
}

export function estimateGraphNodeHeight(node: GraphNodePresentationInput): number {
  const { eyebrow, headline, supporting } = getGraphNodeHeading(node);
  const metadata = getGraphNodeMetadata(node);
  const headlineCharsPerLine = node.kind === 'prompt' || node.kind === 'subagent' ? 24 : 28;

  let height = 92;
  height += Math.max(0, estimateLines(eyebrow, 24, 2) - 1) * 14;
  height += Math.max(1, estimateLines(headline, headlineCharsPerLine, 5)) * 20;

  if (supporting) {
    height += estimateLines(supporting, 34, 6) * 16 + 10;
  }

  if (metadata.length > 0) {
    const metadataRows = Math.ceil(metadata.length / 2);
    const longValueRows = metadata.filter((item) => item.value.length > 18).length;
    height += metadataRows * 34 + Math.min(longValueRows, metadataRows) * 10 + 8;
  }

  if (hasInlinePreview(node)) {
    height += 82;
  }

  return Math.max(NODE_HEIGHT, Math.min(height, 320));
}

export function applyGraphNodeLayout(nodes: ExecutionGraphNode[]): { width: number; height: number } {
  const rowHeights = new Map<number, number>();
  const maxColumn = nodes.reduce((value, node) => Math.max(value, node.column), 0);
  const maxRow = nodes.reduce((value, node) => Math.max(value, node.row), 0);

  nodes.forEach((node) => {
    rowHeights.set(node.row, Math.max(rowHeights.get(node.row) ?? NODE_HEIGHT, node.height));
  });

  const rowOffsets = new Map<number, number>();
  let nextY = BOARD_PADDING_Y;

  for (let row = 0; row <= maxRow; row += 1) {
    rowOffsets.set(row, nextY);
    nextY += (rowHeights.get(row) ?? NODE_HEIGHT) + ROW_GAP;
  }

  nodes.forEach((node) => {
    node.x = BOARD_PADDING_X + node.column * (NODE_WIDTH + COLUMN_GAP);
    node.y = rowOffsets.get(node.row) ?? BOARD_PADDING_Y;
    node.width = NODE_WIDTH;
  });

  return {
    width: BOARD_PADDING_X * 2 + (maxColumn + 1) * NODE_WIDTH + maxColumn * COLUMN_GAP,
    height: maxRow >= 0 ? nextY - ROW_GAP + BOARD_PADDING_Y : BOARD_PADDING_Y * 2,
  };
}