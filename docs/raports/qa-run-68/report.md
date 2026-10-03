# QA run 68 — correct the MCP diagnostic boundary

## Result

The opt-in official-CLI diagnostic now tests catalog behavior rather than treating the presence of a server name as proof of execution. The former absence assertions were an invalid isolation oracle, not a reproduced production defect. They are not relabelled as a successful security regression.

Both CLI reads are hidden, timeout-bounded to15s and output-bounded to256KiB. Only metadata is printed. The temporary local fixture is cleaned in finally; no global config, credentials, Home Site files or running QA settings were changed.

## Evidence

System Node, outside sandbox, DEVIN_CONFIG_PROBE_EXECUTABLE pointing to the installed official devin.exe: devin-cli-config.live.spec.ts2/2 PASS,1.65s. With and without --config, the scoped probe and inherited serena/context7 remained listed. Separate local disabled overrides produced disabled markers for both entries. This is catalog/configuration evidence only; it does not prove processes or tools were prevented from starting.

## Acceptance boundary

| Requirement | Status | Evidence | Remaining |
|---|---|---|---|
| Catalog diagnostic does not confuse listing with execution | PASS | Corrected assertions; actual CLI2/2 | Version-dependent CLI format remains diagnostic-only |
| Exact real SWE-2 builds/runs Home Site through Kalio | PASS for recorded task | QA62 build exit0; QA67 preview and actual browser gates | Not proof of every original UX requirement |
| Completed chat survives F5 at mobile/tablet widths | PASS for completed state | QA67 screenshots320/390/820 | Active thinking/stop/reconnect sibling states need their own evidence |
| Native global MCP startup suppressed | FAIL | QA67 observed Serena and two owned CMD starts | Implement and prove isolation; listing tests cannot close this row |
| No mass console burst | UNVERIFIED beyond sampled windows | QA64/67 bounded polling | Short-lived processes can be missed |
| Full original UX and owned-change closure | UNVERIFIED | Existing UX-01–15 spec | Requirement-by-requirement final audit and remaining owned commits |

[P1] Before production, prove the claimed native-tool/MCP isolation boundary, including inherited hooks and startup processes. [P2] Close the original full UX matrix rather than extrapolating from the completed-chat test. Goal remains active.
