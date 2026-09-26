# Market focus terminal — approved design

The user selected the first displayed concept (single-chart focus terminal), supplied real game screenshots, approved the 48 cropped icons, and requested implementation and production deployment.

## Visual truth

Selected reference: `C:/Users/22351/.codex/generated_images/01a0d2b6-27fb-7af0-b435-8ec1a318dbea/exec-3edad2b5-7e23-4556-9094-82baa3a52759.png` (1672 × 941).
Asset input: `output/market-icons-2026-09-27/manifest.json` and `webp-128/`.

Keep the existing warm application navigation. Use a compact warm top toolbar, a small outside inset and rounded dark terminal, a narrow image-led catalog, a dominant plot, and a slim five-price quote rail. Remove nested quote cards and duplicate section headings. The first statistic is visibly stronger; all five statistics remain on one line with local overflow when necessary. Default to sell-only, preserving explicit both/sell/buy selection. Desktop fills the viewport; narrow screens reflow without hiding controls.

## Data and interaction invariants

Retain the actual API, search/category filters, pagination, cached non-flashing item changes, 24h/7d/30d ranges, explicit error/empty/stale states, refresh and authorized management link. Keep exact values accessible while displaying compact 万/亿 values. Icons map by item ID, never by fuzzy names. Unknown icons have a library-icon fallback and broken-image handling.

Existing observations contain price levels but no quantities or completed trades. Use “报价档位” instead of “盘口深度”, and “报价观测” instead of “实时盘口”. Month statistics are rolling 30 days, labeled accordingly. No fabricated candles, volume, depth bars, item descriptions, LIVE claims or generated numerical data in production. Current/last quote tags must not label an older non-null sample as the newest observation. Preserve null gaps, precise decimal statistics, keyboard interaction and hover details.

Use supplied raster icons and existing UI icon/font system. Keep the existing chart rendering for actual data visualization; do not draw replacement game art. The mock's fabricated imagery, numbers and wording are intentionally replaced by verified assets and API content.

## Scope and release

Frontend-only change; do not change collection accounts, enabled items, database, backend or unrelated screens. Continue in the existing isolated Codex worktree. Include the previously verified local single-row statistics change. Add tests first, run regressions/build, compare rendered source and implementation, perform independent spec and quality review, then push/PR/merge and use the repository's existing deployment workflow. Verify the deployed revision and public market route.
