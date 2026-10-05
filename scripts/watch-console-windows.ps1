param([ValidateRange(1, 300)][int]$Seconds = 30, [switch]$SelfTest)

# Read-only diagnostic. Deliberately excludes window titles and command lines.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class KalioConsoleWindowWatch {
    private delegate void WinEvent(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)]
    private struct Message {
        public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
        public uint time; public int x; public int y; public uint reserved;
    }
    [DllImport("user32.dll")] private static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEvent callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenThread(uint access, bool inherit, uint thread);
    [DllImport("kernel32.dll")] private static extern uint GetProcessIdOfThread(IntPtr thread);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr hwnd);
    private static string ProcessName(uint pid) {
        if (pid == 0) return "unavailable";
        var process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return "unavailable";
        try {
            var name = new StringBuilder(32768);
            uint size = (uint)name.Capacity;
            // Only the executable basename is retained; no path or arguments are logged.
            return QueryFullProcessImageName(process, 0, name, ref size)
                ? System.IO.Path.GetFileName(name.ToString()) : "unavailable";
        } finally { CloseHandle(process); }
    }
    public static string[] Capture(int seconds, bool selfTest) {
        var rows = new List<string>();
        int unclassified = 0;
        bool selfTestDelivered = false;
        WinEvent callback = (hook, evt, hwnd, obj, child, thread, time) => {
            if (hwnd == IntPtr.Zero || obj != 0 || child != 0) return;
            var name = new StringBuilder(256);
            if (GetClassName(hwnd, name, name.Capacity) == 0) {
                // A vanished/inaccessible window is unknown, not evidence of no console.
                unclassified++;
                uint eventPid = 0;
                var eventThread = thread == 0 ? IntPtr.Zero : OpenThread(0x0800, false, thread);
                if (eventThread != IntPtr.Zero) {
                    try { eventPid = GetProcessIdOfThread(eventThread); }
                    finally { CloseHandle(eventThread); }
                }
                // A live event thread can identify the process after its window vanished.
                // It cannot prove the vanished window was a console or was visible.
                rows.Add(DateTimeOffset.UtcNow.ToString("o") + " event=" + evt
                    + " hwnd=" + hwnd.ToInt64() + " eventTickMs=" + time
                    + " pid=" + eventPid + " eventThreadId=" + thread
                    + " pidSource=" + (eventPid == 0 ? "unavailable" : "event-thread")
                    + " processName=" + ProcessName(eventPid)
                    + " class=unavailable");
                return;
            }
            if (name.ToString() != "ConsoleWindowClass" && name.ToString() != "CASCADIA_HOSTING_WINDOW_CLASS" && !(selfTest && name.ToString() == "Static")) return;
            if (selfTest && name.ToString() == "Static") selfTestDelivered = true;
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            // visibility is sampled at callback delivery, not at original event time.
            rows.Add(DateTimeOffset.UtcNow.ToString("o") + " pid=" + pid + " event=" + evt
                + " processName=" + ProcessName(pid)
                + " hwnd=" + hwnd.ToInt64() + " visible=" + IsWindowVisible(hwnd)
                + " eventTickMs=" + time + " class=" + name);
        };
        // OBJECT_CREATE through OBJECT_HIDE, out-of-context callback on this message loop.
        var handle = SetWinEventHook(0x8000, 0x8003, IntPtr.Zero, callback, 0, 0, 0);
        if (handle == IntPtr.Zero) throw new InvalidOperationException("Window event hook registration failed");
        Console.WriteLine("WINDOW_EVENT_HOOK_READY seconds=" + seconds + " utc=" + DateTimeOffset.UtcNow.ToString("o"));
        IntPtr control = IntPtr.Zero;
        try {
            // No WS_VISIBLE: this control never appears on the user's desktop.
            if (selfTest) {
                control = CreateWindowEx(0, "Static", "", 0, 0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (control == IntPtr.Zero) throw new InvalidOperationException("Diagnostic control creation failed");
                // Destroy before pumping: validates the missing-class path without visible windows.
                var transient = CreateWindowEx(0, "Static", "", 0, 0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (transient == IntPtr.Zero) throw new InvalidOperationException("Transient diagnostic control creation failed");
                if (!DestroyWindow(transient)) throw new InvalidOperationException("Transient diagnostic control destruction failed");
            }
            var until = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < until) {
                Message message;
                while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {
                    TranslateMessage(ref message); DispatchMessage(ref message);
                }
                Thread.Sleep(10);
            }
            if (selfTest && !selfTestDelivered) throw new InvalidOperationException("Window event delivery self-test failed");
        } finally {
            if (control != IntPtr.Zero) DestroyWindow(control);
            UnhookWinEvent(handle); GC.KeepAlive(callback);
        }
        rows.Add("WINDOW_EVENT_HOOK_FINISHED records=" + rows.Count + " unclassified=" + unclassified + " utc=" + DateTimeOffset.UtcNow.ToString("o"));
        return rows.ToArray();
    }
}
'@
[KalioConsoleWindowWatch]::Capture($Seconds, $SelfTest.IsPresent)
