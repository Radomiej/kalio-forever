import { BOARD_PADDING_X, BOARD_PADDING_Y, COLUMN_GAP, NODE_HEIGHT, NODE_WIDTH, ROW_GAP, basename } from './executionGraphModel.helpers';
import type { ExecutionGraphNode } from './executionGraphModel';

export interface GraphNodeMetadataItem {
  label: string;
  value: string;
  tone: 'default' | 'accent' | 'warning';
}

type GraphNodePresentationInput = Pick<ExecutionGraphNode, 'kind' | 'title' | 'subtitle' | 'detail' | 'payload'>;

interface GraphNodeSizingProfile {
  baseHeight: number;
  headlineCharsPerLine: number;
  headlineMaxLines: number;
  supportingCharsPerLine: number;
  supportingMaxLines: number;
  metadataColumns: 1 | 2;
  metadataRowHeight: number;
  previewHeightBonus: {
    raapp: number;
    image: number;
  };
  maxHeight: number;
}

const TOOL_ARG_LABELS: Record<string, string> = {
  inputPrompt: 'Prompt',
  prompt: 'Prompt',
  task: 'Task',
  instruction: 'Instruction',
  message: 'Message',
  filePath: 'File',
  path: 'Path',
  vfsPath: 'Path',
  outputPath: 'Output',
  targetPath: 'Target',
  mode: 'Mode',
  vfsMode: 'VFS',
  persona: 'Persona',
  personaId: 'Persona',
  childSessionId: 'Child',
  parentSessionId: 'Parent',
  command: 'Command',
};

const TOOL_ARG_PRIORITY = [
  'inputPrompt',
  'prompt',
  'task',
  'instruction',
  'persona',
  'personaId',
  'filePath',
  'path',
  'vfsMode',
  'mode',
  'command',
];

const NODE_SIZING: Record<ExecutionGraphNode['kind'], GraphNodeSizingProfile> = {
  prompt: {
    baseHeight: 96,
    headlineCharsPerLine: 24,
    headlineMaxLines: 5,
    supportingCharsPerLine: 34,
    supportingMaxLines: 4,
    metadataColumns: 1,
    metadataRowHeight: 34,
    previewHeightBonus: { raapp: 104, image: 92 },
    maxHeight: 280,
  },
  turn: {
    baseHeight: 98,
    headlineCharsPerLine: 26,
    headlineMaxLines: 4,
    supportingCharsPerLine: 32,
    supportingMaxLines: 7,
    metadataColumns: 2,
    metadataRowHeight: 36,
    previewHeightBonus: { raapp: 108, image: 94 },
    maxHeight: 330,
  },
  'tool-group': {
    baseHeight: 90,
    headlineCharsPerLine: 28,
    headlineMaxLines: 3,
    supportingCharsPerLine: 34,
    supportingMaxLines: 3,
    metadataColumns: 1,
    metadataRowHeight: 34,
    previewHeightBonus: { raapp: 96, image: 88 },
    maxHeight: 220,
  },
  tool: {
    baseHeight: 90,
    headlineCharsPerLine: 26,
    headlineMaxLines: 3,
    supportingCharsPerLine: 32,
    supportingMaxLines: 4,
    metadataColumns: 2,
    metadataRowHeight: 34,
    previewHeightBonus: { raapp: 110, image: 96 },
    maxHeight: 360,
  },
  subagent: {
    baseHeight: 114,
    headlineCharsPerLine: 22,
    headlineMaxLines: 6,
    supportingCharsPerLine: 30,
    supportingMaxLines: 7,
    metadataColumns: 1,
    metadataRowHeight: 38,
    previewHeightBonus: { raapp: 112, image: 96 },
    maxHeight: 360,
  },
  'cli-agent': {
    baseHeight: 114,
    headlineCharsPerLine: 22,
    headlineMaxLines: 6,
    supportingCharsPerLine: 30,
    supportingMaxLines: 7,
    metadataColumns: 1,
    metadataRowHeight: 38,
    previewHeightBonus: { raapp: 112, image: 96 },
    maxHeight: 360,
  },
  artifact: {
    baseHeight: 96,
    headlineCharsPerLine: 25,
    headlineMaxLines: 4,
    supportingCharsPerLine: 32,
    supportingMaxLines: 5,
    metadataColumns: 1,
    metadataRowHeight: 34,
    previewHeightBonus: { raapp: 104, image: 92 },
    maxHeight: 320,
  },
  'final-answer': {
    baseHeight: 98,
    headlineCharsPerLine: 26,
    headlineMaxLines: 4,
    supportingCharsPerLine: 32,
    supportingMaxLines: 5,
    metadataColumns: 1,
    metadataRowHeight: 34,
    previewHeightBonus: { raapp: 100, image: 90 },
    maxHeight: 280,
  },
};

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
    return `${normalized.slice(0, 27).trimEnd()}...`;
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

function formatMetadataLabel(value: string): string {
  const direct = TOOL_ARG_LABELS[value];
  if (direct) {
    return direct;
  }

  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => (part.length <= 3 ? part.toUpperCase() : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join(' ');
}

function orderToolArgs(entries: Array<[string, unknown]>): Array<[string, unknown]> {
  return [...entries].sort(([left], [right]) => {
    const leftPriority = TOOL_ARG_PRIORITY.indexOf(left);
    const rightPriority = TOOL_ARG_PRIORITY.indexOf(right);

    if (leftPriority === -1 && rightPriority === -1) {
      return left.localeCompare(right);
    }
    if (leftPriority === -1) {
      return 1;
    }
    if (rightPriority === -1) {
      return -1;
    }

    return leftPriority - rightPriority;
  });
}

function getInlinePreviewKind(node: GraphNodePresentationInput): 'raapp' | 'image' | null {
  if (node.payload.kind === 'artifact') {
    if (node.payload.artifact.kind === 'raapp' || node.payload.artifact.kind === 'image') {
      return node.payload.artifact.kind;
    }
    return null;
  }

  if (node.payload.kind !== 'tool' || !node.payload.result || typeof node.payload.result !== 'object') {
    return null;
  }

  const candidate = node.payload.result as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? candidate.type : null;
  const vfsPath = typeof candidate.vfsPath === 'string'
    ? candidate.vfsPath
    : typeof candidate.path === 'string'
      ? candidate.path
      : null;

  if (candidate.status === 'ready' && (type === 'html' || type === 'gui')) {
    return 'raapp';
  }

  if (!vfsPath) {
    return null;
  }

  return /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(vfsPath) ? 'image' : /\.(html)$/i.test(vfsPath) ? 'raapp' : null;
}

export function getGraphNodeHeading(node: GraphNodePresentationInput): {
  eyebrow: string;
  headline: string;
  supporting: string | null;
} {
  const headlineUsesSubtitle = node.kind === 'prompt' || node.kind === 'turn' || node.kind === 'subagent' || node.kind === 'cli-agent' || node.kind === 'final-answer';
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
      const args: GraphNodeMetadataItem[] = orderToolArgs(Object.entries(node.payload.args))
        .slice(0, 4)
        .map(([label, value]) => ({ label: formatMetadataLabel(label), value: formatMetadataValue(value), tone: 'default' }));

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
    case 'cli-agent': {
      const items: GraphNodeMetadataItem[] = [
        { label: 'Agent', value: node.payload.snapshot.agentId, tone: 'accent' },
        { label: 'Status', value: node.payload.snapshot.status, tone: node.payload.snapshot.status === 'running' ? 'warning' : 'default' },
      ];

      if (node.payload.snapshot.workdir) {
        items.push({ label: 'Workdir', value: basename(node.payload.snapshot.workdir), tone: 'default' });
      }

      if (node.payload.snapshot.lastExitCode !== undefined) {
        items.push({ label: 'Exit', value: String(node.payload.snapshot.lastExitCode), tone: 'default' });
      }

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

export function getGraphNodeMetadataColumnCount(
  node: GraphNodePresentationInput,
  metadata: GraphNodeMetadataItem[] = getGraphNodeMetadata(node),
): 1 | 2 {
  const profile = NODE_SIZING[node.kind];
  const previewKind = getInlinePreviewKind(node);

  if (profile.metadataColumns === 1 || metadata.length <= 1) {
    return 1;
  }

  if (previewKind || metadata.some((item) => item.value.length > 18)) {
    return 1;
  }

  return 2;
}

export function estimateGraphNodeHeight(node: GraphNodePresentationInput): number {
  const { eyebrow, headline, supporting } = getGraphNodeHeading(node);
  const metadata = getGraphNodeMetadata(node);
  const profile = NODE_SIZING[node.kind];
  const metadataColumns = getGraphNodeMetadataColumnCount(node, metadata);
  const previewKind = getInlinePreviewKind(node);

  let height = profile.baseHeight;
  height += Math.max(0, estimateLines(eyebrow, 24, 2) - 1) * 12;
  height += Math.max(1, estimateLines(headline, profile.headlineCharsPerLine, profile.headlineMaxLines)) * 20;

  if (supporting) {
    height += estimateLines(supporting, profile.supportingCharsPerLine, profile.supportingMaxLines) * 16 + 12;
  }

  if (metadata.length > 0) {
    const metadataRows = Math.ceil(metadata.length / metadataColumns);
    const longValueRows = Math.ceil(metadata.filter((item) => item.value.length > 18).length / metadataColumns);
    height += metadataRows * profile.metadataRowHeight + Math.min(longValueRows, metadataRows) * 12 + 10;
  }

  if (previewKind) {
    height += previewKind === 'raapp' ? profile.previewHeightBonus.raapp : profile.previewHeightBonus.image;
  }

  return Math.max(NODE_HEIGHT, Math.min(height, profile.maxHeight));
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