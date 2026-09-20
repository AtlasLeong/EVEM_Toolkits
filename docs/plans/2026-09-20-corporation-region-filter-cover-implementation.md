# 军团星域筛选与顶部封面优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-backed activity-region filtering to the public corporation directory and compact the corporation detail page's top cover without changing existing content or production data.

**Architecture:** Reuse the existing StarField region endpoint for the filter options and add a validated `region` query parameter to the public Community list endpoint. Filter the published revision JSON `base_region` field server-side so pagination remains correct and old free-text revisions remain compatible. Adjust only the detail cover CSS dimensions and responsive overlap spacing.

**Tech Stack:** Django REST Framework, Django tests, React Query, React, CSS, Playwright E2E, Vite.

---

### Task 1: Lock the backend region-filter contract with tests

**Files:**
- Modify: `backend/Community/tests.py`
- Modify: `backend/Community/views.py:273-289`

**Step 1: Write failing backend tests**

Extend the existing public corporation list tests with a published revision whose `base_region` is `德里克` and activity is `pvp`. Assert:

- `GET corporations/?region=德里克` returns the matching corporation.
- `GET corporations/?region=德` also matches the same corporation.
- `GET corporations/?region=德里克&activity=pvp` still matches.
- an unknown region returns an empty result without changing the response shape.
- an empty `region` leaves the existing unfiltered behavior unchanged.
- a region query longer than 80 characters returns HTTP 400.

Run:

```powershell
python manage.py test Community.tests --settings=EVE_MDjango.ci_settings --noinput
```

Expected: the new region assertions fail because the endpoint ignores `region`.

**Step 2: Implement the minimal server filter**

In `CorporationList.get`:

- read and strip `region` from query params;
- reject values longer than 80 with the existing DRF `ValidationError` style;
- when present, filter `published_revision__content__base_region__icontains=region` after applying `listed()`;
- keep `q`, `activity`, ordering, pagination, and response serialization unchanged.

**Step 3: Run the focused backend tests**

```powershell
python manage.py test Community.tests --settings=EVE_MDjango.ci_settings --noinput
```

Expected: all Community tests pass.

**Step 4: Commit the backend contract**

```powershell
git add backend/Community/views.py backend/Community/tests.py
git commit -m "feat(community): filter corporations by region"
```

### Task 2: Add the region selector to the corporation directory

**Files:**
- Modify: `front-codex/src/services/apiCommunity.js`
- Modify: `front-codex/src/pages/Corporations.jsx`
- Modify: `front-codex/src/styles/corporations.css`
- Modify: `front-codex/tests/preview/fixtures.mjs`
- Modify: `front-codex/tests/e2e/helpers/community.js`
- Modify: `front-codex/tests/e2e/specs/corporations.spec.js`

**Step 1: Write failing E2E coverage**

Add a test that:

- sees a combobox labeled `活动星域` next to the existing activity selector;
- chooses `德里克`, observes the request query include `region=德里克`, and sees the matching card;
- combines the region and activity filters;
- clears the region and returns to the unfiltered result count;
- keeps the controls aligned and free of horizontal overflow at desktop and 390px widths.

Update the local community fixture to recognize the new `region` query and return a distinct result set for the selected region.

Run:

```powershell
$env:VITE_API_URL='/api'; npx playwright test tests/e2e/specs/corporations.spec.js --workers=1
```

Expected: the new locator/request assertions fail because the selector and parameter do not exist.

**Step 2: Implement the selector and query state**

- Export `getRegionList` through the Community service boundary or add a small Community-specific wrapper using the existing `/regions` endpoint.
- Load region options with React Query under a stable key such as `community-regions`.
- Add `region` state to `CorporationsPage` and include it in the list query key and `listCorporations` params.
- Put the new native select before the activity select, label it `活动星域`, and reset `page` to 1 on change.
- Keep the selector usable if the region catalog is loading; if it fails, disable it and show a short title/aria hint without breaking search.
- Update empty-state wording to consider `region` a filter.
- Add a CSS grid column and mobile wrapping rule that preserves the existing button alignment.

**Step 3: Run focused E2E coverage**

```powershell
$env:VITE_API_URL='/api'; npx playwright test tests/e2e/specs/corporations.spec.js --workers=1
```

Expected: all corporation directory tests pass, including the new region filter.

**Step 4: Commit the directory filter**

```powershell
git add front-codex/src/services/apiCommunity.js front-codex/src/pages/Corporations.jsx front-codex/src/styles/corporations.css front-codex/tests/preview/fixtures.mjs front-codex/tests/e2e/helpers/community.js front-codex/tests/e2e/specs/corporations.spec.js
git commit -m "feat(community): add public region selector"
```

### Task 3: Compact the corporation detail cover

**Files:**
- Modify: `front-codex/src/styles/corporations.css:338-390,1220-1245`
- Modify: `front-codex/tests/e2e/specs/corporations.spec.js`

**Step 1: Add layout assertions**

Add desktop and mobile assertions for `/corporations/1` that measure `.corp-profile-cover` height and verify the page scroll width does not exceed the viewport.

Run the focused test and confirm the height assertion fails against the current 220px/180px values.

**Step 2: Implement compact dimensions**

- Set the desktop `.corp-profile-cover` height to 160px.
- Set its mobile height to 128px and reduce padding proportionally.
- Adjust `.corp-profile-heading` negative margin and mobile Logo offset only as needed to keep the Logo visibly overlapping the cover without clipping.
- Leave `.corp-card-cover` and poster canvas dimensions unchanged.

**Step 3: Run focused responsive tests**

```powershell
$env:VITE_API_URL='/api'; npx playwright test tests/e2e/specs/corporations.spec.js tests/e2e/specs/responsive-tools.spec.js --workers=1
```

Expected: cover measurements and all existing responsive assertions pass.

**Step 4: Commit the cover adjustment**

```powershell
git add front-codex/src/styles/corporations.css front-codex/tests/e2e/specs/corporations.spec.js
git commit -m "style(community): compact corporation profile cover"
```

### Task 4: Full verification and local handoff

**Step 1: Run backend regression and migration check**

```powershell
python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput
python manage.py makemigrations Community Feedback --check --dry-run --settings=EVE_MDjango.ci_settings
```

Expected: all backend tests pass and no migration changes are detected.

**Step 2: Run frontend tests and build**

```powershell
node --test tests/unit/corporationPoster.test.mjs
npm run build
$env:VITE_API_URL='/api'; npx playwright test --workers=1
```

Expected: poster unit tests, Vite build, and complete E2E suite pass.

**Step 3: Run visual QA**

Start the isolated preview server with `PREVIEW_PORT=4190 npm run preview:ui`, inspect the corporation directory and detail page at desktop and 390px widths, and capture screenshots only in the untracked output directory.

**Step 4: Record evidence**

Update the design doc with final test counts and preview paths. Do not merge, push, deploy, or touch production until the user explicitly requests release.

