import type { ArchitectureGraphProjection, ChatMessage } from './index';

export const REMOTE_SUPERVISION_PORT = Symbol('REMOTE_SUPERVISION_PORT');
export const CHAT_REMOTE_SUPERVISION_PORT = Symbol('CHAT_REMOTE_SUPERVISION_PORT');
export const ARCHITECTURE_REMOTE_GRAPH_PORT = Symbol('ARCHITECTURE_REMOTE_GRAPH_PORT');

export interface RemoteSupervisionApproval {
  id: string; sessionId: string; toolName: string; args: Record<string, unknown>;
  requestedAt: number; revision: string; argsSha256: string;
}
export interface RemoteSupervisionSessionSummary {
  id: string; title: string; updatedAt: number; active: boolean; parentSessionId?: string;
}
export interface RemoteSupervisionSessionSnapshot {
  session: RemoteSupervisionSessionSummary;
  messages: Array<Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'turnId'>>;
  graph: { available: true; runId: string; projection: ArchitectureGraphProjection }
    | { available: false; reason: 'no_architecture_run' | 'projection_unavailable' };
}
export interface ChatRemoteSupervisionSession {
  session: RemoteSupervisionSessionSummary;
  messages: Array<Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt' | 'turnId'>>;
  architectureRunIds: string[];
}
export interface ChatRemoteSupervisionPort {
  snapshot(): Promise<{ sessions: RemoteSupervisionSessionSummary[]; approvals: RemoteSupervisionApproval[] }>;
  session(sessionId: string): Promise<ChatRemoteSupervisionSession | null>;
  decide(input: RemoteSupervisionDecision): Promise<RemoteSupervisionDecisionResult>;
}
export interface RemoteSupervisionSnapshot {
  instance: { id: string; name: string };
  sessions: RemoteSupervisionSessionSummary[];
  approvals: RemoteSupervisionApproval[];
}
export interface RemoteSupervisionDecision {
  approvalId: string; revision: string; argsSha256: string; decision: 'approve' | 'deny';
}
export interface RemoteSupervisionDecisionResult { status: 'settled' | 'stale' | 'rejected' }
export interface RemoteSupervisionPort {
  snapshot(): Promise<RemoteSupervisionSnapshot>;
  session(sessionId: string): Promise<RemoteSupervisionSessionSnapshot | null>;
  decide(input: RemoteSupervisionDecision): Promise<RemoteSupervisionDecisionResult>;
}
export interface ArchitectureRemoteGraphPort {
  getGraph(runId: string): Promise<ArchitectureGraphProjection | null>;
}
