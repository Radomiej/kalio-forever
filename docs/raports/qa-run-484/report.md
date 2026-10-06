# QA484 — overlapping idle process/window capture

2026-10-06. No QA/Devin restart, agent prompt or service mutation.
Process sampler: 12:24:47.0517252–12:25:12.0739525 UTC,
800 samples, maximum sample gap 47.6392ms, exit 0.
Window observer: 12:24:59.8296746–12:25:11.8414479 UTC, exit 0.

Two unclassified callbacks (CREATE and DESTROY) shared HWND30216386 and
PID8420, executable Dropbox.exe. No console class or visibility was captured.
These particular callbacks cannot be attributed to Kalio or Devin.
The process output included unrelated Docker and Git churn; it was truncated
in tool delivery and is insufficient for complete PID correlation. Do not
claim exhaustive capture or use the absence of console-class rows as a fix.

| Requirement | Status | Evidence / next |
| --- | --- | --- |
| Overlapping observers | PASS | timestamps overlap |
| Captured window owner | PASS scoped | two callbacks identify Dropbox.exe |
| User-visible console source | UNVERIFIED | no classified console SHOW event |
| Complete process/window correlation | UNVERIFIED | truncated process output |
| Console bug fixed | NOT DONE | diagnostics only |

Next measurement must summarize/filter process rows before tool output and
retain an ignored raw capture, rather than repeatedly emitting global process
lists. Testing a specific startup trigger remains necessary for startup proof.
