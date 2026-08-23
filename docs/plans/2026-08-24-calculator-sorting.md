# 行星资源计算器表格排序实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为行星资源计算器明细表的 8 个数值列增加可访问的升序/降序排序，并保持现有编辑、计算、保存和删除逻辑不变。

**Architecture:** 在 `PlanetaryCalculatorModal` 内保存独立的 `sortConfig`，通过 `useMemo` 派生仅用于渲染的 `displayRows`。可排序表头使用现有 `sort-header` 样式和 Lucide 排序图标；原始 `rows` 继续作为计算和持久化数据源。

**Tech Stack:** React 18, React Router/Vite, Lucide React, Playwright, CSS

---

### Task 1: 编写计算器排序的失败用例

**Files:**
- Create: `front-codex/tests/e2e/specs/planetary-calculator-sorting.spec.js`
- Reference: `front-codex/tests/e2e/specs/planetary-more.spec.js`

**Step 1: Write the failing test**

复用行星资源 mock，打开计算器并选中两行，验证：

- 初始顺序保持接口返回顺序。
- 计算器表头只有 8 个指定数值列为排序按钮。
- 点击“产量”一次后低产量行在前，再点一次后高产量行在前。
- 点击“总价”按数值排序，而不是按格式化后的字符串排序。
- 排序后修改第一行的阵列数量，当前排序状态仍保留且行仍能正常编辑。

测试可使用如下核心辅助逻辑：

```js
async function openCalculatorWithTwoRows(page) {
  await installPlanetaryMultiMock(page)
  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '光彩合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('thead .table-check-trigger').click()
  await page.getByRole('button', { name: '加入计算器' }).click()
  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()
  return modal
}
```

表头断言使用 `modal.getByRole('button', { name: '产量' })` 等精确名称，并检查资源、星系、操作列没有排序按钮。

**Step 2: Run the test to verify it fails**

Run:

```powershell
cd front-codex
npx playwright test tests/e2e/specs/planetary-calculator-sorting.spec.js --project=chromium --workers=1
```

Expected: FAIL because the calculator headers are plain `<th>` text and no sort buttons exist.

**Step 3: Commit the failing test**

```powershell
git add front-codex/tests/e2e/specs/planetary-calculator-sorting.spec.js
git commit -m "test: specify calculator table sorting"
```

### Task 2: 实现计算器表格排序

**Files:**
- Modify: `front-codex/src/components/planetary/PlanetaryCalculatorModal.jsx`
- Test: `front-codex/tests/e2e/specs/planetary-calculator-sorting.spec.js`

**Step 1: Add sorting state and derived display rows**

Import `ArrowDownUp` and `ChevronUp` from `lucide-react` alongside the existing `ChevronDown` import. Add:

```jsx
const calculatorSortFields = {
  resource_yield: '产量',
  fuel_value: '单位热值',
  arrays_number: '阵列数量',
  computation_time: '计算时长',
  total_fuel: '总热值',
  total_output: '总产量',
  unit_price: '单价',
  total_price: '总价',
}
```

Inside `PlanetaryCalculatorModal`, initialize:

```jsx
const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' })
```

Derive `displayRows` with `useMemo`. If no key is selected, return `rows` unchanged. Otherwise sort indexed rows by `toNumber(row[key])`, use the original index as the tie-breaker, and reverse only for descending order. Add `toggleSort` and `renderSortIcon` helpers matching the existing `Planetary.jsx` interaction.

**Step 2: Make the 8 headers sortable**

Add a small `renderSortableHeader(key, label)` helper that returns a `<th>` containing a `<button type="button" className="sort-header" ...>`. Set `aria-label` to `${label}排序` and `aria-sort` on the `<th>` to `ascending`, `descending`, or `none`.

Use it for the 8 configured fields. Leave the resource, galaxy and operation `<th>` elements as plain headers.

**Step 3: Render `displayRows` instead of `rows`**

Change only the calculator table body mapping from `rows.map(...)` to `displayRows.map(...)`. Keep `updateRow(row.key, ...)`, `deleteRow(row.key)`, batch updates, totals, save and load operations bound to the existing `rows` state.

**Step 4: Run the focused test to verify it passes**

Run:

```powershell
cd front-codex
npx playwright test tests/e2e/specs/planetary-calculator-sorting.spec.js --project=chromium --workers=1
```

Expected: PASS.

**Step 5: Commit the implementation**

```powershell
git add front-codex/src/components/planetary/PlanetaryCalculatorModal.jsx
git commit -m "feat: add calculator table sorting"
```

### Task 3: 回归验证和构建

**Files:**
- Verify: `front-codex/src/components/planetary/PlanetaryCalculatorModal.jsx`
- Verify: `front-codex/tests/e2e/specs/planetary-calculator-sorting.spec.js`

**Step 1: Run calculator-related regression tests**

```powershell
cd front-codex
npx playwright test tests/e2e/specs/planetary-calculator-sorting.spec.js tests/e2e/specs/planetary-calculator-edge.spec.js tests/e2e/specs/planetary-calculator-guards.spec.js tests/e2e/specs/planetary-more.spec.js --project=chromium --workers=1
```

Expected: all selected tests pass.

**Step 2: Build the production frontend**

```powershell
npm run build
```

Expected: Vite exits with code 0.

**Step 3: Check diff and repository status**

```powershell
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; existing ZIP archives remain untracked and untouched.
