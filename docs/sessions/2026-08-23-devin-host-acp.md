# 2026-08-23 — hostowy Devin ACP dla Kalio

## Purpose

Dodać natywną integrację z lokalnym, zalogowanym Devin CLI na hoście przez ACP. Zakres dotyczy hostowego Windsurf/Devin, nie `CLIAgentService`, `spawn_cli_agent`, Devin Cloud REST ani nowej integracji Claude.

## Scope and constraints

- używany hostowy executable: `devin.exe`;
- darmowe lane’y zweryfikowane lokalnie: `glm-5-2` i `swe-1-7`;
- proces uruchamiany dokładnie jako `devin --model <lane> acp`;
- Kalio zachowuje własną sesję, audyt, scheduler i approval boundary;
- Kalio tools are now passed as a scoped Streamable HTTP MCP server when the bridge token is configured; provider-native filesystem/web/terminal tools remain category-gated;
- smoke run odbywał się w pustym katalogu, ponieważ prompt/kontekst prywatnego repo byłby wysłany do zewnętrznej usługi;
- istniejącej integracji Claude nie usuwano ani nie używano jako podstawy tej ścieżki.

## Acceptance criteria

| Kryterium | Stan | Dowód |
| --- | --- | --- |
| Hostowy executable i login | PASS | `devin --version` → `3000.2.17`; `devin auth status` → zalogowany |
| Darmowe modele | PASS | `devin models list` zawiera `glm-5-2` i `swe-1-7` |
| ACP handshake/session/turn | PASS | pusty katalog: `initialize`, `session/new`, `session/prompt`, `stopReason=end_turn`, strumień tekstu/myśli |
| Routing profilu Kalio | PASS | profile `devin-local-glm-5-2` i `devin-local-swe-1-7`, typ `devin-cli-acp` |
| Status API | PASS | `GET http://localhost:3016/api/runtime/devin-cli/status` zwrócił `authenticated=true`, `acp=true`, oba modele |
| Settings/Chrome | PASS | `http://localhost:5188/`, Settings → Integrations, karta `Devin CLI (host)` z `Online`, `Logged in`, `ACP available` |
| Kalio tool bridge | PASS (code) / BLOCKED (live token) | ACP receives the scoped HTTP MCP config; current dev env intentionally has no `KALIO_MCP_BRIDGE_TOKEN`, so `/api/mcp/bridge` returns 503 |
| Native Devin tools policy | PASS | persisted filesystem/web/terminal switches default to false and enabled requests stay behind `kalio_strict` HITL |
| Prywatny workspace canary | BLOCKED | wymaga osobnej, jawnej zgody na wysłanie kontekstu repo do Devina |

## Starting evidence

Przed zmianą istniały profile direct/Codex/Claude/Devin Cloud oraz osobna ścieżka `CLIAgentService`. Hostowy Devin executable był dostępny na hoście i miał aktywną sesję, ale Kalio nie miał adaptera ACP, profili hostowych ani statusu w Settings.

## Investigation or execution method

1. Odczytano istniejący runtime, kontrakty profili, lifecycle sesji i panel native integrations.
2. Zweryfikowano lokalny CLI: wersję, login, ACP help i listę modeli.
3. Sprawdzono oficjalny ACP TypeScript SDK i użyto bieżącej stabilnej wersji `@agentclientprotocol/sdk` 1.4.0.
4. Uruchomiono realny ACP smoke test w pustym katalogu: handshake, nowa sesja i pełny turn.
5. Dodano focused testy API/web, typecheck/build oraz ręczną weryfikację w Chrome.
6. Zebrano pełne suite’y osobno, bez maskowania istniejących awarii niezwiązanych z tym slice’em.
7. Dodano scoped Devin MCP config, ACP tool-activity audit events, native-tool policy/settings API, UI toggles, and focused regression tests.

## Root causes and decisions

- **Zaobserwowano:** hostowy Devin udostępnia ACP i `session/load`; **ograniczenie:** Kalio musi utrzymać własny binding sesji i nie może tracić `cwd`; **decyzja:** jeden długo żyjący host na lane, `externalThreadId` przechowuje opaque ACP `sessionId`, a restart używa `session/load`.
- **Zaobserwowano:** agent może żądać natywnych uprawnień; **decyzja:** mapować ACP `read/edit/delete/move/search`, `fetch`, and `execute` into filesystem/web/terminal policy categories. All categories default to deny; only `kalio_strict` requests reach the existing HITL callback.
- **Zaobserwowano:** current Devin ACP handshake reports `mcpCapabilities.http=false`, but `session/new` accepts an HTTP `mcpServers` entry; **decyzja:** pass the config explicitly and treat a future rejection as a surfaced turn error rather than silently falling back to a wider tool surface.
- **Zaobserwowano:** prywatne repo wymagałoby transmisji lokalnego kontekstu do usługi zewnętrznej; **ograniczenie:** brak jawnej zgody na taki transfer; **decyzja:** live smoke tylko w pustym katalogu.

## Implementation sequence

1. Dodano oficjalny SDK ACP i typ `devin-cli-acp` z allowlistą dwóch darmowych lane’ów.
2. Dodano `DevinAcpHost`/`DevinAcpHostRegistry`: proces, NDJSON guard, handshake, session restore, serializację turnów, stream update, permission boundary i lifecycle.
3. Dodano `DevinCliAcpLLMSource`, routing w `ProfiledLLMSource`, profil seedujący migrację `0034` oraz korelację `externalThreadId`.
4. Dodano status `GET /api/runtime/devin-cli/status`, wybór modelu w persona selectorze i kartę hostowego Devina w Settings.
5. Dodano testy kontraktu oraz dokumentację `project-spec.md` i `docs/technical-documentation-kalio.md`.

## Flow diagram

```mermaid
flowchart TD
    A[Persona wybiera devin-cli-acp + lane] --> B[ProfiledLLMSource]
    B --> C[DevinAcpHostRegistry]
    C --> D[devin --model lane acp]
    D --> E[ACP initialize/session/new lub session/load]
    E --> F[session/prompt]
    F --> G[session/update: text/thought/tool activity]
    G --> H[Kalio ChatSession, audit i UI]
    D --> I{native permission request}
    I -->|policy off| K[ACP permission denied]
    I -->|policy on + strict| J
```

## Files and boundaries changed

Commit `b95cab4` (`feat(runtime): add host-local Devin ACP`) obejmuje 26 plików: adapter ACP i testy, status controller, typy/profile/migrację, routing czatu, selector persona, panel Settings, lockfile i dokumentację. Następnie `b4388c9` podniósł ACP SDK do 1.4.0, a `f6ec1c3` utwardził status probe’a kodami wyjścia po resecie hosta. Nie zmieniano `CLIAgentService`, ścieżki `spawn_cli_agent` ani istniejących adapterów Claude.

## Verification evidence

- `corepack pnpm --filter kalio-api typecheck` — PASS.
- `corepack pnpm --filter kalio-api build` — PASS.
- `corepack pnpm --filter kalio-api test -- src/modules/agent-runtime` — 13 plików, 50 testów PASS po regresji kodów wyjścia probe’a.
- Po aktualizacji SDK do 1.4.0 powtórzono focused backend gate: 13 plików, 50 testów PASS; typecheck i build backendu ponownie PASS.
- `corepack pnpm --filter kalio-web typecheck` — PASS.
- `corepack pnpm --filter kalio-web build` — PASS; istnieje tylko ostrzeżenie o dużym chunku Vite.
- `corepack pnpm --filter kalio-web test -- src/features/persona/persona-runtime-selection.test.ts src/features/chat/runtimeProfileLabel.test.ts src/features/settings/NativeCliIntegrationsPanel.test.tsx` — 3 pliki, 11 testów PASS.
- API live: `GET http://localhost:3016/api/runtime/devin-cli/status` — `devin.exe`, `3000.2.17`, `authenticated=true`, `acp=true`, `models=[glm-5-2,swe-1-7]` in the host stack context.
- Chrome live: `http://localhost:5188/` → Settings → Integrations; karta hostowego Devina widoczna jako Online/Logged in/ACP available. Wykonano screenshot viewportu jako dowód wizualny w sesji QA.
- `git diff --cached --check` — PASS; implementacja utworzona jako `b95cab4`, dokumentacja sesji jako `475a185`, a poprawka probe’a jako `f6ec1c3`.

## P2 closure update

- Added `kalio-mcp-bridge-config.ts`: the Devin adapter passes an authenticated,
  loopback Streamable HTTP MCP server to ACP session creation/restoration with
  explicit Kalio session/VFS/turn/message headers and an explicit tool allow-list.
- Added ACP `tool_call`/`tool_call_update` forwarding to `devin-cli-acp.tool`
  audit events, so live tool progress is observable alongside text and thoughts.
- Added persisted Devin native-tool settings (`filesystem`, `web`, `terminal`),
  default-deny classification, `/api/runtime/devin-cli/settings`, and Settings
  toggles. Enabled categories remain behind the existing strict HITL callback.
- Focused verification: backend bridge/ACP/policy tests `18/18 PASS`; web panel
  tests `5/5 PASS`; typechecks were green before the unrelated persona-avatar
  edits appeared in the shared worktree.
- Live dev verification: `GET /api/runtime/devin-cli/settings` returns all three
  switches false and the loopback bridge URL; `GET /api/mcp/bridge` returns the
  expected `503` while the dev environment has no token. A bearer token was not
  created or persisted by this change.
- Final full typecheck/build attempts are `BLOCKED` by unrelated unowned
  persona-avatar edits: the API test references missing `avatarVariant`, and
  the web build cannot resolve `boring-avatars`. Those files are intentionally
  excluded from this commit; the focused Devin/MCP gates remain green.

## Caveats and inconclusive checks

- Pełny API suite zakończył się `235 passed`, `17 failed` w `239` plikach. Najważniejsze obserwacje: test migracji ma hard-coded oczekiwanie 28 wpisów przy aktualnym journalu 35, a część testów KV/CLI widzi brakujące kolumny w bazie testowej. To pozostały baseline/release gate, nie dowód działania hostowego adaptera.
- Pełny web suite zakończył się `196 passed`, `5 failed` w `198` plikach; awarie dotyczą testów Execution Graph i nie dotknęły focused testów panelu/persona.
- Nie wykonano prywatnego repo canary ani deployu zewnętrznego. Dev hot-reload na localhost był już uruchomiony; dowód obejmuje lokalny runtime, nie produkcję.
- Live ACP odpowiedział `stopReason=end_turn` i streamował komunikację, ale smoke prompt zawierał żądanie literalnej odpowiedzi, którego agent nie zachował dokładnie. Potwierdza to transport/lifecycle, nie jakość instruction-following.

## Post-reset verification

- Po resecie hosta ograniczony probe uruchomiony w sandboxie kończył `devin auth status` kodem `101` z `PermissionDenied` przy tworzeniu rolling loga; nie był to dowód wylogowania.
- To samo polecenie uruchomione w kontekście hostowego stacka kończy się kodem `0` i zwraca `Logged in (via Devin)` z credential file `%APPDATA%\\devin\\credentials.toml`; ponowne logowanie nie jest wymagane.
- Parser statusu został utwardzony: tekst probe’a bez kodu `0` nie może oznaczyć Devina jako zalogowanego ani udostępnić modeli/ACP. Dodano regresję dla częściowego outputu po crashu.
- Weryfikacja API po hot-reloadzie nadal zwraca `authenticated=true`, co jest zgodne z działającym hostowym kontekstem; ograniczony probe pozostaje lokalnym problemem uprawnień procesu, nie stanem sesji Devin.

## Remaining boundary and production closure

- **[P2] Required before broader release:** set `KALIO_MCP_BRIDGE_TOKEN` in the intended host environment and run an authorized Devin MCP canary against a disposable workspace; the code path is implemented but the current dev stack is intentionally token-disabled.
- **[P2] Required before production:** naprawić lub formalnie sklasyfikować pełne API/web suite’y, a następnie powtórzyć pełny gate.
- **[P3] Recommended:** dodać osobny, autoryzowany workspace canary z kontrolowanym testowym katalogiem, gdy będzie zgoda na transmisję kontekstu do Devina.
- Produkcja nie jest potwierdzona: brak deployu, publicznego health checku i produkcyjnego testu tego runtime’u.
