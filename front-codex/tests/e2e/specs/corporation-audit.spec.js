import { test, expect } from "@playwright/test";
import { communityFixture, corporation, corpContent } from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

const claim = (id) => ({
  id,
  corporation: { id, name: `待审军团 ${id}`, short_name: `C${id}` },
  statement: `管理说明 ${id}`,
  contact: "游戏内联系",
  status: "pending",
});

test("审核最后一页后列表自动回到仍有记录的有效页", async ({ page }) => {
  await communityFixture(page, { auth: true, staff: true });
  let count = 21;
  const pages = [];
  await page.route("**/api/community/reviews/?*", (route) => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get("page"));
    pages.push(currentPage);
    const start = (currentPage - 1) * 20;
    return route.fulfill(json({
      count,
      results: Array.from({ length: Math.max(0, Math.min(20, count - start)) }, (_, i) => claim(start + i + 1)),
    }));
  });
  await page.route("**/api/community/reviews/claims/21/", route => route.fulfill(json(claim(21))));
  await page.route("**/api/community/reviews/claims/21/decision/", route => {
    count = 20;
    return route.fulfill(json({ id: 21, status: "approved" }));
  });
  await page.goto("/corporations/review");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByRole("button", { name: /待审军团 21/ }).click();
  await page.getByRole("button", { name: "批准申请", exact: true }).click();
  await expect(page.locator(".corp-review-list button")).toHaveCount(20);
  expect(pages.at(-1)).toBe(1);
});

test("旧审核请求完成不关闭后来选择的另一条审核详情", async ({ page }) => {
  await communityFixture(page, { auth: true, staff: true });
  let approved = false;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/api/community/reviews/?*", route => route.fulfill(json({
    count: approved ? 1 : 2,
    results: approved ? [claim(2)] : [claim(1), claim(2)],
  })));
  await page.route(/\/api\/community\/reviews\/claims\/[12]\/$/, route => {
    const id = Number(route.request().url().split("/").at(-2));
    return route.fulfill(json(claim(id)));
  });
  let decisionStarted = false;
  await page.route("**/api/community/reviews/claims/1/decision/", async route => {
    decisionStarted = true;
    await gate;
    approved = true;
    await route.fulfill(json({ id: 1, status: "approved" }));
  });
  await page.goto("/corporations/review");
  await page.getByRole("button", { name: /待审军团 1/ }).click();
  await page.getByRole("button", { name: "批准申请", exact: true }).click();
  await expect.poll(() => decisionStarted).toBe(true);
  await page.getByRole("button", { name: /待审军团 2/ }).click();
  await expect(page.locator(".corp-review-detail")).toContainText("管理说明 2");
  await page.getByRole("textbox", { name: "审核意见", exact: true }).fill("正在核查第二条");
  release();
  await expect(page.locator(".corp-review-list button")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "审核意见", exact: true })).toHaveValue("正在核查第二条");
});

test("图片失败重试不能在保存草稿期间发起新上传", async ({ page }) => {
  await communityFixture(page, { auth: true });
  let uploads = 0;
  await page.route("**/api/community/corporations/1/media/", route => {
    uploads++;
    return route.fulfill(json({ detail: "模拟上传失败" }, 503));
  });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let saveStarted = false;
  await page.route("**/api/community/revisions/11/", async route => {
    saveStarted = true;
    await gate;
    await route.fulfill(json({ ...corpContent, ...route.request().postDataJSON(), id: 11, status: "draft", version: 2 }));
  });
  await page.goto("/corporations/manage?id=1");
  await page.getByLabel("上传军团封面").setInputFiles({
    name: "cover.png", mimeType: "image/png", buffer: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  });
  const field = page.locator(".corp-media-field").last();
  await expect(field.getByRole("alert")).toContainText("模拟上传失败");
  await expect(field.getByRole("button", { name: "重新加载", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => saveStarted).toBe(true);
  await expect(field.getByRole("button", { name: "重新加载", exact: true })).toHaveCount(0);
  expect(uploads).toBe(1);
  release();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await expect(field.getByRole("button", { name: "重新加载", exact: true })).toBeEnabled();
});

test("军团大厅仅获取临近视口的上传图片，滚动后再加载远处卡片", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await communityFixture(page);
  const requests = new Set();
  await page.route(url => url.pathname === "/api/community/corporations/", route => route.fulfill(json({
    count: 20,
    results: Array.from({ length: 20 }, (_, i) => ({
      ...corporation,
      id: i + 1,
      name: `图片军团 ${i + 1}`,
      logo_url: `/api/community/corporations/${i + 1}/media/1/`,
      cover_url: `/api/community/corporations/${i + 1}/media/2/`,
    })),
  })));
  await page.route(/\/api\/community\/corporations\/\d+\/media\/[12]\/$/, route => {
    requests.add(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(TINY_ICON.split(",")[1], "base64") });
  });
  await page.goto("/corporations");
  await expect(page.locator(".corp-card")).toHaveCount(20);
  await expect(page.locator(".corp-card").first().locator(".corp-cover-surface")).toHaveAttribute("data-cover-kind", "custom");
  expect([...requests]).not.toContain("/api/community/corporations/20/media/1/");
  expect([...requests]).not.toContain("/api/community/corporations/20/media/2/");
  const initialRequests = requests.size;
  await page.locator(".corp-card").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".corp-card").last().locator(".corp-cover-surface")).toHaveAttribute("data-cover-kind", "custom");
  expect([...requests]).toContain("/api/community/corporations/20/media/1/");
  await test.info().attach("image-request-counts", {
    body: JSON.stringify({ totalPossible: 40, initialRequests, afterLastCardScroll: requests.size }),
    contentType: "application/json",
  });
});

test("缺少 IntersectionObserver 时军团上传图片仍可正常加载", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
  });
  await communityFixture(page);
  await page.route(url => url.pathname === "/api/community/corporations/", route => route.fulfill(json({
    count: 1,
    results: [{
      ...corporation,
      logo_url: "/api/community/corporations/1/media/1/",
      cover_url: "/api/community/corporations/1/media/2/",
    }],
  })));
  await page.route(/\/api\/community\/corporations\/1\/media\/[12]\/$/, route => route.fulfill({
    status: 200, contentType: "image/png", body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  }));
  await page.goto("/corporations");
  await expect(page.locator(".corp-card .corp-cover-surface")).toHaveAttribute("data-cover-kind", "custom");
  await expect(page.locator("img.corp-card-logo")).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => page.locator("img.corp-card-logo").evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

for (const operation of ["create", "withdraw"]) {
  test(`${operation} 成功后即使管理页重取失败也采用已确认的版本`, async ({ page }) => {
    await communityFixture(page, { auth: true });
    const revision = { ...corpContent, id: 11, version: 7, status: operation === "create" ? "approved" : "pending" };
    const nextRevision = { ...revision, id: operation === "create" ? 12 : 11, version: operation === "create" ? 1 : 8, status: operation === "create" ? "draft" : "withdrawn" };
    const saves = [];
    await page.route(/\/api\/community\/revisions\/(11|12)\/$/, route => {
      const body = route.request().postDataJSON();
      saves.push({ path: new URL(route.request().url()).pathname, method: route.request().method(), body });
      return route.fulfill(json({ ...nextRevision, ...body, version: nextRevision.version + 1 }));
    });
    let mutated = false;
    await page.route("**/api/community/corporations/1/manage/", route => route.fulfill(mutated
      ? json({ detail: "模拟后续读取失败" }, 503)
      : json({ ...corporation, can_edit: true, is_listed: true, working_revision: revision })));
    await page.route(operation === "create"
      ? "**/api/community/corporations/1/draft/"
      : "**/api/community/revisions/11/withdraw/", route => {
      mutated = true;
      return route.fulfill(json(nextRevision));
    });
    await page.goto("/corporations/manage?id=1");
    await page.getByRole("button", { name: operation === "create" ? "创建新版草稿" : "撤回审核", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("模拟后续读取失败");
    await expect(page.getByRole("button", { name: operation === "create" ? "保存草稿" : "创建新版草稿", exact: true })).toBeEnabled();
    await expect(page.locator(".corp-editor-heading .corp-status")).toHaveText(operation === "create" ? "草稿" : "已撤回");
    if (operation === "create") {
      await page.getByRole("textbox", { name: "军团口号", exact: true }).fill("新草稿继续保存");
      await page.getByRole("button", { name: "保存草稿", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("草稿已保存");
      expect(saves).toEqual([{
        path: "/api/community/revisions/12/",
        method: "PATCH",
        body: expect.objectContaining({ expected_version: 1, tagline: "新草稿继续保存" }),
      }]);
    }
  });
}
