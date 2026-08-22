# Kalio GitHub Release installer/upgrader for Windows
# Downloads a versioned runtime archive and delegates installation to install.ps1.

[CmdletBinding()]
param(
    [ValidateSet('node', 'bun')]
    [string]$Runtime = 'node',
    [ValidatePattern('^(latest|v?[A-Za-z0-9][A-Za-z0-9._-]*)$')]
    [string]$Version = 'latest',
    [string]$InstallRoot = '',
    [switch]$NoLaunch,
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
    [string]$Repository = 'Radomiej/kalio-forever'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-ReleaseTag {
    param([string]$RequestedVersion)

    if ($RequestedVersion -eq 'latest') {
        $headers = @{
            Accept = 'application/vnd.github+json'
            'User-Agent' = 'Kalio-release-installer'
        }
        $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $headers
        return [string]$release.tag_name
    }

    if ($RequestedVersion.StartsWith('v')) {
        return $RequestedVersion
    }
    return 'v' + $RequestedVersion
}

try {
    $tag = Get-ReleaseTag -RequestedVersion $Version
    if ($tag -notmatch '^v[A-Za-z0-9][A-Za-z0-9._-]*$') {
        throw "GitHub release tag is invalid: $tag"
    }
    $releaseVersion = $tag.Substring(1)
    $runtimeSuffix = if ($Runtime -eq 'bun') { '-bun' } else { '' }
    $assetName = 'kalio-runtime-{0}{1}-windows-x64.zip' -f $releaseVersion, $runtimeSuffix
    $baseUrl = "https://github.com/$Repository/releases/download/$tag"
    $rawBaseUrl = "https://raw.githubusercontent.com/$Repository/$tag"
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('kalio-release-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    try {
        $archivePath = Join-Path $tempRoot $assetName
        $installerPath = Join-Path $tempRoot 'install.ps1'
        Write-Host "[kalio] downloading $assetName from $tag" -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$assetName" -OutFile $archivePath
        Invoke-WebRequest -UseBasicParsing -Uri "$rawBaseUrl/scripts/install.ps1" -OutFile $installerPath

        $installerArgs = @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-File', $installerPath,
            '-ArchivePath', $archivePath
        )
        if ($InstallRoot) {
            $installerArgs += @('-InstallRoot', $InstallRoot)
        }
        if ($NoLaunch) {
            $installerArgs += '-NoLaunch'
        }
        & powershell.exe @installerArgs
        if ($LASTEXITCODE -ne 0) {
            throw "Runtime installer exited with code $LASTEXITCODE"
        }
    } finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
} catch {
    Write-Host "[kalio] FAIL $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
