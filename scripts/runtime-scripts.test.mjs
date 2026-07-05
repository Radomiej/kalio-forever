import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stackManagerSource = readFileSync(new URL('./stack-manager.mjs', import.meta.url), 'utf8');
const stackStatusSource = readFileSync(new URL('./stack-status.mjs', import.meta.url), 'utf8');
const installScriptSource = readFileSync(new URL('./install.ps1', import.meta.url), 'utf8');
const autostartScriptSource = readFileSync(new URL('./kalio-autostart.ps1', import.meta.url), 'utf8');
const prodScriptSource = readFileSync(new URL('../start-prod.ps1', import.meta.url), 'utf8');
const quickstartSource = readFileSync(new URL('../docs/quickstart-user.md', import.meta.url), 'utf8');
const localDevGuideSource = readFileSync(new URL('../docs/local-dev-guide.md', import.meta.url), 'utf8');
const scriptsReadmeSource = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const ac13QaStackSource = readFileSync(new URL('./run-ac13-qa-stack.mjs', import.meta.url), 'utf8');
const workflowReleaseGateSource = readFileSync(new URL('./workflow-release-gate.mjs', import.meta.url), 'utf8');
const webViteConfigSource = readFileSync(new URL('../apps/kalio-web/vite.config.ts', import.meta.url), 'utf8');

test('prod stack fallback paths use prod defaults when --data-root is omitted', () => {
  assert.match(
    stackManagerSource,
    /const defaultDatabasePath = isProdProfile \? resolve\(repoRoot, 'data\/kalio\.db'\) : databasePath;/,
  );
  assert.match(
    stackManagerSource,
    /const defaultWorkspaceRoot = isProdProfile \? resolve\(repoRoot, 'data\/workspaces'\) : workspaceRoot;/,
  );
  assert.match(
    stackManagerSource,
    /const defaultMemoryDbPath = isProdProfile \? resolve\(repoRoot, 'data\/memory'\) : resolve\(repoRoot, 'data\/memory-qa'\);/,
  );
  assert.match(
    stackManagerSource,
    /const defaultEmbeddingCacheDir = isProdProfile \? resolve\(repoRoot, 'data\/embeddings-cache'\) : resolve\(repoRoot, 'data\/embeddings-cache-qa'\);/,
  );
});

test('installer stops managed stack before checking install target ports during upgrade', () => {
  const stopIndex = installScriptSource.indexOf("Write-Step 'Stopping any existing managed stack'");
  const backendPortCheckIndex = installScriptSource.indexOf('Test-PortFree -Port $BackendPort');
  const frontendPortCheckIndex = installScriptSource.indexOf('Test-PortFree -Port $FrontendPort');

  assert.notEqual(stopIndex, -1, 'stop step not found');
  assert.notEqual(backendPortCheckIndex, -1, 'backend port check not found');
  assert.notEqual(frontendPortCheckIndex, -1, 'frontend port check not found');
  assert.ok(stopIndex < backendPortCheckIndex, 'existing stack should stop before backend port check');
  assert.ok(stopIndex < frontendPortCheckIndex, 'existing stack should stop before frontend port check');
});

test('autostart docs and scripts describe logon-based startup, not reboot startup', () => {
  assert.doesNotMatch(quickstartSource, /after \*\*system reboot/i);
  assert.doesNotMatch(localDevGuideSource, /after \*\*system reboot/i);
  assert.doesNotMatch(scriptsReadmeSource, /after reboot/i);
  assert.doesNotMatch(installScriptSource, /after user logon \/ system reboot/i);
  assert.doesNotMatch(autostartScriptSource, /after logon \/ system reboot/i);

  assert.match(quickstartSource, /after \*\*user sign-in\*\*/i);
  assert.match(localDevGuideSource, /for autostart after \*\*user sign-in\*\*/i);
  assert.match(scriptsReadmeSource, /Scheduled Task entrypoint after Windows sign-in/i);
  assert.match(installScriptSource, /At logon/);
  assert.match(autostartScriptSource, /Scheduled Task after Windows sign-in/i);
});

test('fixed QA mock mode forces env LLM so stale DB credentials cannot override mock', () => {
  assert.match(stackManagerSource, /--force-env-llm/);
  assert.match(stackManagerSource, /KALIO_FORCE_ENV_LLM: forceEnvLlm \? '1'/);
  assert.match(stackManagerSource, /forceEnvLlm: backendEnv\.KALIO_FORCE_ENV_LLM === '1'/);
  assert.match(stackManagerSource, /KALIO_MOCK_LLM_FAST: getArgValue\(args, '--provider'/);
  assert.match(stackManagerSource, /fastMockLlm: backendEnv\.KALIO_MOCK_LLM_FAST === '1'/);
  assert.match(
    readFileSync(new URL('../start-qa.ps1', import.meta.url), 'utf8'),
    /\$stackArgs \+= "--force-env-llm"/,
  );
});

test('fixed QA launcher builds dist by default and requires explicit SkipBuild for reuse', () => {
  const qaScriptSource = readFileSync(new URL('../start-qa.ps1', import.meta.url), 'utf8');
  assert.match(qaScriptSource, /\[switch\]\$SkipBuild/);
  assert.match(qaScriptSource, /if \(\$SkipBuild\) \{\s*\$stackArgs \+= "--skip-build"/);
  assert.doesNotMatch(qaScriptSource, /if \(-not \$Rebuild\) \{\s*\$stackArgs \+= "--skip-build"/);
});

test('prod launcher reads canonical stack-manager status instead of a legacy state path', () => {
  assert.match(prodScriptSource, /\$statusJson = & \$nodeCmd\.Source \(Join-Path \$root 'scripts\\stack-manager\.mjs'\) 'status' '--json'/);
  assert.match(prodScriptSource, /\$state = \$status\.state/);
  assert.doesNotMatch(prodScriptSource, /\.kalio-stack\\qa-stack-state\.json/);
});

test('stack manager refreshes managed PIDs from live port owners and refuses unmanaged port reuse', () => {
  assert.match(stackManagerSource, /async function resolveListeningPid\(port\)/);
  assert.match(stackManagerSource, /async function refreshStatePortOwners\(state\)/);
  assert.match(stackManagerSource, /async function ensureRequestedPortsAreFree\(ports\)/);
  assert.match(stackManagerSource, /await ensureRequestedPortsAreFree\(\[backendPort, frontendPort\]\);/);
  assert.match(stackManagerSource, /await refreshStatePortOwners\(readState\(\)\);/);
  assert.match(stackManagerSource, /const state = await refreshStatePortOwners\(readState\(\)\);/);
  assert.match(stackManagerSource, /const state = await refreshStatePortOwners\(readState\(\) \?\? readLastState\(\)\);/);
  assert.match(stackManagerSource, /requested ports already in use by unmanaged listeners/);
  assert.match(stackManagerSource, /async function detectKnownManagedPortConflicts\(\)/);
  assert.match(stackManagerSource, /buildStackStatusReport\(\{ status: 'unmanaged listeners'/);
});

test('managed stack status reports effective live llm config from the backend api', () => {
  assert.match(stackManagerSource, /renderEffectiveLlmLine/);
  assert.match(stackStatusSource, /effectiveLlm: await readEffectiveLlmConfig\(state, fetchImpl\)/);
  assert.match(stackStatusSource, /`\$\{apiUrl\}\/llm\/config`/);
  assert.match(ac13QaStackSource, /readEffectiveLlmConfig/);
});

test('stack manager prefers ignored test env values over base env file values', () => {
  assert.match(stackManagerSource, /const fileEnv = \{\s*\.\.\.readEnvFile\(resolveEnvFilePath\(envFile\)\),\s*\.\.\.readEnvFile\(resolveEnvFilePath\(testEnvFile\)\),\s*\};/);
});

test('workflow release gate refreshes frontend runtime config before browser checks', () => {
  assert.match(workflowReleaseGateSource, /function writeFrontendRuntimeConfig\(backendUrl\)/);
  assert.match(workflowReleaseGateSource, /runtime-config\.js/);
  assert.match(workflowReleaseGateSource, /JSON\.stringify\(\{ apiUrl: backendUrl, wsUrl: backendUrl \}\)/);

  const writeIndex = workflowReleaseGateSource.indexOf('writeFrontendRuntimeConfig(apiOrigin);');
  const runIndex = workflowReleaseGateSource.indexOf('await runPlaywrightGroup(group, baseUrl, apiOrigin, status.state);');

  assert.notEqual(writeIndex, -1, 'runtime config refresh call not found');
  assert.notEqual(runIndex, -1, 'Playwright gate call not found');
  assert.ok(writeIndex < runIndex, 'runtime config must be refreshed before Playwright opens the app');
});

test('vite preview serves runtime config from the running process environment', () => {
  assert.match(webViteConfigSource, /function runtimeConfigPlugin\(\): Plugin/);
  assert.match(webViteConfigSource, /configurePreviewServer\(server\)/);
  assert.match(webViteConfigSource, /server\.middlewares\.use\('\/runtime-config\.js', serveRuntimeConfig\)/);
  assert.match(webViteConfigSource, /JSON\.stringify\(\{ apiUrl: apiOrigin, wsUrl: wsOrigin \}\)/);
  assert.match(webViteConfigSource, /Cache-Control', 'no-store'/);
});

test('workflow release gate passes managed QA database path to Playwright tests', () => {
  assert.match(workflowReleaseGateSource, /DATABASE_PATH: stackState\.databasePath/);
  assert.match(workflowReleaseGateSource, /runPlaywrightGroup\(group, baseUrl, apiOrigin, status\.state\)/);
});

test('workflow release gate starts a fresh mock QA stack by default', () => {
  assert.match(workflowReleaseGateSource, /const reuseStack = args\.has\('--reuse-stack'\) \|\| requireLive;/);
  assert.match(workflowReleaseGateSource, /async function ensureFreshMockStackUnlessReusing\(\)/);
  assert.match(workflowReleaseGateSource, /'start',\s*'--backend-port',\s*'0',\s*'--frontend-port',\s*'0'/s);
  assert.match(workflowReleaseGateSource, /'--provider',\s*'mock',\s*'--model',\s*'mock'/s);
  assert.match(workflowReleaseGateSource, /'--force-env-llm',\s*'--force-restart',\s*'--runtime',\s*'direct'/s);

  const freshIndex = workflowReleaseGateSource.indexOf('await ensureFreshMockStackUnlessReusing();');
  const statusIndex = workflowReleaseGateSource.indexOf('const status = await readStackStatus();');
  assert.notEqual(freshIndex, -1, 'fresh stack guard call not found');
  assert.notEqual(statusIndex, -1, 'stack status read not found');
  assert.ok(freshIndex < statusIndex, 'release gate must start/verify the fresh stack before reading status');
});

test('workflow release gate uses an isolated data root for fresh mock QA runs', () => {
  assert.match(workflowReleaseGateSource, /function createWorkflowGateDataRoot\(\)/);
  assert.match(workflowReleaseGateSource, /'--data-root',\s*createWorkflowGateDataRoot\(\)/s);
});

test('workflow release gate does not use fixed quiet-time waits as runtime proof', () => {
  assert.doesNotMatch(workflowReleaseGateSource, /waitForRuntimeAuditQuiet/);
  assert.doesNotMatch(workflowReleaseGateSource, /runtimeAuditQuiet/);
  assert.doesNotMatch(workflowReleaseGateSource, /setTimeout/);

  const groupIndex = workflowReleaseGateSource.indexOf('await runPlaywrightGroup(group, baseUrl, apiOrigin, status.state);');
  assert.notEqual(groupIndex, -1, 'group run call not found');
});

test('live workflow release gate runs paid readiness before browser workflow checks', () => {
  assert.match(workflowReleaseGateSource, /async function runLiveReadinessGate\(apiOrigin\)/);
  assert.match(workflowReleaseGateSource, /scripts\/agentflow-paid-readiness\.mjs/);
  assert.match(workflowReleaseGateSource, /'--api',\s*`\$\{apiOrigin\}\/api`/s);

  const liveGuardIndex = workflowReleaseGateSource.indexOf('if (requireLive) {');
  const readinessIndex = workflowReleaseGateSource.indexOf('await runLiveReadinessGate(apiOrigin);');
  const groupIndex = workflowReleaseGateSource.indexOf('await runPlaywrightGroup(group, baseUrl, apiOrigin, status.state);');

  assert.notEqual(liveGuardIndex, -1, 'live guard not found');
  assert.notEqual(readinessIndex, -1, 'live readiness call not found');
  assert.notEqual(groupIndex, -1, 'Playwright gate call not found');
  assert.ok(liveGuardIndex < readinessIndex, 'live readiness must run only inside the live guard');
  assert.ok(readinessIndex < groupIndex, 'live readiness must pass before browser workflow checks start');
});

test('workflow release gate includes recent runtime regression proof groups', () => {
  assert.match(workflowReleaseGateSource, /name: 'RA-App HITL gate'/);
  assert.match(workflowReleaseGateSource, /manual mode shows tool confirmation and RA-App approval overlay/);
  assert.match(workflowReleaseGateSource, /bypass mode auto-executes tool confirmation and RA-App approval/);

  assert.match(workflowReleaseGateSource, /name: 'child session live HITL gate'/);
  assert.match(workflowReleaseGateSource, /child session receives live HITL and confirms without reload/);
  assert.match(workflowReleaseGateSource, /auto-approved child tool completes without creating manual confirmation/);

  assert.match(workflowReleaseGateSource, /name: 'AgentFlow Goal Guard gate'/);
  assert.match(workflowReleaseGateSource, /renders parent run_sub_agentflow history bubble/);
  assert.match(workflowReleaseGateSource, /starts a two-agent Goal Guard AgentFlow/);
  assert.match(workflowReleaseGateSource, /keeps a Talk-started durable AgentFlow result fresh after child completion and reload/);

  assert.match(workflowReleaseGateSource, /name: 'workflow failure projection gate'/);
  assert.match(workflowReleaseGateSource, /malformed router structured output becomes terminal failed graph state/);

  assert.match(workflowReleaseGateSource, /name: 'workflow follow-up hydration gate'/);
  assert.match(workflowReleaseGateSource, /keeps the earlier workflow bubble stable/);

  assert.match(workflowReleaseGateSource, /name: 'sequential router-chain gate'/);
  assert.match(workflowReleaseGateSource, /renders a sequential router chain without collapsing it into a parallel council/);

  assert.match(workflowReleaseGateSource, /name: 'architect UI variant runtime gate'/);
  assert.match(workflowReleaseGateSource, /saves an Architect UI variant and runs it through Talk workflow mode/);

  assert.match(workflowReleaseGateSource, /name: 'cross-browser workflow replay gate'/);
  assert.match(workflowReleaseGateSource, /a second browser session restores host state, child transcripts, and technical node notes/);
});

test('managed stack builds inherit the caller environment before runtime overrides', () => {
  assert.match(
    stackManagerSource,
    /env: \{ \.\.\.process\.env, \.\.\.backendEnv, \.\.\.pathEnv \}/,
  );
  assert.match(
    stackManagerSource,
    /env: \{ \.\.\.process\.env, \.\.\.frontendEnv, \.\.\.pathEnv \}/,
  );
});
