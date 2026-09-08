# Authentication Tab Contrast Implementation Plan

**Goal:** Apply the user's approved black-background, white-text treatment only to the selected login/register/password-reset tab.

**Architecture:** Change only `.auth-tab.active` in the shared stylesheet, reusing the existing primary-button charcoal (`--text`) and white text. Keep the card, form fields, inactive tabs, sizing, interactions and other pages unchanged. No deployment is requested in this change.

**Tech Stack:** React, CSS, Playwright.

## Implementation

1. Add `front-codex/tests/e2e/specs/auth-tab-contrast.spec.js`. Check all three selected tab states for charcoal background and white text; verify inactive tabs remain transparent, the card remains white, and fields remain warm white.
2. Run `npm run test:e2e -- tests/e2e/specs/auth-tab-contrast.spec.js --workers=1` from `front-codex`. Expect failure against the old pale selected background.
3. In `front-codex/src/styles.css`, change only `.auth-tab.active` background to `var(--text)` and color to `#fff`.
4. Run the focused test, authentication regression tests and `npm run build`. Inspect `git diff --check` and the two-property CSS diff.
5. Keep the verified change locally on `codex/auth-tab-contrast`; do not push master or deploy without authorization.
