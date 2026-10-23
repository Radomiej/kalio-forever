import type { ChatMessage, ChatSession, CreateSessionDto } from '@kalio/types';
import { apiClient } from '../../services/apiClient';
import { activateConversationSession } from '../chat/activeConversationSession';
import type { AgentTurn } from '../../store/sessionStore';

export function resolveRAAppExecutionProfile(explicitId: string, session?: ChatSession): string {
  const id = explicitId.trim() || session?.executionProfileId;
  if (!id) throw new Error('Select an execution profile or open a Kalio conversation with a configured profile first.');
  return id;
}

export async function createRAAppHostSession(dto: CreateSessionDto, deps: {
  addSession: (session: ChatSession) => void;
  setActiveSession: (id: string | null) => void;
  setMessages: (messages: ChatMessage[], sessionId?: string | null) => void;
  setAgentTurns: (turns: AgentTurn[], sessionId?: string | null) => void;
}): Promise<ChatSession> {
  const { data: session } = await apiClient.post<ChatSession>('/api/sessions', dto);
  deps.addSession(session);
  deps.setMessages([], session.id);
  deps.setAgentTurns([], session.id);
  await activateConversationSession({ sessionId: session.id, sessions: [session],
    setActiveSession: deps.setActiveSession, reason: 'app-open' });
  return session;
}

export function prepareRAAppLaunchInputs(id: string, inputs?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (id !== 'qa-interactive' || !inputs) return inputs;
  const validText = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;
  return validText(inputs.question) && Array.isArray(inputs.options)
    && inputs.options.length > 0 && inputs.options.length <= 5 && inputs.options.every(validText) ? inputs : undefined;
}

export function buildRAAppRunPrompt(id: string, name: string, description?: string, inputs?: Record<string, unknown>): string {
  const instruction = inputs ? ` Use these JSON inputs: ${JSON.stringify(inputs)}.` : '';
  const qaInstruction = id === 'qa-interactive'
    ? ' Before calling run_raapp, prepare a non-empty question and 1–5 non-empty string options. Generate missing values using this conversation runtime. Pass them in inputs; never launch an empty Q&A or report it completed.'
    : '';
  return `Run the "${name}" RA-App for me.${description ? ` ${description}` : ''}${instruction}${qaInstruction} Launch it immediately.`;
}
