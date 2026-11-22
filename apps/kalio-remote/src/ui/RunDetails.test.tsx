import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Approval, SessionSnapshot } from '../protocol';
import { ApprovalCard, GraphPanel } from './RunDetails';
import { SessionPanel } from './SessionPanel';

describe('Remote run details', () => {
  it.each(['Nie udało się wczytać sesji: projection_failed', 'Instancja niedostępna.'])(
    'preserves the current session error in conversation and graph details: %s', error => {
      const sessionHtml = renderToStaticMarkup(<SessionPanel session={null} error={error} onGraph={vi.fn()}/>);
      const graphHtml = renderToStaticMarkup(<GraphPanel session={null} error={error}/>);
      expect(sessionHtml).toContain('Sesja niedostępna');
      expect(sessionHtml).toContain(error);
      expect(sessionHtml).not.toContain('Wczytywanie sesji');
      expect(graphHtml).toContain(error);
      expect(graphHtml).not.toContain('Wczytywanie grafu');
    },
  );

  it('keeps a sent approval pending until the host acknowledges its outcome', () => {
    const approval: Approval = {
      id: 'approval', sessionId: 'session', toolName: 'fs_write', args: {},
      revision: '1', argsSha256: 'digest',
    };
    const html = renderToStaticMarkup(<ApprovalCard approval={approval} disabled pending="request" onDecide={vi.fn()}/>);
    expect(html).toContain('Wysyłanie…');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain('Rozstrzygnięto');
    const settled = renderToStaticMarkup(<ApprovalCard approval={approval} disabled result="Rozstrzygnięto" onDecide={vi.fn()}/>);
    expect(settled).toContain('Rozstrzygnięto');
    expect(settled).not.toContain('Wysyłanie…');
  });

  it('renders approval arguments as fields and keeps technical identifiers in details', () => {
    const approval: Approval = {
      id: 'approval', sessionId: 'session', toolName: 'terminal_spawn',
      args: { command: 'npm.cmd', args: ['run', 'test'], reason: 'Local verification' },
      revision: '1', argsSha256: 'digest',
    };
    const html = renderToStaticMarkup(<ApprovalCard approval={approval} disabled onDecide={vi.fn()}/>);
    expect(html).toContain('Uruchomienie komendy');
    expect(html).toContain('<dt>Komenda</dt><dd>npm.cmd</dd>');
    expect(html).toContain('<ol><li>run</li><li>test</li></ol>');
    expect(html).toContain('<summary>Szczegóły techniczne</summary>');
    expect(html).not.toContain('<pre>');
  });

  it('keeps complete step names, localizes statuses and identifies outgoing transitions', () => {
    const graph: SessionSnapshot['graph'] = {
      available: true,
      nodes: [
        { id: 'qa', label: 'Independent visual quality assurance', type: 'role', status: 'running' },
        { id: 'build', label: 'Verify demo build', type: 'role', status: 'pending' },
      ],
      edges: [{ id: 'e1', source: 'qa', target: 'build', type: 'success' }],
    };
    const html = renderToStaticMarkup(<GraphPanel session={{
      sessionId: 'session', title: 'Imperium', active: true, messages: [], graph,
    }}/>);
    expect(html).toContain('Independent visual quality assurance');
    expect(html).toContain('<small>W toku</small>');
    expect(html).toContain('→ Verify demo build');
  });

  it('formats JSON tool results and preserves ordinary user messages', () => {
    const html = renderToStaticMarkup(<SessionPanel onGraph={vi.fn()} session={{
      sessionId: 'session', title: 'Imperium', active: true,
      graph: { available: false, nodes: [], edges: [] },
      messages: [
        { id: 'user', role: 'user', content: 'Run the tests' },
        { id: 'result', role: 'tool_result', content: '{"exitCode":0,"output":"127 passed"}' },
      ],
    }}/>);
    expect(html).toContain('Run the tests');
    expect(html).toContain('<dt>exitCode</dt><dd>0</dd>');
    expect(html).toContain('<dt>output</dt><dd>127 passed</dd>');
  });

  it('distinguishes tool calls from replies and preserves multiline text results', () => {
    const html = renderToStaticMarkup(<SessionPanel onGraph={vi.fn()} session={{
      sessionId: 'session', title: 'Imperium', active: true,
      graph: { available: false, nodes: [], edges: [] },
      messages: [
        { id: 'call', role: 'tool_call', content: '{"path":"src/qa.ts"}' },
        { id: 'result', role: 'tool_result', content: 'first line\n<script>second line</script>' },
      ],
    }}/>);
    expect(html.match(/class="message tool-message"/g)).toHaveLength(2);
    expect(html).toContain('Wywołanie narzędzia');
    expect(html).toContain('<dt>Ścieżka</dt><dd>src/qa.ts</dd>');
    expect(html).toContain('first line\n&lt;script&gt;second line&lt;/script&gt;');
  });
});
