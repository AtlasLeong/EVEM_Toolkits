# Market Components and Structures Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add all tradeable component items and the 16 requested faction structure items to the market catalog, UI categories, and scheduled collection without increasing collector concurrency.

**Architecture:** Extend the existing taxonomy with `components` and `structures` buckets. Components are classified by the official component subcategory while excluding blueprint category rows; structures use an explicit 16-ID allowlist. Seed/API/UI behavior stays data-driven, and production enablement is incremental.

**Tech Stack:** Django/Python, JSON catalog, React/Vite frontend, Playwright, GitHub Actions/systemd deployment.

---

### Task 1: Add failing taxonomy and seed tests

**Files:**
- Modify: `backend/Market/tests/test_taxonomy.py`
- Modify: `backend/Market/tests/test_seed_catalog.py`
- Modify: `backend/Market/tests/test_api.py`
- Modify: `backend/Market/tests/test_terminal_api.py`

**Step 1: Write the failing tests**

Assert that a representative drone, flagship, construction, advanced, and personal-citadel component classify as `components`; a component blueprint remains `other`; all 16 requested structure IDs classify as `structures`; an unrequested damaged structure remains `other`; and category endpoints expose the new labels/counts.

**Step 2: Run the focused tests to verify failure**

Run `python manage.py test Market.tests.test_taxonomy Market.tests.test_seed_catalog Market.tests.test_api Market.tests.test_terminal_api --settings=EVE_MDjango.ci_settings --noinput`.

Expected: failures because the new bucket constants/classification do not exist.

**Step 3: Commit the red tests**

`git add backend/Market/tests && git commit -m "test: define component and structure market buckets"`

### Task 2: Implement taxonomy and seed support

**Files:**
- Modify: `backend/Market/taxonomy.py`
- Modify: `backend/Market/management/commands/market_seed_catalog.py`
- Modify: `docs/market-prices.md`

**Step 1: Add minimal implementation**

Add `BUCKET_COMPONENTS`, `BUCKET_STRUCTURES`, labels, the component subcategory constant, and the explicit 16 structure IDs. Classify components only when `subcategory_id=1200050` and `category_id != 1700`; classify structures only when the item ID is in the allowlist. Add both buckets to `PRIMARY_BUCKETS`, `BUCKET_CHOICES`, and the seed command help.

**Step 2: Run the focused tests to verify green**

Run the Task 1 command and expect all focused tests to pass.

**Step 3: Commit**

`git add backend/Market/taxonomy.py backend/Market/management/commands/market_seed_catalog.py docs/market-prices.md && git commit -m "feat: add component and structure market buckets"`

### Task 3: Cover the catalog and frontend category contract

**Files:**
- Modify: `backend/Market/tests/test_seed_catalog.py`
- Modify: `front-codex/tests/e2e/specs/market.spec.js`

**Step 1: Write/extend failing contract checks**

Use the real catalog to assert 58 non-blueprint component rows and 16 allowlisted structure rows, and assert the UI renders both category labels with counts from the API.

**Step 2: Run the checks**

Run the focused Django tests and `npm run test:e2e -- tests/e2e/specs/market.spec.js --project=chromium --workers=1` from `front-codex`.

**Step 3: Adjust only fixtures/selectors needed for the new contract and commit**

`git add backend/Market/tests/test_seed_catalog.py front-codex/tests/e2e/specs/market.spec.js && git commit -m "test: cover component and structure catalog counts"`

### Task 4: Run full verification and prepare release

**Files:**
- Modify: `docs/market-prices.md` if operational wording needs alignment.

**Step 1: Run backend verification**

`python manage.py test Market --settings=EVE_MDjango.ci_settings --noinput`

`python manage.py makemigrations Market --check --dry-run --settings=EVE_MDjango.ci_settings`

**Step 2: Run frontend verification**

From `front-codex`, run `npm run build`, `npm run check:bundle`, and the market Playwright suite with one worker.

**Step 3: Inspect the diff**

Run `git diff origin/master..HEAD --check` and verify no secrets/session files are present.

**Step 4: Commit release-ready changes**

`git status --short --branch && git log --oneline -5`

### Task 5: Merge, deploy, and incrementally enable

**Step 1: Merge and push**

Fast-forward/update the deployment checkout, merge `codex/market-components-structures` into `master`, and push `origin master`.

**Step 2: Wait for CI publish**

If the collector lock blocks publish, wait for the short-lived collector run to finish and safely retry the same publish workflow.

**Step 3: Enable only the new buckets in production**

Run `python manage.py market_seed_catalog --enable-buckets=components,structures` on the deployed release. Do not use the all-bucket command, so existing operator-disabled categories remain unchanged.

**Step 4: Verify production**

Check `/deploy-version.json`, category counts (58 components, 16 structures), blueprint exclusion, collector status, and at least one successful run containing the new items.
