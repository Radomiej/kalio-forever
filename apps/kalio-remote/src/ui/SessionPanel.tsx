import { GitBranch, Wrench } from 'lucide-react';
import type { Message, SessionSnapshot } from '../protocol';
import { ReadableValue } from './RunDetails';

function MessageContent({ message }: { message: Message }) {
  if (message.role === 'tool_result' || message.role === 'tool_call') {
    try {
      const result: unknown = JSON.parse(message.content);
      return <ReadableValue value={result}/>;
    } catch {
      return <p>{message.content}</p>;
    }
  }
  return <p>{message.content}</p>;
}

export function SessionPanel({ session, error, onGraph }: { session: SessionSnapshot | null; error?: string; onGraph: () => void }) {
  return <section className="detail-panel">
    <div className="panel-title"><h2>{session?.title ?? (error ? 'Sesja niedostępna' : 'Wczytywanie sesji…')}</h2>
      {session && <button className="subtle-button" onClick={onGraph}><GitBranch size={15}/> Graf</button>}
    </div>
    {!session ? <div className="detail-empty">{error ?? 'Czekam na dane sesji.'}</div> :
      <div className="messages">{session.messages.map(message => {
        const isTool = message.role === 'tool_call' || message.role === 'tool_result';
        return <article key={message.id}
        className={'message ' + (isTool ? 'tool-message' : message.role === 'user' ? 'from-user' : '')}>
        <span className="message-role">{isTool && <Wrench size={13}/>}
          {message.role === 'user' ? 'Ty' : message.role === 'tool_result' ? 'Wynik narzędzia' : message.role === 'tool_call' ? 'Wywołanie narzędzia' : 'Kalio'}
        </span>
        <MessageContent message={message}/>
        {message.createdAt && <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
      </article>;
      })}</div>}
  </section>;
}
