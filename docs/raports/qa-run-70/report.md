# QA run 70 — restore Kalio Playwright MCP, locate Data Analyst boundary

## Observed cause / restoration

Canonical .kalio/config.toml contains enabled optional MCP endpoints: data-analyst3000/mcp and playwright-orchestrator3333/mcp. Both endpoints were unreachable; Kalio API reported error/0 tools for both.

The existing managed mcp-playwright-orchestrator service was failed, exit1. Its complete15-line recent trace identifies an unhandled promise rejection: browserContext.storageState attempted to export a closed browser/context from SessionManager.exportStorageState, closeSessionRecord and sweepIdleSessions. The service ran before this failure; this was not an incorrect Kalio URL. Source service is E:/Projekty/mcp-playwrigh-master, outside the Kalio checkout. No source fix or release claim for that project.

Started only the existing managed service once via dev-server MCP. Preserved autostart=true/restartOnExit=false; no restart loop or new definition. Health3333 returned200. Restarted only Kalio connection toml::playwright-orchestrator through its existing controller endpoint: connected26 tools. Actual UI Tools → MCP confirmed the endpoint and26 tools. No native Devin MCP enabled, persona permissions broadened, or browser tool run performed by this connection restoration.

## Data Analyst

No managed Data Analyst service was registered. Repo docs identify E:/Projekty/data-analitic; its AGENTS.md and bootstrap require DA_MCP_TOKEN, loopback bind and raw access disabled by default. Current exact-path checks: dist/server.cjs exists, node_modules absent, .env absent. Official system Node cannot resolve declared dotenv both inside and outside sandbox, so the missing dependency is verified, not inferred from sandbox failure. No package install, server launch, token creation, auth bypass, raw-access change or config disabling performed. User choice requested asynchronously: restore this separate runtime or retain it as an explicitly unconfigured optional integration.

## Acceptance / remaining

| AC | Status | Evidence | Remaining |
|---|---|---|---|
| Kalio connects to Playwright MCP | PASS API/UI/browser |3333 health200; connected26 tools; opt-in actual-QA test1/1 PASS1.8s | Unattended service stability separate |
| Playwright service survives closed-context cleanup | FAIL from service trace | Unhandled storageState rejection caused exit1 | Fix in its owning repo with regression; restart is recovery only |
| Data Analyst available | BLOCKED for this integration | Dependencies/config absent, endpoint unreachable | User runtime/config decision; no blanket goal blocker |
| Real Home Site and SWE-2 | Unchanged | QA69 actual build/preview/chat evidence | This service restoration is not a new inference canary |

[P1] Fix the Playwright idle-cleanup crash before relying on unattended browser service stability. [P2] Resolve optional Data Analyst runtime/configuration without hiding the error or guessing credentials. Full original UX/goal closure remains open.

## Browser gate

qa-mcp-live-audit.spec.ts explicitly navigates actual fixed QA5288, no intercepts, no agent prompts or MCP tool calls.390/1440: visible Playwright26/endpoint3333, visible Data Analyst endpoint3000 and fetch failed, no horizontal document overflow. Screens assets/actual-mcp-{390,1440}.png visually inspected. Initial test failed because accessibility output combined address/error while DOM uses two separate elements; observed exact DOM counts1/1, corrected selector and reran PASS. No production component modified to satisfy the test. Incidental isolated mock runner stack is not live-agent evidence. Runner cleanup exited0.
