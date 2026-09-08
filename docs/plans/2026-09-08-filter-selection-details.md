# Filter Selection Details Implementation Plan

**Goal:** Implement the approved single outer focus ring, rich single-line selection summaries, and bounded selected-item panels; verify and publish directly as authorized.

**Architecture:** Preserve API payloads and selection state. Extend FilterDisclosure with optional visual summary content while retaining a plain-text complete title. Reuse existing security fields and resource icons. Apply focus ownership only to composite input wrappers; standalone controls retain keyboard outlines.

**Tech Stack:** React, CSS, Playwright, existing GitHub Production workflow.

## Tasks

1. Add `front-codex/tests/e2e/specs/filter-selection-details.spec.js`: reproduce duplicate focus rings; assert location security and resource images in collapsed selectors; exercise long names, many selections, removal, stable 42px controls, bounded scrolling and Escape.
2. Run the focused suite and confirm expected failures before implementation.
3. Modify `front-codex/src/components/ui/FilterDisclosure.jsx` to accept a separate visual value, retaining full text as its accessible description/title. Modify `front-codex/src/pages/Planetary.jsx` with first-item details plus remaining count, and a removable resource selection list. No query or calculation changes.
4. Modify `front-codex/src/styles.css`: keep summaries single-line at 42px, truncate names but not metadata/counts, bound selected lists, and remove inner focus outlines only where the containing wrapper draws a focus-within ring. Preserve standalone fields and invalid-field styling.
5. Run focused and full E2E, build, review the diff independently, and inspect local screenshots. Fix regressions before release.
6. Fast-forward master and push the verified commit; wait for Production success, check deployed SHA and backend PID, then verify the affected live UI without creating accounts or business data.
