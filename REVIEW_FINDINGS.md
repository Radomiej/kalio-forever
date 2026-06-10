# Code Review: AgentFlow Launch Allowance Sync (2026-06-10)

## BLOCKING ISSUES

### CRITICAL BUG: `launchAllowedToolNames` not constrained by `orchestratorScopeRestriction`

**File**: `apps/kalio-api/src/modules/agent-flow/agent-flow-launch-context.ts` (lines 108-137)

**Severity**: HIGH – Allowance precedence regression

**Description**:
The `mergeAgentFlowLaunchContext` function has a logic gap in how it handles `orchestratorScopeRestriction`. When an orchestrator restriction is applied:

1. Baseline contains: `launchAllowedToolNames: ['fs_read', 'fs_list', 'vfs_read', ...]`
2. Explicit launch context contains: `orchestratorScopeRestriction: { reason: 'folder scoped run' }` (with narrower `projectPath`, etc.)
3. The function explicitly re-applies `projectPath`, `executionCwd`, and two boolean flags (lines 122-133) to enforce the narrowing
4. **BUT** it does NOT re-apply `launchAllowedToolNames`

**Result**: If explicit does not contain `launchAllowedToolNames`, the baseline list survives untouched. A narrower orchestrator scope intended to limit tool access will silently fail to restrict the tool allowance list.

**Example Attack/Regression Path**:
```typescript
mergeAgentFlowLaunchContext({
  baseline: {
    projectPath: 'C:\\Projekty\\wide',
    launchAllowedToolNames: ['fs_read', 'fs_list', 'vfs_read'], // wide allowance
  },
  launchContext: {
    orchestratorScopeRestriction: { reason: 'restrict to subfolder' },
    projectPath: 'C:\\Projekty\\wide\\sub', // narrower
    // NOTE: NO explicit launchAllowedToolNames here
  },
});
// Expected: tools list should be narrowed by orchestrator
// Actual: launchAllowedToolNames stays ['fs_read', 'fs_list', 'vfs_read']
```

**Impact**:
- Tool precedence is not correctly enforced when orchestrator restrictions narrow scope
- Slot policy (line 82 in `tool-policy.service.ts`) will still intersect against the wide baseline list
- Test coverage gap: The test at line 123 in `agent-flow-launch-context.spec.ts` never validates that `launchAllowedToolNames` is preserved through `orchestratorScopeRestriction`

**Fix Required**:
In `mergeAgentFlowLaunchContext` (lines 121-134), add logic to clear or narrow `launchAllowedToolNames` when `orchestratorScopeRestriction` is applied but explicit does not provide its own list. Options:
1. Delete `launchAllowedToolNames` from merged when restriction is detected and explicit doesn't override it (safest)
2. Narrow the list based on slot policy (requires passing slotPolicy to this function, violating single responsibility)
3. Document that explicit launch context MUST include `launchAllowedToolNames` when restricting (insufficiently safe)

---

## ARCHITECTURAL CONCERNS

### Missing Test Coverage: `launchAllowedToolNames` through orchestrator restrictions

**File**: `apps/kalio-api/src/modules/agent-flow/agent-flow-launch-context.spec.ts`

**Test**: `'honors orchestratorScopeRestriction with narrower explicit paths'` (line 123)

**Issue**: The test provides all required fields (`projectPath`, `executionCwd`, etc.) in the explicit context. It does **not** verify that when a baseline has `launchAllowedToolNames` but explicit applies a restriction without re-specifying the tool list, the merged result properly respects the restriction boundary.

**Recommended Test Addition**:
```typescript
it('when orchestratorScopeRestriction is set without explicit launchAllowedToolNames, baseline list should be cleared or narrowed', () => {
  const merged = mergeAgentFlowLaunchContext({
    baseline: {
      projectPath: 'C:\\Projekty\\wide',
      launchAllowedToolNames: ['fs_read', 'fs_list', 'vfs_read'],
    },
    launchContext: {
      orchestratorScopeRestriction: { reason: 'scoped' },
      projectPath: 'C:\\Projekty\\wide\\sub',
      // NO launchAllowedToolNames in explicit
    },
  });
  
  // Should NOT preserve the wide baseline list
  expect(merged?.launchAllowedToolNames).toBeUndefined();
  // OR: expect(merged?.launchAllowedToolNames).toEqual([]); depending on final design
});
```

---

## PASSING TESTS AND VERIFIED BEHAVIOR

✅ All 32 tests pass:
- `agent-flow-launch-context.spec.ts`: 8 tests pass
- `tool-policy.service.spec.ts`: 14 tests pass
- `run-sub-agentflow.tool.spec.ts`: 10 tests pass

✅ `launchAllowedToolNames` correctly injected into child context by `withLaunchAllowedToolNames()` (run-sub-agentflow.tool.ts:42-62)

✅ Tool policy correctly intersects launch allowance with slot policy (tool-policy.service.ts:81-83)

✅ Scope warnings distinguish between missing `projectPath` and missing `executionCwd` (tool-policy.service.ts:181-225)

✅ `orchestratorScopeRestriction` prevents misleading warnings about inherited context when intentional narrowing is applied (tool-policy.service.ts:202-208)

---

## RECOMMENDATIONS

**Before merging:**

1. **Fix the `launchAllowedToolNames` gap** in `mergeAgentFlowLaunchContext`. Decide on the safest behavior:
   - Option A (Recommended): Remove `launchAllowedToolNames` from merged when `orchestratorScopeRestriction` is applied and explicit doesn't include it
   - Option B: Require explicit launch context to always re-specify `launchAllowedToolNames` when restricting (add runtime validation)

2. **Add test coverage** for the fixed behavior

3. **Verify live**: Run an E2E test where parent has wide tool allowance, child applies orchestrator restriction, and confirm child cannot access tools outside the restriction boundary

**Session documentation exists**: `docs/sessions/2026-06-10-agentflow-launch-allowance-sync.md` adequately notes backend verification but correctly flags that live UI/paid run testing is still needed.

---

## Summary

The fix introduces proper launch allowance inheritance and orchestrator precedence for `agent-flow-branch` tool policy, with comprehensive test coverage. However, **a critical logic gap exists** where `launchAllowedToolNames` is not narrowed when `orchestratorScopeRestriction` is applied without explicit re-specification. This must be fixed before commit.

**Current Gate Status**: ❌ **BLOCKER** — Do not merge. Fix the `launchAllowedToolNames` narrowing first.
