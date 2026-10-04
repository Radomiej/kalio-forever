# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-stop-runtime.spec.ts >> workflow stop on built QA >> workflow stop clears the stop action after a workflow launch
- Location: tests\workflow-stop-runtime.spec.ts:37:7

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
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
    113 × waiting for element to be visible, enabled and stable
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
            - generic [ref=e68]: 52 chats
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
              - button "Bez projektu 26" [expanded] [ref=e84]:
                - img [ref=e85]
                - img [ref=e87]
                - generic [ref=e89]: Bez projektu
                - generic [ref=e90]: "26"
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
                - generic [ref=e113] [cursor=pointer]:
                  - generic [ref=e114]:
                    - generic [ref=e115]:
                      - generic "Root chat" [ref=e116]:
                        - img [ref=e117]
                      - generic [ref=e119]: Child auto approve 1791119355963
                    - generic [ref=e120]:
                      - generic [ref=e121]: Default
                      - generic [ref=e122]: 2m ago
                  - generic [ref=e123]:
                    - button "Rename session Child auto approve 1791119355963" [ref=e124]:
                      - img [ref=e125]
                    - button "Delete session Child auto approve 1791119355963" [ref=e128]:
                      - img [ref=e129]
                - generic [ref=e133] [cursor=pointer]:
                  - generic [ref=e134]:
                    - generic [ref=e135]:
                      - generic "Root chat" [ref=e136]:
                        - img [ref=e137]
                      - generic [ref=e139]: Child HITL 1791119349984
                    - generic [ref=e140]:
                      - generic [ref=e141]: Default
                      - generic [ref=e142]: 3m ago
                  - generic [ref=e143]:
                    - button "Rename session Child HITL 1791119349984" [ref=e144]:
                      - img [ref=e145]
                    - button "Delete session Child HITL 1791119349984" [ref=e148]:
                      - img [ref=e149]
                - generic [ref=e153] [cursor=pointer]:
                  - generic [ref=e154]:
                    - generic [ref=e155]:
                      - generic "Root chat" [ref=e156]:
                        - img [ref=e157]
                      - generic [ref=e159]: New Chat
                    - generic [ref=e160]:
                      - generic [ref=e161]: Default
                      - generic [ref=e162]: 3m ago
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
                      - generic [ref=e182]: 3m ago
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
                      - generic [ref=e199]: Hello Explicit Launch Gate
                    - generic [ref=e200]:
                      - generic [ref=e201]: Default
                      - generic [ref=e202]: 3m ago
                  - generic [ref=e203]:
                    - button "Rename session Hello Explicit Launch Gate" [ref=e204]:
                      - img [ref=e205]
                    - button "Delete session Hello Explicit Launch Gate" [ref=e208]:
                      - img [ref=e209]
                - generic [ref=e213] [cursor=pointer]:
                  - generic [ref=e214]:
                    - generic [ref=e215]:
                      - generic "Root chat" [ref=e216]:
                        - img [ref=e217]
                      - generic [ref=e219]: Native audit fixture 1791119318096
                    - generic [ref=e220]:
                      - generic [ref=e221]: Default
                      - generic [ref=e222]: 3m ago
                  - generic [ref=e223]:
                    - button "Rename session Native audit fixture 1791119318096" [ref=e224]:
                      - img [ref=e225]
                    - button "Delete session Native audit fixture 1791119318096" [ref=e228]:
                      - img [ref=e229]
                - generic [ref=e233] [cursor=pointer]:
                  - generic [ref=e234]:
                    - generic [ref=e235]:
                      - generic "Root chat" [ref=e236]:
                        - img [ref=e237]
                      - generic [ref=e239]: New Chat
                    - generic [ref=e240]:
                      - generic [ref=e241]: Default
                      - generic [ref=e242]: 3m ago
                  - generic [ref=e243]:
                    - button "Rename session New Chat" [ref=e244]:
                      - img [ref=e245]
                    - button "Delete session New Chat" [ref=e248]:
                      - img [ref=e249]
                - generic [ref=e253] [cursor=pointer]:
                  - generic [ref=e254]:
                    - generic [ref=e255]:
                      - generic "Root chat" [ref=e256]:
                        - img [ref=e257]
                      - generic [ref=e259]: New Chat
                    - generic [ref=e260]:
                      - generic [ref=e261]: Default
                      - generic [ref=e262]: 3m ago
                  - generic [ref=e263]:
                    - button "Rename session New Chat" [ref=e264]:
                      - img [ref=e265]
                    - button "Delete session New Chat" [ref=e268]:
                      - img [ref=e269]
                - generic [ref=e274] [cursor=pointer]:
                  - generic [ref=e275]:
                    - generic [ref=e276]:
                      - generic "Root chat" [ref=e277]:
                        - img [ref=e278]
                      - generic [ref=e280]: AgentFlow nested restart 1791118723436
                    - generic [ref=e281]:
                      - generic [ref=e282]: Default
                      - generic [ref=e283]: 13m ago
                  - generic [ref=e284]:
                    - button "Rename session AgentFlow nested restart 1791118723436" [ref=e285]:
                      - img [ref=e286]
                    - button "Delete session AgentFlow nested restart 1791118723436" [ref=e289]:
                      - img [ref=e290]
                    - button "Expand child conversations for AgentFlow nested restart 1791118723436" [ref=e293]:
                      - generic [ref=e294]:
                        - img [ref=e295]
                        - generic [ref=e297]: "7"
                - generic [ref=e300] [cursor=pointer]:
                  - generic [ref=e301]:
                    - generic [ref=e302]:
                      - generic "Root chat" [ref=e303]:
                        - img [ref=e304]
                      - generic [ref=e306]: E2E resumable AgentFlow parent
                    - generic [ref=e307]:
                      - generic [ref=e308]: Default
                      - generic [ref=e309]: 13m ago
                  - generic [ref=e310]:
                    - button "Rename session E2E resumable AgentFlow parent" [ref=e311]:
                      - img [ref=e312]
                    - button "Delete session E2E resumable AgentFlow parent" [ref=e315]:
                      - img [ref=e316]
                    - button "Expand child conversations for E2E resumable AgentFlow parent" [ref=e319]:
                      - generic [ref=e320]:
                        - img [ref=e321]
                        - generic [ref=e323]: "6"
                - generic [ref=e325] [cursor=pointer]:
                  - generic [ref=e326]:
                    - generic [ref=e327]:
                      - generic "Root chat" [ref=e328]:
                        - img [ref=e329]
                      - generic [ref=e331]: E2E invalid AgentFlow schema parent
                    - generic [ref=e332]:
                      - generic [ref=e333]: Default
                      - generic [ref=e334]: 13m ago
                  - generic [ref=e335]:
                    - button "Rename session E2E invalid AgentFlow schema parent" [ref=e336]:
                      - img [ref=e337]
                    - button "Delete session E2E invalid AgentFlow schema parent" [ref=e340]:
                      - img [ref=e341]
                - generic [ref=e346] [cursor=pointer]:
                  - generic [ref=e347]:
                    - generic [ref=e348]:
                      - generic "Root chat" [ref=e349]:
                        - img [ref=e350]
                      - generic [ref=e352]: E2E missing Implementer write parent
                    - generic [ref=e353]:
                      - generic [ref=e354]: Default
                      - generic [ref=e355]: 13m ago
                  - generic [ref=e356]:
                    - button "Rename session E2E missing Implementer write parent" [ref=e357]:
                      - img [ref=e358]
                    - button "Delete session E2E missing Implementer write parent" [ref=e361]:
                      - img [ref=e362]
                    - button "Expand child conversations for E2E missing Implementer write parent" [ref=e365]:
                      - generic [ref=e366]:
                        - img [ref=e367]
                        - generic [ref=e369]: "6"
                - generic [ref=e371] [cursor=pointer]:
                  - generic [ref=e372]:
                    - generic [ref=e373]:
                      - generic "Root chat" [ref=e374]:
                        - img [ref=e375]
                      - generic [ref=e377]: AC26 Reload Test
                    - generic [ref=e378]:
                      - generic [ref=e379]: Default
                      - generic [ref=e380]: 13m ago
                  - generic [ref=e381]:
                    - button "Rename session AC26 Reload Test" [ref=e382]:
                      - img [ref=e383]
                    - button "Delete session AC26 Reload Test" [ref=e386]:
                      - img [ref=e387]
                - generic [ref=e391] [cursor=pointer]:
                  - generic [ref=e392]:
                    - generic [ref=e393]:
                      - generic "Root chat" [ref=e394]:
                        - img [ref=e395]
                      - generic [ref=e397]: New Chat
                    - generic [ref=e398]:
                      - generic [ref=e399]: Default
                      - generic [ref=e400]: 14m ago
                  - generic [ref=e401]:
                    - button "Rename session New Chat" [ref=e402]:
                      - img [ref=e403]
                    - button "Delete session New Chat" [ref=e406]:
                      - img [ref=e407]
                - generic [ref=e411] [cursor=pointer]:
                  - generic [ref=e412]:
                    - generic [ref=e413]:
                      - generic "Root chat" [ref=e414]:
                        - img [ref=e415]
                      - generic [ref=e417]: New Chat
                    - generic [ref=e418]:
                      - generic [ref=e419]: Default
                      - generic [ref=e420]: 14m ago
                  - generic [ref=e421]:
                    - button "Rename session New Chat" [ref=e422]:
                      - img [ref=e423]
                    - button "Delete session New Chat" [ref=e426]:
                      - img [ref=e427]
                - generic [ref=e431] [cursor=pointer]:
                  - generic [ref=e432]:
                    - generic [ref=e433]:
                      - generic "Root chat" [ref=e434]:
                        - img [ref=e435]
                      - generic [ref=e437]: New Chat
                    - generic [ref=e438]:
                      - generic [ref=e439]: Default
                      - generic [ref=e440]: 14m ago
                  - generic [ref=e441]:
                    - button "Rename session New Chat" [ref=e442]:
                      - img [ref=e443]
                    - button "Delete session New Chat" [ref=e446]:
                      - img [ref=e447]
                - generic [ref=e451] [cursor=pointer]:
                  - generic [ref=e452]:
                    - generic [ref=e453]:
                      - generic "Root chat" [ref=e454]:
                        - img [ref=e455]
                      - generic [ref=e457]: AC13 Rapid Enter Queue 1791118665743
                    - generic [ref=e458]:
                      - generic [ref=e459]: Default
                      - generic [ref=e460]: 14m ago
                  - generic [ref=e461]:
                    - button "Rename session AC13 Rapid Enter Queue 1791118665743" [ref=e462]:
                      - img [ref=e463]
                    - button "Delete session AC13 Rapid Enter Queue 1791118665743" [ref=e466]:
                      - img [ref=e467]
                - generic [ref=e471] [cursor=pointer]:
                  - generic [ref=e472]:
                    - generic [ref=e473]:
                      - generic "Root chat" [ref=e474]:
                        - img [ref=e475]
                      - generic [ref=e477]: AC13 Queue Test 1791118654816
                    - generic [ref=e478]:
                      - generic [ref=e479]: Default
                      - generic [ref=e480]: 14m ago
                  - generic [ref=e481]:
                    - button "Rename session AC13 Queue Test 1791118654816" [ref=e482]:
                      - img [ref=e483]
                    - button "Delete session AC13 Queue Test 1791118654816" [ref=e486]:
                      - img [ref=e487]
                - generic [ref=e491] [cursor=pointer]:
                  - generic [ref=e492]:
                    - generic [ref=e493]:
                      - generic "Root chat" [ref=e494]:
                        - img [ref=e495]
                      - generic [ref=e497]: AC12 Reload Test
                    - generic [ref=e498]:
                      - generic [ref=e499]: Default
                      - generic [ref=e500]: 14m ago
                  - generic [ref=e501]:
                    - button "Rename session AC12 Reload Test" [ref=e502]:
                      - img [ref=e503]
                    - button "Delete session AC12 Reload Test" [ref=e506]:
                      - img [ref=e507]
                - generic [ref=e511] [cursor=pointer]:
                  - generic [ref=e512]:
                    - generic [ref=e513]:
                      - generic "Root chat" [ref=e514]:
                        - img [ref=e515]
                      - generic [ref=e517]: Interactive Q&A
                    - generic [ref=e518]:
                      - generic [ref=e519]: RaConsierge
                      - generic [ref=e520]: 14m ago
                  - generic [ref=e521]:
                    - button "Rename session Interactive Q&A" [ref=e522]:
                      - img [ref=e523]
                    - button "Delete session Interactive Q&A" [ref=e526]:
                      - img [ref=e527]
                - generic [ref=e531] [cursor=pointer]:
                  - generic [ref=e532]:
                    - generic [ref=e533]:
                      - generic "Root chat" [ref=e534]:
                        - img [ref=e535]
                      - generic [ref=e537]: AC10 Multi-Turn Test 1791118642235-k6nylz
                    - generic [ref=e538]:
                      - generic [ref=e539]: Default
                      - generic [ref=e540]: 14m ago
                  - generic [ref=e541]:
                    - button "Rename session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e542]:
                      - img [ref=e543]
                    - button "Delete session AC10 Multi-Turn Test 1791118642235-k6nylz" [ref=e546]:
                      - img [ref=e547]
                - generic [ref=e551] [cursor=pointer]:
                  - generic [ref=e552]:
                    - generic [ref=e553]:
                      - generic "Root chat" [ref=e554]:
                        - img [ref=e555]
                      - generic [ref=e557]: AC10 Streaming Test 1791118638880-69lowb
                    - generic [ref=e558]:
                      - generic [ref=e559]: Default
                      - generic [ref=e560]: 14m ago
                  - generic [ref=e561]:
                    - button "Rename session AC10 Streaming Test 1791118638880-69lowb" [ref=e562]:
                      - img [ref=e563]
                    - button "Delete session AC10 Streaming Test 1791118638880-69lowb" [ref=e566]:
                      - img [ref=e567]
                - generic [ref=e571] [cursor=pointer]:
                  - generic [ref=e572]:
                    - generic [ref=e573]:
                      - generic "Root chat" [ref=e574]:
                        - img [ref=e575]
                      - generic [ref=e577]: Interactive Q&A
                    - generic [ref=e578]:
                      - generic [ref=e579]: RaConsierge
                      - generic [ref=e580]: 14m ago
                  - generic [ref=e581]:
                    - button "Rename session Interactive Q&A" [ref=e582]:
                      - img [ref=e583]
                    - button "Delete session Interactive Q&A" [ref=e586]:
                      - img [ref=e587]
                - generic [ref=e591] [cursor=pointer]:
                  - generic [ref=e592]:
                    - generic [ref=e593]:
                      - generic "Root chat" [ref=e594]:
                        - img [ref=e595]
                      - generic [ref=e597]: Interactive Q&A
                    - generic [ref=e598]:
                      - generic [ref=e599]: RaConsierge
                      - generic [ref=e600]: 14m ago
                  - generic [ref=e601]:
                    - button "Rename session Interactive Q&A" [ref=e602]:
                      - img [ref=e603]
                    - button "Delete session Interactive Q&A" [ref=e606]:
                      - img [ref=e607]
                - generic [ref=e611] [cursor=pointer]:
                  - generic [ref=e612]:
                    - generic [ref=e613]:
                      - generic "Root chat" [ref=e614]:
                        - img [ref=e615]
                      - generic [ref=e617]: AC01 Streaming Test 1791118581825-g0pgng
                    - generic [ref=e618]:
                      - generic [ref=e619]: Default
                      - generic [ref=e620]: 15m ago
                  - generic [ref=e621]:
                    - button "Rename session AC01 Streaming Test 1791118581825-g0pgng" [ref=e622]:
                      - img [ref=e623]
                    - button "Delete session AC01 Streaming Test 1791118581825-g0pgng" [ref=e626]:
                      - img [ref=e627]
            - button "Zewnętrzne 0" [ref=e631]:
              - img [ref=e632]
              - img [ref=e634]
              - generic [ref=e636]: Zewnętrzne
              - generic [ref=e637]: "0"
            - button "Audyt 0" [ref=e639]:
              - img [ref=e640]
              - img [ref=e642]
              - generic [ref=e644]: Audyt
              - generic [ref=e645]: "0"
            - button "Inne 0" [ref=e647]:
              - img [ref=e648]
              - img [ref=e650]
              - generic [ref=e652]: Inne
              - generic [ref=e653]: "0"
            - button "E2E Architecture Project 2" [ref=e655]:
              - img [ref=e656]
              - img [ref=e658]
              - generic [ref=e660]: E2E Architecture Project
              - generic [ref=e661]: "2"
      - generic [ref=e666]:
        - generic [ref=e667]:
          - generic [ref=e669]: New Chat
          - group "Widok konwersacji" [ref=e670]:
            - button "Chat" [pressed] [ref=e671]:
              - img [ref=e672]
              - generic [ref=e674]: Chat
            - button "Graf" [ref=e675]:
              - img [ref=e676]
              - generic [ref=e680]: Graf
          - button "Bez projektu Sandbox VFS" [ref=e683]:
            - img [ref=e684]
            - generic [ref=e686]: Bez projektu
            - generic [ref=e687]: Sandbox VFS
            - img [ref=e688]
          - button "Files empty" [ref=e690]:
            - img [ref=e691]
            - generic [ref=e693]: Files
            - generic [ref=e694]: empty
          - button "~18k/32k" [ref=e696] [cursor=pointer]
          - generic "Local LLM" [ref=e697]
        - generic [ref=e701]:
          - paragraph [ref=e702]: New Chat
          - generic [ref=e703]:
            - generic [ref=e704]: K
            - heading "KALIO" [level=2] [ref=e705]
            - paragraph [ref=e706]: AI assistant - build apps, query data, generate images, run tools
          - generic [ref=e707]:
            - generic [ref=e708]:
              - paragraph [ref=e709]: Mode
              - generic [ref=e710]:
                - button "Chat mode" [ref=e711] [cursor=pointer]
                - button "Workflow mode" [ref=e712] [cursor=pointer]
            - generic [ref=e713]:
              - generic [ref=e714]:
                - generic [ref=e715]: Workflow
                - combobox "Workflow" [ref=e716]:
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
              - generic [ref=e718]:
                - generic [ref=e719]: Projekt
                - button "Bez projektu Sandbox VFS" [ref=e720]:
                  - img [ref=e721]
                  - generic [ref=e723]: Bez projektu
                  - generic [ref=e724]: Sandbox VFS
                  - img [ref=e725]
            - generic [ref=e727]:
              - generic [ref=e728]: Provider and model
              - generic [ref=e729]:
                - generic [ref=e730]: Search providers and models
                - combobox "Provider and model" [ref=e731]
                - generic [ref=e732]:
                  - paragraph [ref=e733]: Codex catalog only — all connected Codex accounts. Does not refresh Devin.
                  - button "Recheck Codex models" [ref=e734] [cursor=pointer]
              - paragraph [ref=e735]: Choose a connected runtime/provider and model for this conversation.
          - generic [ref=e736]:
            - generic [ref=e737]:
              - generic [ref=e738]: Prompt
              - textbox "Prompt" [active] [ref=e739]:
                - /placeholder: Run prompt through Strategic Decision Council
                - text: Evaluate the project architecture and keep the workflow running long enough for a stop request. [[mock:script]] hold(8000) return("controlled workflow stop target finished") [[/mock:script]]
              - generic [ref=e740]:
                - button "Run" [disabled]:
                  - img
                  - text: Run
            - generic [ref=e741]:
              - button "What can you do?" [ref=e742] [cursor=pointer]
              - button "Build a calculator app" [ref=e743] [cursor=pointer]
              - button "Create a todo list" [ref=e744] [cursor=pointer]
              - button "Generate an image of a fox" [ref=e745] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect, type Page } from '@playwright/test';
  2  | import {
  3  |   deleteSessionIfExists,
  4  |   expectComposerEnabled,
  5  |   selectArchitectureInComposer,
  6  | } from './helpers/test-config';
  7  |
  8  | const STOPPABLE_WORKFLOW_PROMPT = [
  9  |   'Evaluate the project architecture and keep the workflow running long enough for a stop request.',
  10 |   '[[mock:script]]',
  11 |   'hold(8000) return("controlled workflow stop target finished")',
  12 |   '[[/mock:script]]',
  13 | ].join('\n');
  14 |
  15 | async function clickStopButton(page: Page): Promise<void> {
  16 |   await expect
  17 |     .poll(async () => {
  18 |       const stopBtn = page.getByTestId('chat-stop-btn');
  19 |       if (!await stopBtn.isVisible().catch(() => false)) {
  20 |         return 'missing';
  21 |       }
  22 |       try {
  23 |         await stopBtn.click({ force: true, timeout: 1_000 });
  24 |         return 'clicked';
  25 |       } catch (error) {
  26 |         const message = error instanceof Error ? error.message : String(error);
  27 |         if (/detached|not attached|Timeout .*chat-stop-btn|waiting for getByTestId\('chat-stop-btn'\)/i.test(message)) {
  28 |           return 'retry';
  29 |         }
  30 |         throw error;
  31 |       }
  32 |     }, { timeout: 20_000 })
  33 |     .toBe('clicked');
  34 | }
  35 |
  36 | test.describe('workflow stop on built QA', () => {
  37 |   test('workflow stop clears the stop action after a workflow launch', async ({ page, request }) => {
  38 |     test.setTimeout(60_000);
  39 |
  40 |     let createdSessionId: string | null = null;
  41 |
  42 |     try {
  43 |       await page.goto('/');
  44 |       await page.getByTestId('nav-talk').click();
  45 |       await page.getByTestId('new-session-btn').click();
  46 |       await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 });
  47 |
  48 |       await selectArchitectureInComposer(page, 'strategic-decision-council');
  49 |       await page.getByTestId('welcome-prompt-input').fill(STOPPABLE_WORKFLOW_PROMPT);
> 50 |       await page.getByTestId('welcome-run-prompt').click();
     |                                                    ^ Error: locator.click: Test timeout of 60000ms exceeded.
  51 |
  52 |       createdSessionId = await page.evaluate(() => window.sessionStorage.getItem('kalio:last-active-session-id'));
  53 |
  54 |       await expect(page.getByTestId('architecture-run-timeline')).toBeVisible({ timeout: 20_000 });
  55 |       const stopBtn = page.getByTestId('chat-stop-btn');
  56 |       await expect(stopBtn).toBeVisible({ timeout: 20_000 });
  57 |
  58 |       await clickStopButton(page);
  59 |
  60 |       await expect(stopBtn).toBeHidden({ timeout: 20_000 });
  61 |       await expectComposerEnabled(page, 20_000);
  62 |       await expect(page.getByTestId('chat-queued-badge')).toHaveCount(0);
  63 |       await expect(page.getByTestId('pending-agent-bubble')).toHaveCount(0);
  64 |     } finally {
  65 |       if (createdSessionId) {
  66 |         await deleteSessionIfExists(request, createdSessionId);
  67 |       }
  68 |     }
  69 |   });
  70 | });
  71 |
```