export type UnknownRecord = Record<string, unknown>;
export type SessionSummary = { id: string; title: string; updatedAt?: string; active: boolean; parentSessionId?: string; project?: string; persona?: string };
export type Message = { id: string; role: string; content: string; createdAt?: string; turnId?: string };
export type GraphNode = { id: string; type: string; label: string; status?: string; sessionId?: string };
export type GraphEdge = { id: string; source: string; target: string; type: string };
export type Approval = { id: string; sessionId: string; toolName: string; args: unknown; requestedAt?: string; revision: string; argsSha256: string; status?: string };
export type Snapshot = { instance: { id: string; name: string }; sessions: SessionSummary[]; approvals: Approval[] };
export type SessionSnapshot = { sessionId: string; messages: Message[]; graph: { nodes: GraphNode[]; edges: GraphEdge[] } };
export type Envelope = { v: 1; type: string; instanceId: string; sequence?: number; requestId?: string; payload?: unknown };
export function isRecord(value: unknown): value is UnknownRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const str = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback;
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || !isRecord(value.instance) || !Array.isArray(value.sessions) || !Array.isArray(value.approvals)) return null;
  const instance = value.instance;
  if (typeof instance.id !== 'string' || typeof instance.name !== 'string') return null;
  const sessions = value.sessions.flatMap((item): SessionSummary[] => {
    if (!isRecord(item) || typeof item.id !== 'string') return [];
    return [{ id: item.id, title: str(item.title, 'Untitled session'), active: item.active === true,
      ...(typeof item.updatedAt === 'string' ? { updatedAt: item.updatedAt } : {}),
      ...(typeof item.parentSessionId === 'string' ? { parentSessionId: item.parentSessionId } : {}),
      ...(typeof item.project === 'string' ? { project: item.project } : {}),
      ...(typeof item.persona === 'string' ? { persona: item.persona } : {}) }];
  });
  const approvals = value.approvals.flatMap((item): Approval[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sessionId !== 'string' || typeof item.revision !== 'string' || typeof item.argsSha256 !== 'string') return [];
    return [{ id: item.id, sessionId: item.sessionId, toolName: str(item.toolName, 'Tool request'), args: item.args, revision: item.revision, argsSha256: item.argsSha256,
      ...(typeof item.requestedAt === 'string' ? { requestedAt: item.requestedAt } : {}),
      ...(typeof item.status === 'string' ? { status: item.status } : {}) }];
  });
  return { instance: { id: instance.id, name: instance.name }, sessions, approvals };
}
export function parseSession(value: unknown): SessionSnapshot | null {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !Array.isArray(value.messages) || !isRecord(value.graph) || !Array.isArray(value.graph.nodes) || !Array.isArray(value.graph.edges)) return null;
  const messages = value.messages.flatMap((m): Message[] => isRecord(m) && typeof m.id === 'string' && typeof m.content === 'string' ? [{ id: m.id, role: str(m.role, 'assistant'), content: m.content, ...(typeof m.createdAt === 'string' ? { createdAt: m.createdAt } : {}), ...(typeof m.turnId === 'string' ? { turnId: m.turnId } : {}) }] : []);
  const nodes = value.graph.nodes.flatMap((n): GraphNode[] => isRecord(n) && typeof n.id === 'string' ? [{ id: n.id, type: str(n.type, 'step'), label: str(n.label, n.id), ...(typeof n.status === 'string' ? { status: n.status } : {}), ...(typeof n.sessionId === 'string' ? { sessionId: n.sessionId } : {}) }] : []);
  const edges = value.graph.edges.flatMap((e): GraphEdge[] => isRecord(e) && typeof e.id === 'string' && typeof e.source === 'string' && typeof e.target === 'string' ? [{ id: e.id, source: e.source, target: e.target, type: str(e.type, 'flow') }] : []);
  return { sessionId: value.sessionId, messages, graph: { nodes, edges } };
}
