# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ac-01-streaming.spec.ts >> AC-01: LLM streaming >> WS SESSION_NOT_FOUND error surfaces in chat UI
- Location: tests\ac-01-streaming.spec.ts:80:7

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
            - generic [ref=e56]:
              - img [ref=e57]
              - generic "Needs attention" [ref=e60]
          - generic [ref=e61]: Chats
          - button "Hide conversations" [ref=e62] [cursor=pointer]:
            - img [ref=e63]
        - generic [ref=e67]:
          - generic [ref=e68]:
            - generic [ref=e69]: 3 chats
            - group "Grupowanie rozmów" [ref=e71]:
              - button "Projekt" [pressed] [ref=e72]
              - button "Historia" [ref=e73]
            - button "New" [ref=e74] [cursor=pointer]:
              - img [ref=e75]
              - generic [ref=e76]: New
          - button "Session filter" [ref=e78]:
            - generic [ref=e79]: All
            - img [ref=e80]
          - generic [ref=e83]:
            - generic [ref=e84]:
              - button "Bez projektu 3" [expanded] [ref=e85]:
                - img [ref=e86]
                - img [ref=e88]
                - generic [ref=e90]: Bez projektu
                - generic [ref=e91]: "3"
              - generic [ref=e92]:
                - generic [ref=e94] [cursor=pointer]:
                  - generic [ref=e95]:
                    - generic [ref=e96]:
                      - generic "Root chat" [ref=e97]:
                        - img [ref=e98]
                      - generic [ref=e100]: AC02 Stale Replay 1791118593927
                      - img "Waiting" [ref=e102]
                    - generic [ref=e104]:
                      - generic [ref=e105]: Default
                      - generic [ref=e106]: just now
                    - generic "image_generate waiting" [ref=e107]:
                      - generic [ref=e108]: image_generate waiting
                  - generic [ref=e109]:
                    - button "Rename session AC02 Stale Replay 1791118593927" [ref=e110]:
                      - img [ref=e111]
                    - button "Delete session AC02 Stale Replay 1791118593927" [ref=e114]:
                      - img [ref=e115]
                - generic [ref=e119] [cursor=pointer]:
                  - generic [ref=e120]:
                    - generic [ref=e121]:
                      - generic "Root chat" [ref=e122]:
                        - img [ref=e123]
                      - generic [ref=e125]: AC01 Guard Test 1791118593865-7xp1uy
                    - generic [ref=e126]:
                      - generic [ref=e127]: Default
                      - generic [ref=e128]: just now
                  - generic [ref=e129]:
                    - button "Rename session AC01 Guard Test 1791118593865-7xp1uy" [ref=e130]:
                      - img [ref=e131]
                    - button "Delete session AC01 Guard Test 1791118593865-7xp1uy" [ref=e134]:
                      - img [ref=e135]
                - generic [ref=e139] [cursor=pointer]:
                  - generic [ref=e140]:
                    - generic [ref=e141]:
                      - generic "Root chat" [ref=e142]:
                        - img [ref=e143]
                      - generic [ref=e145]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e146]:
                      - generic [ref=e147]: Default
                      - generic [ref=e148]: just now
                  - generic [ref=e149]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e150]:
                      - img [ref=e151]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e154]:
                      - img [ref=e155]
            - button "Zewnętrzne 0" [expanded] [ref=e159]:
              - img [ref=e160]
              - img [ref=e162]
              - generic [ref=e164]: Zewnętrzne
              - generic [ref=e165]: "0"
            - button "Audyt 0" [expanded] [ref=e167]:
              - img [ref=e168]
              - img [ref=e170]
              - generic [ref=e172]: Audyt
              - generic [ref=e173]: "0"
            - button "Inne 0" [expanded] [ref=e175]:
              - img [ref=e176]
              - img [ref=e178]
              - generic [ref=e180]: Inne
              - generic [ref=e181]: "0"
      - generic [ref=e186]:
        - generic [ref=e187]:
          - generic [ref=e189]: AC01 Guard Test 1791118593865-7xp1uy
          - group "Widok konwersacji" [ref=e190]:
            - button "Chat" [pressed] [ref=e191]:
              - img [ref=e192]
              - generic [ref=e194]: Chat
            - button "Graf" [ref=e195]:
              - img [ref=e196]
              - generic [ref=e200]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e203]:
            - img [ref=e204]
            - generic [ref=e206]: Bez projektu
            - generic [ref=e207]: Sandbox VFS
            - img [ref=e208]
          - button "Files empty" [ref=e210]:
            - img [ref=e211]
            - generic [ref=e213]: Files
            - generic [ref=e214]: empty
          - button "~491/32k" [ref=e216] [cursor=pointer]
          - generic "Local LLM" [ref=e217]
        - generic [ref=e221]:
          - paragraph [ref=e222]: AC01 Guard Test 1791118593865-7xp1uy
          - generic [ref=e223]:
            - generic [ref=e224]: K
            - heading "KALIO" [level=2] [ref=e225]
            - paragraph [ref=e226]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e227]:
            - generic [ref=e228]:
              - paragraph [ref=e229]: Mode
              - generic [ref=e230]:
                - button "Chat mode" [ref=e231] [cursor=pointer]
                - button "Workflow mode" [ref=e232] [cursor=pointer]
            - generic [ref=e233]:
              - generic [ref=e234]:
                - generic [ref=e235]: Persona
                - combobox "Persona" [ref=e237]:
                  - generic [ref=e238]: Default
                  - img [ref=e239]
              - generic [ref=e242]:
                - generic [ref=e243]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e244]:
                  - img [ref=e245]
                  - generic [ref=e247]: Bez projektu
                  - generic [ref=e248]: Sandbox VFS
                  - img [ref=e249]
            - generic [ref=e251]:
              - generic [ref=e252]: Provider and model
              - generic [ref=e253]:
                - generic [ref=e254]: Search providers and models
                - combobox "Provider and model" [ref=e255]
                - generic [ref=e256]:
                  - paragraph [ref=e257]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e258] [cursor=pointer]
              - paragraph [ref=e259]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e260]:
            - generic [ref=e261]:
              - generic [ref=e262]: Prompt
              - textbox "Prompt" [active] [ref=e263]:
                - /placeholder: Ask Default...
                - text: This should fail with SESSION_NOT_FOUND
              - generic [ref=e264]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e265]:
              - button "What can you do?" [ref=e266] [cursor=pointer]
              - button "Build a calculator app" [ref=e267] [cursor=pointer]
              - button "Create a todo list" [ref=e268] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e269] [cursor=pointer]
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