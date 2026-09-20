import { test, expect } from "@playwright/test";
import { communityFixture, corporation } from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

test("军团大厅公开浏览与详情，访客无私有管理资料", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations");
  await expect(
    page.getByRole("heading", { name: "军团大厅", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /远航者军团/ }).click();
  await expect(
    page.getByRole("heading", { name: "远航者军团", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("游戏内联系：远航招募官", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "审核管理", exact: true }),
  ).toHaveCount(0);
});

test("空态与错误态区分，错误可以重试", async ({ page }) => {
  await communityFixture(page, { fails: true });
  await page.goto("/corporations");
  await expect(page.getByRole("alert")).toContainText("军团数据暂时不可用");
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  await expect(page.getByText("还没有公开的军团")).toHaveCount(0);
});

test("游客我的军团入口提示登录", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/manage");
  await expect(
    page.getByRole("link", { name: "登录后管理军团" }),
  ).toBeVisible();
  await expect(page.getByLabel("申请说明")).toHaveCount(0);
});

test("军团搜索框、下拉框与按钮在桌面等高对齐", async ({ page }) => {
  await communityFixture(page);
  await page.goto('/corporations');
  const controls = [page.locator('.corp-search-input'), page.getByRole('combobox', { name: '活动方向' }), page.getByRole('button', { name: '查找军团' })];
  for (const control of controls) await expect(control).toBeVisible();
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  expect(Math.max(...boxes.map(box => box.height)) - Math.min(...boxes.map(box => box.height))).toBeLessThanOrEqual(1);
  expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThanOrEqual(1);
});

test("创建申请携带唯一请求号，说明与验证联系方式为私有", async ({ page }) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage");
  await page
    .getByRole("button", { name: "申请创建 / 认领", exact: true })
    .click();
  await page.getByLabel("军团名称", { exact: true }).fill("曙光军团");
  await page.getByLabel("军团简称", { exact: true }).fill("DAWN");
  await page
    .getByLabel("申请说明", { exact: true })
    .fill("我是军团负责人，角色名：曙光。");
  await page
    .getByLabel("验证联系方式", { exact: true })
    .fill("游戏内联系：曙光");
  await page.getByRole("button", { name: "提交申请", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("申请已提交");
  expect(posts[0].body.request_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(posts[0].body.statement).toContain("军团负责人");
});

test("编辑草稿并提交审核，等待期间不能再编辑", async ({ page }) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page.getByLabel("军团口号", { exact: true }).fill("一起驶向更远的星海");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(
    page.getByText("审核中，公开页面仍展示上次通过的版本。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toHaveCount(0);
  expect(posts.some((p) => p.body.tagline === "一起驶向更远的星海")).toBe(true);
  expect(posts.some((p) => p.path.endsWith("/submit/"))).toBe(true);
});

test("草稿海报始终标记未审核，三个模板可以导出真实 PNG", async ({ page }) => {
  await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await expect(page.getByText("未审核 · 仅作预览")).toBeVisible();
  for (const label of ["招募海报", "军团介绍", "活动宣传"]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(1080);
    expect(bytes.readUInt32BE(20)).toBe(1440);
  }
});

test("管理员审核申请必须看到说明，通过后待审列表刷新", async ({ page }) => {
  const { decisions } = await communityFixture(page, {
    auth: true,
    staff: true,
  });
  await page.goto("/corporations/review");
  await page.getByRole("button", { name: /新星军团/ }).click();
  await expect(
    page.getByText("我是军团管理者，可以游戏内验证。"),
  ).toBeVisible();
  await page.getByLabel("审核意见", { exact: true }).fill("已在游戏内核实。");
  await page.getByRole("button", { name: "批准申请", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("审核已完成");
  expect(decisions[0].decision).toBe("approve");
});

test("手机军团页面与编辑器没有横向溢出", async ({ page }) => {
  await communityFixture(page, { auth: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/corporations",
    "/corporations/1",
    "/corporations/manage?id=1",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(path.split("?")[0]));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".loading-bar")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("海报图片临时加载失败后重试会重新请求图片", async ({ page }) => {
  await communityFixture(page);
  let recovered = false;
  await page.route("**/api/community/corporations/1/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        logo_url: "/api/community/corporations/1/media/7/",
      }),
    ),
  );
  await page.route("**/api/community/corporations/1/media/7/", (route) =>
    route.fulfill(
      recovered
        ? {
            status: 200,
            contentType: "image/png",
            body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
          }
        : json({ detail: "图片暂时不可用" }, 503),
    ),
  );
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: /制作海报/ }).click();
  const studio = page.getByRole("region", { name: "海报工作台" });
  await expect(studio.getByRole("alert")).toContainText("图片暂时不可用");
  recovered = true;
  await studio.getByRole("button", { name: "重新加载" }).click();
  await expect(studio.getByRole("button", { name: "导出 PNG" })).toBeEnabled();
  await expect(studio.getByRole("alert")).toHaveCount(0);
});

test("上传图片期间禁止保存提交和切换表单，完成后关联上传结果", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/community/corporations/1/media/", async (route) => {
    await gate;
    await route.fulfill(
      json({ id: 7, private_url: "/api/community/media/7/private/" }, 201),
    );
  });
  await page.route("**/api/community/media/7/private/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    }),
  );
  await page.goto("/corporations/manage?id=1");
  await page
    .getByLabel("上传军团徽标")
    .setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    });
  try {
    await expect(page.getByText("上传中…", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "提交审核", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "保存草稿", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "招募信息", exact: true }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.getByText("图片已上传，请保存草稿。")).toBeVisible();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(posts.at(-1).body.logo_asset_id).toBe(7);
});
