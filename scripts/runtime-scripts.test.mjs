import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stackManagerSource = readFileSync(new URL('./stack-manager.mjs', import.meta.url), 'utf8');
const stackStatusSource = readFileSync(new URL('./stack-status.mjs', import.meta.url), 'utf8');
const installScriptSource = readFileSync(new URL('./install.ps1', import.meta.url), 'utf8');
const autostartScriptSource = readFileSync(new URL('./kalio-autostart.ps1', import.meta.url), 'utf8');
const quickstartSource = readFileSync(new URL('../docs/quickstart-user.md', import.meta.url), 'utf8');
const localDevGuideSource = readFileSync(new URL('../docs/local-dev-guide.md', import.meta.url), 'utf8');
const scriptsReadmeSource = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const ac13QaStackSource = readFileSync(new URL('./run-ac13-qa-stack.mjs', import.meta.url), 'utf8');

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
