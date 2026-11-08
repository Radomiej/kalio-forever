export type UnknownRecord = Record<string, unknown>;
export type SessionSummary = { id: string; title: string; updatedAt?: string; active: boolean; parentSessionId?: string; project?: string; persona?: string; projectId?: string; personaId?: string };
export type Message = { id: string; role: string; content: string; createdAt?: string; turnId?: string };
export type GraphNode = { id: string; type: string; label: string; status?: string; sessionId?: string };
export type GraphEdge = { id: string; source: string; target: string; type: string };
export type Approval = { id: string; sessionId: string; toolName: string; args: Record<string, unknown>; requestedAt?: string; revision: string; argsSha256: string; status?: string };
export type Snapshot = { instance: { id: string; name: string }; sessions: SessionSummary[]; approvals: Approval[] };
export type SessionSnapshot = { sessionId: string; title: string; updatedAt?: string; active: boolean; messages: Message[]; graph: { nodes: GraphNode[]; edges: GraphEdge[]; available: boolean; reason?: string; runId?: string } };
export type Envelope = { v: 1; type: string; instanceId: string; sequence?: number; requestId?: string; payload?: unknown };
export function isRecord(value: unknown): value is UnknownRecord { return typeof value === 'object' && value !== null && !Array.isArray(value); }
const str = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback;
const isoDate = (v: unknown): string | undefined => typeof v === 'number' && Number.isFinite(v) ? new Date(v).toISOString() : typeof v === 'string' ? v : undefined;
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!isRecord(value) || !isRecord(value.instance) || typeof value.instance.id !== 'string' || typeof value.instance.name !== 'string' || !Array.isArray(value.sessions) || !Array.isArray(value.approvals)) return null;
  const sessions = value.sessions.flatMap((item): SessionSummary[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.updatedAt !== 'number' || typeof item.active !== 'boolean') return [];
    const projectId = typeof item.projectId === 'string' ? item.projectId : undefined;
    const personaId = typeof item.personaId === 'string' ? item.personaId : undefined;
    return [{ id: item.id, title: item.title, active: item.active, updatedAt: new Date(item.updatedAt).toISOString(),
      ...(typeof item.parentSessionId === 'string' ? { parentSessionId: item.parentSessionId } : {}),
      ...(projectId ? { projectId, project: projectId } : {}), ...(personaId ? { personaId, persona: personaId } : {}) }];
  });
  const approvals: Approval[] = [];
  for (const item of value.approvals) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.sessionId !== 'string' || typeof item.toolName !== 'string' ||
        !isRecord(item.args) || typeof item.requestedAt !== 'number' || typeof item.revision !== 'string' || typeof item.argsSha256 !== 'string') return null;
    approvals.push({ id: item.id, sessionId: item.sessionId, toolName: item.toolName, args: item.args, requestedAt: new Date(item.requestedAt).toISOString(), revision: item.revision, argsSha256: item.argsSha256 });
  }
  return { instance: { id: value.instance.id, name: value.instance.name }, sessions, approvals };
}
export function parseSession(value: unknown): SessionSnapshot | null {
  if (!isRecord(value) || !isRecord(value.session) || typeof value.session.id !== 'string' || typeof value.session.title !== 'string' ||
      typeof value.session.updatedAt !== 'number' || typeof value.session.active !== 'boolean' || !Array.isArray(value.messages) || !isRecord(value.graph)) return null;
  const messages: Message[] = [];
  for (const m of value.messages) {
    if (!isRecord(m) || typeof m.id !== 'string' || typeof m.role !== 'string' || typeof m.content !== 'string' || typeof m.createdAt !== 'number') return null;
    messages.push({ id:m.id, role:m.role, content:m.content, createdAt:new Date(m.createdAt).toISOString(), ...(typeof m.turnId === 'string'?{turnId:m.turnId}:{}) });
  }
  const graph = value.graph;
  const summary = value.session;
  const model: SessionSnapshot = { sessionId: summary.id, title: summary.title, updatedAt: new Date(summary.updatedAt).toISOString(), active: summary.active, messages, graph:{available:false,nodes:[],edges:[]} };
  if (graph.available === false && (graph.reason === 'no_architecture_run' || graph.reason === 'projection_unavailable')) {
    model.graph.reason = graph.reason; return model;
  }
  if (graph.available !== true || typeof graph.runId !== 'string' || !isRecord(graph.projection) || !Array.isArray(graph.projection.nodes) || !Array.isArray(graph.projection.edges)) return null;
  const nodes: GraphNode[] = [];
  for (const node of graph.projection.nodes) {
    if (!isRecord(node) || typeof node.id !== 'string' || typeof node.label !== 'string' || typeof node.kind !== 'string' || typeof node.status !== 'string') return null;
    nodes.push({id:node.id,label:node.label,type:node.kind,status:node.status,...(typeof node.sessionId==='string'?{sessionId:node.sessionId}:{})});
  }
  const edges: GraphEdge[] = [];
  for (const edge of graph.projection.edges) {
    if (!isRecord(edge) || typeof edge.id !== 'string' || typeof edge.fromNodeId !== 'string' || typeof edge.toNodeId !== 'string') return null;
    edges.push({id:edge.id,source:edge.fromNodeId,target:edge.toNodeId,type:typeof edge.label==='string'?edge.label:'flow'});
  }
  model.graph={available:true,runId:graph.runId,nodes,edges}; return model;
}
