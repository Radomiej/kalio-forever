param([int]$Iterations = 10)
$ErrorActionPreference = 'Stop'
if ($Iterations -lt 1 -or $Iterations -gt 20) { throw 'Iterations must be between 1 and 20.' }
$source = 'kalio-qa-cmd-' + [Guid]::NewGuid().ToString('N')
$subscription = $null
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
    $subscription = Register-CimIndicationEvent -Namespace root/cimv2 -Query "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName='cmd.exe'" -SourceIdentifier $source
    for ($iteration = 0; $iteration -lt $Iterations; $iteration++) {
        $null = Invoke-RestMethod 'http://127.0.0.1:3316/api/runtime/devin-cli/status'
        $null = Invoke-RestMethod 'http://127.0.0.1:3316/api/runtime/native-cli-integrations'
    }
    # Diagnostic delivery allowance, not a product runtime synchronization mechanism.
    $null = Wait-Event -SourceIdentifier $source -Timeout 2
    $events = @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)
    $starts = @($events | ForEach-Object {
        $eventData = $_.SourceEventArgs.NewEvent
        $parentId = [int]$eventData.ParentProcessID
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$parentId" -ErrorAction SilentlyContinue
        [pscustomobject]@{
            pid = [int]$eventData.ProcessID
            parent = $parentId
            parentName = $parent.Name
            parentParent = $parent.ParentProcessId
            eventTime = [string]$eventData.TIME_CREATED
        }
    })
    [pscustomobject]@{
        startedAt = $started
        finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        requests = $Iterations * 2
        cmdStarts = $starts
        boundary = 'ProcessStartTrace subscription for this measurement window; no command lines, no process termination. Parent metadata may be absent after exit. No outside-window claim.'
    } | ConvertTo-Json -Depth 4 -Compress
} finally {
    if ($subscription) { Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue }
    Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
}
