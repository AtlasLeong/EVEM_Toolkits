# Single-row market statistics

The user approved a compact single-row statistics strip and a larger plot area. This is local frontend work only; no push or deployment is authorized in this iteration.

## Display contract

- Keep the five statistics in their existing order: current, selected-window high/low, month high/low. Each metric has its label above its value; all five metric groups occupy one horizontal row, never 3+2 or 2+2+1.
- Preserve compact 万/亿/万亿 formatting, full-price titles and accessible exact values. Keep readable type at least 12px; no ellipsis or hidden values.
- Use content-minimum columns, distributing spare width evenly. If a narrow panel or a very long value cannot fit, scroll only the statistics strip horizontally. The last metric must be reachable by pointer/touch and keyboard with a visible focus outline. Do not cause document overflow or intercept arrow keys outside the strip.
- Remove repeated observation counts inside each chart header; retain the existing top-level count and loading indicator. Keep buy/sell headings and color coding.
- Reduce excess horizontal padding in the central panel. Let the plot flex into height released by the single-row statistics, retaining axis readability, tooltip containment and the desktop outer frame.
- Preserve both/sell-only/buy-only modes, right-hand quote cards and five-level ladders, catalog, request behavior, freshness, empty values and short-screen scrolling.

## Verification

Reproduce the current 480px container-query wrap before modifying production code. Browser tests cover aligned metric y positions, regular and extreme values, no truncation, keyboard access to the last metric on small screens, full-width single-side plots, recovered plot height, and no whole-page horizontal overflow. Reuse the existing market and shell regressions. Inspect desktop and mobile screenshots; run unit/preview tests and a production build.
