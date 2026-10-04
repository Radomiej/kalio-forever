# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: regression-full-tool-arguments.spec.ts >> long confirmation payload remains fully reviewable on mobile and tablet after reload
- Location: tests\regression-full-tool-arguments.spec.ts:5:5

# Error details

```
Error: expect(locator).not.toContainText(expected) failed

Locator: getByTestId('args-preview')
Expected substring: not "REVIEW END"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "not toContainText" with timeout 5000ms
  - waiting for getByTestId('args-preview')

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - navigation [ref=e5]:
    - button "Home" [ref=e6] [cursor=pointer]:
      - generic [ref=e7]: K
    - button "Talk" [ref=e10] [cursor=pointer]:
      - text: Talk
      - img [ref=e11]
    - button "Tools" [ref=e14] [cursor=pointer]:
      - text: Tools
      - img [ref=e15]
    - button "Mind" [ref=e18] [cursor=pointer]:
      - text: Mind
      - img [ref=e19]
    - button "Architect" [ref=e32] [cursor=pointer]:
      - text: Architect
      - img [ref=e33]
    - button "Observability" [ref=e39] [cursor=pointer]:
      - text: Observability
      - img [ref=e40]
    - button "Settings" [ref=e43] [cursor=pointer]:
      - text: Settings
      - img [ref=e44]
  - main [ref=e47]:
    - generic [ref=e48]:
      - button "Show conversations" [ref=e51] [cursor=pointer]:
        - img [ref=e52]
      - generic [ref=e59]:
        - generic [ref=e60]:
          - generic [ref=e62]: Full arguments fixture 1791119310620
          - group "Widok konwersacji" [ref=e63]:
            - button "Chat" [pressed] [ref=e64]:
              - img [ref=e65]
              - generic [ref=e67]: Chat
            - button "Graf" [ref=e68]:
              - img [ref=e69]
              - generic [ref=e73]: Graf
          - button "Files empty" [ref=e74]:
            - img [ref=e75]
            - generic [ref=e77]: Files
            - generic [ref=e78]: empty
          - button "Copy chat to clipboard" [ref=e79] [cursor=pointer]:
            - img [ref=e80]
          - button "~514/32k" [ref=e84] [cursor=pointer]
          - generic "Local LLM" [ref=e85]
        - generic [ref=e87]:
          - generic [ref=e90]: Review this fixture without executing it.
          - generic [ref=e92]:
            - paragraph [ref=e93]: Kalio
            - generic [ref=e94]:
              - paragraph [ref=e98]: Waiting for review of the full file contents.
              - generic [ref=e99]:
                - generic [ref=e100]:
                  - img [ref=e101]
                  - generic [ref=e103]: fs_write
                  - generic "Handled by Kalio's tool dispatcher, not the provider's native tool runtime." [ref=e104]: Kalio
                  - generic "fixture-only.css" [ref=e105]
                  - generic [ref=e106]: awaiting confirmation
                  - button "Toggle args" [ref=e107]:
                    - img [ref=e108]
                - generic [ref=e110]: Preparing fs_write…
                - region "Full tool arguments" [ref=e112]:
                  - generic [ref=e113]:
                    - generic [ref=e114]: "path:"
                    - text: fixture-only.css
                  - generic [ref=e115]:
                    - generic [ref=e116]: "content:"
                    - text: /* REVIEW START */ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx /* REVIEW END */
                - generic [ref=e117]:
                  - button "Confirm" [ref=e118] [cursor=pointer]
                  - button "Cancel" [ref=e119] [cursor=pointer]
          - generic [ref=e121]:
            - generic [ref=e123]: waiting for approval
            - paragraph [ref=e124]: Kalio is waiting for your approval to use fs_write.
        - generic [ref=e127]:
          - combobox "Architecture runtime" [ref=e128]:
            - option "Single Chat" [selected]
            - option "Strategic Decision Council"
            - option "Five Minds Council"
            - option "Five Minds Strategic"
            - option "Goal Master Delivery Loop"
            - option "Deep Five Minds"
            - option "Architecture Debate"
            - option "Coding Review"
            - option "Deep Research"
            - option "Release Guard"
            - 'option "Lab: Solo + Walidator"'
            - 'option "Lab: Szybka Naprawa"'
            - 'option "Lab: Recon Squad"'
            - 'option "Lab: Classic Trio"'
            - 'option "Lab: Reflective Loop"'
            - 'option "Lab: Bug Hunter"'
            - 'option "Lab: Content Pipeline"'
            - 'option "Lab: Plan & Execute"'
            - 'option "Lab: Performance Boost"'
            - 'option "Lab: Startup MVP"'
            - 'option "Lab: Cascade Cost"'
            - 'option "Lab: Testing Suite"'
            - 'option "Lab: Accessibility Sprint"'
            - 'option "Lab: A/B Test Lab"'
            - 'option "Lab: Tech Writing Pipeline"'
            - 'option "Lab: Performance Squad"'
            - 'option "Lab: Security Hardening"'
            - 'option "Lab: Code Review"'
            - 'option "Lab: Design System"'
            - 'option "Lab: API Modernization"'
            - 'option "Lab: UI/UX Overhaul"'
            - 'option "Lab: Feature Sprint"'
            - 'option "Lab: Standard Dev"'
            - 'option "Lab: Data Pipeline"'
            - 'option "Lab: Research Swarm"'
            - 'option "Lab: Legacy Refactor"'
            - 'option "Lab: Full-Stack SaaS"'
            - 'option "Lab: Deep Research Swarm Pro"'
            - 'option "Lab: Migration Crew"'
            - 'option "Lab: Full-Stack Premium"'
            - 'option "Lab: Multi-Vector Security"'
            - 'option "Lab: PRD to Launch"'
            - 'option "Lab: KB Constructor"'
            - 'option "Lab: SOC2 Sweep"'
            - 'option "Lab: Data Analysis Pipeline"'
            - 'option "Lab: Incident War Room"'
            - 'option "Lab: Microservices"'
            - 'option "Lab: Full Hierarchy"'
            - 'option "Lab: Deep Research+Build"'
            - 'option "Lab: Five Minds Protocol"'
            - 'option "Lab: Deep Five Minds"'
            - 'option "Lab: Five Minds Strategic"'
          - textbox "Chat message" [ref=e129]:
            - /placeholder: Ask Kalio…
          - button "Stop agent" [ref=e130] [cursor=pointer]:
            - img [ref=e131]
          - button "Send message" [disabled]:
            - img
```

# Test source

```ts
  1  | import { expect, test } from '@playwright/test';
  2  | import { resolve } from 'node:path';
  3  | import { API_BASE, deleteSessionIfExists, selectSession } from './helpers/test-config';
  4  | 
  5  | test('long confirmation payload remains fully reviewable on mobile and tablet after reload', async ({ page, request }) => {
  6  |   const suffix = Date.now();
  7  |   const title = `Full arguments fixture ${suffix}`;
  8  |   const response = await request.post(`${API_BASE}/sessions`, {
  9  |     data: { personaId: 'default', title },
  10 |   });
  11 |   expect(response.ok()).toBeTruthy();
  12 |   const session = await response.json() as { id: string };
  13 |   const requestId = `full-args-request-${suffix}`;
  14 |   const payload = '/* REVIEW START */\n' + 'x'.repeat(2000) + '\n/* REVIEW END */';
  15 |   try {
  16 |     const seeded = await request.post(`${API_BASE}/test-support/tool-confirmations/seed-replay`, {
  17 |       data: {
  18 |         sessionId: session.id, requestId, toolCallId: `full-args-call-${suffix}`,
  19 |         toolName: 'fs_write', args: { path: 'fixture-only.css', content: payload },
  20 |         promptMessage: 'Review this fixture without executing it.',
  21 |         assistantMessage: 'Waiting for review of the full file contents.',
  22 |       },
  23 |     });
  24 |     expect(seeded.ok()).toBeTruthy();
  25 |     await page.goto('/');
  26 |     await page.getByTestId('nav-talk').click();
  27 |     await selectSession(page, session.id, title);
  28 |     for (const width of [320, 390, 820]) {
  29 |       await page.setViewportSize({ width, height: 900 });
  30 |       await page.reload();
  31 |       await expect(page.getByTestId('confirmation-confirm-btn')).toBeVisible();
> 32 |       await expect(page.getByTestId('args-preview')).not.toContainText('REVIEW END');
     |                                                          ^ Error: expect(locator).not.toContainText(expected) failed
  33 |       await page.getByTestId('confirmation-args-toggle').click();
  34 |       const panel = page.getByRole('region', { name: 'Full tool arguments' });
  35 |       await expect(panel).toContainText(payload);
  36 |       await expect(panel).toHaveAttribute('tabindex', '0');
  37 |       expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  38 |       expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  39 |       await panel.focus();
  40 |       await panel.press('Control+End');
  41 |       await expect.poll(() => panel.evaluate((element) => element.scrollTop > 0)).toBe(true);
  42 |       await page.screenshot({
  43 |         path: resolve(__dirname, `../../../docs/raports/qa-run-63/assets/full-arguments-fixture-${width}.png`),
  44 |       });
  45 |     }
  46 |   } finally {
  47 |     const dropped = await request.post(`${API_BASE}/test-support/tool-confirmations/drop`, {
  48 |       data: { requestId, sessionId: session.id },
  49 |     });
  50 |     expect(dropped.ok()).toBeTruthy();
  51 |     await deleteSessionIfExists(request, session.id);
  52 |   }
  53 | });
  54 | 
```