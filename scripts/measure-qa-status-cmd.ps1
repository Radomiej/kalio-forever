param([int]$Iterations = 10)
$ErrorActionPreference = 'Stop'
if ($Iterations -lt 1 -or $Iterations -gt 20) { throw 'Iterations must be between 1 and 20.' }
function Read-CmdSample {
    @(Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | ForEach-Object {
        [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; created = $_.CreationDate }
    })
}
$before = @(Read-CmdSample)
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
for ($iteration = 0; $iteration -lt $Iterations; $iteration++) {
    $null = Invoke-RestMethod 'http://127.0.0.1:3316/api/runtime/devin-cli/status'
    $null = Invoke-RestMethod 'http://127.0.0.1:3316/api/runtime/native-cli-integrations'
}
$after = @(Read-CmdSample)
$new = @($after | Where-Object {
    $candidate = $_
    -not ($before | Where-Object { $_.pid -eq $candidate.pid -and $_.created -eq $candidate.created })
})
[pscustomobject]@{
    startedAt = $started
    finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    requests = $Iterations * 2
    beforeCount = $before.Count
    afterCount = $after.Count
    newProcesses = $new
    parentCounts = @($after | Group-Object parent | Sort-Object Count -Descending | Select-Object -First 5 Name, Count)
    boundary = 'Before/after census only; short-lived processes between samples are not captured. No command lines or process termination.'
} | ConvertTo-Json -Depth 4 -Compress
