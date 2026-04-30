# Kalio v2 — dev launcher
# Uruchamia backend (nest watch) + frontend (vite dev) w jednej konsoli
# Uzycie: .\start-dev.ps1
# Zatrzymanie: Ctrl+C — czyści oba serwery

$root = $PSScriptRoot
$api  = Join-Path $root "apps\kalio-api"
$web  = Join-Path $root "apps\kalio-web"
$nestBin = Join-Path $api "node_modules\.bin\nest.CMD"
$BE_PORT = 3016
$FE_PORT = 5188

function Kill-Port {
    param([int]$Port)
    $pids = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Host "  [kill] PID $p on :$Port" -ForegroundColor DarkYellow
    }
}

function Kill-KalioNodeProcesses {
    # Kill any node.exe whose command line references this project — catches
    # orphaned nest/vite processes from crashed or duplicate start-dev runs.
    try {
        $marker = "kalio-forever"
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like "*$marker*" } |
            ForEach-Object {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                Write-Host "  [kill] kalio node PID $($_.ProcessId)" -ForegroundColor DarkYellow
            }
    } catch { }
}

# --- Kill any leftover processes on our ports ---
Write-Host "KALIO Dev Stack" -ForegroundColor Cyan
Write-Host "  Clearing ports $BE_PORT and $FE_PORT..." -ForegroundColor DarkYellow
Kill-Port $BE_PORT
Kill-Port $FE_PORT
Kill-KalioNodeProcesses
Start-Sleep -Milliseconds 600

Write-Host ""
Write-Host "Kalio v2 - dev environment" -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:$BE_PORT" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:$FE_PORT" -ForegroundColor Green
Write-Host ""

# --- Start backend (nest start --watch) ---
$beJob = Start-Job -ScriptBlock {
    param($dir, $nestBin)
    Set-Location $dir
    & $nestBin start --watch 2>&1
} -ArgumentList $api, $nestBin

Write-Host "  Backend  -> http://localhost:$BE_PORT  (Job $($beJob.Id))" -ForegroundColor Green

# Wait for backend to be ready — show output while waiting
Write-Host "  Waiting for backend to be ready..." -ForegroundColor DarkYellow
$retries = 0
$maxRetries = 120   # 120 × 500ms = 60s total
while ($retries -lt $maxRetries) {
    Start-Sleep -Milliseconds 500

    # Always stream backend output so we can see what's happening
    $beOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
    if ($beOut) {
        $beOut | ForEach-Object { Write-Host "  [be] $_" -ForegroundColor DarkCyan }
    }

    # Bail early if job already died
    if ($beJob.State -eq 'Failed' -or $beJob.State -eq 'Completed') {
        $remaining = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
        if ($remaining) { $remaining | ForEach-Object { Write-Host "  [be] $_" -ForegroundColor Red } }
        Write-Host "  [FAIL] Backend process exited unexpectedly ($($beJob.State))." -ForegroundColor Red
        Stop-Job $beJob -ErrorAction SilentlyContinue
        Remove-Job $beJob -Force -ErrorAction SilentlyContinue
        Kill-Port $BE_PORT
        exit 1
    }

    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$BE_PORT/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($response.StatusCode -eq 200) { break }
    } catch { }
    $retries++
}

if ($retries -ge $maxRetries) {
    $remaining = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
    if ($remaining) { $remaining | ForEach-Object { Write-Host "  [be] $_" -ForegroundColor Red } }
    Write-Host "  [FAIL] Backend did not respond within 60s. Check output above." -ForegroundColor Red
    Stop-Job $beJob -ErrorAction SilentlyContinue
    Remove-Job $beJob -Force -ErrorAction SilentlyContinue
    Kill-Port $BE_PORT
    exit 1
}
Write-Host "  Backend ready!" -ForegroundColor Green

# --- Start frontend (vite dev) ---
# IMPORTANT: @tailwindcss/oxide (Rust native module used by Tailwind CSS v4)
# crashes with exit code -1 (4294967295) on Windows when stdout is redirected
# to a file or pipe. The process MUST inherit the real console handles.
# We therefore run it without any output redirect; Vite output goes directly
# to the current console (interleaved with [be] output). No [fe] prefix, but stable.
$pnpmCmd = (Get-Command pnpm.CMD -ErrorAction SilentlyContinue)
if (-not $pnpmCmd) { $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue }
if (-not $pnpmCmd) { Write-Host "[FAIL] pnpm not found on PATH" -ForegroundColor Red; exit 1 }

$feProcess = Start-Process -FilePath $pnpmCmd.Source -ArgumentList "run", "dev" `
    -WorkingDirectory $web -NoNewWindow -PassThru

Write-Host "  Frontend -> http://localhost:$FE_PORT  (PID $($feProcess.Id))" -ForegroundColor Green
Write-Host "  Ctrl+C to stop both" -ForegroundColor Yellow
Write-Host ""

# --- Tail backend output + monitor both processes ---
try {
    while ($true) {
        $beOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
        if ($beOut) {
            $beOut | ForEach-Object { Write-Host "[be] $_" -ForegroundColor DarkCyan }
        }

        if ($beJob.State -eq 'Failed' -or $beJob.State -eq 'Completed') {
            $beOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
            if ($beOut) { $beOut | ForEach-Object { Write-Host "[be] $_" -ForegroundColor Red } }
            Write-Host "[FAIL] Backend exited ($($beJob.State))" -ForegroundColor Red
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
    Stop-Job $beJob -ErrorAction SilentlyContinue
    Remove-Job $beJob -Force -ErrorAction SilentlyContinue
    if ($feProcess -and -not $feProcess.HasExited) {
        Stop-Process -Id $feProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Kill-Port $BE_PORT
    Kill-Port $FE_PORT
    Kill-KalioNodeProcesses
    Write-Host "[OK] Stack stopped." -ForegroundColor Green
}