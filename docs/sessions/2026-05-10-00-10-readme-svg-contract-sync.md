# 2026-05-10 00:10 - README, SVG, contract sync check

## What was done

- Re-checked README, shared contract comments, and legacy SVG assets against the refreshed architecture docs.
- Confirmed that `README.md` and `packages/@kalio/types/src/index.ts` already match `HEAD` for the current runtime wording, so they required no net new diff.
- Replaced the legacy static SVG diagrams in `docs/kalio_module_architecture.svg`, `docs/kalio_chat_tool_loop.svg`, and `docs/kalio_hitl_gate_flow.svg` with current diagrams aligned to the session-centric runtime.

## Files touched

- `docs/kalio_module_architecture.svg`
- `docs/kalio_chat_tool_loop.svg`
- `docs/kalio_hitl_gate_flow.svg`

## Decisions

- Kept the existing SVG filenames so README references stay stable.
- Simplified the SVGs into static diagrams instead of keeping older generated assets with stale labels like `LLMService`, `ToolDispatcher`, and the old 30s HITL timeout wording.
- Recorded that README and shared contract comments were already synchronized in the repository baseline even though they had been called out as stale in earlier session context.

## Validation

- Validated the README Mermaid sequence block successfully.
- Parsed all three updated SVG files as XML successfully.
- Searched the touched surfaces for stale strings such as `LLMService`, `ToolDispatcher`, `TOOL_CANCELLED`, old HITL event names, and the old MCP naming comment; no matches remained.

## Open questions

- None for this sync pass.

## Next steps

- If the docs site or README needs raster previews later, generate PNG exports from the refreshed SVGs rather than reusing the removed historical diagrams.