export function ConversationManagerPanel({ onNavigate }: { onNavigate?: () => void }) {
  onNavigate?.();
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Active Agents</h2>
      <p className="text-sm text-base-content/60">Active agents management coming soon.</p>
    </div>
  );
}
