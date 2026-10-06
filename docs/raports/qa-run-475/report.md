# QA475 — real Codex read through Kalio after frontend correction

2026-10-06, fixed QA localhost:5288, real Chrome UI and existing Home Site.
Existing approved session yvD83rgDA_ZHvUwJKlo_S. No writes or terminal requested.
Prior local gate: graph 42 tests, frontend typecheck/build passed.

| AC | Status | Evidence |
| --- | --- | --- |
| Actual selected Codex provider/model | PASS | journal U7QuJSQP8lybfDqyAZeO7, turn -ZvoYfP1LFQNoMlhVQFB7, codex-app-server/gpt-6-luna, completed, retryCount0 |
| Real Kalio fs_read of exact target | PASS | persisted tool result C3OVU_bzjKuVDA6gGVUB-, exact package.json; expanded UI badge Kalio |
| Correct result | PASS | assistant881VYYrWXqNs0D2DMDadN: nexora-home-site, vite build |
| F5 and graph round-trip | PASS | assistant paragraph count1, Stop count0, graph shows one fs_read and same final reply |
| Runtime identity loading UX | PASS live observation | initial graph snapshot Loading runtime model…, later Devin SWE-2 QA - gpt-6-luna, Turn completed |
| Writes/build/native-policy behavior | UNVERIFIED this run | only one read requested; no inference of all native activity absence |

The persona is intentionally named Devin SWE-2 QA while this conversation's
execution profile is Codex; persona naming is not provider identity. Provider/model
are independently proven by the durable journal. This is not the mock fallback.
Screenshots result.jpg and graph.jpg preserve actual read and settled graph.
No target change, new preview, QA restart, permissions change or provider reset.
Overall goal remains active; console ownership/visibility and Jev are still open.
