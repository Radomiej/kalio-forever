[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'

function Remove-TreeWithRetry {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $lastError = $null
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force
            return
        } catch {
            $lastError = $_.Exception
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Unable to remove temporary installer smoke path ${Path}: $($lastError.Message)"
}

function Stop-InstalledRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter()][System.Diagnostics.Process]$AppProcess
    )

    if ($null -ne $AppProcess -and -not $AppProcess.HasExited) {
        if ($AppProcess.CloseMainWindow()) {
            [void]$AppProcess.WaitForExit(10000)
        }
        if (-not $AppProcess.HasExited) {
            $AppProcess.Kill()
            [void]$AppProcess.WaitForExit(5000)
        }
    }

    $installPrefix = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\') + '\'
    Get-Process -Name 'kalio-node' -ErrorAction SilentlyContinue | ForEach-Object {
        $path = $null
        try {
            $path = $_.Path
        } catch {
            $path = $null
        }
        if ($path -and $path.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

$resolvedInstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
if (-not (Test-Path -LiteralPath $resolvedInstallerPath -PathType Leaf)) {
    throw "NSIS installer is missing: $resolvedInstallerPath"
}

$existingListener = Get-NetTCPConnection -State Listen -LocalPort 4516 -ErrorAction SilentlyContinue
if ($null -ne $existingListener) {
    throw 'Port 4516 is already in use; refusing to interfere with another Kalio instance'
}

$installRoot = Join-Path ([IO.Path]::GetTempPath()) ('kalio-tauri-installer-smoke-' + [guid]::NewGuid().ToString('N'))
$appDataRoot = Join-Path ([IO.Path]::GetTempPath()) ('kalio-tauri-appdata-smoke-' + [guid]::NewGuid().ToString('N'))
$appProcess = $null

try {
    $installerProcess = Start-Process -FilePath $resolvedInstallerPath -ArgumentList @('/S', "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
    if ($installerProcess.ExitCode -ne 0) {
        throw "NSIS installer exited with code $($installerProcess.ExitCode)"
    }

    $app = Get-ChildItem -LiteralPath $installRoot -Filter 'kalio.exe' -File -Recurse | Select-Object -First 1
    if ($null -eq $app) {
        throw "installed Kalio.exe was not found under $installRoot"
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $app.FullName
    $startInfo.WorkingDirectory = $app.DirectoryName
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['LOCALAPPDATA'] = $appDataRoot
    $startInfo.EnvironmentVariables['KALIO_RUNTIME_VERSION'] = 'installer-smoke'
    $appProcess = [Diagnostics.Process]::new()
    $appProcess.StartInfo = $startInfo
    if (-not $appProcess.Start()) {
        throw 'installed Kalio.exe did not start'
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    $healthy = $false
    $lastError = 'installed Tauri app did not answer yet'
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($appProcess.HasExited) {
            throw "installed Kalio.exe exited with code $($appProcess.ExitCode)"
        }
        try {
            $health = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:4516/api/health'
            $runtimeInfo = Invoke-RestMethod -UseBasicParsing -TimeoutSec 2 -Uri 'http://127.0.0.1:4516/api/runtime/info'
            if ($health.status -eq 'ok' -and $runtimeInfo.status -eq 'ok' -and $runtimeInfo.runtime -eq 'kalio') {
                $healthy = $true
                Write-Output "[desktop-installer-smoke] healthy driver=$($runtimeInfo.sqliteDriver)"
                break
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $healthy) {
        throw "installed Kalio.exe did not become healthy: $lastError"
    }

    $databasePath = Join-Path $appDataRoot 'Kalio\data\kalio.db'
    if (-not (Test-Path -LiteralPath $databasePath -PathType Leaf)) {
        throw "installed Tauri app did not create AppData database: $databasePath"
    }
    Write-Output "[desktop-installer-smoke] passed database=$databasePath"
} finally {
    Stop-InstalledRuntime -InstallRoot $installRoot -AppProcess $appProcess
    Remove-TreeWithRetry -Path $installRoot
    Remove-TreeWithRetry -Path $appDataRoot
}
