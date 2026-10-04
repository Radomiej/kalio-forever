# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: llm-panel.spec.ts >> LLMPanel E2E >> can switch back to the env fallback after activating a saved credential
- Location: tests\llm-panel.spec.ts:103:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('provider-row-env')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('provider-row-env')

```

# Page snapshot

```yaml
- dialog "Settings" [ref=e4]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - heading "Settings" [level=2] [ref=e7]
      - button "Close settings" [ref=e8] [cursor=pointer]:
        - img [ref=e9]
    - generic [ref=e12]:
      - generic [ref=e13]:
        - button "LLM Settings" [active] [ref=e14] [cursor=pointer]:
          - img [ref=e15]
          - text: LLM Settings
        - button "Runtime Settings" [ref=e18] [cursor=pointer]:
          - img [ref=e19]
          - text: Runtime Settings
        - button "Conversation" [ref=e22] [cursor=pointer]:
          - img [ref=e23]
          - text: Conversation
        - button "HITL Approvals" [ref=e25] [cursor=pointer]:
          - img [ref=e26]
          - text: HITL Approvals
        - button "Audit Retention" [ref=e28] [cursor=pointer]:
          - img [ref=e29]
          - text: Audit Retention
        - button "Embeddings" [ref=e34] [cursor=pointer]:
          - img [ref=e35]
          - text: Embeddings
        - button "Web Search" [ref=e39] [cursor=pointer]:
          - img [ref=e40]
          - text: Web Search
        - button "Image Generation" [ref=e43] [cursor=pointer]:
          - img [ref=e44]
          - text: Image Generation
        - button "CLI Agents" [ref=e48] [cursor=pointer]:
          - img [ref=e49]
          - text: CLI Agents
        - button "Agent runtimes" [ref=e51] [cursor=pointer]:
          - img [ref=e52]
          - text: Agent runtimes
        - button "Development environments" [ref=e63] [cursor=pointer]:
          - img [ref=e64]
          - text: Development environments
        - button "MCP Servers" [ref=e68] [cursor=pointer]:
          - img [ref=e69]
          - text: MCP Servers
        - button "Allowed Paths" [ref=e71] [cursor=pointer]:
          - img [ref=e72]
          - text: Allowed Paths
        - button "Telegram" [ref=e74] [cursor=pointer]:
          - img [ref=e75]
          - text: Telegram
      - generic [ref=e81]:
        - generic [ref=e82]:
          - heading "LLM Settings" [level=2] [ref=e83]
          - paragraph [ref=e84]: Configure provider credentials and connection health. Active provider selection is stored in the database, and API keys remain write-only.
        - generic [ref=e85]:
          - generic [ref=e86]:
            - generic [ref=e87]:
              - heading "Connection check" [level=3] [ref=e88]
              - paragraph [ref=e89]: Selected as active and successfully tested are separate states.
            - generic [ref=e90]:
              - img [ref=e91]
              - generic [ref=e94]: Not tested
          - paragraph [ref=e95]: "Windows local provider hint: keep the local server running and use the Windows-reachable localhost URL."
        - generic [ref=e96]:
          - generic [ref=e97]:
            - heading "Providers" [level=3] [ref=e98]
            - paragraph [ref=e99]: Saved provider credentials. Activate one here to make it the active runtime provider.
          - status [ref=e100]: The current QA environment uses a test-only fallback. Mock is not offered as a selectable provider.
          - generic [ref=e102]:
            - generic [ref=e103] [cursor=pointer]:
              - button "E2E Env Fallback Test provider active" [ref=e104]:
                - img [ref=e105]
              - generic [ref=e108]:
                - generic [ref=e109]: ollama
                - generic [ref=e110]: E2E Env Fallback Test
                - generic [ref=e111]: e2e-saved-model-switch-check
                - generic [ref=e112]: active
              - img [ref=e113]
            - generic [ref=e115]:
              - generic [ref=e116]:
                - generic [ref=e117]: "Provider: ollama"
                - generic [ref=e118]:
                  - generic [ref=e119]: "Default model:"
                  - generic [ref=e120]: e2e-saved-model-switch-check
                  - button "Edit model for E2E Env Fallback Test" [ref=e121] [cursor=pointer]: Edit
                - generic [ref=e122]: API key stored securely — never exposed
              - generic [ref=e123]:
                - button "Test Connection" [ref=e124] [cursor=pointer]:
                  - img [ref=e125]
                  - text: Test Connection
                - button "Remove" [ref=e127] [cursor=pointer]:
                  - img [ref=e128]
                  - text: Remove
          - button "Add Provider" [ref=e131] [cursor=pointer]:
            - img [ref=e132]
            - text: Add Provider
```

# Test source

```ts
  30  |   });
  31  | 
  32  |   test('"Add Provider" button opens the add form', async ({ page }) => {
  33  |     await openLLMPanel(page);
  34  |     await expect(page.getByTestId('add-provider-form')).not.toBeVisible();
  35  |     await page.getByTestId('add-provider-btn').click();
  36  |     await expect(page.getByTestId('add-provider-form')).toBeVisible();
  37  |   });
  38  | 
  39  |   test('can fill in name, provider, apiKey, model', async ({ page }) => {
  40  |     await openLLMPanel(page);
  41  |     await page.getByTestId('add-provider-btn').click();
  42  | 
  43  |     await page.getByRole('textbox', { name: /name/i }).fill('E2E Test Key');
  44  |     await page.getByRole('button', { name: 'DeepSeek' }).click();
  45  |     await page.getByTestId('add-provider-apikey').fill('sk-e2e-test');
  46  |     const modelInput = page.getByTestId('add-provider-model');
  47  |     await expect(modelInput).toHaveValue('deepseek-reasoner');
  48  |     await modelInput.fill('deepseek-chat');
  49  | 
  50  |     // Verify values are set
  51  |     await expect(page.getByRole('textbox', { name: /name/i })).toHaveValue('E2E Test Key');
  52  |     await expect(page.getByTestId('add-provider-model')).toHaveValue('deepseek-chat');
  53  |   });
  54  | 
  55  |   test('cancel button closes the form without adding', async ({ page }) => {
  56  |     await openLLMPanel(page);
  57  |     const initialRows = await page.getByTestId(/^provider-row-/).count();
  58  |     await page.getByTestId('add-provider-btn').click();
  59  |     await page.getByRole('button', { name: 'Cancel' }).click();
  60  |     await expect(page.getByTestId('add-provider-form')).not.toBeVisible();
  61  |     await expect(page.getByTestId('add-provider-btn')).toBeVisible();
  62  |     expect(await page.getByTestId(/^provider-row-/).count()).toBe(initialRows);
  63  |   });
  64  | 
  65  |   test('after adding, credential appears in list', async ({ page }) => {
  66  |     await openLLMPanel(page);
  67  |     await page.getByTestId('add-provider-btn').click();
  68  | 
  69  |     await page.getByRole('textbox', { name: /name/i }).fill('E2E Ollama');
  70  |     await page.getByRole('button', { name: 'Ollama' }).click();
  71  |     await page.getByTestId('add-provider-apikey').fill('local');
  72  |     await page.getByTestId('add-provider-submit').click();
  73  | 
  74  |     await expect(page.getByText('E2E Ollama')).toBeVisible({ timeout: 5000 });
  75  | 
  76  |     // cleanup
  77  |     const rows = page.getByText('E2E Ollama');
  78  |     const row = rows.first().locator('xpath=ancestor::*[@data-testid[starts-with(., "provider-row-")]]');
  79  |     const testId = await row.getAttribute('data-testid');
  80  |     if (testId) await deleteCredential(page, testId.replace('provider-row-', ''));
  81  |   });
  82  | 
  83  |   test('activating a credential shows the active badge', async ({ page }) => {
  84  |     // Create a credential via API first
  85  |     const res = await page.request.post(`${API_BASE}/credentials`, {
  86  |       data: { name: 'E2E Activate Test', provider: 'ollama', apiKey: 'local', model: 'llama3.2' },
  87  |     });
  88  |     const cred = await res.json() as { id: string };
  89  | 
  90  |     try {
  91  |       await openLLMPanel(page);
  92  |       const row = page.getByTestId(`provider-row-${cred.id}`);
  93  |       await expect(row).toBeVisible();
  94  | 
  95  |       // Click the activate button (first button in row = circle/checkmark)
  96  |       await row.locator('button').first().click();
  97  |       await expect(row.getByText('active')).toBeVisible({ timeout: 5000 });
  98  |     } finally {
  99  |       await deleteCredential(page, cred.id);
  100 |     }
  101 |   });
  102 | 
  103 |   test('can switch back to the env fallback after activating a saved credential', async ({ page }) => {
  104 |     const previousActiveId = await getActiveCredentialId(page.request);
  105 |     await page.request.delete(`${API_BASE}/credentials/active`);
  106 |     const envModel = await getRuntimeModel(page);
  107 | 
  108 |     const res = await page.request.post(`${API_BASE}/credentials`, {
  109 |       data: {
  110 |         name: 'E2E Env Fallback Test',
  111 |         provider: 'ollama',
  112 |         apiKey: 'local',
  113 |         model: 'e2e-saved-model-switch-check',
  114 |       },
  115 |     });
  116 |     const cred = await res.json() as { id: string };
  117 | 
  118 |     try {
  119 |       await openLLMPanel(page);
  120 |       const row = page.getByTestId(`provider-row-${cred.id}`);
  121 |       await expect(row).toBeVisible();
  122 | 
  123 |       await row.locator('button').first().click();
  124 |       await expect(row.getByText('active')).toBeVisible({ timeout: 5000 });
  125 |       await page.getByTestId('settings-tab-runtime').click();
  126 |       await expect(page.getByTestId('model-selector')).toHaveValue('e2e-saved-model-switch-check');
  127 | 
  128 |       await page.getByTestId('settings-tab-llm').click();
  129 |       const envFallbackRow = page.getByTestId('provider-row-env');
> 130 |       await expect(envFallbackRow).toBeVisible();
      |                                    ^ Error: expect(locator).toBeVisible() failed
  131 |       await page.getByTestId('provider-activate-env').click();
  132 | 
  133 |       await expect(envFallbackRow).toContainText('active', { timeout: 5000 });
  134 |       await expect(row).not.toContainText('active');
  135 |       await page.getByTestId('settings-tab-runtime').click();
  136 |       await expect(page.getByTestId('model-selector')).toHaveValue(envModel);
  137 |     } finally {
  138 |       await restoreActiveCredential(page.request, previousActiveId);
  139 |       await deleteCredential(page, cred.id);
  140 |     }
  141 |   });
  142 | 
  143 |   test('deleting a credential removes it from the list', async ({ page }) => {
  144 |     const res = await page.request.post(`${API_BASE}/credentials`, {
  145 |       data: { name: 'E2E Delete Test', provider: 'ollama', apiKey: 'local', model: 'llama3.2' },
  146 |     });
  147 |     const cred = await res.json() as { id: string };
  148 | 
  149 |     await openLLMPanel(page);
  150 |     const row = page.getByTestId(`provider-row-${cred.id}`);
  151 |     await expect(row).toBeVisible({ timeout: 10_000 });
  152 | 
  153 |     // Click the trash/delete button (last button in row)
  154 |     await row.locator('button').last().click();
  155 |     await expect(row).not.toBeVisible({ timeout: 5000 });
  156 |   });
  157 | 
  158 |   test('context window slider updates the badge value', async ({ page }) => {
  159 |     await openLLMPanel(page);
  160 |     await page.getByTestId('settings-tab-runtime').click();
  161 |     const slider = page.getByTestId('context-window-slider');
  162 |     await expect(slider).toBeVisible();
  163 | 
  164 |     await slider.press('Home');
  165 |     for (let step = 0; step < 15; step += 1) {
  166 |       await slider.press('ArrowRight');
  167 |     }
  168 | 
  169 |     await expect(page.getByTestId('context-window-value')).toHaveText(/64k/, { timeout: 3000 });
  170 |   });
  171 | });
  172 | 
```