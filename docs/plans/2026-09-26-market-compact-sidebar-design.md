# Market compact statistics and order-book sidebar

Approved by the user on 2026-09-26: abbreviate chart statistics with 万/亿 and move the existing five-level order book into the right quote sidebar. Keep the framed dark terminal and independent buy/sell charts.

## Display contract

- Statistics use compact Chinese units without repeated ISK suffixes; the group declares ISK once. Values below 10,000 stay numeric. Larger values use 万/亿 (and 万亿 for extreme supported values), rounded to at most two decimals with trailing zeroes removed. Unit boundaries promote after rounding.
- Full original decimal strings remain available in native hover titles and screen-reader text. No floating-point conversion in the compact formatter. Missing/invalid statistics say 样本不足; zero is a valid price.
- Statistics reflow by available panel width rather than truncating numbers or reducing typography. Existing detailed readout, tooltip and order-book prices keep their exact values.
- Right sidebar order: current quote/change cards, separate sell-five/buy-five sections, last collection time and freshness. Empty book sides explicitly say 暂无挂单. No fake levels, quantities or history.
- Desktop keeps the inset single-screen terminal; central charts gain the former order-book height. Narrow screens stack sections and retain normal vertical access. Short desktop screens may scroll inside panels.

## Scope and verification

Frontend-only; no API, polling, database, collection or production deployment changes. Verify precision boundaries and missing values with Node unit tests; verify large-price rendering, keyboard/hover precision, no statistic clipping, sidebar placement and all five levels across desktop/tablet/mobile with Playwright. Review screenshots and run the frontend regression suite and production build before handoff.
