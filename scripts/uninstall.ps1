# Kalio Windows runtime uninstaller
# By default it removes the installed runtime and preserves data.

param(
    [string]$InstallRoot = '',
    [switch]$PurgeData,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Assert-UnderRoot {
    param([string]$Path, [string]$Root)
    $resolvedPath = [IO.Path]::GetFullPath($Path)
    $resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside install root: $resolvedPath"
    }
}

function Get-AutostartShortcutPath {
    $startupRoot = [Environment]::GetFolderPath('Startup')
    if (-not $startupRoot) {
        $startupRoot = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    }
    return Join-Path $startupRoot 'Kalio Forever.lnk'
}

function Remove-AutostartShortcut {
    $shortcutPath = Get-AutostartShortcutPath
    if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
        Remove-Item -LiteralPath $shortcutPath -Force
    }
}

function Remove-LegacyScheduledTasks {
    foreach ($taskName in @('Kalio Forever', 'Kalio-Forever')) {
        try {
            Get-ScheduledTask -TaskPath '\' -TaskName $taskName -ErrorAction Stop | Out-Null
        } catch {
            if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') {
                continue
            }
            throw
        }
        Unregister-ScheduledTask -TaskPath '\' -TaskName $taskName -Confirm:$false -ErrorAction Stop
    }
}

try {
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    if (-not $localAppData) {
        $localAppData = Join-Path $env:USERPROFILE 'AppData\Local'
    }
    if (-not $InstallRoot) {
        $InstallRoot = Join-Path $localAppData 'Kalio'
    }
    $InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
    $lockPath = Join-Path $InstallRoot '.runtime.lock'
    if (Test-Path -LiteralPath $lockPath) {
        throw "Kalio appears to be running. Close it and rerun the uninstaller: $lockPath"
    }

    Remove-AutostartShortcut
    Remove-LegacyScheduledTasks
    $appRoot = Join-Path $InstallRoot 'app'
    $binRoot = Join-Path $InstallRoot 'bin'
    Assert-UnderRoot -Path $appRoot -Root $InstallRoot
    Assert-UnderRoot -Path $binRoot -Root $InstallRoot
    if (Test-Path -LiteralPath $appRoot) {
        Remove-Item -LiteralPath $appRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $binRoot) {
        Remove-Item -LiteralPath $binRoot -Recurse -Force
    }
    Remove-Item -LiteralPath (Join-Path $InstallRoot 'current.json') -Force -ErrorAction SilentlyContinue
    Write-Host '[kalio] installed runtime removed' -ForegroundColor Green

    if ($PurgeData) {
        if (-not $Force) {
            $answer = Read-Host "Delete Kalio data, logs, and cache under '$InstallRoot'? [y/N]"
            if ($answer.Trim().ToLower() -notin @('y', 'yes')) {
                Write-Host '[kalio] data preserved' -ForegroundColor Green
                exit 0
            }
        }
        foreach ($directory in @('data', 'logs', 'cache')) {
            $target = Join-Path $InstallRoot $directory
            Assert-UnderRoot -Path $target -Root $InstallRoot
            Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host '[kalio] data removed' -ForegroundColor Yellow
    } else {
        Write-Host "[kalio] data preserved under $(Join-Path $InstallRoot 'data')" -ForegroundColor Green
    }
} catch {
    Write-Host "[kalio] FAIL $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
