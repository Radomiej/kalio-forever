export async function restartPlaywrightBackend(): Promise<void> {
  const port = process.env.KALIO_PLAYWRIGHT_CONTROL_PORT;
  const token = process.env.KALIO_PLAYWRIGHT_CONTROL_TOKEN;
  if (!port || !token) {
    throw new Error('Restart E2E requires run-playwright-with-stack.mjs control-plane environment.');
  }

  const response = await fetch(`http://127.0.0.1:${port}/restart-backend`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await response.json() as { status?: string };
  if (response.status !== 200 || payload.status !== 'ready') {
    throw new Error(`Backend restart failed with status ${response.status}: ${JSON.stringify(payload)}`);
  }
}
