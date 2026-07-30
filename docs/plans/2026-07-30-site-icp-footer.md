# Global ICP Footer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display the correct ICP filing number and MIIT filing-homepage link in a shared footer on every `front-codex` route.

**Architecture:** Add a presentational `SiteFooter` component and render it once outside `Routes` in `App`. Wrap routed content and the footer in a flex column so short pages keep the footer at the viewport bottom while long pages push it below their content.

**Tech Stack:** React 18, React Router 6, CSS, Playwright, Vite

---

### Task 1: Specify the global filing footer behavior

**Files:**
- Create: `front-codex/tests/e2e/specs/site-footer.spec.js`

**Step 1: Write the failing test**

Create a Playwright test that checks both a shell route and the standalone login routes:

```js
import { test, expect } from '@playwright/test'

const ICP_NUMBER = '粤ICP备2024264329号'
const ICP_URL = 'https://beian.miit.gov.cn/'

test('all route layouts show the correct ICP filing link', async ({ page }) => {
  for (const path of ['/fraudlist', '/login', '/fraudlogin']) {
    await page.goto(path)

    const footer = page.getByRole('contentinfo')
    const filingLink = footer.getByRole('link', { name: ICP_NUMBER, exact: true })

    await expect(footer).toBeVisible()
    await expect(filingLink).toHaveAttribute('href', ICP_URL)
    await expect(filingLink).toHaveAttribute('target', '_blank')
    await expect(filingLink).toHaveAttribute('rel', 'noreferrer')
    await expect(page.getByText(`${ICP_NUMBER}-1`, { exact: true })).toHaveCount(0)
  }
})
```

**Step 2: Run the test to verify it fails**

Run:

```powershell
cd front-codex
npx playwright test tests/e2e/specs/site-footer.spec.js --project=chromium
```

Expected: FAIL because no `contentinfo` footer exists.

**Step 3: Commit the failing specification**

```powershell
git add front-codex/tests/e2e/specs/site-footer.spec.js
git commit -m "test: specify global ICP footer"
```

### Task 2: Add the shared footer component and global layout

**Files:**
- Create: `front-codex/src/components/layout/SiteFooter.jsx`
- Modify: `front-codex/src/App.jsx`
- Modify: `front-codex/src/styles.css`

**Step 1: Create the footer component**

Add `SiteFooter.jsx`:

```jsx
const ICP_NUMBER = '粤ICP备2024264329号'
const ICP_URL = 'https://beian.miit.gov.cn/'

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href={ICP_URL} target="_blank" rel="noreferrer">
        {ICP_NUMBER}
      </a>
    </footer>
  )
}
```

**Step 2: Render the footer once outside all routes**

Import `SiteFooter` in `App.jsx`. Replace the fragment returned by `App` with:

```jsx
<div className="site-frame">
  <ScrollToTop />
  <div className="site-content">
    <Routes>
      {/* keep all existing routes unchanged */}
    </Routes>
  </div>
  <SiteFooter />
</div>
```

This placement covers `AppShell`, `/login`, `/fraudlogin`, redirects, and future routes.

**Step 3: Add global footer layout and visual styles**

Add the following rules near the global layout styles in `styles.css`:

```css
.site-frame {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.site-content {
  min-height: 0;
  flex: 1 0 auto;
  display: flex;
  flex-direction: column;
}

.site-content > .app-shell,
.site-content > .login-screen,
.site-content > .desktop-only-mask {
  min-height: 0;
  flex: 1 0 auto;
}

.site-footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 14px 24px;
  border-top: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.82);
  color: var(--text-soft);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.site-footer a {
  transition: color 0.18s ease;
}

.site-footer a:hover,
.site-footer a:focus-visible {
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 3px;
}
```

Change the existing `.app-shell` and `.login-screen` `min-height` declarations from `100vh` to `100%` so they use the routed content area instead of forcing the footer below an extra full viewport.

**Step 4: Run the focused test**

Run:

```powershell
cd front-codex
npx playwright test tests/e2e/specs/site-footer.spec.js --project=chromium
```

Expected: PASS for all three representative routes.

**Step 5: Commit the implementation**

```powershell
git add front-codex/src/components/layout/SiteFooter.jsx front-codex/src/App.jsx front-codex/src/styles.css
git commit -m "feat: add global ICP filing footer"
```

### Task 3: Verify the production build and final diff

**Files:**
- Verify: `front-codex/src/components/layout/SiteFooter.jsx`
- Verify: `front-codex/src/App.jsx`
- Verify: `front-codex/src/styles.css`
- Verify: `front-codex/tests/e2e/specs/site-footer.spec.js`

**Step 1: Run the production build**

Run:

```powershell
cd front-codex
npm run build
```

Expected: Vite exits with code 0 and writes the production bundle to `front-codex/dist`.

**Step 2: Run a source-level filing check**

Run:

```powershell
rg -n -S "粤ICP备2024264329号|beian\\.miit\\.gov\\.cn|粤ICP备2024264329号-1" front-codex/src front-codex/tests/e2e/specs/site-footer.spec.js
```

Expected: the correct number and MIIT URL appear in the component and test; the obsolete `-1` value appears only in the negative test assertion.

**Step 3: Inspect repository status and diff**

Run:

```powershell
git status --short
git diff --check HEAD~2..HEAD
```

Expected: no whitespace errors; the pre-existing untracked ZIP archives remain untouched.

**Step 4: Commit the test if it is still uncommitted**

```powershell
git add front-codex/tests/e2e/specs/site-footer.spec.js
git commit -m "test: cover global ICP filing footer"
```
