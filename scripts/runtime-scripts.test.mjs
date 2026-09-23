import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const stackManagerSource = readFileSync(new URL('./stack-manager.mjs', import.meta.url), 'utf8');
const stackStatusSource = readFileSync(new URL('./stack-status.mjs', import.meta.url), 'utf8');
const installScriptSource = readFileSync(new URL('./install.ps1', import.meta.url), 'utf8');
const installReleaseScriptSource = readFileSync(new URL('./install-release.ps1', import.meta.url), 'utf8');
const uninstallScriptSource = readFileSync(new URL('./uninstall.ps1', import.meta.url), 'utf8');
const prodScriptSource = readFileSync(new URL('../start-prod.ps1', import.meta.url), 'utf8');
const devScriptSource = readFileSync(new URL('../start-dev.ps1', import.meta.url), 'utf8');
const devCmdSource = readFileSync(new URL('../start-dev.cmd', import.meta.url), 'utf8');
const quickstartSource = readFileSync(new URL('../docs/quickstart-user.md', import.meta.url), 'utf8');
const localDevGuideSource = readFileSync(new URL('../docs/local-dev-guide.md', import.meta.url), 'utf8');
const rootReadmeSource = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const scriptsReadmeSource = readFileSync(new URL('./README.md', import.meta.url), 'utf8');
const ac13QaStackSource = readFileSync(new URL('./run-ac13-qa-stack.mjs', import.meta.url), 'utf8');
const workflowReleaseGateSource = readFileSync(new URL('./workflow-release-gate.mjs', import.meta.url), 'utf8');
const runtimePackageSource = readFileSync(new URL('./build-runtime-package.mjs', import.meta.url), 'utf8');
const runtimeCliSource = readFileSync(new URL('./kalio-cli.mjs', import.meta.url), 'utf8');
const webViteConfigSource = readFileSync(new URL('../apps/kalio-web/vite.config.ts', import.meta.url), 'utf8');
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const releaseManifestUrls = [
  '../package.json',
  '../apps/kalio-api/package.json',
  '../apps/kalio-web/package.json',
  '../apps/e2e/package.json',
  '../apps/kalio-video/package.json',
  '../apps/kalio-demo/package.json',
  '../packages/@kalio/types/package.json',
  '../packages/@kalio/sdk/package.json',
];

test('all workspace manifests match the root release version', () => {
  for (const manifestPath of releaseManifestUrls) {
    const manifest = JSON.parse(readFileSync(new URL(manifestPath, import.meta.url), 'utf8'));
    assert.equal(manifest.version, rootPackage.version, `${manifestPath} has a mismatched release version`);
  }
});

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

test('installer protects upgrades with a runtime lock and stable launcher', () => {
  assert.match(installScriptSource, /\.runtime\.lock/);
  assert.match(installScriptSource, /Kalio appears to be running/);
  assert.match(installScriptSource, /Removing stale runtime lock/);
  assert.match(installScriptSource, /Get-Process -Id \$lockOwner\.pid/);
  assert.match(installScriptSource, /kalio-launcher\.ps1/);
  assert.match(installScriptSource, /current\.json/);
});

test('runtime launcher recovers only a stale lock with a confirmed dead pid', () => {
  assert.match(runtimeCliSource, /process\.kill\(pid, 0\)/);
  assert.match(runtimeCliSource, /await rm\(lockPath, \{ force: true \}\)/);
  assert.match(runtimeCliSource, /Removing stale runtime lock/);
  assert.match(runtimeCliSource, /Another Kalio runtime appears to be running/);
});

test('Windows installer prefers built-in tar and keeps Expand-Archive as a fallback', () => {
  assert.match(installScriptSource, /System32\\tar\.exe/);
  assert.match(installScriptSource, /& \$tarPath -xf \$ArchivePath -C \$DestinationPath/);
  assert.match(installScriptSource, /Expand-Archive -LiteralPath \$ArchivePath -DestinationPath \$DestinationPath -Force/);
});

test('CMD bootstrap downloads the release installer to a temporary file and forwards options', () => {
  const installCmdUrl = new URL('./install.cmd', import.meta.url);
  assert.equal(existsSync(installCmdUrl), true, 'scripts/install.cmd is missing');
  const installCmdSource = existsSync(installCmdUrl) ? readFileSync(installCmdUrl, 'utf8') : '';

  assert.match(installCmdSource, /install-release\.ps1/);
  assert.match(installCmdSource, /-File "%INSTALLER_PATH%" %\*/);
  assert.match(installCmdSource, /del \/q "%INSTALLER_PATH%"/i);
  assert.doesNotMatch(installCmdSource, /\biex\b/i);
});

test('release installer forwards an explicit autostart opt-out', () => {
  assert.match(installReleaseScriptSource, /\[switch\]\$NoAutostart/);
  assert.match(installReleaseScriptSource, /if \(\$NoAutostart\) \{\s*\$installerArgs \+= '-NoAutostart'/s);
});

test('release installer combines the verified release archive with the current main installer', () => {
  assert.match(installReleaseScriptSource, /\$installerBaseUrl = "https:\/\/raw\.githubusercontent\.com\/\$Repository\/main"/);
  assert.match(installReleaseScriptSource, /"\$installerBaseUrl\/scripts\/install\.ps1"/);
  assert.doesNotMatch(installReleaseScriptSource, /\$rawBaseUrl = "https:\/\/raw\.githubusercontent\.com\/\$Repository\/\$tag"/);
});

test('installer registers a per-user Startup shortcut for the stable launcher', () => {
  assert.match(installScriptSource, /Join-Path \$env:SystemRoot 'System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/);
  assert.match(installScriptSource, /GetFolderPath\('Startup'\)/);
  assert.match(installScriptSource, /CreateShortcut\(\$shortcutPath\)/);
  assert.match(installScriptSource, /\$shortcut\.TargetPath = \$powershellPath/);
  assert.match(installScriptSource, /\$shortcut\.Arguments = \('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "\{0\}" serve' -f \$LauncherScript\)/);
  assert.match(installScriptSource, /Register-AutostartShortcut -LauncherScript \$stableLauncherScript/);
  assert.doesNotMatch(installScriptSource, /Register-ScheduledTask|New-ScheduledTaskAction/);
  assert.doesNotMatch(installScriptSource, /update --auto/);
});

test('explicit autostart opt-out removes an existing Startup shortcut', () => {
  assert.match(installScriptSource, /if \(\$NoAutostart\) \{\s*Remove-AutostartShortcut/s);
  assert.match(uninstallScriptSource, /Remove-AutostartShortcut/);
});

test('prod install command uses the release installer that resolves an archive', () => {
  assert.equal(
    rootPackage.scripts['prod:install'],
    'powershell -ExecutionPolicy Bypass -File scripts/install-release.ps1',
  );
});

test('runtime package forces embedded UI traffic to its serving origin', () => {
  assert.match(
    runtimePackageSource,
    /window\.__KALIO_RUNTIME_CONFIG__ = \{ apiUrl: window\.location\.origin, wsUrl: window\.location\.origin \}/,
  );
  assert.doesNotMatch(
    runtimePackageSource,
    /window\.__KALIO_RUNTIME_CONFIG__ = \{\}/,
  );
});

test('Windows docs make CMD primary, autostart default, and Tauri optional', () => {
  const cmdInstall = /curl\.exe -fsSL https:\/\/raw\.githubusercontent\.com\/Radomiej\/kalio-forever\/main\/scripts\/install\.cmd -o "%TEMP%\\kalio-install\.cmd" && call "%TEMP%\\kalio-install\.cmd"/i;

  assert.match(rootReadmeSource, cmdInstall);
  assert.match(quickstartSource, cmdInstall);
  assert.match(rootReadmeSource, /autostart[^\r\n]+default/i);
  assert.match(rootReadmeSource, /-NoAutostart/);
  assert.match(rootReadmeSource, /Tauri[^\r\n]+optional/i);
  assert.doesNotMatch(quickstartSource, /after \*\*system reboot/i);
  assert.doesNotMatch(localDevGuideSource, /after \*\*system reboot/i);
  assert.doesNotMatch(scriptsReadmeSource, /after reboot/i);

  assert.match(quickstartSource, /after \*\*user sign-in\*\*/i);
  assert.match(localDevGuideSource, /for autostart after \*\*user sign-in\*\*/i);
  assert.match(scriptsReadmeSource, /Startup shortcut after Windows sign-in/i);
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

test('dev launcher does not kill listeners unless ForceRestart is explicit', () => {
  assert.match(devScriptSource, /if \(\$ForceRestart\) \{[\s\S]*Stop-PreviousKalioLaunchers/);
  assert.match(devScriptSource, /Clear-OccupiedPorts -Ports @\(\$BE_PORT, \$FE_PORT\) -Force:\$ForceRestart/);
  assert.match(devScriptSource, /if \(-not \$Force\) \{[\s\S]*Ports are already in use/);
  assert.doesNotMatch(devCmdSource, /-ForceRestart/);
});

test('desktop build contract keeps the bundled backend and AppData paths aligned', () => {
  const desktopBuildSource = readFileSync(new URL('./desktop-build.mjs', import.meta.url), 'utf8');
  const desktopPrepareSource = readFileSync(new URL('./tauri-prepare.mjs', import.meta.url), 'utf8');
  const desktopBootstrapSource = readFileSync(new URL('./desktop-server-bootstrap.mjs', import.meta.url), 'utf8');
  const tauriConfigSource = readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8');
  const backendSource = readFileSync(new URL('../src-tauri/src/backend.rs', import.meta.url), 'utf8');

  assert.match(desktopBuildSource, /VITE_API_URL: desktopBackendOrigin/);
  assert.match(desktopPrepareSource, /kalio-server/);
  assert.match(desktopPrepareSource, /kalio-node\.exe/);
  assert.match(desktopPrepareSource, /runtime-config\.js/);
  assert.match(desktopPrepareSource, /node-linker=hoisted/);
  assert.match(desktopPrepareSource, /--ignore-workspace/);
  assert.match(desktopPrepareSource, /name !== '@kalio\/types'/);
  assert.match(desktopBootstrapSource, /CREDENTIALS_MASTER_KEY/);
  assert.match(desktopBootstrapSource, /randomBytes\(32\)/);
  assert.match(tauriConfigSource, /"installMode": "currentUser"/);
  assert.match(tauriConfigSource, /127\.0\.0\.1:4516/);
  assert.match(backendSource, /app_local_data_dir\(\)/);
  assert.match(backendSource, /normalize_windows_path/);
  assert.match(backendSource, /const BACKEND_PORT: u16 = 4516/);
  assert.match(backendSource, /http:\/\/tauri\.localhost/);
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
  assert.match(workflowReleaseGateSource, /const reuseStack = args\.has\('--reuse-stack'\);/);
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

test('workflow release gate cannot run the comprehensive mock suite on a live provider', () => {
  assert.doesNotMatch(workflowReleaseGateSource, /const requireLive/);
  assert.doesNotMatch(workflowReleaseGateSource, /runLiveReadinessGate/);
  assert.match(workflowReleaseGateSource, /--require-live is removed/);
  assert.match(workflowReleaseGateSource, /llmConfig\.provider !== 'mock'/);
  assert.match(workflowReleaseGateSource, /workflow release gate requires the mock provider/);
});

test('paid live canary uses static readiness and one dedicated Playwright spec', () => {
  const paidCanaryUrl = new URL('./paid-live-canary.mjs', import.meta.url);
  assert.equal(existsSync(paidCanaryUrl), true, 'paid-live-canary.mjs is missing');
  const paidCanarySource = readFileSync(paidCanaryUrl, 'utf8');
  assert.match(paidCanarySource, /--confirm-paid/);
  assert.match(paidCanarySource, /agentflow-paid-readiness\.mjs/);
  assert.match(paidCanarySource, /'--api', `\$\{apiOrigin\}\/api`/);
  assert.match(paidCanarySource, /--static-only/);
  assert.match(paidCanarySource, /paid-live-canary\.spec\.ts/);
  assert.doesNotMatch(paidCanarySource, /for \(const group of groups\)/);
  assert.doesNotMatch(paidCanarySource, /KALIO_E2E_PROJECT_PATH|requireProjectPath|--project-path/);
  assert.match(paidCanarySource, /projectContext: 'disabled'/);
});

test('paid tool canary is bounded to one confirmed fs_write under an explicit safe path', () => {
  const runnerUrl = new URL('./paid-live-tool-canary.mjs', import.meta.url);
  const specUrl = new URL('../apps/e2e/tests/paid-live-tool-canary.spec.ts', import.meta.url);
  assert.equal(existsSync(runnerUrl), true, 'paid-live-tool-canary.mjs is missing');
  assert.equal(existsSync(specUrl), true, 'paid-live-tool-canary.spec.ts is missing');

  const runnerSource = readFileSync(runnerUrl, 'utf8');
  const specSource = readFileSync(specUrl, 'utf8');
  assert.match(runnerSource, /--confirm-paid/);
  assert.match(runnerSource, /--safe-project-path/);
  assert.match(runnerSource, /agentflow-paid-readiness\.mjs/);
  assert.match(runnerSource, /--static-only/);
  assert.match(runnerSource, /settings\/max-tool-attempts/);
  assert.match(runnerSource, /KALIO_SAFE_TOOL_PATH/);
  assert.match(runnerSource, /paid-live-tool-canary\.spec\.ts/);

  assert.match(specSource, /allowed-paths/);
  assert.match(specSource, /fs_write/);
  assert.match(specSource, /confirmation-confirm-btn/);
  assert.match(specSource, /KALIO_RUN_PAID_TOOL_CANARY/);
  assert.match(specSource, /readFileSync/);
  assert.match(specSource, /unlinkSync/);
  assert.doesNotMatch(specSource, /terminal_spawn|terminal_exec|run_cli_agent/);
});

test('demo release gate runs the free workflow gate before the explicit paid canary', () => {
  const demoGateUrl = new URL('./demo-release-gate.mjs', import.meta.url);
  assert.equal(existsSync(demoGateUrl), true, 'demo-release-gate.mjs is missing');
  const demoGateSource = readFileSync(demoGateUrl, 'utf8');
  const workflowIndex = demoGateSource.indexOf("'scripts/workflow-release-gate.mjs'");
  const paidIndex = demoGateSource.indexOf("'scripts/paid-live-canary.mjs'");
  assert.notEqual(workflowIndex, -1, 'free workflow gate call is missing');
  assert.notEqual(paidIndex, -1, 'paid canary call is missing');
  assert.ok(workflowIndex < paidIndex, 'free workflow proof must run before the paid canary');
  assert.doesNotMatch(
    demoGateSource,
    /'--backend-port', '0', '--frontend-port', '0',[\s\S]*'--skip-build'/,
    'random-port persistent stack restart must rebuild runtime-config.js',
  );
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
  assert.match(workflowReleaseGateSource, /requires strict Implementer evidence/);
  assert.match(workflowReleaseGateSource, /Implementer write evidence is missing/);
  assert.match(workflowReleaseGateSource, /rejects unknown AgentFlow schemas/);
  assert.match(workflowReleaseGateSource, /resumes a bounded waiting AgentFlow/);
  assert.match(workflowReleaseGateSource, /failing structured QA evidence/);

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
