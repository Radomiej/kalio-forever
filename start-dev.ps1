# Kalio v2 — dev launcher
# Uruchamia backend i frontend równolegle w osobnych terminalach.

$ErrorActionPreference = 'Stop'

Write-Host "Starting Kalio v2 dev environment..." -ForegroundColor Cyan

$apiJob = Start-Job -Name "kalio-api" -ScriptBlock {
  Set-Location "c:\Projekty\kalio-forever\apps\kalio-api"
  pnpm run dev
}

$webJob = Start-Job -Name "kalio-web" -ScriptBlock {
  Set-Location "c:\Projekty\kalio-forever\apps\kalio-web"
  pnpm run dev
}

Write-Host "  kalio-api  → http://localhost:3015" -ForegroundColor Green
Write-Host "  kalio-web  → http://localhost:5187" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop all processes." -ForegroundColor Yellow

try {
  while ($true) {
    Start-Sleep -Seconds 2
    $apiJob, $webJob | ForEach-Object {
      if ($_.State -eq 'Failed') {
        Write-Host "Job $($_.Name) failed:" -ForegroundColor Red
        Receive-Job $_ -ErrorAction SilentlyContinue
      }
    }
  }
} finally {
  Stop-Job $apiJob, $webJob -ErrorAction SilentlyContinue
  Remove-Job $apiJob, $webJob -ErrorAction SilentlyContinue
  Write-Host "Dev environment stopped." -ForegroundColor Cyan
}
