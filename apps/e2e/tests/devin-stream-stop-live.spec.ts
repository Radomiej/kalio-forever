import { expect, test } from '@playwright/test';
import type { AuditLogEntry, ChatMessage } from '@kalio/types';
import { resolve } from 'node:path';
import { selectSession } from './helpers/test-config';

test.skip(process.env['KALIO_DEVIN_STREAM_QA91'] !== '1', 'Authorized real SWE-2 streaming cancellation only.');
test('real Devin visible generation can stop and a fresh read finishes after reload', async ({ page }) => {
  test.setTimeout(180000);
  const sessionId = 'W4fggLSunrJB41C24MV7C';
  const api = 'http://127.0.0.1:3316/api';
  const reportRun = process.env['KALIO_DEVIN_STREAM_REPORT_RUN'] ?? '91';
  if (!/^\d+$/.test(reportRun)) throw new Error('Report run must be numeric');
  const resultHeading = `QA${reportRun}_READ_RESULT`;
  const screenshot = (name: string) => resolve(__dirname, `../../../docs/raports/qa-run-${reportRun}/assets/${name}.png`);
  await page.goto('http://localhost:5288/');
  await page.getByTestId('nav-talk').click();
  await selectSession(page, sessionId, 'New Chat');
  await expect(page.getByText('Devin CLI · swe-2', { exact: true })).toBeVisible();
  const stop = page.getByRole('button', { name: 'Stop agent', exact: true });
  await expect(stop).toHaveCount(0);
  console.log((await page.locator('body').ariaSnapshot()).slice(-3500));
  await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
    'QA91_STREAM test zatrzymania odpowiedzi. Model dokładnie swe-2. Bez jakichkolwiek narzędzi, odczytów, terminala i zmian plików. ' +
    'Zacznij odpowiedź osobnym akapitem QA91_STREAM_BEGIN. Następnie wypisz po polsku 100 numerowanych wskazówek dla strony firmy IT, po 2 zdania każda. ' +
    'To kontrolowany test streamingu; użytkownik może przerwać generowanie przez Stop.'
  );
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  try {
    // The assistant marker proves actual content arrived, not just the pending placeholder.
    await expect(page.getByTestId('agent-turn-bubble').last()).toContainText('QA91_STREAM_BEGIN', { timeout: 90000 });
    await expect(stop).toBeVisible();
    await page.screenshot({ path: screenshot('visible-generation-before-stop') });
    await stop.click();
    await expect(stop).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: screenshot('generation-stopped') });
    await page.getByRole('textbox', { name: 'Chat message', exact: true }).fill(
      'QA91_READ_AFTER_STOP: nowa tura, dokładnie swe-2. Wykonaj jeden Kalio fs_read path E:/Projekty/home-site/package.json, ' +
      `bez innych i natywnych narzędzi, terminala i zmian plików. Nie kontynuuj listy. Zakończ nagłówkiem ## ${resultHeading} i nazwą projektu z pliku.`
    );
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByRole('heading', { name: resultHeading, exact: true }).last()).toBeVisible({ timeout: 90000 });
    await expect(stop).toHaveCount(0);
    await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: resultHeading, exact: true }).last()).toBeVisible();
    await expect(stop).toHaveCount(0);
    await expect(page.getByText('Kalio is responding.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: screenshot('fresh-read-after-f5') });
    const historyResponse = await page.request.get(`${api}/sessions/${sessionId}/messages`);
    expect(historyResponse.ok()).toBe(true);
    const history = await historyResponse.json() as ChatMessage[];
    const prompt = history.filter((message) => message.role === 'user' && message.content.startsWith('QA91_STREAM test')).at(-1)!;
    expect(prompt.turnId).toBeTruthy();
    const partial = history.find((message) => message.role === 'assistant' && message.turnId === prompt.turnId);
    expect(partial?.content).toContain('QA91_STREAM_BEGIN');
    await expect(page.getByTestId('agent-turn-bubble').filter({ hasText: 'QA91_STREAM_BEGIN' }).last()).toBeVisible();
    const auditResponse = await page.request.get(`${api}/audit-log?sessionId=${sessionId}&since=${prompt.createdAt}&limit=2000&source=all`);
    expect(auditResponse.ok()).toBe(true);
    const audit = await auditResponse.json() as AuditLogEntry[];
    expect(audit.length).toBeLessThan(2000);
    expect(audit.some((entry) => entry.label === 'llm.turn.cancelled' && entry.data?.['turnId'] === prompt.turnId)).toBe(true);
    expect(audit.filter((entry) => entry.label === 'process.cmd.invocation')).toHaveLength(0);
    console.log(JSON.stringify({ stoppedTurn: prompt.turnId, since: prompt.createdAt, auditRows: audit.length }));
  } finally {
    if (await stop.isVisible()) await stop.click();
  }
});
