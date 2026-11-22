# CLI-only startup without direct LLM credentials

Kalio can initialize without any `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL` or
`LLM_MODEL`, in development, test and production. Empty values are also accepted.
CLI providers (Codex, Devin and Claude) authenticate through their own adapters;
a direct LLM API key is not their startup prerequisite. Existing database,
workspace and production credentials-master-key requirements remain unchanged.
This contract does not bypass CLI installation, login or provider readiness.

## Provider resolution and actual use

Active saved DB credentials retain precedence over env configuration, except
when the existing explicit `KALIO_FORCE_ENV_LLM=1` override is enabled.
Env defaults describe an unconfigured OpenAI direct provider with empty key and
model, not a working provider. Provider construction is lazy; startup and
`GET /api/llm/config` do not perform direct inference. With no selected direct
model, the active-model list is empty.

Only explicit `LLM_PROVIDER=mock` enables mock. Missing fields and the placeholder
`LLM_API_KEY=mock` do not imply mock, including under `NODE_ENV=test`.
Tests and launchers requiring mock must select it explicitly.

Direct inference validates its effective configuration after DB/profile/request
model resolution. A missing remote API key raises `LLM_AUTH` with guidance to
select a saved credential in Settings or set `LLM_API_KEY`. Missing models report
how to select one or set `LLM_MODEL`. Failures happen before provider HTTP calls;
no request is silently converted to mock. Ollama, BitNet and loopback HTTP(S)
OpenAI-compatible endpoints can run without a key. No-auth providers still need
a selected model. Previously saved credentials can be selected after CLI-only
startup without restarting the backend.

## Launcher contract and boundaries

For a CLI-only launch, omit all four `LLM_*` variables above. Do not synthesize
mock credentials. Launcher/install script alignment is a separate workstream;
this document records the backend contract, not proof of those scripts or a
successful live CLI login. No DEV watcher or production process is started by
these changes.

## Embedding schema defaults

Joi leaves absent `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` unset so it cannot
inject legacy E5 defaults ahead of Memory configuration. The Memory resolver
selects `onnx-community/embeddinggemma-2-ONNX`, 768 dimensions, CPU for new
installs. Explicit legacy E5 env values and saved model selections remain
supported. This is text-only embedding, with no multimodal claim.

## Verification

Regressions cover schema validation across environments; schema-to-Memory
Gemma/E5 selection; service construction and settings without direct credentials;
actionable deferred errors without HTTP; explicit mock; saved DB credential
precedence/removal; and no-auth local provider requests. Provider HTTP responses
are fixtures. These tests do not prove real Codex/Devin/Claude login, live model
inference, launcher integration or production deployment.
