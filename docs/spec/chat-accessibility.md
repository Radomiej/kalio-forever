# Chat accessibility

Session kind indicators are named images: the containing span has role img and the descriptive accessible name; the inner decorative SVG is hidden from assistive technology.

Small text in project-group counts, project paths/Sandbox VFS, answered-tool badges and submitted-app status must retain readable contrast. Use local existing foreground tokens rather than changing the global theme. The selected Chat/Graph button retains its selected background and aria-pressed state with a readable foreground.

Verification includes existing interaction/semantic regressions and the rendered built application. The 2026-11-02 QA audit of the same persisted conversation at1440x1000 changed26 WCAG findings to0 after these local fixes. This is bounded evidence for that surface/theme, not complete application certification; light themes, other routes and remaining automatic advisory findings need their own evidence.
