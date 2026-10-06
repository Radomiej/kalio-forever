# QA479 — real Devin write refusal and conversation recovery

2026-10-06. Existing QA, Chrome UI, exact Home Site project and swe-2.
No stack/host restart or permission/configuration change.

The agent requested one Kalio fs_write for
E:/Projekty/home-site/qa479-write-guard.txt, content QA479_WRITE_GUARD.
The UI displayed exact arguments and awaiting confirmation. Tester clicked
Cancel, not Confirm. The tool settled as cancelled and the agent reported
the denial without retrying. Pending and Stop disappeared.

Durable session W4fggLSunrJB41C24MV7C:
- refusal turn VKplEkfNEqlcvzr8RLlvC;
- tool mcp-18c6d5c1-449f-415c-9291-032fd50d0ae3-6;
- result vqYJIunKTdg9AckauTP4j: cancelled/not approved;
- assistant kxoCQuBwA7PB9DeJcGiG8 reports cancellation;
- follow-up turn Ix-KxY8tetmgCvD-egdAw;
- assistant K1F6pH-acKS2DTvCIzQE7: exact QA479_RECOVERED, no tool calls.

| Requirement | Status | Evidence / boundary |
| --- | --- | --- |
| Manual refusal reaches Devin | PASS | UI cancellation and durable tool result |
| Conversation settles and accepts follow-up | PASS | exact recovered response; Stop count zero |
| No false successful-write claim | PASS | final answer explicitly reports cancellation |
| Target file absent on disk | UNVERIFIED | no independent filesystem read this run |
| F5/graph parity for this refusal | UNVERIFIED | not exercised in this run |
| Startup console flashes fixed | NOT DONE | unrelated unresolved issue, no measurement here |

Screenshot recovery.jpg shows the settled chat. This is a bounded real-provider
refusal/recovery proof, not completion of the full QA objective.
