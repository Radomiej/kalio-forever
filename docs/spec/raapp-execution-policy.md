# RA-App execution policy — requested behavior, not as-built

Recorded 2026-10-08, Europe/Warsaw, from the user's QA feedback. “Drzewa” in this conversation refers to Jev due speech-transcription error.

## Requested behavior

- Each app may define usage instructions and a preferred provider/model execution identity.
- An ordered list of fallback models is tried for **availability before launch**, highest preference first; this is not an inferred global ranking of model quality.
- If no configured candidate is available, ask the user to choose/configure an agent. Cancel creates no running task and sends no generation request.
- Each Home app tile exposes a settings gear on hover or keyboard focus, and without hover on touch devices. A compact modal edits that app's preferred execution profile, ordered fallbacks and usage instructions. There is no global Home model selector.
- When no configured candidate is available, a launch-time choice may explicitly override the app recommendation for that launch; cancelling must not create a session or start generation.
- A model identity must include provider/runtime and its local execution profile; a model string alone does not identify credentials, capabilities or approval policy.
- Do not silently change models after work has started or retry an operation on another model when it may already have executed.
- Persist the selected profile and app/version/instruction snapshot in backend-owned session context; F5 must reconstruct it.

## Existing support and implementation boundary

Current RA-App Manager accepts one explicit execution profile or inherits the current session profile. Root-session creation may use the saved global default. Current metadata does not contain a durable per-app ordered preference list; Home and Manager launch paths must converge before claiming parity.

The bounded Home selector update uses existing session DTO/profile APIs only. It is not the ordered-fallback feature. Full app policy needs reviewed shared contracts, validated package metadata, backend availability/admission, catalog projection, user-choice outcome and durable usage-instruction consumption. Never implement this as frontend-only localStorage truth or infer readiness from enabled=true.

## Acceptance

| ID | Requirement |
|---|---|
| RAP-01 | Available preferred candidate binds persisted session and actual runtime |
| RAP-02 | Missing/disabled/unavailable candidate falls through in declared order before launch |
| RAP-03 | Exhausted list opens chooser with reasons; cancel creates no generation |
| RAP-04 | Explicit override is honored or fails visibly, never silently swapped |
| RAP-05 | Home/Manager share admission and preserve exact app/version/inputs/instructions |
| RAP-06 | Duplicate click, stale readiness, auth loss, Stop and retry do not duplicate execution |
| RAP-07 | F5, keyboard, loading/error/empty and constrained viewport behavior verified |

Status: user authorized complete per-app implementation on 2026-10-08 and replaced the global Home selector design with per-tile settings. Implementation is in progress; the previously deployed Home selector is not completion evidence for the new policy.

## Implementation acceptance matrix

| AC | Required proof | Status |
|---|---|---|
| RAP-08 | Gear does not launch app; hover, keyboard focus and touch expose it | Pending component and browser proof |
| RAP-09 | Modal has labelled controls, Escape, focus return, save/error/cancel states | Pending component and browser proof |
| RAP-10 | Saving one app does not alter another; reopening and F5 hydrate backend settings | Pending persistence and QA proof |
| RAP-11 | No global Home selector remains; icon generation/removal retain their behavior | Pending adjacent regression proof |

Availability is an admission check, not a promise that a remote runtime cannot later fail. A failed operation must be visible and must not be repeated automatically on a fallback after it may have executed. Provider credentials and existing QA settings must survive deployment.
