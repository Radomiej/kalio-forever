import { Check, GitBranch, ShieldAlert, X } from 'lucide-react';
import type { Approval, SessionSnapshot } from '../protocol';

const labels: Record<string, string> = {
  terminal_spawn: 'Uruchomienie komendy',
  fs_write: 'Zapis pliku',
  fs_edit: 'Edycja pliku',
  fs_read: 'Odczyt pliku',
};

const fields: Record<string, string> = {
  command: 'Komenda', cwd: 'Katalog', args: 'Argumenty', path: 'Ścieżka', reason: 'Powód',
};

export function ReadableValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return value.length ? <ol>{value.map((item, index) => <li key={index}><ReadableValue value={item}/></li>)}</ol> : 'Brak';
  }
  if (value && typeof value === 'object') {
    return <dl>{Object.entries(value).map(([key, child]) =>
      <div key={key}><dt>{fields[key] ?? key}</dt><dd><ReadableValue value={child}/></dd></div>)}</dl>;
  }
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  return String(value ?? 'Brak');
}

export function ApprovalCard({ approval, disabled, pending, result, onDecide }: {
  approval: Approval; disabled: boolean; pending?: string; result?: string;
  onDecide: (choice: 'approve' | 'deny') => void;
}) {
  return <article className="approval-card">
    <div className="approval-head">
      <h2><ShieldAlert size={17}/> {labels[approval.toolName] ?? approval.toolName}</h2>
      <span className="pending-pill">{result ?? (pending ? 'Wysyłanie…' : 'Oczekuje')}</span>
    </div>
    <div className="args-box"><ReadableValue value={approval.args}/></div>
    <details className="approval-meta"><summary>Szczegóły techniczne</summary>
      <ReadableValue value={{ Narzędzie: approval.toolName, Sesja: approval.sessionId, Wersja: approval.revision,
        'SHA-256': approval.argsSha256, ...(approval.requestedAt ? { Wysłano: new Date(approval.requestedAt).toLocaleString() } : {}) }}/>
    </details>
    <div className="decision-actions">
      <button className="deny-button" disabled={disabled} onClick={() => onDecide('deny')}><X size={16}/> Odrzuć</button>
      <button className="approve-button" disabled={disabled} onClick={() => onDecide('approve')}><Check size={16}/> Zatwierdź</button>
    </div>
    {disabled && !pending && !result && <small className="disabled-reason">Wymaga aktywnego połączenia i aktualnych danych.</small>}
  </article>;
}

const statusLabels: Record<string, string> = {
  running: 'W toku', waiting: 'Oczekuje', waiting_on_orchestrator: 'Oczekuje na decyzję', pending: 'Oczekuje',
  done: 'Gotowe', completed: 'Gotowe', success: 'Gotowe', failed: 'Błąd', cancelled: 'Anulowano', skipped: 'Pominięto',
};

export function GraphPanel({ session, error }: { session: SessionSnapshot | null; error?: string }) {
  const graph = session?.graph;
  if (!graph?.available || !graph.nodes.length) return <p className="detail-empty">
    {error ?? (!session ? 'Wczytywanie grafu…' : graph?.reason === 'no_architecture_run' ? 'Ta sesja nie ma grafu wykonania.' : 'Graf wykonania jest niedostępny.')}
  </p>;
  const labelsById = new Map(graph.nodes.map(node => [node.id, node.label]));
  return <section className="graph-panel">
    <div className="graph-heading"><GitBranch size={18}/><strong>Graf wykonania</strong></div>
    <ol className="remote-graph-steps">{graph.nodes.map((node, index) => {
      const next = graph.edges.filter(edge => edge.source === node.id && labelsById.has(edge.target));
      return <li key={node.id}>
        <span className="node-dot">{index + 1}</span>
        <div><strong>{node.label}</strong><small>{node.status ? statusLabels[node.status] ?? node.status : 'Stan nieznany'}</small>
          {!!next.length && <ul>{next.map(edge => <li key={edge.id}>→ {labelsById.get(edge.target)}{edge.type !== 'flow' && <small> · {edge.type}</small>}</li>)}</ul>}
        </div>
      </li>;
    })}</ol>
  </section>;
}
