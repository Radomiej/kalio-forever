import {
  Bot, Boxes, BrainCircuit, CheckCircle2, FolderTree, MessageSquareText, Wrench,
} from 'lucide-react';
import type { ExecutionGraphNode, ExecutionGraphNodeKind } from './executionGraphModel';
import type { GraphNodeMetadataItem } from './executionGraphNodePresentation';
import { getGraphNodeMetadata } from './executionGraphNodePresentation';
import type { GraphCardDensity } from './ExecutionGraphBoard.types';

export const NODE_TONES: Record<ExecutionGraphNodeKind, { card: string; accent: string; icon: string }> = {
  prompt: { card: 'border-sky-300/30 bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(14,165,233,0.8)]', accent: 'bg-sky-400', icon: 'text-sky-200' },
  turn: { card: 'border-violet-300/30 bg-[linear-gradient(135deg,rgba(139,92,246,0.15),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(139,92,246,0.82)]', accent: 'bg-violet-400', icon: 'text-violet-200' },
  'tool-group': { card: 'border-emerald-300/30 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(16,185,129,0.78)]', accent: 'bg-emerald-400', icon: 'text-emerald-200' },
  tool: { card: 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,191,36,0.86)]', accent: 'bg-amber-300', icon: 'text-amber-100' },
  subagent: { card: 'border-indigo-300/30 bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(99,102,241,0.82)]', accent: 'bg-indigo-300', icon: 'text-indigo-100' },
  'cli-agent': { card: 'border-cyan-300/30 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(34,211,238,0.78)]', accent: 'bg-cyan-300', icon: 'text-cyan-100' },
  'agent-flow': { card: 'border-teal-300/30 bg-[linear-gradient(135deg,rgba(45,212,191,0.13),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(45,212,191,0.72)]', accent: 'bg-teal-300', icon: 'text-teal-100' },
  'tool-result': { card: 'border-rose-300/30 bg-[linear-gradient(135deg,rgba(251,113,133,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,113,133,0.75)]', accent: 'bg-rose-300', icon: 'text-rose-100' },
  'architecture-run': { card: 'border-blue-300/30 bg-[linear-gradient(135deg,rgba(59,130,246,0.14),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(59,130,246,0.78)]', accent: 'bg-blue-300', icon: 'text-blue-100' },
  artifact: { card: 'border-slate-300/30 bg-[linear-gradient(135deg,rgba(148,163,184,0.13),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(148,163,184,0.62)]', accent: 'bg-slate-300', icon: 'text-slate-100' },
  'final-answer': { card: 'border-emerald-300/35 bg-[linear-gradient(135deg,rgba(52,211,153,0.16),rgba(15,23,42,0.95)_48%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(52,211,153,0.86)]', accent: 'bg-emerald-300', icon: 'text-emerald-100' },
};

export const ROUTER_ROUTE_TONE = {
  card: 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(15,23,42,0.95)_46%,rgba(6,10,18,0.98))] shadow-[0_16px_40px_-28px_rgba(251,191,36,0.9)]',
  accent: 'bg-amber-300',
  icon: 'text-amber-100',
};

export const NODE_TEXT_TONES: Record<ExecutionGraphNodeKind, {
  eyebrow: string;
  headline: string;
  supporting: string;
  accentLabel: string;
  accentValue: string;
}> = {
  prompt: { eyebrow: 'text-sky-50/90', headline: 'text-white', supporting: 'text-sky-50/78', accentLabel: 'text-sky-100/72', accentValue: 'text-sky-50' },
  turn: { eyebrow: 'text-violet-50/90', headline: 'text-fuchsia-50', supporting: 'text-violet-50/78', accentLabel: 'text-violet-100/72', accentValue: 'text-fuchsia-50' },
  'tool-group': { eyebrow: 'text-emerald-50/90', headline: 'text-emerald-50', supporting: 'text-emerald-50/76', accentLabel: 'text-emerald-100/72', accentValue: 'text-emerald-50' },
  tool: { eyebrow: 'text-amber-50/90', headline: 'text-amber-50', supporting: 'text-amber-50/76', accentLabel: 'text-amber-100/72', accentValue: 'text-amber-50' },
  subagent: { eyebrow: 'text-indigo-50/90', headline: 'text-indigo-50', supporting: 'text-indigo-50/78', accentLabel: 'text-indigo-100/72', accentValue: 'text-indigo-50' },
  'cli-agent': { eyebrow: 'text-cyan-50/90', headline: 'text-cyan-50', supporting: 'text-cyan-50/78', accentLabel: 'text-cyan-100/72', accentValue: 'text-cyan-50' },
  'agent-flow': { eyebrow: 'text-teal-50/90', headline: 'text-teal-50', supporting: 'text-teal-50/78', accentLabel: 'text-teal-100/72', accentValue: 'text-teal-50' },
  'tool-result': { eyebrow: 'text-rose-50/90', headline: 'text-rose-50', supporting: 'text-rose-50/78', accentLabel: 'text-rose-100/72', accentValue: 'text-rose-50' },
  'architecture-run': { eyebrow: 'text-blue-50/90', headline: 'text-cyan-50', supporting: 'text-blue-50/78', accentLabel: 'text-cyan-100/72', accentValue: 'text-cyan-50' },
  artifact: { eyebrow: 'text-slate-50/90', headline: 'text-slate-50', supporting: 'text-slate-50/76', accentLabel: 'text-slate-100/72', accentValue: 'text-slate-50' },
  'final-answer': { eyebrow: 'text-emerald-50/92', headline: 'text-emerald-50', supporting: 'text-emerald-50/78', accentLabel: 'text-emerald-100/74', accentValue: 'text-emerald-50' },
};

export function nodeIcon(kind: ExecutionGraphNodeKind) {
  switch (kind) {
    case 'prompt': return <MessageSquareText size={16} />;
    case 'turn': return <Bot size={16} />;
    case 'tool-group': return <Boxes size={16} />;
    case 'tool': return <Wrench size={16} />;
    case 'subagent': return <BrainCircuit size={16} />;
    case 'cli-agent': return <BrainCircuit size={16} />;
    case 'agent-flow': return <FolderTree size={16} />;
    case 'tool-result': return <Wrench size={16} />;
    case 'architecture-run': return <FolderTree size={16} />;
    case 'artifact': return <FolderTree size={16} />;
    case 'final-answer': return <CheckCircle2 size={16} />;
  }
}

export function statusTone(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'text-rose-200';
  if (status === 'waiting') return 'text-amber-100';
  if (status === 'running') return 'text-amber-100';
  if (status === 'success') return 'text-emerald-100';
  return 'text-slate-200';
}

export function statusLabel(status: ExecutionGraphNode['status']): string {
  if (status === 'error') return 'error';
  if (status === 'waiting') return 'waiting';
  if (status === 'running') return 'running';
  if (status === 'success') return 'ready';
  return 'idle';
}

export function getMetadataForDensity(node: ExecutionGraphNode, cardDensity: GraphCardDensity): GraphNodeMetadataItem[] {
  const metadata = getGraphNodeMetadata(node);
  if (cardDensity === 'detailed') {
    return metadata;
  }
  if (node.kind === 'tool' || node.kind === 'tool-group' || node.kind === 'tool-result') {
    return [];
  }
  if (node.kind === 'turn') {
    return metadata.filter((item) => item.label === 'Agent' || item.label === 'Tools').slice(0, 2);
  }
  if (node.kind === 'subagent' || node.kind === 'cli-agent') {
    return metadata.filter((item) => item.label === 'Level' || item.label === 'Persona' || item.label === 'Agent').slice(0, 2);
  }
  if (node.kind === 'architecture-run') {
    return metadata.filter((item) => item.label === 'Schema').slice(0, 1);
  }
  return metadata.slice(0, 1);
}
