import { expect, test } from '@playwright/test';
import type { ArchitectureRun, ChatSession, VFSListResult, VFSReadResult } from '@kalio/types';
import { activeSessionAfterSubmit, installMockLaunchProfile, selectMockLaunchProfile } from './helpers/mock-launch-profile';
import { API_BASE, deleteSessionIfExists, selectArchitectureInComposer, sendMessageFromComposer } from './helpers/test-config';
import { hitlFixtureRequest } from './helpers/hitl-fixture-auth';

for (const decision of ['approve', 'stop'] as const) {
test(`REST architecture child approval ${decision} clears Home live without F5`, async ({ page, request }) => {
  test.setTimeout(60_000);
  let hostId: string | null = null;
  let releaseLaunch = () => {};
  const launchBarrier = new Promise<void>(resolve => { releaseLaunch = resolve; });
  const before = await (await hitlFixtureRequest(request, 'GET')).json();
  await hitlFixtureRequest(request, 'PUT', { mode: 'manual' });
  await installMockLaunchProfile(page, request);
  await page.route('**/api/architecture-runs/async', async route => {
    await launchBarrier;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('nav-talk').click();
    await page.getByTestId('new-session-btn').click();
    await selectMockLaunchProfile(page);
    await selectArchitectureInComposer(page, 'coding_review');
    await sendMessageFromComposer(page, '[[mock:architecture:evidence]] [[mock:tool:run_subagent:hitl]] Exercise the isolated child approval through the release judge.');
    hostId = await activeSessionAfterSubmit(page);
    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-hitl-empty')).toBeVisible();
    // Home is already mounted when the server starts; mount-time replay cannot supply this approval.
    releaseLaunch();
    const approval = page.locator('[data-testid^="home-hitl-approve-"]');
    await expect(approval).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId('home-hitl-inbox')).toContainText('vfs_write');
    const rootsResponse = await request.get(`${API_BASE}/sessions/${hostId}/children`);
    expect(rootsResponse.ok()).toBe(true);
    const roots = await rootsResponse.json() as { runtimeContext?: { architectureContext?: { architectureRunId?: string } } }[];
    const runId = roots[0]?.runtimeContext?.architectureContext?.architectureRunId;
    expect(runId).toBeTruthy();
    const runBefore = await (await request.get(`${API_BASE}/architecture-runs/${runId}`)).json() as ArchitectureRun;
    const guardId = runBefore.branchSessionIds?.release_guard;
    if (!guardId) throw new Error('Missing release judge session');
    const nested = await (await request.get(`${API_BASE}/sessions/${guardId}/children`)).json() as ChatSession[];
    expect(nested).toHaveLength(1);
    const nestedChild = nested[0];
    if (!nestedChild) throw new Error('Missing approval child');
    const owner = await (await request.get(`${API_BASE}/sessions/${hostId}`)).json() as ChatSession;
    expect(nestedChild.projectId).toBe(owner.projectId);
    expect(nestedChild.executionProfileId).toBe(owner.executionProfileId);
    if (decision === 'approve') {
      await approval.click();
    } else {
      await page.getByTestId('nav-talk').click();
      await page.getByTestId('chat-stop-btn').click();
      await page.getByTestId('nav-home').click();
    }
    await expect(approval).toHaveCount(0);
    await expect.poll(async () => {
      const runResponse = await request.get(`${API_BASE}/architecture-runs/${runId}`);
      return (await runResponse.json() as { status: string }).status;
    }, { timeout: 20_000 }).toBe(decision === 'approve' ? 'completed' : 'cancelled');
    const filesResponse = await request.get(`${API_BASE}/sessions/${guardId}/vfs`);
    expect(filesResponse.ok()).toBe(true);
    const files = await filesResponse.json() as VFSListResult;
    expect(files.files.filter(file => file.path === 'e2e/mock-tool-trigger.txt')).toHaveLength(decision === 'approve' ? 1 : 0);
    if (decision === 'approve') {
      const contentResponse = await request.get(`${API_BASE}/sessions/${guardId}/vfs/read?path=e2e%2Fmock-tool-trigger.txt`);
      expect(contentResponse.ok()).toBe(true);
      expect((await contentResponse.json() as VFSReadResult).content).toBe('mock-trigger-confirmation');
      const results = await request.get(`${API_BASE}/audit-log?sessionId=${nestedChild.id}&type=tool_result&label=vfs_write&limit=10`);
      expect(results.ok()).toBe(true);
      expect(await results.json()).toHaveLength(1);
    }
  } finally {
    releaseLaunch();
    if (hostId) await deleteSessionIfExists(request, hostId);
    await hitlFixtureRequest(request, 'PUT', before);
  }
});
}
