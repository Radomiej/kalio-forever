param([ValidateRange(1, 60)][int]$Seconds = 30)

# Event-only observation, including starts whose parent has already exited.
$ErrorActionPreference = 'Stop'
$sourceId = 'KalioStartup-' + [guid]::NewGuid().ToString('N')
$subscription = $null
$starts = [System.Collections.Generic.List[object]]::new()
function Receive-StartupEvents {
  foreach ($event in @(Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue)) {
    $process = $event.SourceEventArgs.NewEvent
    $starts.Add([pscustomobject]@{
      pid = [int]$process.ProcessID
      parentPid = [int]$process.ParentProcessID
      name = [string]$process.ProcessName
      eventTimeUtc = [DateTime]::FromFileTimeUtc([long]$process.TIME_CREATED).ToString('o')
    })
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
}
try {
  $subscription = Register-CimIndicationEvent -Namespace root/cimv2 `
    -Query 'SELECT * FROM Win32_ProcessStartTrace' -SourceIdentifier $sourceId
  $startedAt = [DateTimeOffset]::UtcNow
  Write-Output ('STARTUP_PROCESS_MONITOR_READY seconds=' + $Seconds)
  $deadline = $startedAt.AddSeconds($Seconds)
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    Receive-StartupEvents
    Start-Sleep -Milliseconds 50
  }
  Receive-StartupEvents
  $endedAt = [DateTimeOffset]::UtcNow
  [pscustomobject]@{
    startedAt = $startedAt.ToString('o')
    endedAt = $endedAt.ToString('o')
    starts = @($starts.ToArray())
    boundary = 'Global process-start events in this bounded window, not visible-window proof. No arguments, environment, or titles. Events arriving after the final drain are not covered.'
  } | ConvertTo-Json -Depth 4
} finally {
  if ($null -ne $subscription) {
    Unregister-Event -SourceIdentifier $sourceId
    Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue | Remove-Event
    Remove-Job -Job $subscription -Force
  }
}
