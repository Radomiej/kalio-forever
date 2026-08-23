# Stable Windows launcher. It resolves current.json so upgrades never leave the
# Scheduled Task pointing at a version-specific directory.

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = 'Stop'

$installRoot = Split-Path -Parent $PSScriptRoot
$currentPath = Join-Path $installRoot 'current.json'
if (-not (Test-Path -LiteralPath $currentPath -PathType Leaf)) {
    throw "Kalio current.json is missing: $currentPath"
}

$current = Get-Content -LiteralPath $currentPath -Raw | ConvertFrom-Json
$version = [string]$current.version
$runtime = [string]$current.runtime
if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "Invalid Kalio runtime version: $version"
}

$runtimeName = if ($runtime -eq 'bun') { 'kalio-bun.exe' } else { 'kalio-node.exe' }
$versionRoot = Join-Path $installRoot "app\versions\$version"
$runtimePath = Join-Path $versionRoot "bin\$runtimeName"
$cliPath = Join-Path $versionRoot 'bin\kalio-cli.mjs'
if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
    throw "Kalio runtime executable is missing: $runtimePath"
}
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) {
    throw "Kalio CLI is missing: $cliPath"
}

$env:KALIO_HOME = $installRoot
$env:KALIO_DATA_ROOT = Join-Path $installRoot 'data'
$env:KALIO_RUNTIME_VERSION = $version
& $runtimePath $cliPath @Arguments
exit $LASTEXITCODE
