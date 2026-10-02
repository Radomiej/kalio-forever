import { createServer } from 'node:http';
import { once } from 'node:events';

/** Real local HTTP mock of the typed Decisions protocol; no external/paid calls. */
export async function startDecisionFixture() {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/decide') { response.writeHead(404).end(); return; }
    let body = '';
    request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    request.on('end', () => {
      const payload = JSON.parse(body) as { questions: Record<string, { type: string; criteria?: Record<string, string> }> };
      requests += 1;
      const answers = Object.fromEntries(Object.entries(payload.questions).map(([id, question]) => [id,
        question.type === 'noul' ? { type: 'noul', noul: 0.97 } : { type: 'choice', choice: Object.keys(question.criteria ?? {})[0], confidence: 0.95 },
      ]));
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ model: 'local-decision-fixture', answers }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port.');
  return {
    endpoint: `http://127.0.0.1:${address.port}/decide`,
    get requestCount() { return requests; },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
