# Community Corporation Poster Backgrounds Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add six selectable Canvas poster backgrounds and expose validated corporation type, security-region, alliance, and welfare metadata across editing, public pages, and exported posters.

**Architecture:** Keep the existing immutable `Revision.content` JSON contract and approval flow. Add server-side enum/list normalization and a backward-compatible public serializer, then pass the normalized content into a deterministic Canvas background renderer; the poster background picker is independent from the existing recruitment/introduction/event layout selector.

**Tech Stack:** Django REST Framework, Django tests, React, Vite, CSS, Canvas 2D, Playwright, Node `node:test` poster unit tests.

---

### Task 1: Extend and validate the revision content contract

**Files:**
- Modify: `backend/Community/views.py:29-110,340-378`
- Test: `backend/Community/tests.py`

**Step 1: Write the failing backend tests**

Add tests for:

- default revisions returning empty `corp_types`, `region_tags`, `benefit_keys`, blank `benefits_note`, and `deep-space` as the background;
- accepting the allowed type/region/benefit/background keys with duplicate removal only where the API contract explicitly permits it;
- rejecting unknown keys, duplicate values, more than two corporation types, more than three region tags, more than eight welfare presets, and overlong `benefits_note`;
- returning the new fields in approved public data while preserving the legacy `benefits` string;
- reading a pre-feature revision without any new keys and falling back safely.

**Step 2: Run the focused tests to verify failure**

Run:

```powershell
python manage.py test Community.tests --settings=EVE_MDjango.ci_settings --noinput
```

Expected: the new contract tests fail because the fields and validation do not exist yet.

**Step 3: Implement the smallest backend contract**

In `views.py`:

- define allow-lists for `CORP_TYPES`, `REGION_TAGS`, `BENEFIT_KEYS`, and `POSTER_BACKGROUNDS`;
- add the keys to `CONTENT_FIELDS` and `default_content()`;
- update `revision_data()` so both private and approved public serializers return only normalized, supported values;
- add a reusable list validator used by `updated_content()` to enforce list type, maximum length, allowed values, and duplicates;
- validate `benefits_note` as optional text with a bounded length;
- preserve `benefits` unchanged for existing drafts and old approved revisions;
- keep `activity_keys` behavior unchanged and do not add a migration.

**Step 4: Run the focused tests to verify success**

Run the same command. Expected: all Community tests pass.

**Step 5: Commit**

```powershell
git add backend/Community/views.py backend/Community/tests.py
git commit -m "feat(community): validate corporation tags and poster backgrounds"
```

### Task 2: Add structured metadata controls to the corporation editor

**Files:**
- Modify: `front-codex/src/pages/CorporationManage.jsx:1-80,330-590,640-665`
- Modify: `front-codex/src/services/apiCommunity.js`
- Modify: `front-codex/src/styles/corporations.css`
- Test: `front-codex/tests/e2e/helpers/community.js`
- Test: `front-codex/tests/e2e/specs/corporations.spec.js`

**Step 1: Write the failing editor E2E tests**

Extend the fixture revision with the new fields and add tests that:

- show type, region, welfare, alliance, and background controls for an editable draft;
- select multiple tags and welfare presets, enter a welfare note, choose a background, save, reload, and observe the values preserved;
- prevent over-selection in the UI and keep chips wrapping without horizontal overflow;
- leave pending/approved revisions read-only.

**Step 2: Run the focused browser tests to verify failure**

Run:

```powershell
$env:VITE_API_URL='/api'; npx playwright test tests/e2e/specs/corporations.spec.js --workers=1
```

Expected: the new controls cannot be found or persisted.

**Step 3: Implement the editor controls**

- Add shared option definitions for type, region, welfare, and background labels.
- Extend `contentFromRevision()` and `payloadFromForm()` with the new arrays, note, and background key while defaulting missing values.
- Add accessible checkbox/chip groups with `aria-pressed`/labels and visible selected states; enforce the same client limits as the backend without relying on them for security.
- Keep `alliance` as the existing text field and add help text explaining that it is the current alliance affiliation.
- Pass an `onBackgroundChange` callback from `DraftEditor` to `PosterStudio` so a background thumbnail selection updates the draft form and is saved with the next revision patch.
- Add responsive wrapping styles for chips and welfare rows; do not change existing form spacing outside the new sections.

**Step 4: Run the focused browser tests to verify success**

Run the same Playwright command. Expected: the new editor tests pass with no mobile horizontal overflow.

**Step 5: Commit**

```powershell
git add front-codex/src/pages/CorporationManage.jsx front-codex/src/services/apiCommunity.js front-codex/src/styles/corporations.css front-codex/tests/e2e/helpers/community.js front-codex/tests/e2e/specs/corporations.spec.js
git commit -m "feat(community): add corporation tags and welfare editor"
```

### Task 3: Show the new metadata on public directory and detail pages

**Files:**
- Modify: `front-codex/src/pages/Corporations.jsx`
- Modify: `front-codex/src/styles/corporations.css`
- Test: `front-codex/tests/e2e/specs/corporations.spec.js`
- Test: `front-codex/tests/preview/community.mjs`

**Step 1: Write the failing public-page tests**

Assert that directory cards show a bounded summary of type/region tags, detail pages show all tags, alliance, and welfare chips, and legacy content with no arrays still renders its old benefits text.

**Step 2: Run the focused tests to verify failure**

Run the corporation Playwright spec again. Expected: the new labels are absent.

**Step 3: Implement public rendering**

- Add small reusable label maps and render type/region tags as text-bearing badges.
- Show no more than two summary tags in cards, with a `+N` overflow label; show complete lists on the detail page.
- Render welfare presets as chips followed by `benefits_note` and the legacy free-text benefits fallback.
- Keep alliance in the existing detail metadata block and add a stable empty state.
- Add narrow-screen wrapping rules and verify no card or panel gains horizontal overflow.

**Step 4: Run the focused tests to verify success**

Expected: directory, detail, legacy fallback, and mobile assertions pass.

**Step 5: Commit**

```powershell
git add front-codex/src/pages/Corporations.jsx front-codex/src/styles/corporations.css front-codex/tests/e2e/specs/corporations.spec.js front-codex/tests/preview/community.mjs
git commit -m "feat(community): show corporation metadata publicly"
```

### Task 4: Build deterministic selectable Canvas backgrounds

**Files:**
- Modify: `front-codex/src/utils/corporationPoster.js`
- Modify: `front-codex/src/components/community/PosterStudio.jsx`
- Modify: `front-codex/src/styles/corporations.css`
- Test: `front-codex/tests/unit/corporationPoster.test.mjs`

**Step 1: Write the failing unit tests**

Add tests that:

- expose exactly six background keys and labels;
- draw every background into a 1080×1440 canvas without throwing;
- use the same background key and content to produce deterministic drawing calls;
- include type, region, welfare, and alliance text in poster drawing inputs without allowing content to escape its bounds;
- fall back to `deep-space` for an unknown key.

**Step 2: Run the poster unit tests to verify failure**

Run:

```powershell
node --test tests/unit/corporationPoster.test.mjs
```

Expected: the background registry and drawing behavior are missing.

**Step 3: Implement the renderer and picker**

- Add `POSTER_BACKGROUNDS` and a pure `drawPosterBackground(ctx, background, template)` function.
- Use deterministic geometry (seeded star/particle positions, gradients, arcs, grid lines, scan lines, and a contrast overlay) rather than random calls or remote assets.
- Keep the existing content template selector; add a separate thumbnail selector labeled “海报背景”.
- Read `content.poster_background` as the default, allow an optional `onBackgroundChange` callback for editable drafts, and keep public/review previews locally selectable when no callback is supplied.
- Add compact badge helpers for type, region, welfare, and alliance; cap visible poster chips and use a localized overflow label.
- Preserve the existing image decoding, export lock, unapproved watermark, and filename behavior.

**Step 4: Run the poster unit tests to verify success**

Run the same Node test command. Expected: all poster tests pass.

**Step 5: Commit**

```powershell
git add front-codex/src/utils/corporationPoster.js front-codex/src/components/community/PosterStudio.jsx front-codex/src/styles/corporations.css front-codex/tests/unit/corporationPoster.test.mjs
git commit -m "feat(community): add selectable poster backgrounds"
```

### Task 5: Full regression, visual QA, and handoff evidence

**Files:**
- Modify: `docs/plans/2026-09-20-community-corp-poster-backgrounds-design.md` (record evidence only)
- Test: existing backend and frontend test suites

**Step 1: Run backend regression and migration checks**

```powershell
python manage.py test Community Feedback License ActivationCode TacticalBoard EVE_MDjango.tests_deployment --settings=EVE_MDjango.ci_settings --noinput
python manage.py makemigrations Community Feedback --check --dry-run --settings=EVE_MDjango.ci_settings
```

Expected: all existing backend tests pass and no migration is generated.

**Step 2: Run frontend unit, build, and full E2E tests**

```powershell
node --test tests/unit/corporationPoster.test.mjs
npm run build
$env:VITE_API_URL='/api'; npx playwright test --workers=1
```

Expected: poster tests pass, Vite build succeeds, and the complete Community regression remains green with only existing bundle-size warnings if present.

**Step 3: Run local visual QA**

Use the isolated Community preview to capture desktop and mobile screenshots of the editor, public detail, each background selector, and at least one exported poster. Check text contrast, chip wrapping, image fallbacks, and no horizontal overflow.

**Step 4: Record evidence and commit**

Update the design document with dated test counts, build result, and screenshot paths. Commit only tracked source/docs changes; leave generated `.playwright-cli/` and `output/` artifacts untracked.

```powershell
git add docs/plans/2026-09-20-community-corp-poster-backgrounds-design.md
git commit -m "test(community): verify poster background and metadata rollout"
```

Do not merge, push, migrate production, or deploy until the user explicitly requests release after reviewing the screenshots.
