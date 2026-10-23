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

windowsTest('installer rejects conflicting autostart switches', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'kalio-autostart-test-'));
  try {
    const result = runFunction('./install.ps1', 'Set-AutostartPreference', `
try {
  Set-AutostartPreference -DataRoot ${psString(dataRoot)} -NoAutostart -EnableAutostart | Out-Null
} catch {
  exit 0
}
throw 'Conflicting switches were accepted'
`);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
