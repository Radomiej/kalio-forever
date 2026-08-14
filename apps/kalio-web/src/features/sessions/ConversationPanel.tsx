import type { ReactNode } from 'react';
import { SessionPanel } from './SessionPanel';

export function ConversationPanel({ onSelect, viewSwitcher }: { onSelect?: () => void; viewSwitcher?: ReactNode }) {
  void viewSwitcher;
  return <SessionPanel onSelect={onSelect} />;
}
