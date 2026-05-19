# Kalio v2 — dev launcher
# Uruchamia backend (nest watch) + frontend (vite dev) w jednej konsoli
# Uzycie: .\start-dev.ps1
# Zatrzymanie: Ctrl+C — czyści oba serwery

param(
    [switch]$UseMockLLM,
    [int]$BackendPort = 3016,
    [int]$FrontendPort = 5188
)

$root = $PSScriptRoot
$api  = Join-Path $root "apps\kalio-api"
$web  = Join-Path $root "apps\kalio-web"
$e2eEnvFile = Join-Path $root ".env.test"
$nestJs = Join-Path $api "node_modules\@nestjs\cli\bin\nest.js"
$viteJs = Join-Path $web "node_modules\vite\bin\vite.js"
$BE_PORT = $BackendPort
$FE_PORT = $FrontendPort
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Write-Host "[FAIL] node not found on PATH" -ForegroundColor Red; exit 1 }

# Some Windows shells expose both Path and PATH in the process environment.
# Start-Process builds a case-insensitive dictionary and fails on that duplicate.
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
if (-not $processPath) { $processPath = [Environment]::GetEnvironmentVariable('PATH', 'Process') }
if ($processPath) {
    [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
    [Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
}

$previousEnv = @{
    LLM_PROVIDER = $env:LLM_PROVIDER
    LLM_API_KEY = $env:LLM_API_KEY
    LLM_BASE_URL = $env:LLM_BASE_URL
    LLM_MODEL = $env:LLM_MODEL
    NODE_ENV = $env:NODE_ENV
    PORT = $env:PORT
    DATABASE_PATH = $env:DATABASE_PATH
    WORKSPACE_ROOT = $env:WORKSPACE_ROOT
    CORS_ORIGIN = $env:CORS_ORIGIN
    VITE_API_URL = $env:VITE_API_URL
    VITE_WS_URL = $env:VITE_WS_URL
    VITE_PORT = $env:VITE_PORT
}

function Restore-EnvVars {
    param([hashtable]$Values)

    foreach ($entry in $Values.GetEnumerator()) {
        if ($null -eq $entry.Value) {
            Remove-Item "Env:$($entry.Key)" -ErrorAction SilentlyContinue
        } else {
            Set-Item "Env:$($entry.Key)" $entry.Value
        }
    }
}

if ($UseMockLLM) {
    $env:LLM_PROVIDER = 'mock'
    $env:LLM_API_KEY = 'mock'
    $env:LLM_BASE_URL = 'mock'
    $env:LLM_MODEL = 'mock'
}

$apiOrigin = "http://localhost:$BE_PORT"
$useDedicatedPorts = $BE_PORT -ne 3016 -or $FE_PORT -ne 5188

if ($useDedicatedPorts) {
    $env:NODE_ENV = 'test'
    $env:DATABASE_PATH = './data/kalio-e2e.db'
    $env:WORKSPACE_ROOT = './data/workspaces-e2e'
    $env:CORS_ORIGIN = "http://localhost:$FE_PORT"
}

$env:PORT = "$BE_PORT"
$env:VITE_API_URL = $apiOrigin
$env:VITE_WS_URL = $apiOrigin
$env:VITE_PORT = "$FE_PORT"

function Get-PortOwners {
    param([int[]]$Ports)

    @(
        foreach ($port in $Ports) {
            Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 } |
                Select-Object -ExpandProperty OwningProcess
        }
    ) | Sort-Object -Unique
}

# Recursively collect a PID and all its descendants
function Get-ProcessTree {
    param([int]$ParentId)
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty ProcessId)
    $all = @($ParentId)
    foreach ($child in $children) {
        $all += Get-ProcessTree -ParentId $child
    }
    return $all | Sort-Object -Unique
}

function Stop-Processes {
    param(
        [int[]]$ProcessIds,
        [string]$Label
    )

    foreach ($processId in @($ProcessIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique)) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        Write-Host "  [kill] $Label PID $processId" -ForegroundColor DarkYellow
    }
}

# Stop only the tree rooted at a known PID, then verify ports are free
function Stop-KalioStack {
    param(
        [System.Diagnostics.Process]$BeProcess,
        [System.Diagnostics.Process]$FeProcess,
        [int[]]$Ports,
        [int]$TimeoutMs = 10000
    )

    foreach ($proc in @($BeProcess, $FeProcess)) {
        if ($proc -and -not $proc.HasExited) {
            $tree = @(Get-ProcessTree -ParentId $proc.Id)
            Stop-Processes -ProcessIds $tree -Label 'kalio'
        }
    }

    # Give OS a moment, then free any port stragglers
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
    do {
        $portOwners = @(Get-PortOwners -Ports $Ports)
        if ($portOwners.Count -eq 0) { return }
        Stop-Processes -ProcessIds $portOwners -Label 'port owner'
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)
}

# Used only at startup to free ports left by a previous run
function Clear-OccupiedPorts {
    param(
        [int[]]$Ports,
        [int]$TimeoutMs = 10000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)

    do {
        $portOwners = @(Get-PortOwners -Ports $Ports)
        if ($portOwners.Count -eq 0) { return $true }
        Stop-Processes -ProcessIds $portOwners -Label 'port owner'
        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)

    $remaining = @(Get-PortOwners -Ports $Ports)
    if ($remaining.Count -gt 0) {
        Write-Host "  [FAIL] Could not free ports: $($Ports -join ', '). Remaining PIDs: $($remaining -join ', ')" -ForegroundColor Red
        return $false
    }
    return $true
}

# --- Kill any leftover processes on our ports ---
Write-Host "KALIO Dev Stack" -ForegroundColor Cyan
Write-Host "  Clearing ports $BE_PORT and $FE_PORT..." -ForegroundColor DarkYellow
if (-not (Clear-OccupiedPorts -Ports @($BE_PORT, $FE_PORT))) {
    exit 1
}

Write-Host ""
Write-Host "Kalio v2 - dev environment" -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:$BE_PORT" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:$FE_PORT" -ForegroundColor Green
if ($UseMockLLM) {
    Write-Host "  llm-mode   ->  mock" -ForegroundColor DarkYellow
}
Write-Host ""

# --- Start backend (nest start --watch) ---
if ($useDedicatedPorts) {
    Write-Host "  Building backend for dedicated E2E env..." -ForegroundColor DarkYellow
    Push-Location $api
    try {
        & $nodeCmd.Source $nestJs build
    } finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [FAIL] Backend build failed for dedicated E2E env." -ForegroundColor Red
        Restore-EnvVars -Values $previousEnv
        exit 1
    }

    $beProcess = Start-Process -FilePath $nodeCmd.Source -ArgumentList "--env-file=$e2eEnvFile", "dist/main.js" `
        -WorkingDirectory $api -NoNewWindow -PassThru
} else {
    $beProcess = Start-Process -FilePath $nodeCmd.Source -ArgumentList $nestJs, "start", "--watch" `
        -WorkingDirectory $api -NoNewWindow -PassThru
}

Write-Host "  Backend  -> http://localhost:$BE_PORT  (PID $($beProcess.Id))" -ForegroundColor Green

# Wait for backend to be ready
Write-Host "  Waiting for backend to be ready..." -ForegroundColor DarkYellow
$retries = 0
$maxRetries = 120   # 120 × 500ms = 60s total
while ($retries -lt $maxRetries) {
    Start-Sleep -Milliseconds 500

    if ($beProcess -and $beProcess.HasExited) {
        Write-Host "  [FAIL] Backend process exited unexpectedly (code $($beProcess.ExitCode))." -ForegroundColor Red
        Clear-OccupiedPorts -Ports @($BE_PORT, $FE_PORT) | Out-Null
        exit 1
    }

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$BE_PORT/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) { break }
    } catch { }
    $retries++
}

if ($retries -ge $maxRetries) {
    Write-Host "  [FAIL] Backend did not respond within 60s. Check output above." -ForegroundColor Red
    Stop-KalioStack -BeProcess $beProcess -FeProcess $null -Ports @($BE_PORT, $FE_PORT)
    exit 1
}
Write-Host "  Backend ready!" -ForegroundColor Green

if ($useDedicatedPorts) {
    if ($null -eq $previousEnv.NODE_ENV) {
        Remove-Item 'Env:NODE_ENV' -ErrorAction SilentlyContinue
    } else {
        Set-Item 'Env:NODE_ENV' $previousEnv.NODE_ENV
    }
}

# --- Start frontend (vite dev) ---
# IMPORTANT: @tailwindcss/oxide (Rust native module used by Tailwind CSS v4)
# crashes with exit code -1 (4294967295) on Windows when stdout is redirected
# to a file or pipe. The process MUST inherit the real console handles.
# We therefore run Vite directly via node without any output redirect.
$feProcess = Start-Process -FilePath $nodeCmd.Source -ArgumentList $viteJs `
    -WorkingDirectory $web -NoNewWindow -PassThru

Write-Host "  Frontend -> http://localhost:$FE_PORT  (PID $($feProcess.Id))" -ForegroundColor Green
Write-Host "  Ctrl+C to stop both" -ForegroundColor Yellow
Write-Host ""

# --- Monitor both processes ---
try {
    while ($true) {
        if ($beProcess -and $beProcess.HasExited) {
            Write-Host "[FAIL] Backend exited (code $($beProcess.ExitCode))" -ForegroundColor Red
            break
        }
        if ($feProcess -and $feProcess.HasExited) {
            Write-Host "[FAIL] Frontend exited (code $($feProcess.ExitCode))" -ForegroundColor Red
            break
        }

        Start-Sleep -Milliseconds 400
    }
} finally {
    Write-Host ""
    Write-Host "Stopping stack..." -ForegroundColor Yellow
    Stop-KalioStack -BeProcess $beProcess -FeProcess $feProcess -Ports @($BE_PORT, $FE_PORT)
    Restore-EnvVars -Values $previousEnv
    Write-Host "[OK] Stack stopped." -ForegroundColor Green
}
