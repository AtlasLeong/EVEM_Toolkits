import { test, expect } from "@playwright/test";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPUDWhiYGBgYmBgYGBgAAALyQEDGI7q3gAAAABJRU5ErkJggg==",
  "base64",
);
const roles = (page) =>
  page.getByRole("complementary", { name: "本地沙盒演示身份" });
async function chooseRole(page, label) {
  const bar = roles(page);
  if ((await bar.locator("details").getAttribute("open")) === null)
    await bar.locator("summary").click();
  await bar.getByRole("button", { name: label, exact: true }).click();
  await expect(bar.locator("#preview-current-role")).toContainText(
    label === "游客浏览" ? "游客" : label,
  );
}

test("real local preview supports UI login, claim review, edits, upload, withdrawal, publication and new revision", async ({
  page,
}) => {
  // Deliberately no route mocks and no localStorage auth pre-seeding.
  const external = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://127.0.0.1:4191/")
    )
      external.push(request.url());
  });
  await page.goto("/login");
  await expect(roles(page)).toContainText("无需注册或真实密码");
  await chooseRole(page, "演示军团管理员");
  await expect(page).toHaveURL(/\/corporations\/manage$/);
  await page
    .getByRole("button", { name: "申请创建 / 认领", exact: true })
    .click();
  const name = `本地流程军团-${Date.now()}`;
  await page.getByLabel("军团名称", { exact: true }).fill(name);
  await page.getByLabel("军团简称", { exact: true }).fill("SANDBOX");
  await page
    .getByLabel("申请说明", { exact: true })
    .fill("我是本地测试军团的管理者，仅用于功能验收。");
  await page.getByLabel("验证联系方式", { exact: true }).fill("私密沙盒联系");
  await page.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(page.getByText("申请已提交，请等待管理员核实。")).toBeVisible();
  await chooseRole(page, "游客浏览");
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: "output/corp-sandbox-default-covers.png",
    fullPage: false,
  });
  await chooseRole(page, "演示审核员");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByText("私密沙盒联系", { exact: true })).toBeVisible();
  await page.getByLabel("审核意见", { exact: true }).fill("本地核验通过");
  await page.getByRole("button", { name: "批准申请", exact: true }).click();
  await expect(page.getByText("审核已完成", { exact: true })).toBeVisible();
  await chooseRole(page, "演示军团管理员");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "创建资料草稿", exact: true }).click();
  await page.getByLabel("军团口号", { exact: true }).fill("从本地沙盒启航");
  await page
    .getByLabel("军团介绍", { exact: true })
    .fill("完整 UI 创建与编辑流程，只有审核后才能公开。");
  await page.getByLabel("所属联盟", { exact: true }).fill("本地联盟");
  await page.getByRole("checkbox", { name: "主权生产", exact: true }).check();
  await page.getByRole("checkbox", { name: "海盗作战", exact: true }).check();
  await page
    .getByRole("textbox", { name: "自定义活动标签", exact: true })
    .fill("反收割演练");
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page.getByLabel("上传军团封面", { exact: true }).setInputFiles({
    name: "sandbox-cover.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByText("图片已上传，请保存草稿。")).toBeVisible();
  await page.getByRole("button", { name: "招募信息", exact: true }).click();
  await page
    .getByLabel("公开联系方式", { exact: true })
    .fill("游戏内联系：沙盒管理员");
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  await page
    .getByRole("textbox", { name: "主要活动介绍", exact: true })
    .fill("主权战与反收割演练，周末组织生产协作。");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("草稿已保存", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("军团口号", { exact: true })).toHaveValue(
    "从本地沙盒启航",
  );
  await expect(
    page.getByRole("button", { name: "移除标签：反收割演练", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "output/corp-sandbox-manage-desktop.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(
    page.getByText("审核中，公开页面仍展示上次通过的版本。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤回审核", exact: true }).click();
  await page.getByRole("button", { name: "创建新版草稿", exact: true }).click();
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(
    page.getByText("审核中，公开页面仍展示上次通过的版本。"),
  ).toBeVisible();
  await chooseRole(page, "演示审核员");
  await page.getByRole("button", { name: "资料审核", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(
    page.getByText("完整 UI 创建与编辑流程，只有审核后才能公开。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".corp-review-fields")).toContainText(
    "主权战与反收割演练，周末组织生产协作。",
  );
  await expect(page.locator(".corp-review-fields")).toContainText("反收割演练");
  await page.getByRole("button", { name: "批准并发布", exact: true }).click();
  await expect(page.getByText("审核已完成", { exact: true })).toBeVisible();
  await chooseRole(page, "游客浏览");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByText("主权战与反收割演练，周末组织生产协作。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("活动方向标签", { exact: true })).toContainText(
    "反收割演练",
  );
  await expect(page.getByText("私密沙盒联系")).toHaveCount(0);
  await expect(page.locator(".corp-cover-upload.is-ready")).toBeVisible();
  await expect(
    page.locator(".corp-profile-cover [data-cover-kind]"),
  ).toHaveAttribute("data-cover-kind", "custom");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  await expect(dialog.getByRole("button", { name: /下载|导出/ })).toBeEnabled();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /下载|导出/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await dialog.getByRole("button", { name: "关闭海报制作" }).click();
  await chooseRole(page, "演示军团管理员");
  await page.goto("/corporations/review");
  await expect(
    page.getByText("此页面仅供管理员使用", { exact: true }),
  ).toBeVisible();
  await page.goto("/corporations/manage");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "创建新版草稿", exact: true }).click();
  const introduction = page.getByRole("textbox", {
    name: "军团介绍",
    exact: true,
  });
  await expect(introduction).toBeEnabled();
  await expect(introduction).toHaveValue(
    "完整 UI 创建与编辑流程，只有审核后才能公开。",
  );
  expect(external).toEqual([]);
});

test("mobile role entry stays usable and role switching preserves unrelated local storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await page.evaluate(() =>
    localStorage.setItem("sandbox-unrelated-preference", "keep"),
  );
  await chooseRole(page, "演示军团管理员");
  await chooseRole(page, "游客浏览");
  await page.screenshot({
    path: "output/corp-sandbox-mobile-entry.png",
    fullPage: false,
  });
  expect(
    await page.evaluate(() =>
      localStorage.getItem("sandbox-unrelated-preference"),
    ),
  ).toBe("keep");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.goto("/corporations/manage?previewRole=user");
  await expect(roles(page).locator("#preview-current-role")).toContainText(
    "演示军团管理员",
  );
  await expect(page).toHaveURL(/\/corporations\/manage$/);
});

test("preview toolbar does not overlap the expanded or collapsed desktop navigation and remains full-width on login and mobile", async ({
  page,
}) => {
  await page.goto("/login");
  const toolbar = roles(page);
  const loginRect = await toolbar.boundingBox();
  expect(loginRect.x).toBe(0);
  expect(loginRect.width).toBe(1440);
  await page.goto("/corporations");
  const sidebar = page.getByRole("complementary", {
    name: "工具导航",
    exact: true,
  });
  await expect(sidebar).toBeVisible();
  const expandedSidebar = await sidebar.boundingBox();
  const expandedToolbar = await toolbar.boundingBox();
  expect(expandedToolbar.x).toBeGreaterThanOrEqual(
    expandedSidebar.x + expandedSidebar.width - 0.5,
  );
  await page.getByRole("button", { name: "收起导航", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "展开导航", exact: true }),
  ).toBeVisible();
  const collapsedSidebar = await sidebar.boundingBox();
  const collapsedToolbar = await toolbar.boundingBox();
  expect(collapsedToolbar.x).toBeGreaterThanOrEqual(
    collapsedSidebar.x + collapsedSidebar.width - 0.5,
  );
  expect(collapsedToolbar.x).toBeLessThan(expandedToolbar.x);
  await page.screenshot({
    path: "output/corp-sandbox-toolbar-collapsed.png",
    fullPage: false,
  });
  await page.getByRole("button", { name: "展开导航", exact: true }).click();
  await page.screenshot({
    path: "output/corp-sandbox-toolbar-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileToolbar = await toolbar.boundingBox();
  expect(mobileToolbar.x).toBe(0);
  expect(mobileToolbar.width).toBe(390);
  await expect(sidebar).not.toBeVisible();
  const mobileHeader = await page.locator(".mobile-shell-header").boundingBox();
  expect(mobileHeader.y).toBeGreaterThanOrEqual(
    mobileToolbar.y + mobileToolbar.height - 0.5,
  );
  await expect(
    toolbar.getByRole("button", { name: "演示军团管理员", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "output/corp-sandbox-toolbar-mobile.png",
    fullPage: false,
  });
});

test("preview toolbar follows application logout and cross-tab auth changes", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await chooseRole(page, "演示军团管理员");
  await page.getByRole("button", { name: "退出", exact: true }).click();
  await expect(roles(page).locator("#preview-current-role")).toHaveText(
    "当前身份：游客",
  );
  await chooseRole(page, "演示军团管理员");
  const secondTab = await context.newPage();
  await secondTab.goto("/corporations");
  await expect(roles(secondTab).locator("#preview-current-role")).toContainText(
    "演示军团管理员",
  );
  await secondTab.getByRole("button", { name: "退出", exact: true }).click();
  await expect(roles(page).locator("#preview-current-role")).toHaveText(
    "当前身份：游客",
  );
  await secondTab.close();
});
