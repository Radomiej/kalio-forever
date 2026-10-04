# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ac-13-anti-spam.spec.ts >> AC-13: Queue while streaming >> composer stays enabled while streaming and queues a second message
- Location: tests\ac-13-anti-spam.spec.ts:14:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByTestId('welcome-run-prompt')
    - locator resolved to <button disabled type="button" data-testid="welcome-run-prompt" class="btn btn-primary btn-sm gap-2">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not enabled
    - retrying click action
      - waiting 100ms
    57 × waiting for element to be visible, enabled and stable
       - element is not enabled
     - retrying click action
       - waiting 500ms

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
      - generic [ref=e49]:
        - generic [ref=e50]:
          - button "Conversations" [ref=e51] [cursor=pointer]:
            - img [ref=e53]
          - button "Active agent runs" [ref=e55] [cursor=pointer]:
            - img [ref=e57]
          - generic [ref=e60]: Chats
          - button "Hide conversations" [ref=e61] [cursor=pointer]:
            - img [ref=e62]
        - generic [ref=e66]:
          - generic [ref=e67]:
            - generic [ref=e68]: 8 chats
            - group "Grupowanie rozmów" [ref=e70]:
              - button "Projekt" [pressed] [ref=e71]
              - button "Historia" [ref=e72]
            - button "New" [ref=e73] [cursor=pointer]:
              - img [ref=e74]
              - generic [ref=e75]: New
          - button "Session filter" [ref=e77]:
            - generic [ref=e78]: All
            - img [ref=e79]
          - generic [ref=e82]:
            - generic [ref=e83]:
              - button "Bez projektu 8" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "8"
              - generic [ref=e91]:
                - generic [ref=e93] [cursor=pointer]:
                  - generic [ref=e94]:
                    - generic [ref=e95]:
                      - generic "Root chat" [ref=e96]:
                        - img [ref=e97]
                      - generic [ref=e99]: AC13 Queue Test 1791118654816
                    - generic [ref=e100]:
                      - generic [ref=e101]: Default
                      - generic [ref=e102]: just now
                  - generic [ref=e103]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e104]:
                      - img [ref=e105]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e108]:
                      - img [ref=e109]
                - generic [ref=e113] [cursor=pointer]:
                  - generic [ref=e114]:
                    - generic [ref=e115]:
                      - generic "Root chat" [ref=e116]:
                        - img [ref=e117]
                      - generic [ref=e119]: AC12 Reload Test
                    - generic [ref=e120]:
                      - generic [ref=e121]: Default
                      - generic [ref=e122]: just now
                  - generic [ref=e123]:
                    - button "Rename session AC12 Reload Test" [ref=e124]:
                      - img [ref=e125]
                    - button "Delete session AC12 Reload Test" [ref=e128]:
                      - img [ref=e129]
                - generic [ref=e133] [cursor=pointer]:
                  - generic [ref=e134]:
                    - generic [ref=e135]:
                      - generic "Root chat" [ref=e136]:
                        - img [ref=e137]
                      - generic [ref=e139]: Interactive Q&A
                    - generic [ref=e140]:
                      - generic [ref=e141]: RaConsierge
                      - generic [ref=e142]: just now
                  - generic [ref=e143]:
                    - button "Rename session Interactive Q&A" [ref=e144]:
                      - img [ref=e145]
                    - button "Delete session Interactive Q&A" [ref=e148]:
                      - img [ref=e149]
                - generic [ref=e153] [cursor=pointer]:
                  - generic [ref=e154]:
                    - generic [ref=e155]:
                      - generic "Root chat" [ref=e156]:
                        - img [ref=e157]
                      - generic [ref=e159]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e160]:
                      - generic [ref=e161]: Default
                      - generic [ref=e162]: just now
                  - generic [ref=e163]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e164]:
                      - img [ref=e165]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e168]:
                      - img [ref=e169]
                - generic [ref=e173] [cursor=pointer]:
                  - generic [ref=e174]:
                    - generic [ref=e175]:
                      - generic "Root chat" [ref=e176]:
                        - img [ref=e177]
                      - generic [ref=e179]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e180]:
                      - generic [ref=e181]: Default
                      - generic [ref=e182]: just now
                  - generic [ref=e183]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e184]:
                      - img [ref=e185]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e188]:
                      - img [ref=e189]
                - generic [ref=e193] [cursor=pointer]:
                  - generic [ref=e194]:
                    - generic [ref=e195]:
                      - generic "Root chat" [ref=e196]:
                        - img [ref=e197]
                      - generic [ref=e199]: Interactive Q&A
                    - generic [ref=e200]:
                      - generic [ref=e201]: RaConsierge
                      - generic [ref=e202]: just now
                  - generic [ref=e203]:
                    - button "Rename session Interactive Q&A" [ref=e204]:
                      - img [ref=e205]
                    - button "Delete session Interactive Q&A" [ref=e208]:
                      - img [ref=e209]
                - generic [ref=e213] [cursor=pointer]:
                  - generic [ref=e214]:
                    - generic [ref=e215]:
                      - generic "Root chat" [ref=e216]:
                        - img [ref=e217]
                      - generic [ref=e219]: Interactive Q&A
                    - generic [ref=e220]:
                      - generic [ref=e221]: RaConsierge
                      - generic [ref=e222]: just now
                  - generic [ref=e223]:
                    - button "Rename session Interactive Q&A" [ref=e224]:
                      - img [ref=e225]
                    - button "Delete session Interactive Q&A" [ref=e228]:
                      - img [ref=e229]
                - generic [ref=e233] [cursor=pointer]:
                  - generic [ref=e234]:
                    - generic [ref=e235]:
                      - generic "Root chat" [ref=e236]:
                        - img [ref=e237]
                      - generic [ref=e239]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e240]:
                      - generic [ref=e241]: Default
                      - generic [ref=e242]: 1m ago
                  - generic [ref=e243]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e244]:
                      - img [ref=e245]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e248]:
                      - img [ref=e249]
            - button "Zewnętrzne 0" [expanded] [ref=e253]:
              - img [ref=e254]
              - img [ref=e256]
              - generic [ref=e258]: Zewnętrzne
              - generic [ref=e259]: "0"
            - button "Audyt 0" [expanded] [ref=e261]:
              - img [ref=e262]
              - img [ref=e264]
              - generic [ref=e266]: Audyt
              - generic [ref=e267]: "0"
            - button "Inne 0" [expanded] [ref=e269]:
              - img [ref=e270]
              - img [ref=e272]
              - generic [ref=e274]: Inne
              - generic [ref=e275]: "0"
      - generic [ref=e280]:
        - generic [ref=e281]:
          - generic [ref=e283]: AC13 Queue Test 1791118654816
          - group "Widok konwersacji" [ref=e284]:
            - button "Chat" [pressed] [ref=e285]:
              - img [ref=e286]
              - generic [ref=e288]: Chat
            - button "Graf" [ref=e289]:
              - img [ref=e290]
              - generic [ref=e294]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e297]:
            - img [ref=e298]
            - generic [ref=e300]: Bez projektu
            - generic [ref=e301]: Sandbox VFS
            - img [ref=e302]
          - button "Files empty" [ref=e304]:
            - img [ref=e305]
            - generic [ref=e307]: Files
            - generic [ref=e308]: empty
          - button "~18k/32k" [ref=e310] [cursor=pointer]
          - generic "Local LLM" [ref=e311]
        - generic [ref=e315]:
          - paragraph [ref=e316]: AC13 Queue Test 1791118654816
          - generic [ref=e317]:
            - generic [ref=e318]: K
            - heading "KALIO" [level=2] [ref=e319]
            - paragraph [ref=e320]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e321]:
            - generic [ref=e322]:
              - paragraph [ref=e323]: Mode
              - generic [ref=e324]:
                - button "Chat mode" [ref=e325] [cursor=pointer]
                - button "Workflow mode" [ref=e326] [cursor=pointer]
            - generic [ref=e327]:
              - generic [ref=e328]:
                - generic [ref=e329]: Persona
                - combobox "Persona" [ref=e331]:
                  - generic [ref=e332]: Default
                  - img [ref=e333]
              - generic [ref=e336]:
                - generic [ref=e337]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e338]:
                  - img [ref=e339]
                  - generic [ref=e341]: Bez projektu
                  - generic [ref=e342]: Sandbox VFS
                  - img [ref=e343]
            - generic [ref=e345]:
              - generic [ref=e346]: Provider and model
              - generic [ref=e347]:
                - generic [ref=e348]: Search providers and models
                - combobox "Provider and model" [ref=e349]
                - generic [ref=e350]:
                  - paragraph [ref=e351]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e352] [cursor=pointer]
              - paragraph [ref=e353]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e354]:
            - generic [ref=e355]:
              - generic [ref=e356]: Prompt
              - textbox "Prompt" [active] [ref=e357]:
                - /placeholder: Ask Default...
                - text: "Repeat this text slowly: HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO"
              - generic [ref=e358]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e359]:
              - button "What can you do?" [ref=e360] [cursor=pointer]
              - button "Build a calculator app" [ref=e361] [cursor=pointer]
              - button "Create a todo list" [ref=e362] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e363] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import {
  3  |   API_BASE,
  4  |   deleteSessionIfExists,
  5  |   expectComposerEnabled,
  6  |   getComposerSendButton,
  7  |   selectSession,
  8  | } from './helpers/test-config';
  9  | 
  10 | const LONG_STREAMING_PROMPT = `Repeat this text slowly: ${'HELLO '.repeat(120).trim()}`;
  11 | 
  12 | // AC-13: Queue mode — composer stays enabled during streaming; extra sends queue instead of spamming active turn
  13 | test.describe('AC-13: Queue while streaming', () => {
  14 |   test('composer stays enabled while streaming and queues a second message', async ({ page, request }) => {
  15 |     const title = `AC13 Queue Test ${Date.now()}`;
  16 | 
  17 |     const res = await request.post(`${API_BASE}/sessions`, {
  18 |       data: { title, personaId: 'default' },
  19 |     });
  20 |     expect(res.ok()).toBeTruthy();
  21 |     const session = await res.json() as { id: string };
  22 | 
  23 |     await page.goto('/');
  24 |     await page.getByTestId('nav-talk').click();
  25 |     await selectSession(page, session.id, title);
  26 | 
  27 |     const chatInput = await expectComposerEnabled(page, 5000);
  28 |     const sendBtn = await getComposerSendButton(page);
  29 | 
  30 |     await chatInput.fill(LONG_STREAMING_PROMPT);
> 31 |     await sendBtn.click();
     |                   ^ Error: locator.click: Test timeout of 30000ms exceeded.
  32 | 
  33 |     await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
  34 |     const streamingInput = await expectComposerEnabled(page, 5000);
  35 |     const streamingSendBtn = await getComposerSendButton(page);
  36 | 
  37 |     await streamingInput.fill('queued follow-up');
  38 |     await streamingSendBtn.click();
  39 | 
  40 |     const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
  41 |     await expect(userMessages).toHaveCount(2, { timeout: 10_000 });
  42 |     await expect(userMessages.nth(1)).toContainText('queued follow-up');
  43 | 
  44 |     await deleteSessionIfExists(request, session.id);
  45 |   });
  46 | 
  47 |   test('rapid Enter key presses while streaming can queue additional user bubbles', async ({ page, request }) => {
  48 |     test.setTimeout(45_000);
  49 | 
  50 |     const title = `AC13 Rapid Enter Queue ${Date.now()}`;
  51 | 
  52 |     const res = await request.post(`${API_BASE}/sessions`, {
  53 |       data: { title, personaId: 'default' },
  54 |     });
  55 |     expect(res.ok()).toBeTruthy();
  56 |     const session = await res.json() as { id: string };
  57 | 
  58 |     await page.goto('/');
  59 |     await page.getByTestId('nav-talk').click();
  60 |     await selectSession(page, session.id, title);
  61 | 
  62 |     const chatInput = await expectComposerEnabled(page, 5000);
  63 | 
  64 |     await chatInput.fill(LONG_STREAMING_PROMPT);
  65 |     await chatInput.press('Enter');
  66 | 
  67 |     await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
  68 |     const streamingInput = await expectComposerEnabled(page, 5000);
  69 |     const userMessages = page.locator('[data-testid="message-bubble"][data-role="user"]');
  70 | 
  71 |     for (let i = 0; i < 3; i++) {
  72 |       await streamingInput.fill(`queued ${i + 1}`);
  73 |       await streamingInput.press('Enter');
  74 |       await expect(userMessages).toHaveCount(i + 2, { timeout: 10_000 });
  75 |     }
  76 | 
  77 |     await expect(userMessages).toHaveCount(4, { timeout: 15_000 });
  78 | 
  79 |     await deleteSessionIfExists(request, session.id);
  80 |   });
  81 | });
  82 | 
```