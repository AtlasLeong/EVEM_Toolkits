# Market Components and Structures Design

**Date:** 2026-10-02

## Goal

Expose all 58 tradeable component items from the official component subcategory and 16 curated faction structure items in the market terminal, while preserving the existing low-concurrency, randomized account-pool collector.

## Scope

- Add a `components` bucket labeled `组件` for the 58 non-blueprint rows in the six official component groups: `高级舰船组件-复数`, `个人堡垒组件-复数`, `铁壁升级组件-复数`, `建筑基础组件-复数`, `旗舰组件-复数`, and `无人机组件-复数`. The classifier must require `category_id != 1700` so blueprint rows are excluded.
- Add a `structures` bucket labeled `受损结构` for exactly these 16 IDs, four per empire: level 4, dreadnought, carrier, and titan structures for Amarr, Caldari, Gallente, and Minmatar.
- Do not enable blueprints or the other faction/industrial damaged-structure variants.
- Keep the existing currency, planetary, minerals, and intermediate buckets and their enabled state unchanged during production rollout.

## Architecture and data flow

1. `Market.taxonomy` owns the two new stable bucket identifiers, labels, classification rules, and the explicit structure allowlist.
2. `market_seed_catalog` imports the existing catalog metadata, classifies rows, and accepts the two new bucket names in `--enable-buckets`.
3. The category/list APIs derive counts from enabled `MarketItem` rows, so no new endpoint or database schema is required.
4. The collector continues to select at most `MAX_ITEMS_PER_RUN` enabled items in one leased run, queries them sequentially with the existing pace, and chooses one shuffled usable session from `MARKET_SESSION_FILES` (falling back between sessions only before the first persisted quote).

## Reliability and load

- No parallel quote requests are introduced.
- The existing 35–51 minute randomized schedule and run lease remain unchanged.
- Adding 74 enabled items to the existing catalog increases a full rotation by roughly 74 seconds at the one-second query pace; the 40-item per-run cap keeps each individual session bounded.
- Blueprint rows are excluded by the `category_id != 1700` guard and structure rows are restricted to the explicit allowlist.

## Testing and rollout

- Add taxonomy tests for component classification, blueprint exclusion, and all 16 structure IDs.
- Extend seed/API/terminal tests to assert both categories and their counts.
- Add an end-to-end market category check for both new buckets.
- Run the Market Django suite, frontend build/bundle checks, and the market Playwright suite.
- After deployment, run `market_seed_catalog --enable-buckets=components,structures` so existing operator-disabled buckets remain untouched; verify category counts and a successful collector run before announcing release.
