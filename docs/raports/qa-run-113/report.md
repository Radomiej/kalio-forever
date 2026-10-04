# QA113 — Fresh Codex catalog readiness

2026-10-04. Fixed QA API3316; starting HEAD97ef189 plus preserved dirty changes. No prompt, generation, tool invocation, provider edit or data reset.

Existing QA84 session58mz05cKrZDGG1DPbMKBU is bound to codex-luna/default persona/system:none with no runtime context and empty current-run response. It is not a HomeSite tool-test session; do not reuse its history as project execution proof.

Initial GET native-cli-integrations showed chatgpt-default disconnected and its catalog endpoint empty. One explicit POST /runtime/native-cli-integrations/chatgpt-default/models/check succeeded in2.93s. Fresh model/list returned gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5; processEpochYffXZsKgBBgw_YZE1Z4jZ, checkedAt1791078962481. This proves protocol/model discovery, not generation or tools.

[P2] Saved enabled profiles codex-guard/codex-strict(gpt-5.4), codex-spark(gpt-5.3-codex-spark), codex-mini(gpt-5.4-mini) reference models absent from the fresh account catalog. Preserve user settings; picker availability and runtime validation must use live catalog, not merely enabled profiles. Controller create/update currently checks Devin availability only; source forwards Codex profile.model without catalog validation. This is an identified implementation gap, not a demonstrated live unsupported-model invocation.

Required next: enforce Codex catalog-based selection/runtime admission with regression coverage, then create an explicit HomeSite-bound Codex session and prove tools/manual HITL through UI after local gates. Existing canary history and model/list cannot close that acceptance.
