param(
  [Parameter(Mandatory = $true)][int]$RootProcessId,
  [ValidateRange(1, 60)][int]$DurationSeconds = 45,
  [ValidateSet('events', 'poll')][string]$Mode = 'events'
)

# Read-only diagnostic: never collect command lines, environment, or credentials.
$ErrorActionPreference = 'Stop'
$root = Get-Process -Id $RootProcessId
$sourceId = 'KalioQaProcessStarts-' + [guid]::NewGuid().ToString('N')
$owned = [System.Collections.Generic.HashSet[int]]::new()
[void]$owned.Add($RootProcessId)
$starts = [System.Collections.Generic.List[object]]::new()
$subscription = $null
try {
  # Subscribe before the baseline snapshot so short-lived starts are not lost to polling.
  if ($Mode -eq 'events') {
    $subscription = Register-CimIndicationEvent -Namespace root/cimv2 `
      -Query 'SELECT * FROM Win32_ProcessStartTrace' -SourceIdentifier $sourceId
  }
  $baseline = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name)
  $seen = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($process in $baseline) { [void]$seen.Add([int]$process.ProcessId) }
  do {
    $changed = $false
    foreach ($process in $baseline) {
      if ($owned.Contains([int]$process.ParentProcessId) -and $owned.Add([int]$process.ProcessId)) {
        $changed = $true
      }
    }
  } while ($changed)
  $initialOwned = @($baseline | Where-Object { $owned.Contains([int]$_.ProcessId) } |
    ForEach-Object { @{ id = [int]$_.ProcessId; parentId = [int]$_.ParentProcessId; name = $_.Name } })
  $startedAt = [DateTimeOffset]::UtcNow
  Write-Output ('MONITOR_READY ' + (@{
    rootId = $RootProcessId; rootName = $root.ProcessName; durationSeconds = $DurationSeconds; mode = $Mode
  } | ConvertTo-Json -Compress))
  $deadline = $startedAt.AddSeconds($DurationSeconds)
  while ([DateTimeOffset]::UtcNow -lt $deadline) {
    if ($Mode -eq 'poll') {
      $snapshot = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name)
      do {
        $changed = $false
        foreach ($process in $snapshot) {
          if ($owned.Contains([int]$process.ParentProcessId) -and $owned.Add([int]$process.ProcessId)) {
            $changed = $true
          }
        }
      } while ($changed)
      foreach ($process in $snapshot) {
        if ($seen.Add([int]$process.ProcessId)) {
          $isOwned = $owned.Contains([int]$process.ProcessId)
          if ($isOwned -or $process.Name -ieq 'cmd.exe') {
            $starts.Add(@{
              id = [int]$process.ProcessId; parentId = [int]$process.ParentProcessId
              name = [string]$process.Name; owned = $isOwned
              observedAt = [DateTimeOffset]::UtcNow.ToString('o')
            })
          }
        }
      }
      Start-Sleep -Milliseconds 250
      continue
    }
    foreach ($event in @(Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue)) {
      $process = $event.SourceEventArgs.NewEvent
      $isOwned = $owned.Contains([int]$process.ParentProcessID)
      if ($isOwned) { [void]$owned.Add([int]$process.ProcessID) }
      if ($isOwned -or $process.ProcessName -ieq 'cmd.exe') {
        $starts.Add(@{
          id = [int]$process.ProcessID; parentId = [int]$process.ParentProcessID
          name = [string]$process.ProcessName; owned = $isOwned
          observedAt = $event.TimeGenerated.ToUniversalTime().ToString('o')
        })
      }
      Remove-Event -EventIdentifier $event.EventIdentifier
    }
    Start-Sleep -Milliseconds 100
  }
  @{
    startedAt = $startedAt.ToString('o'); endedAt = [DateTimeOffset]::UtcNow.ToString('o')
    rootId = $RootProcessId; mode = $Mode; initialOwned = $initialOwned; starts = @($starts.ToArray())
    ownedStartCount = @($starts | Where-Object { $_.owned }).Count
    ownedCmdStartCount = @($starts | Where-Object { $_.owned -and $_.name -ieq 'cmd.exe' }).Count
    allCmdStartCount = @($starts | Where-Object { $_.name -ieq 'cmd.exe' }).Count
    limitation = 'Bounded observation only; polling can miss short-lived processes; no command lines or PID-reuse guarantees.'
  } | ConvertTo-Json -Depth 5
} finally {
  if ($null -ne $subscription) {
    Unregister-Event -SourceIdentifier $sourceId
    Get-Event -SourceIdentifier $sourceId -ErrorAction SilentlyContinue | Remove-Event
    Remove-Job -Job $subscription -Force
  }
}
