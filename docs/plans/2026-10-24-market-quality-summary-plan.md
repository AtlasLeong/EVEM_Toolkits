# Static Dark Quality Summary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the public expanded quality explanation while retaining a dark, static, honest quality summary.

**Architecture:** Narrow changes to MarketQualitySummary.jsx and its dedicated stylesheet. Preserve existing query/age/count utilities and all backend contracts. Update obsolete disclosure UI tests into static-summary and responsive regressions.

**Tech Stack:** React, existing console CSS tokens, Node tests, Playwright/Vite.

---

## Task 1: Lock the new public UI contract (test first)

Files: `front-codex/tests/e2e/specs/market-quality.spec.js` and
`front-codex/tests/e2e/specs/market-quality-visual.spec.js` (desktop/phone visual acceptance).

1. Run existing frontend units and the quality browser suite as a clean baseline.
2. Replace now-obsolete expanded-card/time/Escape assertions with visible quality
   numbers, no disclosure/details/summary/region, dark console token styling,
   non-interactive cursor/focus and no expansion on click.
3. Preserve 320/375px signed-in layout, 768px/200% text (signed in and public),
   four-digit count cases, age/no-fetch, rollback/remount, refresh-failure cached
   results, zero inventory and unavailable assertions. Failure is a visible
   short role=status message even without an expanded panel.
4. Run focused new static/dark/failure assertions and observe real assertion
   failures against unchanged production code, not test setup or syntax errors.

## Task 2: Minimal component and stylesheet change

Files: `front-codex/src/components/MarketQualitySummary.jsx`,
`front-codex/src/styles/market-quality.css`.

1. Change `details/summary` to an ordinary labelled group. Retain existing count
   and monotonic-age calls. Delete the body, disclosure, Escape handler and
   timestamp/collector-only imports/function.
2. Keep title, numerator/denominator and percentage as inline summary content;
   when query.isError with cached counts, include a brief visible status and
   warning class. Initial failures/loading and zero coverage retain wording.
3. Replace dedicated light colors with console tokens, 40px minimum height,
   existing control radius, wrap-safe spacing, muted label and accent percentage.
   Keep existing <=1179px action wrapping and <=767px full-row behavior. Delete
   CSS used solely by the removed disclosure, without touching global styles.
4. Run the updated quality suite to green and inspect desktop/phone screenshots.

## Task 3: Independent review and completion

1. Run `node --test tests/unit/*.test.mjs`, `npm run build` and related quality,
   Market collection-health/capacity/public-page browser regressions. Use the
   existing local mock API, never production collection endpoints.
2. Review generated screenshots at desktop/phone widths; verify enlarged text
   and cached-refresh warning do not overflow or hide sibling controls.
3. Request independent requirements/quality review; fix material issues and rerun.
4. `git diff --check`; verify only scoped component/style/test/docs changed, commit
   explicit files on `codex/market-quality-summary-20261024`. Preserve unrelated
   untracked artifacts and user work. Do not push/merge/deploy without a new
   release request. Report actual tests and show the preview when helpful.

## Execution evidence

- Reused this task's attached isolated worktree; clean runtime baseline equals
  `origin/master` (`0fb8ba166`). Existing unrelated untracked artifacts retained.
- Before code changes: all 751 frontend units and all 14 original quality
  browser tests passed. The approved interaction change deliberately retires
  disclosure-only card/timestamp/Escape assertions, not freshness logic tests.
- RED: unchanged component failed the new `tagName !== DETAILS` assertion and
  the independent visual `summary` count=0 assertion; retained metric visibility
  passed before both failures. GREEN: 19 updated quality/visual browsers and all
  751 frontend units passed. Production build and bundle budget also passed.
- The browser cutoff case uses a quote ten seconds inside the boundary to avoid
  response/render millisecond drift; the existing unit still covers strict
  equality at exactly two hours. No production freshness algorithm changed.
- Final relevant regression: `npx playwright test market dark-console
  console-unification --workers=2` passed all 175 tests. Independent reviewer
  separately passed 19 quality/visual browsers and 17 quality/API/polling units,
  inspected desktop/mobile/enlarged-text screenshots and found no issues.
- Root visually inspected desktop/mobile headers and 320px/200% text. Only the
  component and its dedicated CSS change production behavior; backend, query,
  age/count utilities and polling files are byte-identical to the base.
- Completed as tested local branch; no remote push, PR, merge, production call
  or deployment was performed for this UI request. Existing private artifacts
  remain untracked and were not included in commits.
