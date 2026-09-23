# Tactical map performance verification

Date: 2026-09-23

## Scope

- Coalesce wheel input into one camera update per animation frame.
- Move the committed camera through SVG world and overlay transforms during a wheel burst instead of rebuilding the React tree for every native wheel event.
- Keep marker and label collision layouts stable while the camera is moving, then recompute once after the idle window.
- Add zoom hysteresis for dense names and a short settle fade with reduced-motion support.
- Keep pointer hit testing, drag previews, and focus actions on the live camera ref.

## Verification

- `node --test tests/unit/*.test.mjs` — 215 passed.
- `npm run build` — passed; Vite production build and bundle budget check passed.
- `npx playwright test --config=tests/preview-e2e/playwright.config.js --reporter=line` — 4 passed.
- `npx playwright test --config=tests/tactical-e2e/playwright.config.js --reporter=line` — 86 passed in a single-worker run after the final camera-layer changes.
- Focused wheel/marker checks — 3 passed (`map wheel zoom`, `wheel bursts`, `stable marker slots`).
- `git diff --check` — passed.

## Notes

The map still keeps the real star coordinates and gate topology unchanged. During zoom, the static topology and the screen-space tactical annotations move together through an affine transform; the collision solver runs only after the gesture settles. This removes the source of label jumping and most of the React/SVG work from the high-frequency wheel path.
