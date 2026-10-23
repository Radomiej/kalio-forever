import { expect, type Page } from '@playwright/test';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';

export async function inspectCompletedPreviewTurn(page: Page, sessionId: string, turnId: string) {
  const api = 'http://127.0.0.1:3316/api';
  const response = await page.request.get(`${api}/sessions/${sessionId}/messages`);
  expect(response.ok()).toBe(true);
  const history = await response.json() as ChatMessage[];
  const prompt = history.find(m => m.role === 'user' && m.turnId === turnId);
  expect(prompt).toBeTruthy();
  await expect.poll(async () => {
    const auditResponse = await page.request.get(`${api}/audit-log?sessionId=${sessionId}&since=${prompt!.createdAt}&limit=2000&source=all`);
    expect(auditResponse.ok()).toBe(true);
    const audit = await auditResponse.json() as AuditLogEntry[];
    expect(audit.length).toBeLessThan(2000);
    return audit.filter(e => e.label === 'llm.turn.completed' && e.data?.['turnId'] === turnId).length;
  }, { timeout: 90000 }).toBe(1);
  const finalResponse = await page.request.get(`${api}/sessions/${sessionId}/messages`);
  expect(finalResponse.ok()).toBe(true);
  const messages = await finalResponse.json() as ChatMessage[];
  const results: Record<string, unknown>[] = messages.filter(m => m.role === 'tool_result' && m.turnId === turnId)
    .map(m => JSON.parse(m.content) as unknown)
    .filter((value): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value));
  const spawn = results.filter(r => r['command'] === 'npm run preview -- --host 127.0.0.1 --port 57868 --strictPort');
  expect(spawn).toHaveLength(1);
  const terminalId = spawn[0]!['id'];
  expect(typeof terminalId).toBe('string');
  expect(results.some(r => r['id'] === terminalId && r['status'] === 'running')).toBe(true);
  const turn = page.getByTestId('agent-turn-bubble').filter({ hasText: terminalId as string });
  await expect(turn).toHaveCount(1, { timeout: 30000 });
  const result = turn.locator('[data-testid="tool-call-bubble"][data-tool-name="terminal_output"]').last();
  await expect(result).toBeVisible();
  await expect(result.getByTestId('tool-execution-origin')).toHaveText('Kalio');
  await result.getByRole('button', { name: 'Toggle details', exact: true }).click();
  await expect(result).toContainText(terminalId as string);
  await expect(result).toContainText(/"status":\s*"running"/);
  return { turn, result, terminalId };
}
