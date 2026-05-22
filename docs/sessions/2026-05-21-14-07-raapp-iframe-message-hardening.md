# RA-App iframe message hardening

- Date: 2026-05-21 14:07
- Scope: harden `HtmlIframeRenderer` so untrusted served `src` previews cannot inject chat messages through `kalio_send_message`, while preserving inline trusted HTML bridge behavior and resize handling.

## What changed

- Added focused tests in `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.test.tsx` for:
  - trusted inline `html` iframes forwarding `kalio_send_message`
  - served `src` previews blocking `kalio_send_message`
  - served `src` previews still honoring `raapp_resize`
- Updated `apps/kalio-web/src/features/raapp/HtmlIframeRenderer.tsx` so the interactive chat bridge only accepts `kalio_send_message` when the renderer is using trusted inline HTML (`srcDoc`).
- Left resize handling scoped only by known iframe window identity so served previews keep auto-height behavior.

## Validation

- Ran `npm run test -- src/features/raapp/HtmlIframeRenderer.test.tsx` before the fix: failed on the new served-preview blocking test because `addMessage` was called.
- Ran the same command after the fix: all 11 tests passed.

## Decisions

- Did not add an `event.origin === window.location.origin` check because sandboxed inline iframes can legitimately have origin `null`.
- Kept the fix local to `HtmlIframeRenderer` and its test file; no shared bridge or backend changes were needed.

## Open questions

- None for this slice.

## Next steps

- If additional RA-App trust tiers are introduced later, represent them explicitly in the renderer instead of inferring trust from generic message origin.