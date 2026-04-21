# Kalio v2 — dev launcher
# Uruchamia backend i frontend w osobnych oknach PowerShell z live output.
# Uzycie: .\start-dev.ps1

$root  = $PSScriptRoot
$api   = Join-Path $root "apps\kalio-api"
$web   = Join-Path $root "apps\kalio-web"
$nestBin = Join-Path $api "node_modules\.bin\nest.CMD"
$BE_PORT = 3016
$FE_PORT = 5188

function Kill-Port {
    param([int]$Port)
    $pids = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | 
            Select-Object -ExpandProperty OwningProcess | 
            Sort-Object -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Write-Host "  [kill] PID $p on :$Port" -ForegroundColor DarkYellow
    }
}

Write-Host "KALIO Dev Stack" -ForegroundColor Cyan
Write-Host "  Clearing ports $BE_PORT and $FE_PORT..." -ForegroundColor DarkYellow
Kill-Port $BE_PORT
Kill-Port $FE_PORT
Start-Sleep -Milliseconds 300

Write-Host ""
Write-Host "Kalio v2 - dev environment" -ForegroundColor Cyan
Write-Host "  kalio-api  ->  http://localhost:3016" -ForegroundColor Green
Write-Host "  kalio-web  ->  http://localhost:5188" -ForegroundColor Green
Write-Host ""

$apiCmd = "Set-Location '$api'; Write-Host 'kalio-api starting...' -ForegroundColor Cyan; & '$nestBin' start --watch"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $apiCmd -WindowStyle Normal

$webCmd = "Set-Location '$web'; Write-Host 'kalio-web starting...' -ForegroundColor Cyan; pnpm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $webCmd -WindowStyle Normal

Write-Host "Both servers starting in separate windows." -ForegroundColor Yellow
Write-Host "Close those windows to stop." -ForegroundColor Yellow
Write-Host ""