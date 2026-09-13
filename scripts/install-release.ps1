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
        $manifestPath = Join-Path $tempRoot 'kalio-runtime-manifest.json'
        $installerPath = Join-Path $tempRoot 'install.ps1'
        Write-Host "[kalio] downloading $assetName from $tag" -ForegroundColor Cyan
        Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$assetName" -OutFile $archivePath
        $manifestDownloaded = $false
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/kalio-runtime-manifest.json" -OutFile $manifestPath
            $manifestDownloaded = $true
        } catch {
            Write-Warning "Runtime manifest is unavailable for $tag; continuing without an archive hash check"
        }
        if ($manifestDownloaded) {
            $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
            if ($manifest.schema -ne 1 -or [string]::IsNullOrWhiteSpace([string]$manifest.payload)) {
                throw 'Runtime update manifest is invalid'
            }
            $payloadBytes = [Convert]::FromBase64String([string]$manifest.payload)
            $payload = [Text.Encoding]::UTF8.GetString($payloadBytes) | ConvertFrom-Json
            if ([string]$payload.tag -ne $tag -or [string]$payload.version -ne $releaseVersion) {
                throw 'Runtime update manifest does not match the selected GitHub Release'
            }
            $hashEntry = @($payload.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
            if ($null -eq $hashEntry -or ([string]$hashEntry.sha256) -notmatch '^[A-Fa-f0-9]{64}$') {
                throw "Runtime update manifest has no valid SHA-256 entry for $assetName"
            }
            $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne ([string]$hashEntry.sha256).ToLowerInvariant()) {
                throw "Runtime archive SHA-256 mismatch: expected $($hashEntry.sha256), got $actualHash"
            }
            Write-Host '[kalio] runtime archive SHA-256 verified' -ForegroundColor Green
            if ($manifest.signature) {
                Write-Warning 'Runtime manifest signature is present; full Ed25519 trust verification is enabled after the signed public key is installed'
            } else {
                Write-Warning 'Runtime manifest is unsigned; archive integrity is protected by HTTPS and SHA-256 only'
            }
        }
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
