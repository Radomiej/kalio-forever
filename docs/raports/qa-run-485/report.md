# QA485 — bounded correlation collector

2026-10-06. Added scripts/capture-idle-console-correlation.mjs to start the
existing process/window observers concurrently with windowsHide true and
retain complete raw outputs in ignored .tmp/startup-captures. No service restart.
Only window events and matching sampled process rows are printed.

Node syntax check passed; git check-ignore confirmed the raw artifact location.
Live 15-second run exited 0: 484 process samples, maximum gap 46.9171ms,
47 new sampled process identities, zero recorded window events.
Interval 12:26:14.0014629–12:26:29.0303923 UTC.
Raw artifact: .tmp/startup-captures/idle-correlation-1791289589069.json.

This proves successful bounded capture and artifact retention, not absence of
startup flashes. No startup trigger occurred. Parser/error-path unit tests,
baseline-PID identity and PID-reuse handling remain unverified. No console fix
is claimed. The collector and this report are not yet committed.

Follow-up: capture-idle-console-correlation.test.mjs passed 5/5 Node tests,
rejecting 0, -1, 61, NaN and fractional durations before observer launch.
These are argument-guard tests, not parser/child-failure/timeout coverage.
Reviewed the existing startup launcher: it gates startup on both monitor READY
signals and retains raw capture. A genuine startup test needs first checking
active sessions and backing up retained provider configuration before stopping QA.
