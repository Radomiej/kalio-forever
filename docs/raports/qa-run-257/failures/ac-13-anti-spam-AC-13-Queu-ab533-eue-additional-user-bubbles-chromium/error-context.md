# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ac-13-anti-spam.spec.ts >> AC-13: Queue while streaming >> rapid Enter key presses while streaming can queue additional user bubbles
- Location: tests\ac-13-anti-spam.spec.ts:47:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('chat-stop-btn')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('chat-stop-btn')

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
            - generic [ref=e68]: 9 chats
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
              - button "Bez projektu 9" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "9"
              - generic [ref=e91]:
                - generic [ref=e93] [cursor=pointer]:
                  - generic [ref=e94]:
                    - generic [ref=e95]:
                      - generic "Root chat" [ref=e96]:
                        - img [ref=e97]
                      - generic [ref=e99]: AC13 Rapid Enter Queue 1791118665743
                    - generic [ref=e100]:
                      - generic [ref=e101]: Default
                      - generic [ref=e102]: just now
                  - generic [ref=e103]:
                    - button "Rename session AC13 Rapid Enter Queue 1791118665743" [ref=e104]:
                      - img [ref=e105]
                    - button "Delete session AC13 Rapid Enter Queue 1791118665743" [ref=e108]:
                      - img [ref=e109]
                - generic [ref=e113] [cursor=pointer]:
                  - generic [ref=e114]:
                    - generic [ref=e115]:
                      - generic "Root chat" [ref=e116]:
                        - img [ref=e117]
                      - generic [ref=e119]: AC13 Queue Test 1791118654816
                    - generic [ref=e120]:
                      - generic [ref=e121]: Default
                      - generic [ref=e122]: just now
                  - generic [ref=e123]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e124]:
                      - img [ref=e125]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e128]:
                      - img [ref=e129]
                - generic [ref=e133] [cursor=pointer]:
                  - generic [ref=e134]:
                    - generic [ref=e135]:
                      - generic "Root chat" [ref=e136]:
                        - img [ref=e137]
                      - generic [ref=e139]: AC12 Reload Test
                    - generic [ref=e140]:
                      - generic [ref=e141]: Default
                      - generic [ref=e142]: just now
                  - generic [ref=e143]:
                    - button "Rename session AC12 Reload Test" [ref=e144]:
                      - img [ref=e145]
                    - button "Delete session AC12 Reload Test" [ref=e148]:
                      - img [ref=e149]
                - generic [ref=e153] [cursor=pointer]:
                  - generic [ref=e154]:
                    - generic [ref=e155]:
                      - generic "Root chat" [ref=e156]:
                        - img [ref=e157]
                      - generic [ref=e159]: Interactive Q&A
                    - generic [ref=e160]:
                      - generic [ref=e161]: RaConsierge
                      - generic [ref=e162]: just now
                  - generic [ref=e163]:
                    - button "Rename session Interactive Q&A" [ref=e164]:
                      - img [ref=e165]
                    - button "Delete session Interactive Q&A" [ref=e168]:
                      - img [ref=e169]
                - generic [ref=e173] [cursor=pointer]:
                  - generic [ref=e174]:
                    - generic [ref=e175]:
                      - generic "Root chat" [ref=e176]:
                        - img [ref=e177]
                      - generic [ref=e179]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e180]:
                      - generic [ref=e181]: Default
                      - generic [ref=e182]: just now
                  - generic [ref=e183]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e184]:
                      - img [ref=e185]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e188]:
                      - img [ref=e189]
                - generic [ref=e193] [cursor=pointer]:
                  - generic [ref=e194]:
                    - generic [ref=e195]:
                      - generic "Root chat" [ref=e196]:
                        - img [ref=e197]
                      - generic [ref=e199]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e200]:
                      - generic [ref=e201]: Default
                      - generic [ref=e202]: just now
                  - generic [ref=e203]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e204]:
                      - img [ref=e205]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e208]:
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
                      - generic [ref=e239]: Interactive Q&A
                    - generic [ref=e240]:
                      - generic [ref=e241]: RaConsierge
                      - generic [ref=e242]: just now
                  - generic [ref=e243]:
                    - button "Rename session Interactive Q&A" [ref=e244]:
                      - img [ref=e245]
                    - button "Delete session Interactive Q&A" [ref=e248]:
                      - img [ref=e249]
                - generic [ref=e253] [cursor=pointer]:
                  - generic [ref=e254]:
                    - generic [ref=e255]:
                      - generic "Root chat" [ref=e256]:
                        - img [ref=e257]
                      - generic [ref=e259]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e260]:
                      - generic [ref=e261]: Default
                      - generic [ref=e262]: 1m ago
                  - generic [ref=e263]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e264]:
                      - img [ref=e265]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e268]:
                      - img [ref=e269]
            - button "Zewnętrzne 0" [expanded] [ref=e273]:
              - img [ref=e274]
              - img [ref=e276]
              - generic [ref=e278]: Zewnętrzne
              - generic [ref=e279]: "0"
            - button "Audyt 0" [expanded] [ref=e281]:
              - img [ref=e282]
              - img [ref=e284]
              - generic [ref=e286]: Audyt
              - generic [ref=e287]: "0"
            - button "Inne 0" [expanded] [ref=e289]:
              - img [ref=e290]
              - img [ref=e292]
              - generic [ref=e294]: Inne
              - generic [ref=e295]: "0"
      - generic [ref=e300]:
        - generic [ref=e301]:
          - generic [ref=e303]: AC13 Rapid Enter Queue 1791118665743
          - group "Widok konwersacji" [ref=e304]:
            - button "Chat" [pressed] [ref=e305]:
              - img [ref=e306]
              - generic [ref=e308]: Chat
            - button "Graf" [ref=e309]:
              - img [ref=e310]
              - generic [ref=e314]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e317]:
            - img [ref=e318]
            - generic [ref=e320]: Bez projektu
            - generic [ref=e321]: Sandbox VFS
            - img [ref=e322]
          - button "Files empty" [ref=e324]:
            - img [ref=e325]
            - generic [ref=e327]: Files
            - generic [ref=e328]: empty
          - button "~18k/32k" [ref=e330] [cursor=pointer]
          - generic "Local LLM" [ref=e331]
        - generic [ref=e335]:
          - paragraph [ref=e336]: AC13 Rapid Enter Queue 1791118665743
          - generic [ref=e337]:
            - generic [ref=e338]: K
            - heading "KALIO" [level=2] [ref=e339]
            - paragraph [ref=e340]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e341]:
            - generic [ref=e342]:
              - paragraph [ref=e343]: Mode
              - generic [ref=e344]:
                - button "Chat mode" [ref=e345] [cursor=pointer]
                - button "Workflow mode" [ref=e346] [cursor=pointer]
            - generic [ref=e347]:
              - generic [ref=e348]:
                - generic [ref=e349]: Persona
                - combobox "Persona" [ref=e351]:
                  - generic [ref=e352]: Default
                  - img [ref=e353]
              - generic [ref=e356]:
                - generic [ref=e357]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e358]:
                  - img [ref=e359]
                  - generic [ref=e361]: Bez projektu
                  - generic [ref=e362]: Sandbox VFS
                  - img [ref=e363]
            - generic [ref=e365]:
              - generic [ref=e366]: Provider and model
              - generic [ref=e367]:
                - generic [ref=e368]: Search providers and models
                - combobox "Provider and model" [ref=e369]
                - generic [ref=e370]:
                  - paragraph [ref=e371]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e372] [cursor=pointer]
              - paragraph [ref=e373]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e374]:
            - generic [ref=e375]:
              - generic [ref=e376]: Prompt
              - textbox "Prompt" [active] [ref=e377]:
                - /placeholder: Ask Default...
                - text: "Repeat this text slowly: HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO HELLO"
              - generic [ref=e378]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e379]:
              - button "What can you do?" [ref=e380] [cursor=pointer]
              - button "Build a calculator app" [ref=e381] [cursor=pointer]
              - button "Create a todo list" [ref=e382] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e383] [cursor=pointer]
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
  31 |     await sendBtn.click();
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
> 67 |     await expect(page.getByTestId('chat-stop-btn')).toBeVisible({ timeout: 5000 });
     |                                                     ^ Error: expect(locator).toBeVisible() failed
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