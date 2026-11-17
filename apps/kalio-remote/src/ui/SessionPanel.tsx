import { GitBranch } from 'lucide-react';
import type { Message, SessionSnapshot } from '../protocol';
import { ReadableValue } from './RunDetails';

function MessageContent({ message }: { message: Message }) {
  if (message.role === 'tool_result') {
    try {
      const result: unknown = JSON.parse(message.content);
      return <ReadableValue value={result}/>;
    } catch {
      return <p>{message.content}</p>;
    }
  }
  return <p>{message.content}</p>;
}

export function SessionPanel({ session, onGraph }: { session: SessionSnapshot | null; onGraph: () => void }) {
  return <section className="detail-panel">
    <div className="panel-title"><h2>{session?.title ?? 'Wczytywanie sesji…'}</h2>
      {session && <button className="subtle-button" onClick={onGraph}><GitBranch size={15}/> Graf</button>}
    </div>
    {!session ? <div className="detail-empty">Wybierz sesję, aby zobaczyć wiadomości i postęp.</div> :
      <div className="messages">{session.messages.map(message => <article key={message.id}
        className={'message ' + (message.role === 'user' ? 'from-user' : '')}>
        <span className="message-role">{message.role === 'user' ? 'TY' : message.role === 'tool_result' ? 'WYNIK NARZĘDZIA' : 'KALIO'}</span>
        <MessageContent message={message}/>
        {message.createdAt && <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
      </article>)}</div>}
  </section>;
}
