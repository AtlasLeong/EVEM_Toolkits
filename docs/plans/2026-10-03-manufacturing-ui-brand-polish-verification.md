# Manufacturing UI and EVEM branding verification

Verified locally on 2026-10-03 in the existing `codex/viewer-allowlist-deploy` worktree. No merge, push, deployment or production permission change was performed.

## Delivered

- Stable desktop root and manufacturing scroll gutters; picker opening and quote selection preserve card positions and content widths.
- Separate 126 px make/buy group with a 6 px gap, individual 8 px corners, visible keyboard focus and 44 px phone button height.
- Selected node decoration stays inside its rectangle. Duplicate panel eyebrow labels and disconnected skill/building presets are removed; the final efficiency field and calculation limitations remain.
- Purchase category counts include missing-price items. Manufacturing calculations, API requests and viewer access remain unchanged.
- Static title, description and OG/Twitter metadata use `EVEM 工具箱`; runtime titles use `模块名称 · EVEM 工具箱`. Compass assets remain unchanged. No private data or invented sharing image is included.

## Fresh final checks

| Check | Result |
| --- | --- |
| `npm run test:unit` | 550 passed, 0 failed |
| `node --test tests/preview/*.test.mjs` | 30 passed, 0 failed |
| Main browser suite, `PW_TEST_PORT=4173`, 3 workers | 381 passed, 0 failed |
| Tactical responsive subset, `TACTICAL_TEST_PORT=4193`, 1 worker | 10 passed, 0 failed |
| `npm run build` and bundle budget | Passed |
| `git diff --check` | Passed |
| Independent specification and code-quality reviews | Passed; no blocking findings |

The focused manufacturing suite also passed 10/10 after the final phone alignment correction.

## Regressions caught and corrected

Tests first failed against zero-gap legacy buttons, incorrect missing-quote purchase counts and absent stable gutters. Full integration testing then caught a 10 px mobile width reservation; phone-sized pages now hide only the root scrollbar appearance, retaining normal scrolling and full viewport width. A new same-row geometry assertion caught the mobile expand arrow wrapping; tightening the name area's flex basis resolved it without changing the control widths.

The existing starsea association test was reproducibly ambiguous between loading and association status messages. Its locator now filters the intended status by association text; application behavior and the original assertion remain intact.

## Actual browser evidence

The Codex in-app browser was checked at 1440 × 900 and 390 × 844. At desktop picker open/close and selected-node pricing, the control/route/cost cards retained x positions 264/516/1126 px, widths 240/598/280 px and client widths 229/587/269 px. Mobile content width was 390 px with no horizontal overflow; make/buy buttons were 44 px tall and the expand arrow shared their y position.

Sidebar navigation, browser Back and Forward showed `制造估价 · EVEM 工具箱` / `市场价格 · EVEM 工具箱` correctly. Raw HTTP HTML on `/manufacturing` contained the approved public title and all sharing metadata without requiring JavaScript.

Screenshots (workspace-relative):

- `output/playwright/ui-polish-2026-10-03/desktop-moros-final.jpg`
- `output/playwright/ui-polish-2026-10-03/desktop-selected.jpg`
- `output/playwright/ui-polish-2026-10-03/mobile-route-390.jpg`

## Handoff boundaries

Preview: `http://127.0.0.1:4185/manufacturing`. The sandbox does not connect to production; missing live market quotes in preview are explicitly labelled and are not treated as zero-cost materials. Production still uses the existing single-viewer access policy. Old sharing-platform caches cannot be invalidated by this local implementation; the new metadata becomes publicly served only after an authorized deployment.

The user's dirty client-icon research README and unrelated untracked files were preserved.
