# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agentflow-goal-guard.spec.ts >> Goal Guard AgentFlow from Architect UI >> keeps a Talk-started durable AgentFlow result fresh after child completion and reload
- Location: tests\agentflow-goal-guard.spec.ts:502:7

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
            - generic [ref=e68]: 15 chats
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
              - button "Bez projektu 15" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "15"
              - generic [ref=e91]:
                - generic [ref=e93] [cursor=pointer]:
                  - generic [ref=e94]:
                    - generic [ref=e95]:
                      - generic "Root chat" [ref=e96]:
                        - img [ref=e97]
                      - generic [ref=e99]: Talk durable Goal Guard reload 1791118707218
                    - generic [ref=e100]:
                      - generic [ref=e101]: Default
                      - generic [ref=e102]: just now
                  - generic [ref=e103]:
                    - button "Rename session Talk durable Goal Guard reload 1791118707218" [ref=e104]:
                      - img [ref=e105]
                    - button "Delete session Talk durable Goal Guard reload 1791118707218" [ref=e108]:
                      - img [ref=e109]
                - generic [ref=e113] [cursor=pointer]:
                  - generic [ref=e114]:
                    - generic [ref=e115]:
                      - generic "Root chat" [ref=e116]:
                        - img [ref=e117]
                      - generic [ref=e119]: Talk-started AgentFlow 1791118704209
                    - generic [ref=e120]:
                      - generic [ref=e121]: Default
                      - generic [ref=e122]: just now
                  - generic [ref=e123]:
                    - button "Rename session Talk-started AgentFlow 1791118704209" [ref=e124]:
                      - img [ref=e125]
                    - button "Delete session Talk-started AgentFlow 1791118704209" [ref=e128]:
                      - img [ref=e129]
                - generic [ref=e133] [cursor=pointer]:
                  - generic [ref=e134]:
                    - generic [ref=e135]:
                      - generic "Root chat" [ref=e136]:
                        - img [ref=e137]
                      - generic [ref=e139]: AC26 Reload Test
                    - generic [ref=e140]:
                      - generic [ref=e141]: Default
                      - generic [ref=e142]: just now
                  - generic [ref=e143]:
                    - button "Rename session AC26 Reload Test" [ref=e144]:
                      - img [ref=e145]
                    - button "Delete session AC26 Reload Test" [ref=e148]:
                      - img [ref=e149]
                - generic [ref=e153] [cursor=pointer]:
                  - generic [ref=e154]:
                    - generic [ref=e155]:
                      - generic "Root chat" [ref=e156]:
                        - img [ref=e157]
                      - generic [ref=e159]: New Chat
                    - generic [ref=e160]:
                      - generic [ref=e161]: Default
                      - generic [ref=e162]: just now
                  - generic [ref=e163]:
                    - button "Rename session New Chat" [ref=e164]:
                      - img [ref=e165]
                    - button "Delete session New Chat" [ref=e168]:
                      - img [ref=e169]
                - generic [ref=e173] [cursor=pointer]:
                  - generic [ref=e174]:
                    - generic [ref=e175]:
                      - generic "Root chat" [ref=e176]:
                        - img [ref=e177]
                      - generic [ref=e179]: New Chat
                    - generic [ref=e180]:
                      - generic [ref=e181]: Default
                      - generic [ref=e182]: just now
                  - generic [ref=e183]:
                    - button "Rename session New Chat" [ref=e184]:
                      - img [ref=e185]
                    - button "Delete session New Chat" [ref=e188]:
                      - img [ref=e189]
                - generic [ref=e193] [cursor=pointer]:
                  - generic [ref=e194]:
                    - generic [ref=e195]:
                      - generic "Root chat" [ref=e196]:
                        - img [ref=e197]
                      - generic [ref=e199]: New Chat
                    - generic [ref=e200]:
                      - generic [ref=e201]: Default
                      - generic [ref=e202]: just now
                  - generic [ref=e203]:
                    - button "Rename session New Chat" [ref=e204]:
                      - img [ref=e205]
                    - button "Delete session New Chat" [ref=e208]:
                      - img [ref=e209]
                - generic [ref=e213] [cursor=pointer]:
                  - generic [ref=e214]:
                    - generic [ref=e215]:
                      - generic "Root chat" [ref=e216]:
                        - img [ref=e217]
                      - generic [ref=e219]: AC13 Rapid Enter Queue 1791118665743
                    - generic [ref=e220]:
                      - generic [ref=e221]: Default
                      - generic [ref=e222]: just now
                  - generic [ref=e223]:
                    - button "Rename session AC13 Rapid Enter Queue 1791118665743" [ref=e224]:
                      - img [ref=e225]
                    - button "Delete session AC13 Rapid Enter Queue 1791118665743" [ref=e228]:
                      - img [ref=e229]
                - generic [ref=e233] [cursor=pointer]:
                  - generic [ref=e234]:
                    - generic [ref=e235]:
                      - generic "Root chat" [ref=e236]:
                        - img [ref=e237]
                      - generic [ref=e239]: AC13 Queue Test 1791118654816
                    - generic [ref=e240]:
                      - generic [ref=e241]: Default
                      - generic [ref=e242]: just now
                  - generic [ref=e243]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e244]:
                      - img [ref=e245]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e248]:
                      - img [ref=e249]
                - generic [ref=e253] [cursor=pointer]:
                  - generic [ref=e254]:
                    - generic [ref=e255]:
                      - generic "Root chat" [ref=e256]:
                        - img [ref=e257]
                      - generic [ref=e259]: AC12 Reload Test
                    - generic [ref=e260]:
                      - generic [ref=e261]: Default
                      - generic [ref=e262]: just now
                  - generic [ref=e263]:
                    - button "Rename session AC12 Reload Test" [ref=e264]:
                      - img [ref=e265]
                    - button "Delete session AC12 Reload Test" [ref=e268]:
                      - img [ref=e269]
                - generic [ref=e273] [cursor=pointer]:
                  - generic [ref=e274]:
                    - generic [ref=e275]:
                      - generic "Root chat" [ref=e276]:
                        - img [ref=e277]
                      - generic [ref=e279]: Interactive Q&A
                    - generic [ref=e280]:
                      - generic [ref=e281]: RaConsierge
                      - generic [ref=e282]: just now
                  - generic [ref=e283]:
                    - button "Rename session Interactive Q&A" [ref=e284]:
                      - img [ref=e285]
                    - button "Delete session Interactive Q&A" [ref=e288]:
                      - img [ref=e289]
                - generic [ref=e293] [cursor=pointer]:
                  - generic [ref=e294]:
                    - generic [ref=e295]:
                      - generic "Root chat" [ref=e296]:
                        - img [ref=e297]
                      - generic [ref=e299]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e300]:
                      - generic [ref=e301]: Default
                      - generic [ref=e302]: 1m ago
                  - generic [ref=e303]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e304]:
                      - img [ref=e305]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e308]:
                      - img [ref=e309]
                - generic [ref=e313] [cursor=pointer]:
                  - generic [ref=e314]:
                    - generic [ref=e315]:
                      - generic "Root chat" [ref=e316]:
                        - img [ref=e317]
                      - generic [ref=e319]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e320]:
                      - generic [ref=e321]: Default
                      - generic [ref=e322]: 1m ago
                  - generic [ref=e323]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e324]:
                      - img [ref=e325]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e328]:
                      - img [ref=e329]
                - generic [ref=e333] [cursor=pointer]:
                  - generic [ref=e334]:
                    - generic [ref=e335]:
                      - generic "Root chat" [ref=e336]:
                        - img [ref=e337]
                      - generic [ref=e339]: Interactive Q&A
                    - generic [ref=e340]:
                      - generic [ref=e341]: RaConsierge
                      - generic [ref=e342]: 1m ago
                  - generic [ref=e343]:
                    - button "Rename session Interactive Q&A" [ref=e344]:
                      - img [ref=e345]
                    - button "Delete session Interactive Q&A" [ref=e348]:
                      - img [ref=e349]
                - generic [ref=e353] [cursor=pointer]:
                  - generic [ref=e354]:
                    - generic [ref=e355]:
                      - generic "Root chat" [ref=e356]:
                        - img [ref=e357]
                      - generic [ref=e359]: Interactive Q&A
                    - generic [ref=e360]:
                      - generic [ref=e361]: RaConsierge
                      - generic [ref=e362]: 1m ago
                  - generic [ref=e363]:
                    - button "Rename session Interactive Q&A" [ref=e364]:
                      - img [ref=e365]
                    - button "Delete session Interactive Q&A" [ref=e368]:
                      - img [ref=e369]
                - generic [ref=e373] [cursor=pointer]:
                  - generic [ref=e374]:
                    - generic [ref=e375]:
                      - generic "Root chat" [ref=e376]:
                        - img [ref=e377]
                      - generic [ref=e379]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e380]:
                      - generic [ref=e381]: Default
                      - generic [ref=e382]: 2m ago
                  - generic [ref=e383]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e384]:
                      - img [ref=e385]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e388]:
                      - img [ref=e389]
            - button "Zewnętrzne 0" [expanded] [ref=e393]:
              - img [ref=e394]
              - img [ref=e396]
              - generic [ref=e398]: Zewnętrzne
              - generic [ref=e399]: "0"
            - button "Audyt 0" [expanded] [ref=e401]:
              - img [ref=e402]
              - img [ref=e404]
              - generic [ref=e406]: Audyt
              - generic [ref=e407]: "0"
            - button "Inne 0" [expanded] [ref=e409]:
              - img [ref=e410]
              - img [ref=e412]
              - generic [ref=e414]: Inne
              - generic [ref=e415]: "0"
      - generic [ref=e420]:
        - generic [ref=e421]:
          - generic [ref=e423]: Talk durable Goal Guard reload 1791118707218
          - group "Widok konwersacji" [ref=e424]:
            - button "Chat" [pressed] [ref=e425]:
              - img [ref=e426]
              - generic [ref=e428]: Chat
            - button "Graf" [ref=e429]:
              - img [ref=e430]
              - generic [ref=e434]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e437]:
            - img [ref=e438]
            - generic [ref=e440]: Bez projektu
            - generic [ref=e441]: Sandbox VFS
            - img [ref=e442]
          - button "Files empty" [ref=e444]:
            - img [ref=e445]
            - generic [ref=e447]: Files
            - generic [ref=e448]: empty
          - button "~18k/32k" [ref=e450] [cursor=pointer]
          - generic "Local LLM" [ref=e451]
        - generic [ref=e455]:
          - paragraph [ref=e456]: Talk durable Goal Guard reload 1791118707218
          - generic [ref=e457]:
            - generic [ref=e458]: K
            - heading "KALIO" [level=2] [ref=e459]
            - paragraph [ref=e460]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e461]:
            - generic [ref=e462]:
              - paragraph [ref=e463]: Mode
              - generic [ref=e464]:
                - button "Chat mode" [ref=e465] [cursor=pointer]
                - button "Workflow mode" [ref=e466] [cursor=pointer]
            - generic [ref=e467]:
              - generic [ref=e468]:
                - generic [ref=e469]: Persona
                - combobox "Persona" [ref=e471]:
                  - generic [ref=e472]: Default
                  - img [ref=e473]
              - generic [ref=e476]:
                - generic [ref=e477]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e478]:
                  - img [ref=e479]
                  - generic [ref=e481]: Bez projektu
                  - generic [ref=e482]: Sandbox VFS
                  - img [ref=e483]
            - generic [ref=e485]:
              - generic [ref=e486]: Provider and model
              - generic [ref=e487]:
                - generic [ref=e488]: Search providers and models
                - combobox "Provider and model" [ref=e489]
                - generic [ref=e490]:
                  - paragraph [ref=e491]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e492] [cursor=pointer]
              - paragraph [ref=e493]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e494]:
            - generic [ref=e495]:
              - generic [ref=e496]: Prompt
              - textbox "Prompt" [active] [ref=e497]:
                - /placeholder: Ask Default...
                - text: Run Goal Guard from Talk as a durable child flow and complete it without manual intervention. Use the native child AgentFlow tool, not the legacy council flow. [[mock:tool:run_sub_agentflow]] [[mock:goal-guard-vfs-success]]
              - generic [ref=e498]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e499]:
              - button "What can you do?" [ref=e500] [cursor=pointer]
              - button "Build a calculator app" [ref=e501] [cursor=pointer]
              - button "Create a todo list" [ref=e502] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e503] [cursor=pointer]
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