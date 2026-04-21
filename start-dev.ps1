# Kalio v2 — dev launcher
# Uruchamia backend i frontend w osobnych oknach PowerShell z live output.
# Użycie: .\start-dev.ps1

$root  = $PSScriptRoot
$api   = Join-Path $root "apps\kalio-api"
$web   = Join-Path $root "apps\kalio-web"
$nestBin = Join-Path $api "node_modules\.bin\nest.CMD"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          Kalio v2 — dev environment          ║" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "║  kalio-api  →  http://localhost:3016         ║" -ForegroundColor Green
Write-Host "║  kalio-web  →  http://localhost:5188         ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Start API in new window ────────────────────────────────────────────────────
$apiCmd = "Set-Location '$api'; Write-Host 'kalio-api starting...' -ForegroundColor Cyan; & '$nestBin' start --watch"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $apiCmd -WindowStyle Normal

# ── Start Web in new window ────────────────────────────────────────────────────
$webCmd = "Set-Location '$web'; Write-Host 'kalio-web starting...' -ForegroundColor Cyan; pnpm run dev"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $webCmd -WindowStyle Normal

Write-Host "Both servers starting in separate windows." -ForegroundColor Yellow
Write-Host "Close those windows or press Ctrl+C here to stop." -ForegroundColor Yellow
Write-Host ""
