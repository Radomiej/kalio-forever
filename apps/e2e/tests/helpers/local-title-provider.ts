import { createServer } from 'node:http';
import { expect, type APIRequestContext } from '@playwright/test';
import { API_BASE } from './test-config';

/** Real HTTP adapter boundary, deterministic local response; never a live LLM. */
export async function createLocalTitleProvider(request: APIRequestContext) {
  if (!process.env['DATABASE_PATH']?.replaceAll('\\', '/').includes('playwright-stack/')) {
    throw new Error('Local title provider requires isolated Playwright storage');
  }
  const model = 'e2e-title-provider';
  const server = createServer((incoming, outgoing) => {
    if (incoming.url === '/v1/models') {
      outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ data: [{ id: model }] }));
      return;
    }
    if (incoming.url !== '/v1/chat/completions') {
      outgoing.writeHead(404).end();
      return;
    }
    let body = '';
    incoming.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    incoming.on('end', () => {
      let payload: { stream?: boolean };
      try { payload = JSON.parse(body) as { stream?: boolean }; }
      catch { outgoing.writeHead(400).end('Invalid JSON'); return; }
      if (payload.stream) {
        outgoing.setHeader('Content-Type', 'text/event-stream');
        outgoing.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' } }] })}\n\ndata: [DONE]\n\n`);
      } else {
        outgoing.setHeader('Content-Type', 'application/json');
        outgoing.end(JSON.stringify({ choices: [{ message: { content: 'Session Title Verification' } }] }));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local provider port');
  let credentialId: string | null = null;
  try {
    const response = await request.post(`${API_BASE}/credentials`, { data: {
      name: 'Local title fixture', provider: 'ollama', apiKey: 'local-fixture',
      model, baseUrl: `http://127.0.0.1:${address.port}/v1`,
    } });
    expect(response.ok()).toBeTruthy();
    credentialId = (await response.json() as { id: string }).id;
    const profile = await request.post(`${API_BASE}/runtime/profiles`, { data: {
      name: 'Local title fixture', kind: 'direct-llm', provider: 'ollama', model,
      authProfileId: credentialId,
    } });
    expect(profile.ok()).toBeTruthy();
  } catch (error) {
    if (credentialId) await request.delete(`${API_BASE}/credentials/${credentialId}`);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw error;
  }
  return { model, async close() {
    if (credentialId) await request.delete(`${API_BASE}/credentials/${credentialId}`);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } };
}
