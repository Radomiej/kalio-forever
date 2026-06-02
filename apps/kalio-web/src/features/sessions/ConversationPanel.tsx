import type { ReactNode } from 'react';
import { SessionPanel } from './SessionPanel';

export function ConversationPanel({ onSelect, viewSwitcher }: { onSelect?: () => void; viewSwitcher?: ReactNode }) {
  return <SessionPanel onSelect={onSelect} viewSwitcher={viewSwitcher} />;
}
