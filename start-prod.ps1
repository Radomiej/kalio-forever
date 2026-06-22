# Kalio v2 — production-profile launcher (built dist, AppData data root)
# Usage:
#   .\start-prod.ps1              # start from existing dist (no rebuild)
#   .\start-prod.ps1 -Rebuild     # build first, then start
#   .\start-prod.ps1 -UseMockLLM  # ignore .env LLM and force mock provider
# Stop: Ctrl+C in this console, or `node scripts/stack-manager.mjs stop`

param(
    [switch]$Rebuild,
    [switch]$UseMockLLM,
    [int]$BackendPort = 4016,
    [int]$FrontendPort = 6188
)

$root = $PSScriptRoot
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE 'AppData\Local'
}
$prodDataRoot = Join-Path $localAppData 'kalio-forever'
$envFile = Join-Path $prodDataRoot '.env'
$programFilesNode = 'C:\Program Files\nodejs'
if (Test-Path $programFilesNode) {
    $env:PATH = "$programFilesNode;$env:PATH"
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Write-Host '[FAIL] node not found on PATH' -ForegroundColor Red; exit 1 }

function Import-EnvFileIfMissing {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return }

    foreach ($line in Get-Content $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#') -or -not $trimmed.Contains('=')) {
            continue
        }

        $key, $value = $trimmed.Split('=', 2)
        $key = $key.Trim()
        if (-not $key -or (Test-Path "Env:$key")) {
            continue
        }

        $value = $value.Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        Set-Item "Env:$key" $value
    }
}

function Ensure-ProdEnvFile {
    param([string]$Path, [string]$Root, [int]$ApiPort, [int]$WebPort)

    if (Test-Path $Path) { return }

    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $masterKey = [Convert]::ToBase64String($bytes)

    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    $content = @"
LLM_PROVIDER=mock
LLM_API_KEY=mock
LLM_BASE_URL=mock
LLM_MODEL=mock
NODE_ENV=production
PORT=$ApiPort
VITE_PORT=$WebPort
DATABASE_PATH=$(Join-Path $Root 'kalio.db')
WORKSPACE_ROOT=$(Join-Path $Root 'workspaces')
MEMORY_DB_PATH=$(Join-Path $Root 'memory')
EMBEDDING_CACHE_DIR=$(Join-Path $Root 'embeddings-cache')
CREDENTIALS_MASTER_KEY=$masterKey
CORS_ORIGIN=http://localhost:$WebPort,http://127.0.0.1:$WebPort
KALIO_INSTALL_PROFILE=prod
"@
    Set-Content -Path $Path -Value $content -Encoding UTF8
    Write-Host "  created prod env -> $Path" -ForegroundColor DarkYellow
}

Ensure-ProdEnvFile -Path $envFile -Root $prodDataRoot -ApiPort $BackendPort -WebPort $FrontendPort
Import-EnvFileIfMissing -Path (Join-Path $root '.env')
Import-EnvFileIfMissing -Path $envFile
$env:KALIO_INSTALL_PROFILE = 'prod'

Write-Host 'KALIO Prod Stack (dist-only)' -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "  data root  ->  $prodDataRoot" -ForegroundColor Green
if ($Rebuild) {
    Write-Host '  mode       ->  rebuild + start' -ForegroundColor DarkYellow
} else {
    Write-Host '  mode       ->  skip-build (reuse existing dist)' -ForegroundColor DarkYellow
}
if ($UseMockLLM) {
    Write-Host '  llm-mode   ->  mock' -ForegroundColor DarkYellow
} else {
    Write-Host '  llm-mode   ->  .env / process env' -ForegroundColor DarkYellow
}
Write-Host ''

$stackArgs = @(
    (Join-Path $root 'scripts\stack-manager.mjs'),
    'start',
    '--profile', 'prod',
    '--runtime', 'direct',
    '--backend-port', "$BackendPort",
    '--frontend-port', "$FrontendPort",
    '--data-root', $prodDataRoot,
    '--env-file', $envFile
)

if (-not $Rebuild) {
    $stackArgs += '--skip-build'
}

if (-not $UseMockLLM) {
    $stackArgs += '--use-env-llm'
}

& $nodeCmd.Source @stackArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

try {
    $statusJson = & $nodeCmd.Source (Join-Path $root 'scripts\stack-manager.mjs') 'status' '--json'
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    $status = $statusJson | ConvertFrom-Json
} catch {
    Write-Host "[FAIL] Could not read prod stack status from stack-manager: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$state = $status.state
if ($status.status -ne 'running' -or -not $state) {
    Write-Host "[FAIL] Prod stack did not report running status after start: $($status.status)" -ForegroundColor Red
    exit 1
}

$backendPid = [int]$state.backend.pid
$frontendPid = [int]$state.frontend.pid

Write-Host "  Backend  PID $backendPid" -ForegroundColor Green
Write-Host "  Frontend PID $frontendPid" -ForegroundColor Green
Write-Host '  Ctrl+C to stop prod stack' -ForegroundColor Yellow
Write-Host ''

function Test-ProcessAlive {
    param([int]$ProcessId)

    if ($ProcessId -le 0) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

try {
    while ($true) {
        if (-not (Test-ProcessAlive -ProcessId $backendPid)) {
            Write-Host '[FAIL] Backend process exited.' -ForegroundColor Red
            break
        }
        if (-not (Test-ProcessAlive -ProcessId $frontendPid)) {
            Write-Host '[FAIL] Frontend process exited.' -ForegroundColor Red
            break
        }
        Start-Sleep -Milliseconds 400
    }
} finally {
    Write-Host ''
    Write-Host 'Stopping prod stack...' -ForegroundColor Yellow
    & $nodeCmd.Source (Join-Path $root 'scripts\stack-manager.mjs') stop
    Write-Host '[OK] Prod stack stopped.' -ForegroundColor Green
}
