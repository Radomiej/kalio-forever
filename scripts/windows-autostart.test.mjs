import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const windowsTest = process.platform === 'win32' ? test : test.skip;

function psString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function runFunction(fileName, functionName, scenario) {
  const sourcePath = fileURLToPath(new URL(fileName, import.meta.url));
  const script = `
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(${psString(sourcePath)}, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'Installer script did not parse' }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq ${psString(functionName)} }, $true)
if (-not $definition) { throw 'Expected function is missing' }
. ([scriptblock]::Create($definition.Extent.Text))
${scenario}
`;
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

for (const fileName of ['./install.ps1', './uninstall.ps1']) {
  windowsTest(`${fileName} removes only the two legacy Kalio Scheduled Tasks`, () => {
    const result = runFunction(fileName, 'Remove-LegacyScheduledTasks', `
$script:removed = @()
function Start-Process { throw 'Unexpected process launch' }
function Stop-Process { throw 'Unexpected process stop' }
function Get-ScheduledTask {
  param([string]$TaskName, [string]$TaskPath, [string]$ErrorAction)
  if ($TaskPath -ne '\\') { throw 'Unexpected task path' }
  return [pscustomobject]@{ TaskName = $TaskName }
}
function Unregister-ScheduledTask {
  param([string]$TaskName, [string]$TaskPath, [switch]$Confirm, [string]$ErrorAction)
  if ($TaskPath -ne '\\') { throw 'Unexpected task path' }
  $script:removed += $TaskName
}
Remove-LegacyScheduledTasks
if (($script:removed -join ',') -ne 'Kalio Forever,Kalio-Forever') { throw 'Legacy tasks were not removed' }
`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

windowsTest('installer retains an explicit autostart opt-out across repair and can re-enable it', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'kalio-autostart-test-'));
  try {
    const result = runFunction('./install.ps1', 'Set-AutostartPreference', `
$dataRoot = ${psString(dataRoot)}
if (-not (Set-AutostartPreference -DataRoot $dataRoot)) { throw 'Fresh install must enable autostart' }
if (Set-AutostartPreference -DataRoot $dataRoot -NoAutostart) { throw 'Explicit opt-out was ignored' }
if (Set-AutostartPreference -DataRoot $dataRoot) { throw 'Repair lost the opt-out' }
if (-not (Set-AutostartPreference -DataRoot $dataRoot -EnableAutostart)) { throw 'Explicit opt-in was ignored' }
`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
