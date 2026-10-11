param([ValidateRange(1, 300)][int]$Seconds = 30)

# Read-only sampling: no arguments, environment, titles or process mutation.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public static class KalioProcessSnapshots {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Entry {
        public uint size, usage, pid;
        public UIntPtr heap;
        public uint module, threads, parentPid;
        public int priority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    }
    public sealed class Row {
        public uint pid, parentPid;
        public string name, observedAtUtc;
    }
    public sealed class Result {
        public string startedAtUtc, endedAtUtc;
        public int samples;
        public double maxSampleGapMs;
        public List<Row> starts = new List<Row>();
        public string boundary = "Sampled process identities, not process-start events or visible-window proof. Processes between samples and PID reuse can be missed.";
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32FirstW(IntPtr handle, ref Entry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Process32NextW(IntPtr handle, ref Entry entry);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    private static List<Row> Read() {
        var handle = CreateToolhelp32Snapshot(2, 0);
        if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var rows = new List<Row>();
            var entry = new Entry { size = (uint)Marshal.SizeOf(typeof(Entry)) };
            if (!Process32FirstW(handle, ref entry)) throw new Win32Exception(Marshal.GetLastWin32Error());
            do {
                rows.Add(new Row { pid = entry.pid, parentPid = entry.parentPid, name = entry.name,
                    observedAtUtc = DateTimeOffset.UtcNow.ToString("o") });
            } while (Process32NextW(handle, ref entry));
            int error = Marshal.GetLastWin32Error();
            if (error != 18) throw new Win32Exception(error);
            return rows;
        } finally { CloseHandle(handle); }
    }
    public static Result Capture(int seconds) {
        var seen = new HashSet<uint>();
        foreach (var row in Read()) seen.Add(row.pid);
        var result = new Result { startedAtUtc = DateTimeOffset.UtcNow.ToString("o") };
        Console.WriteLine("PROCESS_SNAPSHOT_READY seconds=" + seconds);
        var timer = Stopwatch.StartNew();
        double previous = 0;
        while (timer.Elapsed.TotalSeconds < seconds) {
            double now = timer.Elapsed.TotalMilliseconds;
            result.maxSampleGapMs = Math.Max(result.maxSampleGapMs, now - previous);
            previous = now;
            foreach (var row in Read()) if (seen.Add(row.pid)) result.starts.Add(row);
            result.samples++;
            Thread.Sleep(10);
        }
        result.endedAtUtc = DateTimeOffset.UtcNow.ToString("o");
        return result;
    }
}
'@
[KalioProcessSnapshots]::Capture($Seconds) | ConvertTo-Json -Depth 4
