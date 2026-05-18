# 2026-05-18 13:18 - persona graph validation

## What was done

- Added the first backend implementation slice for persona graphs as an internal validator in `persona-graph-config.ts`.
- Defined a minimal v1 graph shape with `router`, `persona`, `tool`, and `final` nodes plus edge validation.
- Added `PersonaService.validateGraphConfig()` as a narrow backend entrypoint.
- Exposed `POST /personas/:id/graph/validate` in `PersonaController` for server-side graph validation without persistence.
- Added focused tests for validator rules plus service/controller delegation.

## Files touched

- `apps/kalio-api/src/modules/persona/persona-graph-config.ts`
- `apps/kalio-api/src/modules/persona/persona-graph-config.spec.ts`
- `apps/kalio-api/src/modules/persona/persona.service.ts`
- `apps/kalio-api/src/modules/persona/persona.service.spec.ts`
- `apps/kalio-api/src/modules/persona/persona.controller.ts`
- `apps/kalio-api/src/modules/persona/persona.controller.spec.ts`

## Decisions

- Kept the first slice backend-local and avoided persistence or shared-type expansion in the same change.
- Made validation return structured errors instead of throwing on graph-shape issues so the future editor can render field-level feedback.
- Kept persona existence as a service-level guard so the validation endpoint still respects the current persona surface.

## Validation

- `cd apps/kalio-api; npx vitest run src/modules/persona/persona-graph-config.spec.ts`
- `cd apps/kalio-api; npx vitest run src/modules/persona/persona-graph-config.spec.ts src/modules/persona/persona.service.spec.ts src/modules/persona/persona.controller.spec.ts`
- `get_errors` on all touched persona graph files returned no errors

## Open questions

- Shared graph wire types in `packages/@kalio/types` are still pending and were deliberately deferred in this first slice.
- Persistence shape is still open: dedicated `persona_graphs` table versus a JSON column on `personas`.
- The current validator checks graph shape and references, but not yet domain-level rules such as allowed persona/tool targets.

## Next steps

- Add persistence for graph configs and a save/load API beside the validation endpoint.
- Promote the backend-local graph types into shared contracts once the storage/API shape is settled.
- Add graph-specific business validation for existing persona ids, tool names, and routing guardrails.