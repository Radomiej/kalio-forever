---
name: kalio-operator
description: Operate Kalio on Windows: start the installed app, configure Codex or Devin, install local embeddings, and verify tool approvals and runtime health.
---

# Kalio operator

## Environment

Confirm the user's target before changing settings. Production installs live under `%LOCALAPPDATA%\Kalio`, with UI/API on http://127.0.0.1:4016/. Stable QA uses UI :5288/API :3316 and `%LOCALAPPDATA%\kalio-forever-qa`; DEV uses :5188/:3016. Read `/api/runtime/info` to verify the actual version/profile. Never transfer evidence or provider configuration between environments implicitly.

Start installed production using `%LOCALAPPDATA%\Kalio\bin\kalio.cmd start`; it starts the server and opens the browser. On Windows launch background helpers with hidden windows. Preserve `data`, its `.env`, database and credential encryption key during upgrades. Prefer the exact release installer and verify the archive checksum. Sandbox environment variables may point to a virtual profile: use the actual user environment for installation checks.

## User workflow

Drive the requested workflow through Chrome or the in-app browser, inspecting live controls first. API checks support browser proof. Inspect Settings and the chat model selector; saved profiles alone do not prove login or model availability.

For Codex, inspect `/api/runtime/native-cli-integrations` and refresh the configured auth profile through its check/model-catalog endpoints. Select a model returned by that account. For Devin inspect `/api/runtime/devin-cli/status`, settings and its authenticated catalog. Use the exact selected model; never silently substitute GLM for SWE. Do not assume a model is free from its name or an old price label.

Persist the chosen default through Settings or `/api/runtime/default-profile` using the supported authentication flow. Keep approval enforcement enabled. Replace mock only after confirming a real integration; never silently fall back to mock after a provider error. Do not expose credentials or auth bootstrap tokens in logs or notes.

## Embeddings and approvals

Local embedding model weights are downloaded separately from the Transformers/ONNX execution libraries. Inspect `/api/memory/embedding-local`, `/api/memory/status/embedding` and the local availability endpoint. Install via the supported local model installation endpoint, wait for ready, then test before activation. Switching model/dimensions requires a separate compatible index or reindex; preserve existing indexes. Google model catalog identifiers and revisions must come from the current backend, not guessed downloads.

Inspect Decision Settings and HITL before enabling automated approval. Distinguish official TypeSafe Jev from independent Jev-like models. Verify available weights, license, local serving protocol and Kalio compatibility before installation or activation. Never treat an uncalibrated local model's confidence as authorization; retain hard deny rules and manual approval for unresolved or destructive actions.

## Proof and reporting

Verify actual provider/model, one authorized bounded operation, tool origin (Kalio/native), final response completion and history after reload. For file changes use the exact approved project and reconcile agent prose with tool/audit evidence. No live canary may expand the user's approved scope.

Report separately: installed, configured, online, model downloaded, inference tested, UI verified. Include URL/version and concrete remaining blockers. Never call the workflow ready from HTTP 200 alone. Preserve unrelated DEV/QA services and user data.
