import { Logger } from '@nestjs/common';
import type { CodexAppServerConnection, CodexServerNotification } from './codex-app-server.host';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const logger = new Logger('CodexImageTurn');

/** Events are scoped to one turn; notifications may precede turn/start's response. */
export async function runCodexImageTurn(connection: CodexAppServerConnection, threadId: string, prompt: string, abortSignal?: AbortSignal, timeoutMs = 180_000, imageUrls: string[] = []): Promise<string> {
  let turnId: string | undefined;
  let image: string | undefined;
  let settled = false;
  let succeeded = false;
  const early: CodexServerNotification[] = [];
  let resolveResult!: (value: string) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const fail = (message: string) => { if (!settled) { settled = true; rejectResult(new Error(message)); } };
  const interrupt = () => {
    if (turnId) void connection.request('turn/interrupt', { threadId, turnId }).catch(error => logger.warn(`Image turn interrupt failed: ${String(error)}`));
  };
  const handle = (notification: CodexServerNotification) => {
    const params = notification.params;
    if (!record(params) || params['threadId'] !== threadId || settled) return;
    if (!turnId) { early.push(notification); return; }
    const turn = record(params['turn']) ? params['turn'] : undefined;
    if ((params['turnId'] ?? turn?.['id']) !== turnId) return;
    if (notification.method === 'item/completed' && record(params['item'])) {
      const item = params['item'];
      if (item['type'] !== 'imageGeneration') return;
      if (item['failure'] || item['status'] !== 'completed') fail('ChatGPT image generation failed or is unavailable for this account.');
      else if (typeof item['result'] === 'string' && item['result']) image = item['result'];
    }
    if (notification.method === 'turn/completed') {
      if (turn?.['status'] !== 'completed' || turn['error']) {
        const error = record(turn?.['error']) ? turn['error']['message'] : undefined;
        fail(typeof error === 'string' ? error : 'ChatGPT image turn failed or was interrupted.');
      } else if (!image) fail('ChatGPT returned no generated image. Check the integration, model, and account image limits.');
      else { settled = true; succeeded = true; resolveResult(image); }
    }
    if (notification.method === 'error' && params['willRetry'] !== true) {
      const error = record(params['error']) ? params['error']['message'] : undefined;
      fail(typeof error === 'string' ? error : 'ChatGPT image generation failed.');
    }
  };
  const offNotification = connection.onNotification(handle);
  const offClosed = connection.onClosed?.(() => fail('ChatGPT integration disconnected during image generation.'));
  const offRequest = connection.onRequest(request => {
    if (!record(request.params) || request.params['threadId'] !== threadId) return;
    if (request.method === 'item/permissions/requestApproval') connection.respond(request.id, { permissions: {}, scope: 'turn' });
    else if (request.method.endsWith('/requestApproval')) connection.respond(request.id, { decision: 'decline' });
    else connection.respond(request.id, { success: false, contentItems: [{ type: 'inputText', text: 'Only native image generation is allowed.' }] });
  });
  const abort = () => fail('ChatGPT image generation cancelled.');
  abortSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => fail('ChatGPT image generation timed out.'), timeoutMs);
  try {
    if (abortSignal?.aborted) abort();
    if (!settled) {
      const start = connection.request('turn/start', {
        threadId, input: [{ type: 'text', text: prompt, text_elements: [] }, ...imageUrls.map(url => ({ type: 'image', url }))],
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' }, effort: 'low',
      }).then(response => {
        const turn = record(response) && record(response['turn']) ? response['turn'] : undefined;
        if (typeof turn?.['id'] !== 'string') throw new Error('ChatGPT returned no image turn id.');
        turnId = turn['id'];
        if (settled) interrupt();
        else { for (const event of early) handle(event); early.length = 0; }
      });
      await Promise.race([start, result]);
    }
    return await result;
  } finally {
    settled = true;
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', abort);
    offNotification(); offRequest(); offClosed?.();
    if (!succeeded) interrupt();
  }
}
