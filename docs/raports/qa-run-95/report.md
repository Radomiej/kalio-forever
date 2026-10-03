# QA95 — Real Devin repairs HomeSite through Kalio

2026-10-03. Fixed QA localhost:5288 / API3316, same AppData database and approved session W4fggLSunrJB41C24MV7C. Exact swe-2 strict bridge; native filesystem/terminal/web disabled. Current session was idle; reset only its idle Devin host with settings PATCH {}, then static readiness passed 16/16. Local focused regressions, API typecheck/build and root test gate had passed before this live run.

Real repository Playwright drove Talk, not direct LLM/tool API. Prompt reported QA94 pointer interception and constrained changes to HomeSite src. Start test passed (31.6s), leaving the exact fs_write request for review. Reviewed full CSS payload targeting E:/Projekty/home-site/src/styles.css: mobile toggle gains position:relative and z-index:1. Clicked actual Confirm in Kalio. The subsequent test failed because it incorrectly expected expanded arguments to disappear after approval; the approved write itself succeeded. Corrected that test assertion; did not repeat the write.

Separate build approval test reviewed command npm, args [run,build], cwd E:/Projekty/home-site, then clicked Confirm. Passed in 6.7s; F5 retained the response and terminal state. No direct target edits or local build commands were used.

## Durable evidence

- Turn yiWUkOhQkmmngo8eV6I3y, run r4fMshf_IPrZenvyzBtNA, model swe-2.
- Three successful fs_read, one successful fs_write, one successful terminal_spawn, one successful terminal_output; completed turn records six tools.
- Terminal 5RobPs0N1HV1Qmgwhcp-h, durable output message yQ5xW_EpM0XWXG3IHF7jI: status exited, exitCode0, vite5.4.21, 26 modules, build759ms.
- Built artifacts index-DDzjYeyO.css and index-BWlm4q-R.js; verified against the served page in QA96.
- Audit since1791038895644: 61 events, exactly one process.cmd.invocation from the approved terminal.spawn, zero native approval events. This is a scoped audit, not an OS-wide leak census.
- HomeSite is not a Git repository; attempted read-only git status confirmed that boundary. No target commit claimed.

## Screenshots

[Write awaiting approval](assets/repair-awaiting-approval.png), [build awaiting approval](assets/build-awaiting-approval.png), [final response after F5](assets/repair-completed.png).

Real repair/write/build chain PASS. Browser acceptance belongs to QA96. New helper is opt-in and phase-gated (start/css/build) to prevent parallel/repeated writes; initial observed runs used grep selection before phase guards were added. Corrected CSS assertion has not been replayed because replaying the already-completed write would be misleading.
