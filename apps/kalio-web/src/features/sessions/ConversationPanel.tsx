import { SessionPanel } from './SessionPanel';

export function ConversationPanel({ onSelect }: { onSelect?: () => void }) {
  return <SessionPanel onSelect={onSelect} />;
}
