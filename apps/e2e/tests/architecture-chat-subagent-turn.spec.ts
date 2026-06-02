import { expect, test } from '@playwright/test';
import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';

test.describe('Architecture chat turn projection', () => {
  test('renders a sequential router chain without collapsing it into a parallel council', async ({ page, request }) => {
    test.setTimeout(120_000);
    const title = `Architecture Sequential E2E ${Date.now()}`;
    const schemaName = `Sequential Router Chain ${Date.now()}`;
    const variantResponse = await request.post(`${API_BASE}/architecture-registry/schemas/strategic-decision-council/variants`, {
      data: {
        name: schemaName,
        description: 'E2E sequential router chain variant.',
        nodes: [
          {
            id: 'router-entry',
            label: 'Router Entry',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'choose_one',
              fanOut: 'sequential',
              convergeToNodeId: 'pragmatist',
            },
          },
          { id: 'pragmatist', label: 'Pragmatist', kind: 'role', roleSlotId: 'pragmatist' },
          {
            id: 'router-check',
            label: 'Router Check',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'choose_one',
              fanOut: 'sequential',
              convergeToNodeId: 'innovator',
            },
          },
          { id: 'innovator', label: 'Innovator', kind: 'role', roleSlotId: 'innovator' },
          {
            id: 'router-final',
            label: 'Router Final',
            kind: 'router',
            roleSlotId: 'router',
            behavior: {
              mode: 'rank_then_merge',
              fanOut: 'sequential',
              convergeToNodeId: 'final-artifact',
            },
          },
          {
            id: 'final-artifact',
            label: 'Final Artifact',
            kind: 'artifact',
            roleSlotId: 'finalizer',
            behavior: { mode: 'finalize' },
          },
        ],
        edges: [
          { id: 'router-entry-pragmatist', fromNodeId: 'router-entry', toNodeId: 'pragmatist' },
          { id: 'pragmatist-router-check', fromNodeId: 'pragmatist', toNodeId: 'router-check' },
          { id: 'router-check-innovator', fromNodeId: 'router-check', toNodeId: 'innovator' },
          { id: 'innovator-router-final', fromNodeId: 'innovator', toNodeId: 'router-final' },
          { id: 'router-final-final-artifact', fromNodeId: 'router-final', toNodeId: 'final-artifact' },
        ],
        contextPolicy: {
          includeUserTask: true,
          includeProjectMemory: false,
          includeBrowserSession: false,
          includePriorDecisions: false,
          includeOtherAgentOutputs: true,
        },
      },
    });
    expect(variantResponse.ok()).toBeTruthy();
    const variant = await variantResponse.json() as { id: string };

    const response = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(response.ok()).toBeTruthy();
    const session = await response.json() as { id: string };

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await page.getByTestId('chat-architecture-select').selectOption(variant.id);
      await page.getByTestId('chat-input').fill('Route this through the sequential chain.');
      await page.getByTestId('chat-send-btn').click();

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 90_000 });
      const subagentCalls = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_subagent"]');
      await expect(subagentCalls).toHaveCount(2, { timeout: 90_000 });
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible();
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer', { timeout: 90_000 });
      await expect(page.getByTestId('architecture-route-parallel-agents')).toHaveCount(0);
      await expect(page.getByTestId('architecture-route-agent')).toHaveCount(2);
      await expect(page.getByTestId('architecture-route-router')).toHaveCount(3);
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-routing')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer');
      await expect(page.getByTestId('architecture-run-sequential-parallel-stage')).toHaveCount(0);
      await expect(page.getByTestId('architecture-run-sequential-step')).toHaveCount(6);

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);
      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 30_000 });
      await expect(subagentCalls).toHaveCount(2, { timeout: 30_000 });
      await expect(page.getByTestId('architecture-route-parallel-agents')).toHaveCount(0);
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router -> Pragmatist -> Router -> Innovator -> Router -> Finalizer');
    } finally {
      await deleteSessionIfExists(request, session.id);
      await request.delete(`${API_BASE}/architecture-registry/schemas/${variant.id}`, { timeout: 5000 }).catch(() => undefined);
    }
  });

  test('renders council branches as sub-agent chips and restores them after reload', async ({ page, request }) => {
    test.setTimeout(120_000);
    const title = `Architecture E2E ${Date.now()}`;
    const response = await request.post(`${API_BASE}/sessions`, {
      data: { title, personaId: 'default' },
    });
    expect(response.ok()).toBeTruthy();
    const session = await response.json() as { id: string };

    try {
      await page.goto('/');
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await page.getByTestId('chat-architecture-select').selectOption('strategic-decision-council');
      await page.getByTestId('chat-input').fill('What can you do?');
      await page.getByTestId('chat-send-btn').click();

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 90_000 });
      const subagentCalls = page.locator('[data-testid="tool-call-bubble"][data-tool-name="run_subagent"]');
      await expect(subagentCalls).toHaveCount(5, { timeout: 90_000 });
      await expect(page.getByTestId('tool-call-chip')).toHaveText([
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
      ]);
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router', { timeout: 90_000 });
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Finalizer', { timeout: 90_000 });
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible();
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Pragmatist');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Stream: completed /');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Incoming graph outputs:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Available next nodes:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Act as a graph router.');

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('canvas-panel')).toHaveClass(/w-72/);
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-branches')).toContainText('Pragmatist');
      await expect(page.getByTestId('architecture-run-routing')).toContainText('Router');

      const firstTimelineBranch = page.getByTestId('architecture-route-agent').first();
      const timelineChildSessionId = await firstTimelineBranch.getAttribute('data-session-id');
      if (!timelineChildSessionId) throw new Error('Missing child session id on inline architecture timeline branch');
      await firstTimelineBranch.click();
      await expect(page.getByTestId('canvas-focus-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('canvas-focus-section')).toContainText(timelineChildSessionId);
      await expect(page.getByTestId('canvas-focus-section')).toContainText('Architecture: Strategic Decision Council v0.1.0', { timeout: 10_000 });
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
        .toBe(session.id);
      await page.getByTestId(`canvas-focus-open-session-${timelineChildSessionId}`).click();
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
        .toBe(timelineChildSessionId);
      await expect(page.getByTestId('message-list')).toContainText('Architecture: Strategic Decision Council v0.1.0');
      await selectSession(page, session.id, title);

      await page.getByTestId('open-subagent-canvas').first().click();
      await expect(page.getByTestId('canvas-panel')).toHaveClass(/w-72/);
      await expect(page.getByTestId('canvas-subagents-section')).toBeVisible({ timeout: 10_000 });
      const firstCanvasSubagent = page.locator('[data-testid^="canvas-open-subagent-"]').first();
      const childSessionId = await firstCanvasSubagent.getAttribute('data-session-id');
      if (!childSessionId) throw new Error('Missing child session id on architecture canvas sub-agent opener');
      await firstCanvasSubagent.click();
      await expect
        .poll(() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')), { timeout: 10_000 })
        .toBe(childSessionId);
      await expect(page.getByTestId('message-list')).toContainText('Architecture: Strategic Decision Council v0.1.0');
      await expect(page.getByTestId('message-list')).toContainText('Return a concise role-specific contribution');
      await selectSession(page, session.id, title);

      await page.reload();
      await page.getByTestId('nav-talk').click();
      await selectSession(page, session.id, title);

      await expect(page.getByTestId('agent-turn-bubble')).toHaveCount(1, { timeout: 30_000 });
      await expect(subagentCalls).toHaveCount(5, { timeout: 30_000 });
      await expect(page.getByTestId('tool-call-chip')).toHaveText([
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
        /run_subagent/,
      ]);
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Router');
      await expect(page.getByTestId('agent-turn-bubble')).toContainText('Finalizer');
      await expect(page.getByTestId('architecture-run-timeline')).toBeVisible();
      await expect(page.getByTestId('architecture-route-parallel-agents')).toContainText('Pragmatist');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Execution trace:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Stream: completed /');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Incoming graph outputs:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Available next nodes:');
      await expect(page.getByTestId('agent-turn-bubble')).not.toContainText('Act as a graph router.');

      await page.getByTestId('open-architecture-run-canvas').click();
      await expect(page.getByTestId('architecture-run-canvas-section')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('architecture-run-branches')).toContainText('Pragmatist');

      await page.getByTestId('open-subagent-canvas').first().click();
      await expect(page.getByTestId('canvas-panel')).toHaveClass(/w-72/);
      await expect(page.getByTestId('canvas-subagents-section')).toBeVisible({ timeout: 10_000 });
      const reloadedChildSessionId = await page.locator('[data-testid^="canvas-open-subagent-"]').first().getAttribute('data-session-id');
      if (!reloadedChildSessionId) throw new Error('Missing child session id on restored architecture canvas sub-agent opener');
    } finally {
      await deleteSessionIfExists(request, session.id);
    }
  });
});
