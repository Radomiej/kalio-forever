# Kalio v2 — built QA / prod-preview launcher
# Runs dist-only API + vite preview on fixed ports with isolated AppData profile.
# Usage:
#   .\start-qa.ps1              # start from existing dist (no rebuild)
#   .\start-qa.ps1 -Rebuild     # build first, then start
#   .\start-qa.ps1 -UseMockLLM  # ignore .env LLM and force mock provider
# Stop: Ctrl+C in this console, or `pnpm qa:stop`

param(
    [switch]$Rebuild,
    [switch]$UseMockLLM,
    [int]$BackendPort = 3316,
    [int]$FrontendPort = 5288
)

$root = $PSScriptRoot
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE "AppData\Local"
}
$qaDataRoot = Join-Path $localAppData "kalio-forever-qa"
$stackStatePath = Join-Path $root ".kalio-stack\qa-stack-state.json"

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Write-Host "[FAIL] node not found on PATH" -ForegroundColor Red; exit 1 }

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

Import-EnvFileIfMissing -Path (Join-Path $root ".env")

Write-Host "KALIO QA Stack (dist-only)" -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:$BackendPort" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:$FrontendPort" -ForegroundColor Green
Write-Host "  data root  ->  $qaDataRoot" -ForegroundColor Green
if ($Rebuild) {
    Write-Host "  mode       ->  rebuild + start" -ForegroundColor DarkYellow
} else {
    Write-Host "  mode       ->  skip-build (reuse existing dist)" -ForegroundColor DarkYellow
}
if ($UseMockLLM) {
    Write-Host "  llm-mode   ->  mock" -ForegroundColor DarkYellow
} else {
    Write-Host "  llm-mode   ->  .env / process env" -ForegroundColor DarkYellow
}
Write-Host ""

$stackArgs = @(
    (Join-Path $root "scripts\stack-manager.mjs"),
    "start",
    "--backend-port", "$BackendPort",
    "--frontend-port", "$FrontendPort",
    "--data-root", $qaDataRoot
)

if (-not $Rebuild) {
    $stackArgs += "--skip-build"
}

if (-not $UseMockLLM) {
    $stackArgs += "--use-env-llm"
}

& $nodeCmd.Source @stackArgs
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (-not (Test-Path $stackStatePath)) {
    Write-Host "[FAIL] QA stack state file missing after start: $stackStatePath" -ForegroundColor Red
    exit 1
}

$state = Get-Content $stackStatePath -Raw | ConvertFrom-Json
$backendPid = [int]$state.backend.pid
$frontendPid = [int]$state.frontend.pid

Write-Host "  Backend  PID $backendPid" -ForegroundColor Green
Write-Host "  Frontend PID $frontendPid" -ForegroundColor Green
Write-Host "  Ctrl+C to stop QA stack" -ForegroundColor Yellow
Write-Host ""

function Test-ProcessAlive {
    param([int]$ProcessId)

    if ($ProcessId -le 0) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

try {
    while ($true) {
        if (-not (Test-ProcessAlive -ProcessId $backendPid)) {
            Write-Host "[FAIL] Backend process exited." -ForegroundColor Red
            break
        }
        if (-not (Test-ProcessAlive -ProcessId $frontendPid)) {
            Write-Host "[FAIL] Frontend process exited." -ForegroundColor Red
            break
        }
        Start-Sleep -Milliseconds 400
    }
} finally {
    Write-Host ""
    Write-Host "Stopping QA stack..." -ForegroundColor Yellow
    & $nodeCmd.Source (Join-Path $root "scripts\stack-manager.mjs") "stop"
    Write-Host "[OK] QA stack stopped." -ForegroundColor Green
}
