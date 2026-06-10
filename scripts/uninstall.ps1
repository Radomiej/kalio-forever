# Kalio Windows production uninstaller
# Usage:
#   irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/uninstall.ps1 | iex
#   .\scripts\uninstall.ps1 -KeepData

param(
    [string]$InstallDir = '',
    [string]$DataRoot = '',
    [switch]$KeepData,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Kalio-Forever'

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if (-not $localAppData) {
    $localAppData = Join-Path $env:USERPROFILE 'AppData\Local'
}

if (-not $InstallDir) {
    $InstallDir = Join-Path $localAppData 'kalio-forever\app'
}
if (-not $DataRoot) {
    $DataRoot = Join-Path $localAppData 'kalio-forever'
}

function Write-Step {
    param([string]$Message)
    Write-Host "[kalio] $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[kalio] $Message" -ForegroundColor Green
}

function Ensure-SystemNodeOnPath {
    $programFilesNode = 'C:\Program Files\nodejs'
    if (Test-Path $programFilesNode) {
        $env:PATH = "$programFilesNode;$env:PATH"
    }
}

try {
    Write-Host ''
    Write-Host 'Kalio Production Uninstaller' -ForegroundColor Cyan
    Write-Host "  install dir -> $InstallDir" -ForegroundColor Yellow
    Write-Host "  data root   -> $DataRoot" -ForegroundColor Yellow
    Write-Host ''

    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Write-Step "Removing Scheduled Task '$TaskName'"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Ok "Removed Scheduled Task '$TaskName'"
    } else {
        Write-Step "Scheduled Task '$TaskName' not found"
    }

    Ensure-SystemNodeOnPath
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }

    $stackManager = Join-Path $InstallDir 'scripts\stack-manager.mjs'
    if ($nodeCmd -and (Test-Path $stackManager)) {
        Write-Step 'Stopping managed Kalio stack'
        Push-Location $InstallDir
        try {
            & $nodeCmd.Source $stackManager stop
        } finally {
            Pop-Location
        }
        Write-Ok 'Stack stop requested'
    } else {
        Write-Step 'Stack manager unavailable; skipping managed stop'
    }

    if (Test-Path $InstallDir) {
        Write-Step "Removing install dir: $InstallDir"
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
        Write-Ok 'Install dir removed'
    }

    if (-not $KeepData) {
        if (-not $Force) {
            $answer = Read-Host "Delete user data at '$DataRoot' too? [y/N]"
            if ($answer -notin @('y', 'Y', 'yes', 'YES')) {
                Write-Ok 'User data preserved'
                exit 0
            }
        }

        if (Test-Path $DataRoot) {
            Write-Step "Removing data root: $DataRoot"
            Remove-Item -LiteralPath $DataRoot -Recurse -Force
            Write-Ok 'Data root removed'
        }
    } else {
        Write-Ok "User data preserved at $DataRoot"
    }

    Write-Host ''
    Write-Ok 'Kalio uninstall complete'
    Write-Host ''
} catch {
    Write-Host "[kalio] FAIL $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
