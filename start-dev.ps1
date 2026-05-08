# Kalio v2 — dev launcher
# Uruchamia backend (nest watch) + frontend (vite dev) w jednej konsoli
# Uzycie: .\start-dev.ps1
# Zatrzymanie: Ctrl+C — czyści oba serwery

$root = $PSScriptRoot
$api  = Join-Path $root "apps\kalio-api"
$web  = Join-Path $root "apps\kalio-web"
$nestJs = Join-Path $api "node_modules\@nestjs\cli\bin\nest.js"
$viteJs = Join-Path $web "node_modules\vite\bin\vite.js"
$BE_PORT = 3016
$FE_PORT = 5188
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Write-Host "[FAIL] node not found on PATH" -ForegroundColor Red; exit 1 }

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

function Get-KalioNodeProcessIds {
    try {
        $marker = "kalio-forever"
        @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*$marker*" } |
            Select-Object -ExpandProperty ProcessId | Sort-Object -Unique)
    } catch {
        @()
    }
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

function Clear-KalioDevProcesses {
    param(
        [int[]]$Ports,
        [int]$TimeoutMs = 15000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)

    do {
        $portOwners = @(Get-PortOwners -Ports $Ports)
        $kalioNodePids = @(Get-KalioNodeProcessIds)

        if ($portOwners.Count -eq 0 -and $kalioNodePids.Count -eq 0) {
            return $true
        }

        if ($portOwners.Count -gt 0) {
            Stop-Processes -ProcessIds $portOwners -Label 'port owner'
        }

        if ($kalioNodePids.Count -gt 0) {
            Stop-Processes -ProcessIds $kalioNodePids -Label 'kalio node'
        }

        Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $deadline)

    $remainingPortOwners = @(Get-PortOwners -Ports $Ports)
    $remainingKalioNodePids = @(Get-KalioNodeProcessIds)

    if ($remainingPortOwners.Count -gt 0 -or $remainingKalioNodePids.Count -gt 0) {
        Write-Host "  [FAIL] Could not clear previous Kalio processes/ports." -ForegroundColor Red
        if ($remainingPortOwners.Count -gt 0) {
            Write-Host "  Remaining port owners: $($remainingPortOwners -join ', ')" -ForegroundColor Red
        }
        if ($remainingKalioNodePids.Count -gt 0) {
            Write-Host "  Remaining kalio node PIDs: $($remainingKalioNodePids -join ', ')" -ForegroundColor Red
        }
        return $false
    }

    return $true
}

# --- Kill any leftover processes on our ports ---
Write-Host "KALIO Dev Stack" -ForegroundColor Cyan
Write-Host "  Clearing ports $BE_PORT and $FE_PORT..." -ForegroundColor DarkYellow
if (-not (Clear-KalioDevProcesses -Ports @($BE_PORT, $FE_PORT))) {
    exit 1
}

Write-Host ""
Write-Host "Kalio v2 - dev environment" -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:$BE_PORT" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:$FE_PORT" -ForegroundColor Green
Write-Host ""

# --- Start backend (nest start --watch) ---
$beProcess = Start-Process -FilePath $nodeCmd.Source -ArgumentList $nestJs, "start", "--watch" `
    -WorkingDirectory $api -NoNewWindow -PassThru

Write-Host "  Backend  -> http://localhost:$BE_PORT  (PID $($beProcess.Id))" -ForegroundColor Green

# Wait for backend to be ready
Write-Host "  Waiting for backend to be ready..." -ForegroundColor DarkYellow
$retries = 0
$maxRetries = 120   # 120 × 500ms = 60s total
while ($retries -lt $maxRetries) {
    Start-Sleep -Milliseconds 500

    if ($beProcess -and $beProcess.HasExited) {
        Write-Host "  [FAIL] Backend process exited unexpectedly (code $($beProcess.ExitCode))." -ForegroundColor Red
        Clear-KalioDevProcesses -Ports @($BE_PORT, $FE_PORT) | Out-Null
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
    if ($beProcess -and -not $beProcess.HasExited) {
        Stop-Process -Id $beProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Clear-KalioDevProcesses -Ports @($BE_PORT, $FE_PORT) | Out-Null
    exit 1
}
Write-Host "  Backend ready!" -ForegroundColor Green

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
    if ($beProcess -and -not $beProcess.HasExited) {
        Stop-Process -Id $beProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($feProcess -and -not $feProcess.HasExited) {
        Stop-Process -Id $feProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Clear-KalioDevProcesses -Ports @($BE_PORT, $FE_PORT) | Out-Null
    Write-Host "[OK] Stack stopped." -ForegroundColor Green
}