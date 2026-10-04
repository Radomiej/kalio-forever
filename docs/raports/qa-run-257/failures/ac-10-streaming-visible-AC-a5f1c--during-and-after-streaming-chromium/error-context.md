# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ac-10-streaming-visible.spec.ts >> AC-10: Streaming visibility >> agent response streams and is visible during and after streaming
- Location: tests\ac-10-streaming-visible.spec.ts:45:7

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator:  getByTestId('welcome-run-prompt')
Expected: enabled
Received: disabled
Timeout:  10000ms

Call log:
  - Expect "toBeEnabled" with timeout 10000ms
  - waiting for getByTestId('welcome-run-prompt')
    14 × locator resolved to <button disabled type="button" data-testid="welcome-run-prompt" class="btn btn-primary btn-sm gap-2">…</button>
       - unexpected value "disabled"

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
            - generic [ref=e68]: 4 chats
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
              - button "Bez projektu 4" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "4"
              - generic [ref=e91]:
                - generic [ref=e93] [cursor=pointer]:
                  - generic [ref=e94]:
                    - generic [ref=e95]:
                      - generic "Root chat" [ref=e96]:
                        - img [ref=e97]
                      - generic [ref=e99]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e100]:
                      - generic [ref=e101]: Default
                      - generic [ref=e102]: just now
                  - generic [ref=e103]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e104]:
                      - img [ref=e105]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e108]:
                      - img [ref=e109]
                - generic [ref=e113] [cursor=pointer]:
                  - generic [ref=e114]:
                    - generic [ref=e115]:
                      - generic "Root chat" [ref=e116]:
                        - img [ref=e117]
                      - generic [ref=e119]: Interactive Q&A
                    - generic [ref=e120]:
                      - generic [ref=e121]: RaConsierge
                      - generic [ref=e122]: just now
                  - generic [ref=e123]:
                    - button "Rename session Interactive Q&A" [ref=e124]:
                      - img [ref=e125]
                    - button "Delete session Interactive Q&A" [ref=e128]:
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
                      - generic [ref=e159]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e160]:
                      - generic [ref=e161]: Default
                      - generic [ref=e162]: just now
                  - generic [ref=e163]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e164]:
                      - img [ref=e165]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e168]:
                      - img [ref=e169]
            - button "Zewnętrzne 0" [expanded] [ref=e173]:
              - img [ref=e174]
              - img [ref=e176]
              - generic [ref=e178]: Zewnętrzne
              - generic [ref=e179]: "0"
            - button "Audyt 0" [expanded] [ref=e181]:
              - img [ref=e182]
              - img [ref=e184]
              - generic [ref=e186]: Audyt
              - generic [ref=e187]: "0"
            - button "Inne 0" [expanded] [ref=e189]:
              - img [ref=e190]
              - img [ref=e192]
              - generic [ref=e194]: Inne
              - generic [ref=e195]: "0"
      - generic [ref=e200]:
        - generic [ref=e201]:
          - generic [ref=e203]: AC10 Streaming Test 1791118638880-69lowb
          - group "Widok konwersacji" [ref=e204]:
            - button "Chat" [pressed] [ref=e205]:
              - img [ref=e206]
              - generic [ref=e208]: Chat
            - button "Graf" [ref=e209]:
              - img [ref=e210]
              - generic [ref=e214]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e217]:
            - img [ref=e218]
            - generic [ref=e220]: Bez projektu
            - generic [ref=e221]: Sandbox VFS
            - img [ref=e222]
          - button "Files empty" [ref=e224]:
            - img [ref=e225]
            - generic [ref=e227]: Files
            - generic [ref=e228]: empty
          - button "~18k/32k" [ref=e230] [cursor=pointer]
          - generic "Local LLM" [ref=e231]
        - generic [ref=e235]:
          - paragraph [ref=e236]: AC10 Streaming Test 1791118638880-69lowb
          - generic [ref=e237]:
            - generic [ref=e238]: K
            - heading "KALIO" [level=2] [ref=e239]
            - paragraph [ref=e240]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e241]:
            - generic [ref=e242]:
              - paragraph [ref=e243]: Mode
              - generic [ref=e244]:
                - button "Chat mode" [ref=e245] [cursor=pointer]
                - button "Workflow mode" [ref=e246] [cursor=pointer]
            - generic [ref=e247]:
              - generic [ref=e248]:
                - generic [ref=e249]: Persona
                - combobox "Persona" [ref=e251]:
                  - generic [ref=e252]: Default
                  - img [ref=e253]
              - generic [ref=e256]:
                - generic [ref=e257]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e258]:
                  - img [ref=e259]
                  - generic [ref=e261]: Bez projektu
                  - generic [ref=e262]: Sandbox VFS
                  - img [ref=e263]
            - generic [ref=e265]:
              - generic [ref=e266]: Provider and model
              - generic [ref=e267]:
                - generic [ref=e268]: Search providers and models
                - combobox "Provider and model" [ref=e269]
                - generic [ref=e270]:
                  - paragraph [ref=e271]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e272] [cursor=pointer]
              - paragraph [ref=e273]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e274]:
            - generic [ref=e275]:
              - generic [ref=e276]: Prompt
              - textbox "Prompt" [active] [ref=e277]:
                - /placeholder: Ask Default...
                - text: Say the word HELLO and nothing else.
              - generic [ref=e278]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e279]:
              - button "What can you do?" [ref=e280] [cursor=pointer]
              - button "Build a calculator app" [ref=e281] [cursor=pointer]
              - button "Create a todo list" [ref=e282] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e283] [cursor=pointer]
```

# Test source

```ts
  130 | export async function ensureEnvMockProvider(request: APIRequestContext): Promise<void> {
  131 | 	const response = await request.delete(`${API_BASE}/credentials/active`);
  132 | 	expect(response.ok()).toBeTruthy();
  133 | 	await expect.poll(async () => isMockLlm(request), {
  134 | 		timeout: 10_000,
  135 | 		message: 'Expected Playwright stack to fall back to env mock provider',
  136 | 	}).toBe(true);
  137 | }
  138 |
  139 | export async function selectSession(page: Page, sessionId: string, title: string): Promise<void> {
  140 | 	await expect(page.getByTestId('session-panel')).toBeVisible({ timeout: 15_000 });
  141 |
  142 | 	for (let attempt = 0; attempt < 3; attempt += 1) {
  143 | 		await expectChatTransportReady(page);
  144 | 		for (let groupAttempt = 0; groupAttempt < 10; groupAttempt += 1) {
  145 | 			const collapsedGroup = page.locator('[data-testid^="project-group-"][aria-expanded="false"]').first();
  146 | 			if (!(await collapsedGroup.isVisible().catch(() => false))) {
  147 | 				break;
  148 | 			}
  149 | 			await collapsedGroup.click();
  150 | 		}
  151 |
  152 | 		const sessionItem = page.locator(`[data-testid="session-item"][data-session-id="${sessionId}"]`);
  153 | 		if (await sessionItem.isVisible().catch(() => false)) {
  154 | 			await sessionItem.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
  155 | 			await sessionItem.click({ force: true, timeout: 5_000 }).catch(async () => {
  156 | 				await expectChatTransportReady(page);
  157 | 				await sessionItem.click({ force: true, timeout: 5_000 });
  158 | 			});
  159 | 			await expect
  160 | 				.poll(
  161 | 					() => page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id')),
  162 | 					{ timeout: 5000 },
  163 | 				)
  164 | 				.toBe(sessionId);
  165 | 			return;
  166 | 		}
  167 |
  168 | 		await page.waitForTimeout(1_000);
  169 | 		if (await sessionItem.isVisible().catch(() => false)) {
  170 | 			continue;
  171 | 		}
  172 |
  173 | 		if (attempt < 2) {
  174 | 			await page.reload();
  175 | 			const talkNav = page.getByTestId('nav-talk');
  176 | 			if (await talkNav.isVisible().catch(() => false)) {
  177 | 				await talkNav.click({ force: true });
  178 | 			}
  179 | 		}
  180 | 	}
  181 |
  182 | 	const visibleSessionCount = await page.getByTestId('session-item').count().catch(() => 0);
  183 | 	const transportMessages = await transportStatusMessages(page);
  184 | 	throw new Error(
  185 | 		`Session ${sessionId} (${title}) did not appear in the Talk sidebar. `
  186 | 		+ `visibleSessions=${visibleSessionCount}; transport=${transportMessages || 'ready'}`,
  187 | 	);
  188 | }
  189 |
  190 | async function expectChatTransportReady(page: Page): Promise<void> {
  191 | 	await expect
  192 | 		.poll(
  193 | 			async () => activeTransportStatusMessages(page),
  194 | 			{
  195 | 				timeout: 30_000,
  196 | 				message: 'Expected chat transport to be connected before selecting a session',
  197 | 			},
  198 | 		)
  199 | 		.toBe('');
  200 | }
  201 |
  202 | async function activeTransportStatusMessages(page: Page): Promise<string> {
  203 | 	const messages = await page
  204 | 		.getByTestId('chat-connection-status')
  205 | 		.allTextContents()
  206 | 		.catch(() => []);
  207 | 	return messages.map((message) => message.trim()).filter(Boolean).join(' | ');
  208 | }
  209 |
  210 | async function transportStatusMessages(page: Page): Promise<string> {
  211 | 	const activeMessages = await page
  212 | 		.getByTestId('chat-connection-status')
  213 | 		.allTextContents()
  214 | 		.catch(() => []);
  215 | 	const recoveryMessages = await page
  216 | 		.getByTestId('chat-recovery-notice')
  217 | 		.allTextContents()
  218 | 		.catch(() => []);
  219 | 	return [...activeMessages, ...recoveryMessages]
  220 | 		.map((message) => message.trim())
  221 | 		.filter(Boolean)
  222 | 		.join(' | ');
  223 | }
  224 |
  225 | export async function sendMessageFromComposer(page: Page, message: string): Promise<void> {
  226 | 	const input = await expectComposerEnabled(page, 10_000);
  227 | 	await input.fill(message);
  228 | 	await expect(input).toHaveValue(message, { timeout: 10_000 });
  229 | 	const sendButton = await getComposerSendButton(page);
> 230 | 	await expect(sendButton).toBeEnabled({ timeout: 10_000 });
      |                           ^ Error: expect(locator).toBeEnabled() failed
  231 | 	await sendButton.click();
  232 | }
  233 |
  234 | export async function expectComposerEnabled(page: Page, timeoutMs = 10_000): Promise<Locator> {
  235 | 	const welcomeInput = page.getByTestId('welcome-prompt-input');
  236 | 	if (await welcomeInput.isVisible().catch(() => false)) {
  237 | 		await expect(welcomeInput).toBeEnabled({ timeout: timeoutMs });
  238 | 		return welcomeInput;
  239 | 	}
  240 |
  241 | 	const chatInput = page.getByTestId('chat-input');
  242 | 	await expect(chatInput).toBeEnabled({ timeout: timeoutMs });
  243 | 	return chatInput;
  244 | }
  245 |
  246 | export async function getComposerSendButton(page: Page): Promise<Locator> {
  247 | 	const welcomeButton = page.getByTestId('welcome-run-prompt');
  248 | 	if (await welcomeButton.isVisible().catch(() => false)) {
  249 | 		return welcomeButton;
  250 | 	}
  251 |
  252 | 	return page.getByTestId('chat-send-btn');
  253 | }
  254 |
  255 | export async function selectArchitectureInComposer(page: Page, architectureId: string): Promise<void> {
  256 | 	const welcomeSelect = page.getByTestId('welcome-architecture-select');
  257 | 	if (await welcomeSelect.isVisible().catch(() => false)) {
  258 | 		await welcomeSelect.selectOption(architectureId);
  259 | 		return;
  260 | 	}
  261 |
  262 | 	const workflowModeButton = page.getByTestId('welcome-mode-workflow');
  263 | 	if (await workflowModeButton.isVisible().catch(() => false)) {
  264 | 		await workflowModeButton.click();
  265 | 		await expect(welcomeSelect).toBeVisible({ timeout: 5000 });
  266 | 		await welcomeSelect.selectOption(architectureId);
  267 | 		return;
  268 | 	}
  269 |
  270 | 	await page.getByTestId('chat-architecture-select').selectOption(architectureId);
  271 | }
  272 |
  273 | export async function selectSessionOriginFilter(
  274 | 	page: Page,
  275 | 	filterId: 'all' | 'user' | 'agent' | 'archived',
  276 | ): Promise<void> {
  277 | 	await page.getByTestId('session-origin-filter-trigger').click();
  278 | 	await page.getByTestId(`session-origin-filter-${filterId}`).click();
  279 | }
  280 |
  281 | export async function deleteSessionIfExists(request: APIRequestContext, sessionId: string): Promise<void> {
  282 | 	await request.delete(`${API_BASE}/sessions/${sessionId}`, { timeout: 5000 }).catch(() => undefined);
  283 | }
  284 |
```