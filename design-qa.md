# Dark console — staged implementation checkpoint

Scope: stage 1 navigation shell only. This is not acceptance of the full redesign and is not a deployable release approval.

## Evidence

- Source: `docs/design/dark-console-reference.png` (1487 × 1058).
- Implementation: `docs/design/phase1-shell.png` (1472 × 1047), captured with the in-app browser from the local worktree at `http://127.0.0.1:4180/planetary`.
- Requested CSS viewport: 1487 × 1058; browser screenshot is slightly rescaled. No pixel-perfect typography claim is made.
- Both images were opened together in a single comparison input, before and after the logo fix. Full-view comparison establishes overall scope differences; the readable sidebar region is the only stage-1 fidelity target.
- State differs: source is authenticated with search results and selected rows; local capture is guest, initial filters, no result selection. Full-page state-matched comparison is deferred until those business screens are redesigned. No real login or write action was used for visual checks.

## Findings and history

1. Resolved: original dark brand asset became nearly invisible against the dark sidebar. Added a light backing to the original image, then recaptured and reopened it with the reference. Brand silhouette is now visible without replacing the supplied asset.
2. Expected staged difference: existing light business pages remain inside `.page-stage`; filters, result density, calculator actions and page-specific typography are not yet migrated. This blocks full redesign acceptance, not the navigation-only checkpoint.
3. Follow-up: table-end accessibility at narrow desktop widths needs loaded-data visual evidence; document-level no-overflow assertions alone cannot prove absence of internal clipping.

## Required fidelity surfaces

- Typography: existing system Chinese font stack preserved; sidebar labels 14px and brand 19px fit without wrapping. Business typography remains pending.
- Layout: fixed 216px sidebar, vertical navigation, bottom account actions, separate workspace and footer. Existing business layout intentionally retained. Tests cover widths 1280/1440/1920, narrow-screen mask and 1280 × 400 authenticated account controls.
- Colors: console background #0b1117, sidebar #0d141b, cyan #18bfdc, dark primary foreground #07151d. Business colors remain isolated and unchanged.
- Images: supplied logo retained with light backing, existing resource images retained, existing Lucide icon library retained. No generated replacement assets or simulated product imagery.
- Copy: existing navigation/routes and account labels retained. Brand is now a semantic home link. Desktop-only message uses the real product name. ICP number and destination retained.

## Verification boundary

Browser interaction: brand link returns to fraud list. Automated tests cover keyboard home navigation, active link, guest/auth guards, logout, footer and screen widths. Full browser console/error and state-matched result-table visual QA remain for the business-page stages. Code reviewer found no blocking stage-1 issue; logo feedback was addressed and low-height test coverage added.

## Remaining implementation checklist

1. Migrate common forms/tables and business pages from legacy colors.
2. Compact planetary filters and implement prominent bulk-add action.
3. Migrate calculator, saved schemes, remaining routes and overlays.
4. Capture source-matched loaded/selected state, inspect console errors, complete full visual QA and regression.
5. Obtain explicit release authorization; do not push, merge, SSH or deploy as part of this task.

final result: blocked

Blocker applies to **full redesign handoff**: later staged business-page implementation and matched-state visual evidence are intentionally outstanding. Navigation-only implementation is available as a local progress checkpoint.
