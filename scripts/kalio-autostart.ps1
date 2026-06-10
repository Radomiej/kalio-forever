# Kalio prod autostart — invoked by Scheduled Task after Windows sign-in.
# Idempotent: stack-manager stops any stale stack before starting.

param(
    [string]$InstallDir = '',
    [string]$DataRoot = '',
    [int]$BackendPort = 4016,
    [int]$FrontendPort = 6188
)

$ErrorActionPreference = 'Stop'

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE 'AppData\Local'
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $localAppData 'kalio-forever\app'
}
if (-not $DataRoot) {
    $DataRoot = Join-Path $localAppData 'kalio-forever'
}

$stackDir = Join-Path $InstallDir '.kalio-stack'
$logsDir = Join-Path $stackDir 'logs'
$autostartLog = Join-Path $logsDir 'autostart.log'
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Write-AutostartLog {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path $autostartLog -Value $line
}

function Import-EnvFile {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
            continue
        }

        $key, $value = $trimmed.Split('=', 2)
        $key = $key.Trim()
        if (-not $key) { continue }

        $value = $value.Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        Set-Item -Path "Env:$key" -Value $value
    }
}

try {
    $programFilesNode = 'C:\Program Files\nodejs'
    if (Test-Path $programFilesNode) {
        $env:PATH = "$programFilesNode;$env:PATH"
    }

    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $nodeCmd) {
        Write-AutostartLog 'FAIL node not found on PATH'
        exit 1
    }

    if (-not (Test-Path $InstallDir)) {
        Write-AutostartLog "FAIL install dir missing: $InstallDir"
        exit 1
    }

    $envFile = Join-Path $DataRoot '.env'
    Import-EnvFile -Path $envFile
    $env:KALIO_INSTALL_PROFILE = 'prod'

    $stackManager = Join-Path $InstallDir 'scripts\stack-manager.mjs'
    if (-not (Test-Path $stackManager)) {
        Write-AutostartLog "FAIL stack-manager missing: $stackManager"
        exit 1
    }

    Write-AutostartLog "starting prod stack install=$InstallDir data=$DataRoot ports=$BackendPort/$FrontendPort"

    $stackArgs = @(
        $stackManager,
        'start',
        '--profile', 'prod',
        '--skip-build',
        '--runtime', 'direct',
        '--backend-port', "$BackendPort",
        '--frontend-port', "$FrontendPort",
        '--data-root', $DataRoot,
        '--env-file', $envFile,
        '--use-env-llm'
    )

    Push-Location $InstallDir
    try {
        & $nodeCmd.Source @stackArgs
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($exitCode -ne 0) {
        Write-AutostartLog "FAIL stack-manager exit code $exitCode"
        exit $exitCode
    }

    Write-AutostartLog 'OK prod stack started'
    exit 0
} catch {
    Write-AutostartLog "FAIL $($_.Exception.Message)"
    exit 1
}
