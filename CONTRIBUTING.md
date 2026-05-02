# Contributing to Kalio

Thank you for your interest in contributing. This document explains how the project works and what's expected.

---

## Before you start

Read **[AGENTS.md](./AGENTS.md)** — it is the canonical operating guide for all contributors (human and AI). The architecture rules there are enforced, not advisory.

---

## Development setup

```bash
# Prerequisites: Node.js >= 22, pnpm >= 9
pnpm install
cp .env.example .env   # set LLM_PROVIDER=mock for offline dev
.\start-dev.ps1        # starts API (:3016) + web (:5188)
```

---

## Workflow

### Test-driven development (required)

Every bug fix and non-trivial feature requires a test:

1. Write a failing test that reproduces the problem or describes the expected behaviour
2. Run it — confirm it fails
3. Write the minimal implementation to make it pass
4. Run all tests — confirm nothing regressed

```bash
# Backend unit tests (single file, fast iteration)
cd apps/kalio-api
node_modules\.bin\vitest.CMD run src/modules/chat/chat.service.spec.ts

# Frontend unit tests
cd apps/kalio-web
node_modules\.bin\vitest.CMD run src/features/chat/ChatInterface.test.tsx

# All tests
pnpm turbo run test

# Type check
pnpm turbo run typecheck
```

### Architecture rules (enforced)

| Rule | Detail |
|---|---|
| **No `any`** | Use `unknown` + narrowing or explicit types |
| **No cross-module imports** | Modules communicate only through `@kalio/types` |
| **500 LOC limit** | Hard limit per file (tests exempt). Split before adding |
| **No empty catch** | Always log with context. Never `.catch(() => {})` |
| **Shared types in one place** | All BE↔FE contracts in `packages/@kalio/types/src/index.ts` |
| **Destructive tools need confirmation** | `requiresConfirmation: true` on any tool that deletes or overwrites |

### Code audit

Run the built-in static analysis to catch file size violations, silent errors, and dead code:

```bash
pnpm audit          # collect raw data
pnpm audit:report   # generate docs/audit/<date>-report.md
```

Review all 🔴 CRITICAL items before opening a PR.

---

## Adding a new backend tool

```ts
@Injectable()
@Tool({
  name: 'my_tool',
  description: 'What this tool does.',
  parameters: { /* JSON Schema */ },
  requiresConfirmation: false,  // set true if destructive
})
export class MyTool {
  async execute(request: ToolCallRequest): Promise<object> { … }
}
```

Then:
1. Register in `ToolDispatchService` constructor injection + `executors` map
2. Add to `ToolModule` providers array
3. Write a spec file co-located with the tool

---

## Adding a new Socket.IO event

1. Add the event shape to `SocketEvents` in `packages/@kalio/types/src/index.ts`
2. Emit/handle it in the gateway / SDK — never invent ad-hoc shapes

---

## Pull requests

- One logical change per PR
- PR description must explain *why*, not just *what*
- All tests must pass (`pnpm turbo run test`)
- No TypeScript errors (`pnpm turbo run typecheck`)
- No new 🔴 CRITICAL items in the audit report

---

## Session logs

After non-trivial work, create a log in `docs/sessions/`:

```
docs/sessions/YYYY-MM-DD-HH-MM-<topic>.md
```

Sections: what was done, files touched, decisions made, open questions, next steps.

---

## Questions?

Open a GitHub Discussion or issue. See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for community standards.
