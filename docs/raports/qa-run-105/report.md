# QA105 — Real Kalio read after native enforcement patch

2026-10-04. Same fixed built QA/database/approved HomeSite session as QA104. Bez czynnego run: idle Devin reset succeeded without changing settings; fresh static16-check preflight PASS. Real UI SWE-2 prompt requested exactly one Kalio fs_read of E:/Projekty/home-site/package.json, no native tools, terminal or writes.

Chromium1280x720: PASS10.4seconds (test8.9). Durable turn7wX5-JGpJluK4bjfYNJLA has exactly one fs_read call and one result containing react/vite. UI final heading and Kalio origin survive F5. No target files edited. Screenshot saved [after F5](assets/kalio-read-after-f5.png).

| Acceptance | Status | Boundary |
| --- | --- | --- |
| Real bridge read under new deny rules | PASS | Exact swe-2 and approved package.json |
| Durable result/provenance after F5 | PASS | Observed UI and scoped history |
| Native denial and all categories | UNVERIFIED here | QA104 observed failed read, broader proof remains |
| Complete Devin/ChatGPT integration | OPEN | Not inferred from a single read |
