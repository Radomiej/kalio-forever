# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: architecture-follow-up-stability.spec.ts >> Architecture workflow follow-up stability >> keeps the earlier workflow bubble stable, exposes only real branch sessions, and rehydrates after reload
- Location: tests\architecture-follow-up-stability.spec.ts:28:7

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
            - generic [ref=e68]: 43 chats
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
              - button "Bez projektu 18" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "18"
              - generic [ref=e91]:
                - generic [ref=e93] [cursor=pointer]:
                  - generic [ref=e94]:
                    - generic [ref=e95]:
                      - generic "Root chat" [ref=e96]:
                        - img [ref=e97]
                      - generic [ref=e99]: New Chat
                    - generic [ref=e100]:
                      - generic [ref=e101]: Default
                      - generic [ref=e102]: just now
                  - generic [ref=e103]:
                    - button "Rename session New Chat" [ref=e104]:
                      - img [ref=e105]
                    - button "Delete session New Chat" [ref=e108]:
                      - img [ref=e109]
                - generic [ref=e114] [cursor=pointer]:
                  - generic [ref=e115]:
                    - generic [ref=e116]:
                      - generic "Root chat" [ref=e117]:
                        - img [ref=e118]
                      - generic [ref=e120]: AgentFlow nested restart 1791118723436
                    - generic [ref=e121]:
                      - generic [ref=e122]: Default
                      - generic [ref=e123]: just now
                  - generic [ref=e124]:
                    - button "Rename session AgentFlow nested restart 1791118723436" [ref=e125]:
                      - img [ref=e126]
                    - button "Delete session AgentFlow nested restart 1791118723436" [ref=e129]:
                      - img [ref=e130]
                    - button "Expand child conversations for AgentFlow nested restart 1791118723436" [ref=e133]:
                      - generic [ref=e134]:
                        - img [ref=e135]
                        - generic [ref=e137]: "7"
                - generic [ref=e140] [cursor=pointer]:
                  - generic [ref=e141]:
                    - generic [ref=e142]:
                      - generic "Root chat" [ref=e143]:
                        - img [ref=e144]
                      - generic [ref=e146]: E2E resumable AgentFlow parent
                    - generic [ref=e147]:
                      - generic [ref=e148]: Default
                      - generic [ref=e149]: just now
                  - generic [ref=e150]:
                    - button "Rename session E2E resumable AgentFlow parent" [ref=e151]:
                      - img [ref=e152]
                    - button "Delete session E2E resumable AgentFlow parent" [ref=e155]:
                      - img [ref=e156]
                    - button "Expand child conversations for E2E resumable AgentFlow parent" [ref=e159]:
                      - generic [ref=e160]:
                        - img [ref=e161]
                        - generic [ref=e163]: "6"
                - generic [ref=e165] [cursor=pointer]:
                  - generic [ref=e166]:
                    - generic [ref=e167]:
                      - generic "Root chat" [ref=e168]:
                        - img [ref=e169]
                      - generic [ref=e171]: E2E invalid AgentFlow schema parent
                    - generic [ref=e172]:
                      - generic [ref=e173]: Default
                      - generic [ref=e174]: just now
                  - generic [ref=e175]:
                    - button "Rename session E2E invalid AgentFlow schema parent" [ref=e176]:
                      - img [ref=e177]
                    - button "Delete session E2E invalid AgentFlow schema parent" [ref=e180]:
                      - img [ref=e181]
                - generic [ref=e186] [cursor=pointer]:
                  - generic [ref=e187]:
                    - generic [ref=e188]:
                      - generic "Root chat" [ref=e189]:
                        - img [ref=e190]
                      - generic [ref=e192]: E2E missing Implementer write parent
                    - generic [ref=e193]:
                      - generic [ref=e194]: Default
                      - generic [ref=e195]: just now
                  - generic [ref=e196]:
                    - button "Rename session E2E missing Implementer write parent" [ref=e197]:
                      - img [ref=e198]
                    - button "Delete session E2E missing Implementer write parent" [ref=e201]:
                      - img [ref=e202]
                    - button "Expand child conversations for E2E missing Implementer write parent" [ref=e205]:
                      - generic [ref=e206]:
                        - img [ref=e207]
                        - generic [ref=e209]: "6"
                - generic [ref=e211] [cursor=pointer]:
                  - generic [ref=e212]:
                    - generic [ref=e213]:
                      - generic "Root chat" [ref=e214]:
                        - img [ref=e215]
                      - generic [ref=e217]: AC26 Reload Test
                    - generic [ref=e218]:
                      - generic [ref=e219]: Default
                      - generic [ref=e220]: 1m ago
                  - generic [ref=e221]:
                    - button "Rename session AC26 Reload Test" [ref=e222]:
                      - img [ref=e223]
                    - button "Delete session AC26 Reload Test" [ref=e226]:
                      - img [ref=e227]
                - generic [ref=e231] [cursor=pointer]:
                  - generic [ref=e232]:
                    - generic [ref=e233]:
                      - generic "Root chat" [ref=e234]:
                        - img [ref=e235]
                      - generic [ref=e237]: New Chat
                    - generic [ref=e238]:
                      - generic [ref=e239]: Default
                      - generic [ref=e240]: 1m ago
                  - generic [ref=e241]:
                    - button "Rename session New Chat" [ref=e242]:
                      - img [ref=e243]
                    - button "Delete session New Chat" [ref=e246]:
                      - img [ref=e247]
                - generic [ref=e251] [cursor=pointer]:
                  - generic [ref=e252]:
                    - generic [ref=e253]:
                      - generic "Root chat" [ref=e254]:
                        - img [ref=e255]
                      - generic [ref=e257]: New Chat
                    - generic [ref=e258]:
                      - generic [ref=e259]: Default
                      - generic [ref=e260]: 1m ago
                  - generic [ref=e261]:
                    - button "Rename session New Chat" [ref=e262]:
                      - img [ref=e263]
                    - button "Delete session New Chat" [ref=e266]:
                      - img [ref=e267]
                - generic [ref=e271] [cursor=pointer]:
                  - generic [ref=e272]:
                    - generic [ref=e273]:
                      - generic "Root chat" [ref=e274]:
                        - img [ref=e275]
                      - generic [ref=e277]: New Chat
                    - generic [ref=e278]:
                      - generic [ref=e279]: Default
                      - generic [ref=e280]: 1m ago
                  - generic [ref=e281]:
                    - button "Rename session New Chat" [ref=e282]:
                      - img [ref=e283]
                    - button "Delete session New Chat" [ref=e286]:
                      - img [ref=e287]
                - generic [ref=e291] [cursor=pointer]:
                  - generic [ref=e292]:
                    - generic [ref=e293]:
                      - generic "Root chat" [ref=e294]:
                        - img [ref=e295]
                      - generic [ref=e297]: AC13 Rapid Enter Queue 1791118665743
                    - generic [ref=e298]:
                      - generic [ref=e299]: Default
                      - generic [ref=e300]: 1m ago
                  - generic [ref=e301]:
                    - button "Rename session AC13 Rapid Enter Queue 1791118665743" [ref=e302]:
                      - img [ref=e303]
                    - button "Delete session AC13 Rapid Enter Queue 1791118665743" [ref=e306]:
                      - img [ref=e307]
                - generic [ref=e311] [cursor=pointer]:
                  - generic [ref=e312]:
                    - generic [ref=e313]:
                      - generic "Root chat" [ref=e314]:
                        - img [ref=e315]
                      - generic [ref=e317]: AC13 Queue Test 1791118654816
                    - generic [ref=e318]:
                      - generic [ref=e319]: Default
                      - generic [ref=e320]: 1m ago
                  - generic [ref=e321]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e322]:
                      - img [ref=e323]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e326]:
                      - img [ref=e327]
                - generic [ref=e331] [cursor=pointer]:
                  - generic [ref=e332]:
                    - generic [ref=e333]:
                      - generic "Root chat" [ref=e334]:
                        - img [ref=e335]
                      - generic [ref=e337]: AC12 Reload Test
                    - generic [ref=e338]:
                      - generic [ref=e339]: Default
                      - generic [ref=e340]: 1m ago
                  - generic [ref=e341]:
                    - button "Rename session AC12 Reload Test" [ref=e342]:
                      - img [ref=e343]
                    - button "Delete session AC12 Reload Test" [ref=e346]:
                      - img [ref=e347]
                - generic [ref=e351] [cursor=pointer]:
                  - generic [ref=e352]:
                    - generic [ref=e353]:
                      - generic "Root chat" [ref=e354]:
                        - img [ref=e355]
                      - generic [ref=e357]: Interactive Q&A
                    - generic [ref=e358]:
                      - generic [ref=e359]: RaConsierge
                      - generic [ref=e360]: 1m ago
                  - generic [ref=e361]:
                    - button "Rename session Interactive Q&A" [ref=e362]:
                      - img [ref=e363]
                    - button "Delete session Interactive Q&A" [ref=e366]:
                      - img [ref=e367]
                - generic [ref=e371] [cursor=pointer]:
                  - generic [ref=e372]:
                    - generic [ref=e373]:
                      - generic "Root chat" [ref=e374]:
                        - img [ref=e375]
                      - generic [ref=e377]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e378]:
                      - generic [ref=e379]: Default
                      - generic [ref=e380]: 2m ago
                  - generic [ref=e381]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e382]:
                      - img [ref=e383]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e386]:
                      - img [ref=e387]
                - generic [ref=e391] [cursor=pointer]:
                  - generic [ref=e392]:
                    - generic [ref=e393]:
                      - generic "Root chat" [ref=e394]:
                        - img [ref=e395]
                      - generic [ref=e397]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e398]:
                      - generic [ref=e399]: Default
                      - generic [ref=e400]: 2m ago
                  - generic [ref=e401]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e402]:
                      - img [ref=e403]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e406]:
                      - img [ref=e407]
                - generic [ref=e411] [cursor=pointer]:
                  - generic [ref=e412]:
                    - generic [ref=e413]:
                      - generic "Root chat" [ref=e414]:
                        - img [ref=e415]
                      - generic [ref=e417]: Interactive Q&A
                    - generic [ref=e418]:
                      - generic [ref=e419]: RaConsierge
                      - generic [ref=e420]: 2m ago
                  - generic [ref=e421]:
                    - button "Rename session Interactive Q&A" [ref=e422]:
                      - img [ref=e423]
                    - button "Delete session Interactive Q&A" [ref=e426]:
                      - img [ref=e427]
                - generic [ref=e431] [cursor=pointer]:
                  - generic [ref=e432]:
                    - generic [ref=e433]:
                      - generic "Root chat" [ref=e434]:
                        - img [ref=e435]
                      - generic [ref=e437]: Interactive Q&A
                    - generic [ref=e438]:
                      - generic [ref=e439]: RaConsierge
                      - generic [ref=e440]: 2m ago
                  - generic [ref=e441]:
                    - button "Rename session Interactive Q&A" [ref=e442]:
                      - img [ref=e443]
                    - button "Delete session Interactive Q&A" [ref=e446]:
                      - img [ref=e447]
                - generic [ref=e451] [cursor=pointer]:
                  - generic [ref=e452]:
                    - generic [ref=e453]:
                      - generic "Root chat" [ref=e454]:
                        - img [ref=e455]
                      - generic [ref=e457]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e458]:
                      - generic [ref=e459]: Default
                      - generic [ref=e460]: 3m ago
                  - generic [ref=e461]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e462]:
                      - img [ref=e463]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e466]:
                      - img [ref=e467]
            - button "Zewnętrzne 0" [ref=e471]:
              - img [ref=e472]
              - img [ref=e474]
              - generic [ref=e476]: Zewnętrzne
              - generic [ref=e477]: "0"
            - button "Audyt 0" [ref=e479]:
              - img [ref=e480]
              - img [ref=e482]
              - generic [ref=e484]: Audyt
              - generic [ref=e485]: "0"
            - button "Inne 0" [ref=e487]:
              - img [ref=e488]
              - img [ref=e490]
              - generic [ref=e492]: Inne
              - generic [ref=e493]: "0"
            - button "E2E Architecture Project 1" [ref=e495]:
              - img [ref=e496]
              - img [ref=e498]
              - generic [ref=e500]: E2E Architecture Project
              - generic [ref=e501]: "1"
      - generic [ref=e506]:
        - generic [ref=e507]:
          - generic [ref=e509]: New Chat
          - group "Widok konwersacji" [ref=e510]:
            - button "Chat" [pressed] [ref=e511]:
              - img [ref=e512]
              - generic [ref=e514]: Chat
            - button "Graf" [ref=e515]:
              - img [ref=e516]
              - generic [ref=e520]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e523]:
            - img [ref=e524]
            - generic [ref=e526]: Bez projektu
            - generic [ref=e527]: Sandbox VFS
            - img [ref=e528]
          - button "Files empty" [ref=e530]:
            - img [ref=e531]
            - generic [ref=e533]: Files
            - generic [ref=e534]: empty
          - button "~18k/32k" [ref=e536] [cursor=pointer]
          - generic "Local LLM" [ref=e537]
        - generic [ref=e541]:
          - paragraph [ref=e542]: New Chat
          - generic [ref=e543]:
            - generic [ref=e544]: K
            - heading "KALIO" [level=2] [ref=e545]
            - paragraph [ref=e546]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e547]:
            - generic [ref=e548]:
              - paragraph [ref=e549]: Mode
              - generic [ref=e550]:
                - button "Chat mode" [ref=e551] [cursor=pointer]
                - button "Workflow mode" [ref=e552] [cursor=pointer]
            - generic [ref=e553]:
              - generic [ref=e554]:
                - generic [ref=e555]: Workflow
                - combobox "Workflow" [ref=e556]:
                  - option "Strategic Decision Council" [selected]
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
              - generic [ref=e558]:
                - generic [ref=e559]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e560]:
                  - img [ref=e561]
                  - generic [ref=e563]: Bez projektu
                  - generic [ref=e564]: Sandbox VFS
                  - img [ref=e565]
            - generic [ref=e567]:
              - generic [ref=e568]: Provider and model
              - generic [ref=e569]:
                - generic [ref=e570]: Search providers and models
                - combobox "Provider and model" [ref=e571]
                - generic [ref=e572]:
                  - paragraph [ref=e573]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e574] [cursor=pointer]
              - paragraph [ref=e575]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e576]:
            - generic [ref=e577]:
              - generic [ref=e578]: Prompt
              - textbox "Prompt" [active] [ref=e579]:
                - /placeholder: Run prompt through Strategic Decision Council
                - text: Assess what this workflow can do in two short bullets.
              - generic [ref=e580]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e581]:
              - button "What can you do?" [ref=e582] [cursor=pointer]
              - button "Build a calculator app" [ref=e583] [cursor=pointer]
              - button "Create a todo list" [ref=e584] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e585] [cursor=pointer]
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