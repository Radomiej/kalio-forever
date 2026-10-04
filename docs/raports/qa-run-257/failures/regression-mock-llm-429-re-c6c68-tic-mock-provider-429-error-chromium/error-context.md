# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: regression-mock-llm-429-recovery.spec.ts >> REGRESSION: mock LLM 429 recovery >> UI recovers cleanly after a deterministic mock-provider 429 error
- Location: tests\regression-mock-llm-429-recovery.spec.ts:17:7

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
            - generic [ref=e69]: 47 chats
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
              - button "Bez projektu 21" [expanded] [ref=e85]:
                - img [ref=e86]
                - img [ref=e88]
                - generic [ref=e90]: Bez projektu
                - generic [ref=e91]: "21"
              - generic [ref=e92]:
                - generic [ref=e94] [cursor=pointer]:
                  - generic [ref=e95]:
                    - generic [ref=e96]:
                      - generic "Root chat" [ref=e97]:
                        - img [ref=e98]
                      - generic [ref=e100]: Mock 429 Recovery 1791119314980-pag1s5
                    - generic [ref=e101]:
                      - generic [ref=e102]: Default
                      - generic [ref=e103]: just now
                  - generic [ref=e104]:
                    - button "Rename session Mock 429 Recovery 1791119314980-pag1s5" [ref=e105]:
                      - img [ref=e106]
                    - button "Delete session Mock 429 Recovery 1791119314980-pag1s5" [ref=e109]:
                      - img [ref=e110]
                - generic [ref=e114] [cursor=pointer]:
                  - generic [ref=e115]:
                    - generic [ref=e116]:
                      - generic "Root chat" [ref=e117]:
                        - img [ref=e118]
                      - generic [ref=e120]: New Chat
                    - generic [ref=e121]:
                      - generic [ref=e122]: Default
                      - generic [ref=e123]: just now
                  - generic [ref=e124]:
                    - button "Rename session New Chat" [ref=e125]:
                      - img [ref=e126]
                    - button "Delete session New Chat" [ref=e129]:
                      - img [ref=e130]
                - generic [ref=e134] [cursor=pointer]:
                  - generic [ref=e135]:
                    - generic [ref=e136]:
                      - generic "Root chat" [ref=e137]:
                        - img [ref=e138]
                      - generic [ref=e140]: New Chat
                    - generic [ref=e141]:
                      - generic [ref=e142]: Default
                      - generic [ref=e143]: just now
                  - generic [ref=e144]:
                    - button "Rename session New Chat" [ref=e145]:
                      - img [ref=e146]
                    - button "Delete session New Chat" [ref=e149]:
                      - img [ref=e150]
                - generic [ref=e154] [cursor=pointer]:
                  - generic [ref=e155]:
                    - generic [ref=e156]:
                      - generic "Root chat" [ref=e157]:
                        - img [ref=e158]
                      - generic [ref=e160]: Full arguments fixture 1791119310620
                      - img "Waiting" [ref=e162]
                    - generic [ref=e164]:
                      - generic [ref=e165]: Default
                      - generic [ref=e166]: just now
                    - generic "fs_write waiting" [ref=e167]:
                      - generic [ref=e168]: fs_write waiting
                  - generic [ref=e169]:
                    - button "Rename session Full arguments fixture 1791119310620" [ref=e170]:
                      - img [ref=e171]
                    - button "Delete session Full arguments fixture 1791119310620" [ref=e174]:
                      - img [ref=e175]
                - generic [ref=e180] [cursor=pointer]:
                  - generic [ref=e181]:
                    - generic [ref=e182]:
                      - generic "Root chat" [ref=e183]:
                        - img [ref=e184]
                      - generic [ref=e186]: AgentFlow nested restart 1791118723436
                    - generic [ref=e187]:
                      - generic [ref=e188]: Default
                      - generic [ref=e189]: 9m ago
                  - generic [ref=e190]:
                    - button "Rename session AgentFlow nested restart 1791118723436" [ref=e191]:
                      - img [ref=e192]
                    - button "Delete session AgentFlow nested restart 1791118723436" [ref=e195]:
                      - img [ref=e196]
                    - button "Expand child conversations for AgentFlow nested restart 1791118723436" [ref=e199]:
                      - generic [ref=e200]:
                        - img [ref=e201]
                        - generic [ref=e203]: "7"
                - generic [ref=e206] [cursor=pointer]:
                  - generic [ref=e207]:
                    - generic [ref=e208]:
                      - generic "Root chat" [ref=e209]:
                        - img [ref=e210]
                      - generic [ref=e212]: E2E resumable AgentFlow parent
                    - generic [ref=e213]:
                      - generic [ref=e214]: Default
                      - generic [ref=e215]: 9m ago
                  - generic [ref=e216]:
                    - button "Rename session E2E resumable AgentFlow parent" [ref=e217]:
                      - img [ref=e218]
                    - button "Delete session E2E resumable AgentFlow parent" [ref=e221]:
                      - img [ref=e222]
                    - button "Expand child conversations for E2E resumable AgentFlow parent" [ref=e225]:
                      - generic [ref=e226]:
                        - img [ref=e227]
                        - generic [ref=e229]: "6"
                - generic [ref=e231] [cursor=pointer]:
                  - generic [ref=e232]:
                    - generic [ref=e233]:
                      - generic "Root chat" [ref=e234]:
                        - img [ref=e235]
                      - generic [ref=e237]: E2E invalid AgentFlow schema parent
                    - generic [ref=e238]:
                      - generic [ref=e239]: Default
                      - generic [ref=e240]: 9m ago
                  - generic [ref=e241]:
                    - button "Rename session E2E invalid AgentFlow schema parent" [ref=e242]:
                      - img [ref=e243]
                    - button "Delete session E2E invalid AgentFlow schema parent" [ref=e246]:
                      - img [ref=e247]
                - generic [ref=e252] [cursor=pointer]:
                  - generic [ref=e253]:
                    - generic [ref=e254]:
                      - generic "Root chat" [ref=e255]:
                        - img [ref=e256]
                      - generic [ref=e258]: E2E missing Implementer write parent
                    - generic [ref=e259]:
                      - generic [ref=e260]: Default
                      - generic [ref=e261]: 9m ago
                  - generic [ref=e262]:
                    - button "Rename session E2E missing Implementer write parent" [ref=e263]:
                      - img [ref=e264]
                    - button "Delete session E2E missing Implementer write parent" [ref=e267]:
                      - img [ref=e268]
                    - button "Expand child conversations for E2E missing Implementer write parent" [ref=e271]:
                      - generic [ref=e272]:
                        - img [ref=e273]
                        - generic [ref=e275]: "6"
                - generic [ref=e277] [cursor=pointer]:
                  - generic [ref=e278]:
                    - generic [ref=e279]:
                      - generic "Root chat" [ref=e280]:
                        - img [ref=e281]
                      - generic [ref=e283]: AC26 Reload Test
                    - generic [ref=e284]:
                      - generic [ref=e285]: Default
                      - generic [ref=e286]: 10m ago
                  - generic [ref=e287]:
                    - button "Rename session AC26 Reload Test" [ref=e288]:
                      - img [ref=e289]
                    - button "Delete session AC26 Reload Test" [ref=e292]:
                      - img [ref=e293]
                - generic [ref=e297] [cursor=pointer]:
                  - generic [ref=e298]:
                    - generic [ref=e299]:
                      - generic "Root chat" [ref=e300]:
                        - img [ref=e301]
                      - generic [ref=e303]: New Chat
                    - generic [ref=e304]:
                      - generic [ref=e305]: Default
                      - generic [ref=e306]: 10m ago
                  - generic [ref=e307]:
                    - button "Rename session New Chat" [ref=e308]:
                      - img [ref=e309]
                    - button "Delete session New Chat" [ref=e312]:
                      - img [ref=e313]
                - generic [ref=e317] [cursor=pointer]:
                  - generic [ref=e318]:
                    - generic [ref=e319]:
                      - generic "Root chat" [ref=e320]:
                        - img [ref=e321]
                      - generic [ref=e323]: New Chat
                    - generic [ref=e324]:
                      - generic [ref=e325]: Default
                      - generic [ref=e326]: 10m ago
                  - generic [ref=e327]:
                    - button "Rename session New Chat" [ref=e328]:
                      - img [ref=e329]
                    - button "Delete session New Chat" [ref=e332]:
                      - img [ref=e333]
                - generic [ref=e337] [cursor=pointer]:
                  - generic [ref=e338]:
                    - generic [ref=e339]:
                      - generic "Root chat" [ref=e340]:
                        - img [ref=e341]
                      - generic [ref=e343]: New Chat
                    - generic [ref=e344]:
                      - generic [ref=e345]: Default
                      - generic [ref=e346]: 10m ago
                  - generic [ref=e347]:
                    - button "Rename session New Chat" [ref=e348]:
                      - img [ref=e349]
                    - button "Delete session New Chat" [ref=e352]:
                      - img [ref=e353]
                - generic [ref=e357] [cursor=pointer]:
                  - generic [ref=e358]:
                    - generic [ref=e359]:
                      - generic "Root chat" [ref=e360]:
                        - img [ref=e361]
                      - generic [ref=e363]: AC13 Rapid Enter Queue 1791118665743
                    - generic [ref=e364]:
                      - generic [ref=e365]: Default
                      - generic [ref=e366]: 10m ago
                  - generic [ref=e367]:
                    - button "Rename session AC13 Rapid Enter Queue 1791118665743" [ref=e368]:
                      - img [ref=e369]
                    - button "Delete session AC13 Rapid Enter Queue 1791118665743" [ref=e372]:
                      - img [ref=e373]
                - generic [ref=e377] [cursor=pointer]:
                  - generic [ref=e378]:
                    - generic [ref=e379]:
                      - generic "Root chat" [ref=e380]:
                        - img [ref=e381]
                      - generic [ref=e383]: AC13 Queue Test 1791118654816
                    - generic [ref=e384]:
                      - generic [ref=e385]: Default
                      - generic [ref=e386]: 11m ago
                  - generic [ref=e387]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e388]:
                      - img [ref=e389]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e392]:
                      - img [ref=e393]
                - generic [ref=e397] [cursor=pointer]:
                  - generic [ref=e398]:
                    - generic [ref=e399]:
                      - generic "Root chat" [ref=e400]:
                        - img [ref=e401]
                      - generic [ref=e403]: AC12 Reload Test
                    - generic [ref=e404]:
                      - generic [ref=e405]: Default
                      - generic [ref=e406]: 11m ago
                  - generic [ref=e407]:
                    - button "Rename session AC12 Reload Test" [ref=e408]:
                      - img [ref=e409]
                    - button "Delete session AC12 Reload Test" [ref=e412]:
                      - img [ref=e413]
                - generic [ref=e417] [cursor=pointer]:
                  - generic [ref=e418]:
                    - generic [ref=e419]:
                      - generic "Root chat" [ref=e420]:
                        - img [ref=e421]
                      - generic [ref=e423]: Interactive Q&A
                    - generic [ref=e424]:
                      - generic [ref=e425]: RaConsierge
                      - generic [ref=e426]: 11m ago
                  - generic [ref=e427]:
                    - button "Rename session Interactive Q&A" [ref=e428]:
                      - img [ref=e429]
                    - button "Delete session Interactive Q&A" [ref=e432]:
                      - img [ref=e433]
                - generic [ref=e437] [cursor=pointer]:
                  - generic [ref=e438]:
                    - generic [ref=e439]:
                      - generic "Root chat" [ref=e440]:
                        - img [ref=e441]
                      - generic [ref=e443]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e444]:
                      - generic [ref=e445]: Default
                      - generic [ref=e446]: 11m ago
                  - generic [ref=e447]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e448]:
                      - img [ref=e449]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e452]:
                      - img [ref=e453]
                - generic [ref=e457] [cursor=pointer]:
                  - generic [ref=e458]:
                    - generic [ref=e459]:
                      - generic "Root chat" [ref=e460]:
                        - img [ref=e461]
                      - generic [ref=e463]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e464]:
                      - generic [ref=e465]: Default
                      - generic [ref=e466]: 11m ago
                  - generic [ref=e467]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e468]:
                      - img [ref=e469]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e472]:
                      - img [ref=e473]
                - generic [ref=e477] [cursor=pointer]:
                  - generic [ref=e478]:
                    - generic [ref=e479]:
                      - generic "Root chat" [ref=e480]:
                        - img [ref=e481]
                      - generic [ref=e483]: Interactive Q&A
                    - generic [ref=e484]:
                      - generic [ref=e485]: RaConsierge
                      - generic [ref=e486]: 11m ago
                  - generic [ref=e487]:
                    - button "Rename session Interactive Q&A" [ref=e488]:
                      - img [ref=e489]
                    - button "Delete session Interactive Q&A" [ref=e492]:
                      - img [ref=e493]
                - generic [ref=e497] [cursor=pointer]:
                  - generic [ref=e498]:
                    - generic [ref=e499]:
                      - generic "Root chat" [ref=e500]:
                        - img [ref=e501]
                      - generic [ref=e503]: Interactive Q&A
                    - generic [ref=e504]:
                      - generic [ref=e505]: RaConsierge
                      - generic [ref=e506]: 11m ago
                  - generic [ref=e507]:
                    - button "Rename session Interactive Q&A" [ref=e508]:
                      - img [ref=e509]
                    - button "Delete session Interactive Q&A" [ref=e512]:
                      - img [ref=e513]
                - generic [ref=e517] [cursor=pointer]:
                  - generic [ref=e518]:
                    - generic [ref=e519]:
                      - generic "Root chat" [ref=e520]:
                        - img [ref=e521]
                      - generic [ref=e523]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e524]:
                      - generic [ref=e525]: Default
                      - generic [ref=e526]: 12m ago
                  - generic [ref=e527]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e528]:
                      - img [ref=e529]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e532]:
                      - img [ref=e533]
            - button "Zewnętrzne 0" [expanded] [ref=e537]:
              - img [ref=e538]
              - img [ref=e540]
              - generic [ref=e542]: Zewnętrzne
              - generic [ref=e543]: "0"
            - button "Audyt 0" [expanded] [ref=e545]:
              - img [ref=e546]
              - img [ref=e548]
              - generic [ref=e550]: Audyt
              - generic [ref=e551]: "0"
            - button "Inne 0" [expanded] [ref=e553]:
              - img [ref=e554]
              - img [ref=e556]
              - generic [ref=e558]: Inne
              - generic [ref=e559]: "0"
            - generic [ref=e560]:
              - button "E2E Architecture Project 2" [expanded] [ref=e561]:
                - img [ref=e562]
                - img [ref=e564]
                - generic [ref=e566]: E2E Architecture Project
                - generic [ref=e567]: "2"
              - generic [ref=e568]:
                - generic [ref=e570] [cursor=pointer]:
                  - generic [ref=e571]:
                    - generic [ref=e572]:
                      - generic "Root chat" [ref=e573]:
                        - img [ref=e574]
                      - generic [ref=e576]: New Chat
                    - generic [ref=e577]:
                      - generic [ref=e578]: Default
                      - generic [ref=e579]: 9m ago
                  - generic [ref=e580]:
                    - button "Rename session New Chat" [ref=e581]:
                      - img [ref=e582]
                    - button "Delete session New Chat" [ref=e585]:
                      - img [ref=e586]
                - generic [ref=e590] [cursor=pointer]:
                  - generic [ref=e591]:
                    - generic [ref=e592]:
                      - generic "Root chat" [ref=e593]:
                        - img [ref=e594]
                      - generic [ref=e596]: New Chat
                    - generic [ref=e597]:
                      - generic [ref=e598]: Default
                      - generic [ref=e599]: 9m ago
                  - generic [ref=e600]:
                    - button "Rename session New Chat" [ref=e601]:
                      - img [ref=e602]
                    - button "Delete session New Chat" [ref=e605]:
                      - img [ref=e606]
      - generic [ref=e613]:
        - generic [ref=e614]:
          - generic [ref=e616]: Mock 429 Recovery 1791119314980-pag1s5
          - group "Widok konwersacji" [ref=e617]:
            - button "Chat" [pressed] [ref=e618]:
              - img [ref=e619]
              - generic [ref=e621]: Chat
            - button "Graf" [ref=e622]:
              - img [ref=e623]
              - generic [ref=e627]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e630]:
            - img [ref=e631]
            - generic [ref=e633]: Bez projektu
            - generic [ref=e634]: Sandbox VFS
            - img [ref=e635]
          - button "Files empty" [ref=e637]:
            - img [ref=e638]
            - generic [ref=e640]: Files
            - generic [ref=e641]: empty
          - button "~18k/32k" [ref=e643] [cursor=pointer]
          - generic "Local LLM" [ref=e644]
        - generic [ref=e648]:
          - paragraph [ref=e649]: Mock 429 Recovery 1791119314980-pag1s5
          - generic [ref=e650]:
            - generic [ref=e651]: K
            - heading "KALIO" [level=2] [ref=e652]
            - paragraph [ref=e653]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e654]:
            - generic [ref=e655]:
              - paragraph [ref=e656]: Mode
              - generic [ref=e657]:
                - button "Chat mode" [ref=e658] [cursor=pointer]
                - button "Workflow mode" [ref=e659] [cursor=pointer]
            - generic [ref=e660]:
              - generic [ref=e661]:
                - generic [ref=e662]: Persona
                - combobox "Persona" [ref=e664]:
                  - generic [ref=e665]: Default
                  - img [ref=e666]
              - generic [ref=e669]:
                - generic [ref=e670]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e671]:
                  - img [ref=e672]
                  - generic [ref=e674]: Bez projektu
                  - generic [ref=e675]: Sandbox VFS
                  - img [ref=e676]
            - generic [ref=e678]:
              - generic [ref=e679]: Provider and model
              - generic [ref=e680]:
                - generic [ref=e681]: Search providers and models
                - combobox "Provider and model" [ref=e682]
                - generic [ref=e683]:
                  - paragraph [ref=e684]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e685] [cursor=pointer]
              - paragraph [ref=e686]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e687]:
            - generic [ref=e688]:
              - generic [ref=e689]: Prompt
              - textbox "Prompt" [active] [ref=e690]:
                - /placeholder: Ask Default...
                - text: Please fail with a deterministic mock provider 429 [[mock:error:429]]
              - generic [ref=e691]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e692]:
              - button "What can you do?" [ref=e693] [cursor=pointer]
              - button "Build a calculator app" [ref=e694] [cursor=pointer]
              - button "Create a todo list" [ref=e695] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e696] [cursor=pointer]
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