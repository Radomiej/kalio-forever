# QA235 — restore Home-site preview through real Devin

2026-10-04. Fixed Kalio QA localhost:5288 / API :3316, exact Devin swe-2, approved E:/Projekty/home-site. Cold-start static readiness passed before execution.

Real UI test qa-devin-preview-recovery-live.spec.ts: 1 PASS, 10.9s. Existing preview was checked unavailable to avoid duplicate launch. Exactly one Kalio terminal_spawn was manually confirmed: npm run preview -- --host 127.0.0.1 --port 57868 --strictPort in the approved project. Before approval: zero scoped CMD events. After approval: exactly one spawn and one CMD event. Only terminal_spawn/terminal_output were used.

HTTP preview returned 200; final response persisted after F5, no Stop agent or connection warning. Screens assets/preview-approval.png, preview-response-after-f5.png, home-site.png. No target source edits, build, installation or commit. This restores the QA234 unavailable preview, without establishing its prior termination cause.

Preview: http://127.0.0.1:57868/. It is a backend-owned terminal, not a durable independent hosting service; survival across another QA restart is not promised by this test.
