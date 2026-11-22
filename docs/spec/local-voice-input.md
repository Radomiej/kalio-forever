# Local voice input — implementation contract

Status: in development, 2026-11-02. Source changes are not proof of DEV/QA/production acceptance. This contract supersedes the research document's default no-retention proposal for unfinished browser recordings. Latest user decision: automatically remove successful recordings after safe transcript insertion; retain failures and not-yet-inserted results only.

## User flow

1. Voice settings show the exact optional runtime/model and complete download size before an explicit Install action. No install starts on application startup, microphone click or failed transcription. Progress, cancellation, failure and retry are visible.
2. Dictation starts only on an explicit user action and browser microphone permission. It supports an existing chat or the first prompt of a new chat without creating a history row.
3. Capture is bounded to60 seconds. Show elapsed time, actual measured audio level and distinguish signal, silence, permission/capture error and local-saving failure. Reduced-motion uses a static meter. Do not simulate activity when the input is silent.
4. Persist raw recording chunks locally with acknowledged storage transactions. Show saving/saved/error truthfully. Ordinary inference/auth/network failures never delete the recording. Retry uses saved audio; failed recordings also have explicit Delete. Automatically delete audio after nonempty transcription is safely inserted into the composer. No success library, retention timer or model selector is part of this flow. Cleanup failure must not reinsert or retranscribe an already-inserted result.
5. Transcript becomes editable composer text, never auto-sent. If the draft/session changed while inference ran, show the result for explicit insertion rather than overwriting newer text; retain the recording until that insertion succeeds. Failed/uninserted local launch recordings remain discoverable after launch/F5.
6. The composer shows one compact purple transcriber beside Send, not an audio-management panel: record trigger; X and confirm/finish during capture; taller measured audio bars in the centre; text after finishing. Keep copy short and English, consistent with the current app. Recoverable failure actions are Retry/Delete. Permission waiting is cancellable and bounded with actionable guidance; no endless waiting or fabricated audio activity.
7. Explicit X discards the current recording. Stop the PCM producer, invalidate further appends, drain already-queued storage writes and delete the recording so it cannot reappear after reload. This differs from a failed confirmed transcription or interruption, whose audio remains recoverable. Cancellation of the backend request alone is not deletion of the local draft.
8. Voice settings use a compact model card with measured download size, readiness and explicit Install/Cancel actions. Detailed runtime/licensing information is secondary. The installed model currently enforces a 60-second capture limit; configurable minutes remain a separate FE/BE contract change, not a client-only bypass.

Browser storage is origin-specific; localhost and127.0.0.1 are distinct stores. Uncommitted audio can be lost during abrupt process/device failure. Quota failure, blocked storage and eviction must not be represented as saved. Warn before leaving while capture or uncommitted data exists; do not promise recovery after storage clearing or disk failure.

The delivery journal distinguishes pending insertion from a committed composer acknowledgement. Dismissing a pending transcript must leave an explicit recovery action without reloading or retranscribing. An inserted result whose audio cleanup fails offers deletion only. Successful deletion clears the matching pending transcript action without affecting other recordings.

## Runtime and transport

- Optional Windows x64 CPU runtime: sherpa-onnx-node1.13.8 + sherpa-onnx-win-x641.13.8, registry integrity pinned. Model Parakeet TDT v3 INT8 from the exact research manifest. Initial measured download679,385,601B includes runtime8,906,829B and model670,478,772B; installed size/RAM are separate measurements.
- VFS-owned private storage streams bounded downloads, verifies size/hash and allowlisted package entries, rejects traversal/links/junctions and unapproved redirects, and publishes readiness atomically. No model weights added to the release archive. Concurrent installs and orphan cleanup require exact ownership.
- A bounded cold CPU worker handles each request. Cancel/timeout kills that worker and frees native memory. Backend uploads are ephemeral, with no raw audio/transcript logging or backend recording archive. Browser drafts provide recovery.
- GPU is not a prerequisite or a proven capability of this CPU path. Hardware support and performance require separate measured evidence.

Existing local browser cookie bootstrap: `POST /api/decision/auth` with empty JSON body, then guarded exact speech GET/PUT routes. No new provider credential. Nonlocal/untrusted origins fail closed; no silent cloud/Web Speech fallback.

| Route | Contract |
|---|---|
| GET /api/speech/status | missing/installing/verifying/ready/error, installed, exact model/backend, downloadedBytes,totalBytes,phase,errorCode,maxDurationSeconds60 |
| PUT /api/speech/install | Explicit empty JSON object;202 status |
| PUT /api/speech/install/cancel | Empty JSON object; cancel install and return status |
| PUT /api/speech/transcriptions/:requestId | Multipart `audio` canonical44-byte-header WAV PCM16 mono16kHz, <=1,920,044B; exactly one `sessionId` or `draftId` metadata field |
| PUT /api/speech/transcriptions/:requestId/cancel | Empty JSON object; cancels this request, never deletes the browser recording |

Response binds requestId and the same exclusive sessionId/draftId to text and durationMs. New launch draftId is a browser recording scope, not a fabricated existing ChatSession. Validate IDs and bounded data; no conversation database row is created by transcription. Cancellation must remain effective during model-root verification before worker spawn.

## Required proof before release

Observed Windows CPU baseline (2026-11-02): pinned official English sample3,845.0625ms, cold worker3,141ms including model load, CPU4threads, installed693,997,789B. Source model files reused a separately hash-verified official local cache; runtime packages came from the official registry. This does not prove a complete model network download or Polish accuracy. Cancellation and identical retry passed. Worker JavaScript networking and parent fetch were disabled for the isolated inference test; OS-level egress isolation, peak RAM and GPU were not measured. Parent additionally verified real DEV HTTP auth/exclusive launch-draft binding and transcription:200,2,972ms round trip,79 transcript characters, no microphone used.

DEV/preview proxy must route exact speech endpoints through the existing Host-preserving protected proxy, before generic `/api` rewriting. The backend's Host/Origin checks remain unchanged. Regression:missing route caused live403; protected route restores authenticated status. Direct unauthenticated requests still fail.

- Fixture tests: WAV limits, HTTP auth/content type/scope/cancel/busy, archive integrity/containment, partial cleanup, lifecycle/cancellation and worker failures.
- Actual local CPU inference using a pinned official sample; label its language. English proof does not establish Polish accuracy. Record cold latency, audio duration, model/backend/disk size and peak memory where measured.
- Real microphone permission/capture, reactive level, silence and failure states; saved recording ->failure ->F5 ->Retry/Delete; storage quota failure and session/draft concurrency. Exercise first prompt, existing chat and workflow composer.
- Affected typecheck/build/lint, isolated regression gates, DEV browser proof, then built QA deployment preserving providers. Production remains a separate acceptance step.
