# Kalio v2 — dev launcher
# Uruchamia backend (nest watch) + frontend (vite dev) w jednej konsoli
# Uzycie: .\start-dev.ps1
# Zatrzymanie: Ctrl+C — czyści oba serwery

param(
    [switch]$UseMockLLM,
    [switch]$ForceRestart,
    [int]$BackendPort = 3016,
    [int]$FrontendPort = 5188
)

$ForceRestart = $ForceRestart -or ($env:KALIO_FORCE_RESTART -in @('1', 'true', 'TRUE', 'True', 'yes', 'YES', 'Yes'));

$root = $PSScriptRoot
$api  = Join-Path $root "apps\kalio-api"
$web  = Join-Path $root "apps\kalio-web"
$e2eEnvFile = Join-Path $root ".env.test"
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE "AppData\Local"
}
$devDataRoot = Join-Path $localAppData "kalio-forever-dev"
$BE_PORT = $BackendPort
$FE_PORT = $FrontendPort

# Singleton lock — must run before port cleanup or stack startup.
$script:devStackMutex = $null
$script:devStackMutexOwned = $false
$devStackMutexName = "Global\KalioForever-DevStack-$BE_PORT-$FE_PORT"

function Get-DevLauncherProcessIds {
    param([int]$CurrentProcessId)

    $escapedRoot = [Regex]::Escape($root)
    @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -ne $CurrentProcessId -and
                $_.CommandLine -and
                $_.CommandLine -match $escapedRoot -and
                $_.CommandLine -match 'start-dev\.ps1'
            } |
            Select-Object -ExpandProperty ProcessId
    ) | Sort-Object -Unique
}

function Stop-DevLauncherProcesses {
    param([int[]]$ProcessIds)

    foreach ($processId in @($ProcessIds | Where-Object { $_ -gt 0 } | Sort-Object -Unique)) {
        try {
            Stop-Process -Id $processId -Force -ErrorAction Stop
            Write-Host "  [kill] stale dev launcher PID $processId" -ForegroundColor DarkYellow
        } catch {
            Write-Host "  [warn] could not stop stale dev launcher PID ${processId}: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

function Try-AcquireDevStackMutex {
    $script:devStackMutex = [System.Threading.Mutex]::new($false, $devStackMutexName)
    $script:devStackMutexOwned = $script:devStackMutex.WaitOne(0, $false)
    return $script:devStackMutexOwned
}

try {
    $script:devStackMutexOwned = Try-AcquireDevStackMutex
    if (-not $script:devStackMutexOwned) {
        if ($ForceRestart) {
            Write-Host "  Force restart requested; removing stale dev launcher state..." -ForegroundColor DarkYellow
            Stop-DevLauncherProcesses -ProcessIds (Get-DevLauncherProcessIds -CurrentProcessId $PID)
            if ($script:devStackMutex) {
                try { $script:devStackMutex.Dispose() } catch { }
                $script:devStackMutex = $null
            }
            Start-Sleep -Milliseconds 400
            $script:devStackMutexOwned = Try-AcquireDevStackMutex
        }
    }
    if (-not $script:devStackMutexOwned) {
        $beHealthy = $false
        $feHealthy = $false
        try {
            $beResponse = Invoke-WebRequest -Uri "http://localhost:$BE_PORT/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            $beHealthy = $beResponse.StatusCode -eq 200
        } catch { }
        try {
            $feResponse = Invoke-WebRequest -Uri "http://localhost:$FE_PORT" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
            $feHealthy = $feResponse.StatusCode -eq 200
        } catch { }

        if ($beHealthy -and $feHealthy) {
            Write-Host "[OK] Kalio dev stack already running on ports $BE_PORT/$FE_PORT." -ForegroundColor Green
            Write-Host "  Backend  -> http://localhost:$BE_PORT" -ForegroundColor Green
            Write-Host "  Frontend -> http://localhost:$FE_PORT" -ForegroundColor Green
            Write-Host "  Attached to existing stack (dev-servers watchdog)." -ForegroundColor DarkGray
            if ($script:devStackMutex) {
                try { $script:devStackMutex.Dispose() } catch { }
                $script:devStackMutex = $null
            }
            while ($true) {
                Start-Sleep -Seconds 15
                $stillHealthy = $true
                try {
                    $beCheck = Invoke-WebRequest -Uri "http://localhost:$BE_PORT/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                    if ($beCheck.StatusCode -ne 200) { $stillHealthy = $false }
                } catch { $stillHealthy = $false }
                try {
                    $feCheck = Invoke-WebRequest -Uri "http://localhost:$FE_PORT" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                    if ($feCheck.StatusCode -ne 200) { $stillHealthy = $false }
                } catch { $stillHealthy = $false }
                if (-not $stillHealthy) {
                    Write-Host "[WARN] Existing stack became unhealthy; exiting so dev-servers can restart." -ForegroundColor Yellow
                    exit 1
                }
            }
        }

        Write-Host "[FAIL] Kalio dev stack already running (ports $BE_PORT/$FE_PORT)." -ForegroundColor Red
        Write-Host "  Stop dev-servers Kalio or the other start-dev.ps1 before starting again." -ForegroundColor DarkYellow
        if ($script:devStackMutex) {
            try { $script:devStackMutex.Dispose() } catch { }
            $script:devStackMutex = $null
        }
        exit 1
    }
} catch {
    if ($script:devStackMutex) {
        try { $script:devStackMutex.Dispose() } catch { }
        $script:devStackMutex = $null
    }
    Write-Host "[FAIL] Could not acquire dev stack singleton lock: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Write-Host "[FAIL] node not found on PATH" -ForegroundColor Red; exit 1 }

function Resolve-WorkspaceCli {
    param(
        [string]$PrimaryPath,
        [string]$PackageFilter,
        [string]$RelativePath
    )

    if (Test-Path $PrimaryPath) { return $PrimaryPath }

    $pnpmStore = Join-Path $root "node_modules\.pnpm"
    if (-not (Test-Path $pnpmStore)) { return $null }

    $match = Get-ChildItem -Path $pnpmStore -Directory -Filter $PackageFilter -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $match) { return $null }

    $candidate = Join-Path $match.FullName $RelativePath
    if (Test-Path $candidate) { return $candidate }
    return $null
}

$nestJs = Resolve-WorkspaceCli `
    -PrimaryPath (Join-Path $api "node_modules\@nestjs\cli\bin\nest.js") `
    -PackageFilter "@nestjs+cli*" `
    -RelativePath "node_modules\@nestjs\cli\bin\nest.js"
if (-not $nestJs) { Write-Host "[FAIL] Nest CLI not found. Run pnpm install from repo root." -ForegroundColor Red; exit 1 }
$viteJs = Resolve-WorkspaceCli `
    -PrimaryPath (Join-Path $web "node_modules\vite\bin\vite.js") `
    -PackageFilter "vite@*" `
    -RelativePath "node_modules\vite\bin\vite.js"
if (-not $viteJs) { Write-Host "[FAIL] Vite CLI not found. Run pnpm install from repo root." -ForegroundColor Red; exit 1 }

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
    KALIO_FORCE_ENV_LLM = $env:KALIO_FORCE_ENV_LLM
    NODE_ENV = $env:NODE_ENV
    PORT = $env:PORT
    DATABASE_PATH = $env:DATABASE_PATH
    WORKSPACE_ROOT = $env:WORKSPACE_ROOT
    CORS_ORIGIN = $env:CORS_ORIGIN
    VITE_API_URL = $env:VITE_API_URL
    VITE_WS_URL = $env:VITE_WS_URL
    VITE_PORT = $env:VITE_PORT
    VITE_HMR_HOST = $env:VITE_HMR_HOST
    VITE_HMR_CLIENT_PORT = $env:VITE_HMR_CLIENT_PORT
}

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
    $env:KALIO_FORCE_ENV_LLM = '1'
}

$devOriginHost = '127.0.0.1'
$apiOrigin = "http://$devOriginHost`:$BE_PORT"
$useDedicatedPorts = $BE_PORT -ne 3016 -or $FE_PORT -ne 5188

if ($useDedicatedPorts) {
    $env:NODE_ENV = 'test'
    $env:DATABASE_PATH = './data/kalio-e2e.db'
    $env:WORKSPACE_ROOT = './data/workspaces-e2e'
    $env:CORS_ORIGIN = "http://localhost:$FE_PORT"
}

if (-not $env:DATABASE_PATH) {
    $env:DATABASE_PATH = Join-Path $devDataRoot "kalio-dev.db"
}
if (-not $env:WORKSPACE_ROOT) {
    $env:WORKSPACE_ROOT = Join-Path $devDataRoot "workspaces"
}
if (-not $env:MEMORY_DB_PATH) {
    $env:MEMORY_DB_PATH = Join-Path $devDataRoot "memory"
}
if (-not $env:EMBEDDING_CACHE_DIR) {
    $env:EMBEDDING_CACHE_DIR = Join-Path $devDataRoot "embeddings-cache"
}
if (-not $env:CORS_ORIGIN) {
    $env:CORS_ORIGIN = "http://localhost:$FE_PORT,http://127.0.0.1:$FE_PORT"
}
if (-not $env:LLM_PROVIDER) {
    $env:LLM_PROVIDER = 'mock'
}
if (-not $env:LLM_API_KEY) {
    $env:LLM_API_KEY = 'mock'
}
if (-not $env:LLM_BASE_URL) {
    $env:LLM_BASE_URL = 'mock'
}
if (-not $env:LLM_MODEL) {
    $env:LLM_MODEL = 'mock'
}

$env:PORT = "$BE_PORT"
$env:VITE_API_URL = $apiOrigin
$env:VITE_WS_URL = $apiOrigin
$env:VITE_PORT = "$FE_PORT"
$env:VITE_HMR_HOST = $devOriginHost
$env:VITE_HMR_CLIENT_PORT = "$FE_PORT"

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

function Release-DevStackMutex {
    if ($script:devStackMutexOwned -and $script:devStackMutex) {
        try { [void]$script:devStackMutex.ReleaseMutex() } catch { }
        $script:devStackMutexOwned = $false
    }
    if ($script:devStackMutex) {
        try { $script:devStackMutex.Dispose() } catch { }
        $script:devStackMutex = $null
    }
}

try {
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
# Bind Vite to all local interfaces so the dev stack is reachable through both
# localhost and 127.0.0.1 during manual QA and Playwright external-server reuse.
$feArgs = @(
    $viteJs
    '--host'
    '0.0.0.0'
    '--port'
    "$FE_PORT"
    '--strictPort'
)
$feProcess = Start-Process -FilePath $nodeCmd.Source -ArgumentList $feArgs `
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
} finally {
    Release-DevStackMutex
}
