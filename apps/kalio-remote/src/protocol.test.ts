import { describe, expect, it } from 'vitest';
import { parseSnapshot, parseSession } from './protocol';

describe('remote payload projection parsing', () => {
  it('keeps display-safe session fields and ignores malformed entries', () => {
    const value = parseSnapshot({ instance: { id: 'i1', name: 'Host' }, sessions: [{ id: 's', title: 'Chat', active: true, providerSecret: 'discard' }, { title: 'invalid' }], approvals: [] });
    expect(value?.sessions).toEqual([{ id: 's', title: 'Chat', active: true }]);
    expect(JSON.stringify(value)).not.toContain('providerSecret');
  });
  it('does not invent graph nodes when projection is absent', () => {
    expect(parseSession({ sessionId: 's', messages: [], graph: { available: false, reason: 'no_architecture_run' } })).toBeNull();
  });
  it('validates graph data and messages with narrow fields', () => {
    const value = parseSession({ sessionId: 's', messages: [{ id: 'm', role: 'user', content: 'hello', providerDump: 'secret' }], graph: { nodes: [{ id: 'n', label: 'Run', type: 'agent' }], edges: [] } });
    expect(value?.graph.nodes).toHaveLength(1);
    expect(JSON.stringify(value)).not.toContain('providerDump');
  });
});
