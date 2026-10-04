# QA318 — Devin startup process boundary

Date: 2026-10-04. Read-only runtime-source investigation; fixed QA unchanged.

## Findings

- ACP startup first calls `suppressInheritedDevinMcp` in its private working directory. That helper executes three sequential commands: `--version`, `mcp list`, then verification `mcp list`. The ACP process is started afterward.
- These three commands use direct promisified execFile, not DevinCliCommandQueueService. They therefore do not pass through that service's invocation audit. This does not establish repeated or concurrent startup.
- All three commands explicitly use windowsHide=true, timeout=15000 and maxBuffer=256 KiB. ACP spawn also sets windowsHide=true and shell=false. Source flags do not prove descendants cannot display windows.
- The three probes plus ACP are a candidate boundary matching the reported small startup burst; causation remains unverified without process/window tracing. Do not remove MCP isolation or its verification to hide the symptom.

## Verification

System Node, outside sandbox, Kalio API Vitest: devin-cli-mcp-suppression.spec.ts (8 passed), devin-cli-command-queue.service.spec.ts (2 passed). Mocked processes only; no real Devin command was run.

| Acceptance | Status | Remaining |
| --- | --- | --- |
| Identify startup commands beyond status queue | PASS (source + tests) | Three direct execFile probes identified. |
| Verify suppression preserves safety and bounded execution | PASS (mock tests) | Live private-overlay behavior not retested here. |
| Prove which process creates visible windows | UNVERIFIED | Earlier Windows event subscription denied access; polling can miss brief processes. |
| Eliminate reported startup windows | UNVERIFIED | No product change in this slice. |

Next: instrument this precise startup boundary without logging arguments, configuration output, environment or secrets, then correlate a controlled startup with parent/child process evidence. Preserve provider settings and MCP suppression guarantees.
