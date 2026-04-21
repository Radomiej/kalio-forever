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

# --- Kill any leftover processes on our ports ---
Write-Host "KALIO Dev Stack" -ForegroundColor Cyan
Write-Host "  Clearing ports $BE_PORT and $FE_PORT..." -ForegroundColor DarkYellow
Kill-Port $BE_PORT
Kill-Port $FE_PORT
Start-Sleep -Milliseconds 300

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

# Wait for backend to be ready
Write-Host "  Waiting for backend to be ready..." -ForegroundColor DarkYellow
$retries = 0
while ($retries -lt 40) {
    Start-Sleep -Milliseconds 300
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$BE_PORT" -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) { break }
    } catch { }
    $retries++
}
if ($retries -ge 40) {
    $earlyOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
    if ($earlyOut) {
        $earlyOut | ForEach-Object { Write-Host "[be] $_" -ForegroundColor Red }
    }
    Write-Host "  [FAIL] Backend did not start. Check output above." -ForegroundColor Red
    Stop-Job $beJob -ErrorAction SilentlyContinue
    Remove-Job $beJob -Force -ErrorAction SilentlyContinue
    Kill-Port $BE_PORT
    exit 1
}
Write-Host "  Backend ready!" -ForegroundColor Green

# --- Start frontend (vite dev) ---
$feJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    & pnpm run dev 2>&1
} -ArgumentList $web

Write-Host "  Frontend -> http://localhost:$FE_PORT  (Job $($feJob.Id))" -ForegroundColor Green
Write-Host "  Ctrl+C to stop both" -ForegroundColor Yellow
Write-Host ""

# --- Tail job output ---
try {
    while ($true) {
        # Backend output
        $beOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
        if ($beOut) {
            $beOut | ForEach-Object { Write-Host "[be] $_" -ForegroundColor DarkCyan }
        }

        # Frontend output
        $feOut = Receive-Job -Job $feJob -ErrorAction SilentlyContinue
        if ($feOut) {
            $feOut | ForEach-Object { Write-Host "[fe] $_" -ForegroundColor DarkGreen }
        }

        # Crash detection
        if ($beJob.State -eq 'Failed' -or $beJob.State -eq 'Completed') {
            $beOut = Receive-Job -Job $beJob -ErrorAction SilentlyContinue
            if ($beOut) { $beOut | ForEach-Object { Write-Host "[be] $_" -ForegroundColor Red } }
            Write-Host "[FAIL] Backend exited ($($beJob.State))" -ForegroundColor Red
            break
        }
        if ($feJob.State -eq 'Failed' -or $feJob.State -eq 'Completed') {
            $feOut = Receive-Job -Job $feJob -ErrorAction SilentlyContinue
            if ($feOut) { $feOut | ForEach-Object { Write-Host "[fe] $_" -ForegroundColor Red } }
            Write-Host "[FAIL] Frontend exited ($($feJob.State))" -ForegroundColor Red
            break
        }

        Start-Sleep -Milliseconds 400
    }
} finally {
    Write-Host ""
    Write-Host "Stopping stack..." -ForegroundColor Yellow
    Stop-Job $beJob, $feJob -ErrorAction SilentlyContinue
    Remove-Job $beJob, $feJob -Force -ErrorAction SilentlyContinue
    Kill-Port $BE_PORT
    Kill-Port $FE_PORT
    Write-Host "[OK] Stack stopped." -ForegroundColor Green
}