# Kalio Windows production installer
# Usage:
#   irm https://raw.githubusercontent.com/Radomiej/kalio-forever/main/scripts/install.ps1 | iex
#   .\scripts\install.ps1 -RepoUrl https://github.com/Radomiej/kalio-forever.git

param(
    [string]$RepoUrl = 'https://github.com/Radomiej/kalio-forever.git',
    [string]$Branch = 'main',
    [string]$InstallDir = '',
    [string]$DataRoot = '',
    [int]$BackendPort = 4016,
    [int]$FrontendPort = 6188,
    [switch]$NoOpen,
    [switch]$NoTask,
    [switch]$SkipBuild
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

function Write-Fail {
    param([string]$Message)
    Write-Host "[kalio] FAIL $Message" -ForegroundColor Red
}

function Ensure-SystemNodeOnPath {
    $programFilesNode = 'C:\Program Files\nodejs'
    if (Test-Path $programFilesNode) {
        $env:PATH = "$programFilesNode;$env:PATH"
    }
}

function Get-NodeCommand {
    Ensure-SystemNodeOnPath
    $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
    if (-not $nodeCmd) {
        throw 'Node.js not found. Install Node 22+ from https://nodejs.org and rerun the installer.'
    }
    return $nodeCmd
}

function Test-NodeVersion {
    param($NodeCmd)
    $versionText = & $NodeCmd.Source -p "process.versions.node"
    $major = [int]($versionText.Split('.')[0])
    if ($major -lt 22) {
        throw "Node.js 22+ required. Found $versionText at $($NodeCmd.Source)"
    }
}

function Test-GitAvailable {
    $gitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
    if (-not $gitCmd) { $gitCmd = Get-Command git -ErrorAction SilentlyContinue }
    if (-not $gitCmd) {
        throw 'Git not found. Install Git for Windows and rerun the installer.'
    }
    return $gitCmd
}

function Test-PortFree {
    param([int]$Port)

    $owners = @(Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 } |
        Select-Object -ExpandProperty OwningProcess -Unique)

    if ($owners.Count -gt 0) {
        throw "Port $Port is already in use (PID $($owners -join ', ')). Stop the conflicting process or pass different ports."
    }
}

function Stop-ManagedStackIfPresent {
    param($NodeCmd, [string]$TargetDir)

    $stackManager = Join-Path $TargetDir 'scripts\stack-manager.mjs'
    if (-not (Test-Path $stackManager)) {
        return
    }

    Write-Step 'Stopping any existing managed stack'
    & $NodeCmd.Source $stackManager stop
    if ($LASTEXITCODE -ne 0) {
        Write-Step 'No managed stack to stop (continuing)'
    }
}

function Ensure-Pnpm {
    param($NodeCmd)

    Write-Step 'Enabling pnpm via corepack'
    $corepackJs = Join-Path ${env:ProgramFiles} 'nodejs\node_modules\corepack\dist\corepack.js'
    if (-not (Test-Path $corepackJs)) {
        $corepackJs = Join-Path (Split-Path $NodeCmd.Source -Parent) 'node_modules\corepack\dist\corepack.js'
    }
    if (-not (Test-Path $corepackJs)) {
        throw 'corepack.js not found. Reinstall Node.js 22+ with corepack support.'
    }

    & $NodeCmd.Source $corepackJs enable
    if ($LASTEXITCODE -ne 0) { throw "corepack enable failed with exit code $LASTEXITCODE" }

    & $NodeCmd.Source $corepackJs prepare pnpm@9.15.0 --activate
    if ($LASTEXITCODE -ne 0) { throw "corepack prepare pnpm failed with exit code $LASTEXITCODE" }

    $pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) { $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue }
    if (-not $pnpmCmd) {
        throw 'pnpm not available after corepack prepare.'
    }
    return $pnpmCmd
}

function Ensure-Repo {
    param($GitCmd, [string]$TargetDir, [string]$RemoteUrl, [string]$RemoteBranch)

    New-Item -ItemType Directory -Force -Path (Split-Path $TargetDir -Parent) | Out-Null

    if (Test-Path (Join-Path $TargetDir '.git')) {
        Write-Step "Updating existing install at $TargetDir"
        Push-Location $TargetDir
        try {
            & $GitCmd.Source fetch origin $RemoteBranch
            if ($LASTEXITCODE -ne 0) { throw "git fetch failed with exit code $LASTEXITCODE" }
            & $GitCmd.Source checkout $RemoteBranch
            if ($LASTEXITCODE -ne 0) { throw "git checkout failed with exit code $LASTEXITCODE" }
            & $GitCmd.Source pull --ff-only origin $RemoteBranch
            if ($LASTEXITCODE -ne 0) { throw "git pull failed with exit code $LASTEXITCODE" }
        } finally {
            Pop-Location
        }
        return
    }

    if (Test-Path $TargetDir) {
        throw "Install path exists but is not a git repo: $TargetDir"
    }

    Write-Step "Cloning $RemoteUrl -> $TargetDir"
    & $GitCmd.Source clone --branch $RemoteBranch --depth 1 $RemoteUrl $TargetDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit code $LASTEXITCODE" }
}

function New-ProdEnvFile {
    param([string]$Path, [string]$Root, [int]$ApiPort, [int]$WebPort)

    if (Test-Path $Path) {
        Write-Step "Keeping existing env file: $Path"
        return
    }

    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $masterKey = [Convert]::ToBase64String($bytes)

    $dbPath = Join-Path $Root 'kalio.db'
    $workspacePath = Join-Path $Root 'workspaces'
    $memoryPath = Join-Path $Root 'memory'
    $embeddingPath = Join-Path $Root 'embeddings-cache'

    $content = @"
# Kalio production profile (generated by install.ps1)
LLM_PROVIDER=mock
LLM_API_KEY=mock
LLM_BASE_URL=mock
LLM_MODEL=mock

NODE_ENV=production
PORT=$ApiPort
VITE_PORT=$WebPort
DATABASE_PATH=$dbPath
WORKSPACE_ROOT=$workspacePath
MEMORY_DB_PATH=$memoryPath
EMBEDDING_CACHE_DIR=$embeddingPath
CREDENTIALS_MASTER_KEY=$masterKey
CORS_ORIGIN=http://localhost:$WebPort,http://127.0.0.1:$WebPort
KALIO_INSTALL_PROFILE=prod
"@

    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    Set-Content -Path $Path -Value $content -Encoding UTF8
    Write-Ok "Created prod env file: $Path"
}

function Register-KalioTask {
    param([string]$AutostartScript)

    if (-not (Test-Path $AutostartScript)) {
        throw "Autostart script missing: $AutostartScript"
    }

    Write-Step "Registering Scheduled Task '$TaskName'"
    $action = New-ScheduledTaskAction `
        -Execute 'powershell.exe' `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$AutostartScript`""

    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'Start Kalio prod stack when the user signs in' `
        -Force | Out-Null

    Write-Ok "Scheduled Task '$TaskName' registered"
}

try {
    Write-Host ''
    Write-Host 'Kalio Production Installer' -ForegroundColor Cyan
    Write-Host "  install dir -> $InstallDir" -ForegroundColor Green
    Write-Host "  data root   -> $DataRoot" -ForegroundColor Green
    Write-Host "  ports       -> API $BackendPort / UI $FrontendPort" -ForegroundColor Green
    Write-Host ''

    $nodeCmd = Get-NodeCommand
    Test-NodeVersion -NodeCmd $nodeCmd
    $gitCmd = Test-GitAvailable

    Ensure-Repo -GitCmd $gitCmd -TargetDir $InstallDir -RemoteUrl $RepoUrl -RemoteBranch $Branch
    Stop-ManagedStackIfPresent -NodeCmd $nodeCmd -TargetDir $InstallDir
    Test-PortFree -Port $BackendPort
    Test-PortFree -Port $FrontendPort

    $envFile = Join-Path $DataRoot '.env'
    New-ProdEnvFile -Path $envFile -Root $DataRoot -ApiPort $BackendPort -WebPort $FrontendPort

    $pnpmCmd = Ensure-Pnpm -NodeCmd $nodeCmd

    Push-Location $InstallDir
    try {
        Write-Step 'Installing dependencies'
        & $pnpmCmd.Source install
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }

        Write-Step 'Running workspace preflight repair if needed'
        & $nodeCmd.Source (Join-Path $InstallDir 'scripts\repo-preflight.mjs') --repair
        if ($LASTEXITCODE -ne 0) {
            Write-Step 'Preflight repair reported issues; continuing with install'
        }

        if (-not $SkipBuild) {
            Write-Step 'Building Kalio (api + web)'
            & $pnpmCmd.Source run build
            if ($LASTEXITCODE -ne 0) { throw "pnpm build failed with exit code $LASTEXITCODE" }
        }

        Write-Step 'Starting prod stack'
        $stackArgs = @(
            (Join-Path $InstallDir 'scripts\stack-manager.mjs'),
            'start',
            '--profile', 'prod',
            '--runtime', 'direct',
            '--backend-port', "$BackendPort",
            '--frontend-port', "$FrontendPort",
            '--data-root', $DataRoot,
            '--env-file', $envFile,
            '--use-env-llm'
        )
        if ($SkipBuild) {
            $stackArgs += '--skip-build'
        }

        & $nodeCmd.Source @stackArgs
        if ($LASTEXITCODE -ne 0) { throw "stack-manager start failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    if (-not $NoTask) {
        Register-KalioTask -AutostartScript (Join-Path $InstallDir 'scripts\kalio-autostart.ps1')
    }

    $uiUrl = "http://localhost:$FrontendPort"
    $apiUrl = "http://localhost:$BackendPort/api/health"

    Write-Host ''
    Write-Ok 'Kalio production install complete'
    Write-Host "  UI     -> $uiUrl" -ForegroundColor Green
    Write-Host "  Health -> $apiUrl" -ForegroundColor Green
    Write-Host "  Data   -> $DataRoot" -ForegroundColor Green
    if (-not $NoTask) {
        Write-Host "  Task   -> $TaskName (At logon for this user)" -ForegroundColor Green
    }
    Write-Host ''

    if (-not $NoOpen) {
        Start-Process $uiUrl
    }
} catch {
    Write-Fail $_.Exception.Message
    exit 1
}
