import { SessionPanel } from './SessionPanel';

export function ConversationPanel({ onSelect }: { onSelect?: () => void }) {
  onSelect?.();
  return <SessionPanel />;
}
