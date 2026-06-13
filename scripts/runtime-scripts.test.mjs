import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stackManagerSource = readFileSync(new URL('./stack-manager.mjs', import.meta.url), 'utf8');
const installScriptSource = readFileSync(new URL('./install.ps1', import.meta.url), 'utf8');
const autostartScriptSource = readFileSync(new URL('./kalio-autostart.ps1', import.meta.url), 'utf8');
const quickstartSource = readFileSync(new URL('../docs/quickstart-user.md', import.meta.url), 'utf8');
const localDevGuideSource = readFileSync(new URL('../docs/local-dev-guide.md', import.meta.url), 'utf8');
const scriptsReadmeSource = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

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
