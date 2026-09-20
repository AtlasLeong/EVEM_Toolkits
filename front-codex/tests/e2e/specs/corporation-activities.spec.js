import { test, expect } from "@playwright/test";
import {
  communityFixture,
  corporation,
  corpContent,
} from "../helpers/community";
import { json } from "../helpers/api";

test("招募信息同一行的下拉框与输入框等高对齐", async ({ page }) => {
  await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("button", { name: "招募信息", exact: true }).click();
  const select = page.locator(
    'summary[aria-label^="招募状态："] .filter-value',
  );
  const input = page.getByRole("textbox", { name: "活跃时间", exact: true });
  await expect(select).toBeVisible();
  const first = await select.boundingBox(),
    second = await input.boundingBox();
  expect(first.height).toBe(second.height);
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
});

test("主要活动按1500个Unicode字符计数而非UTF16长度", async ({ page }) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  const overview = page.getByRole("textbox", {
    name: "主要活动介绍",
    exact: true,
  });
  await overview.fill("🚀".repeat(1500));
  await expect(overview).toHaveValue("🚀".repeat(1500));
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect([...posts.at(-1).body.activity_description]).toHaveLength(1500);
  await overview.fill("航".repeat(1501));
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText("1500");
  expect(posts).toHaveLength(1);
});

test("手机自定义标签支持输入法、数量限制和删除，无横向溢出", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  const input = page.getByRole("textbox", {
    name: "自定义活动标签",
    exact: true,
  });
  await input.fill("反收割");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  await expect(input).toHaveValue("反收割");
  await expect(
    page.getByRole("button", { name: "移除标签：反收割" }),
  ).toHaveCount(0);
  await input.press("Enter");
  await input.fill("一二三四五六七八九十十一二");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("12");
  for (const tag of ["小队游猎", "运输护航", "新人教学", "舰队补给"]) {
    await input.fill(tag);
    await input.press("Enter");
  }
  await expect(input).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "添加标签", exact: true }),
  ).toBeDisabled();
  const editor = page.locator(".corp-custom-tags-editor");
  await expect(editor).toContainText("5 / 5");
  await page.getByRole("button", { name: "移除标签：舰队补给" }).click();
  await expect(input).toBeEnabled();
  expect(posts).toHaveLength(0);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/corp-activity-tags-mobile.png",
  });
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  const overview = page.getByRole("textbox", {
    name: "主要活动介绍",
    exact: true,
  });
  expect((await overview.boundingBox()).height).toBeGreaterThanOrEqual(180);
  await overview.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/corp-activity-overview-mobile.png",
  });
});

test("保存会包含尚未按添加的标签，同时不回写只读旧活动原文", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page
    .getByRole("textbox", { name: "自定义活动标签", exact: true })
    .fill("驻地防御");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  const payload = posts.at(-1).body;
  expect(payload.custom_activity_tags).toEqual(["驻地防御"]);
  expect(payload.activity_description).toBe("");
  for (const key of [
    "event_title",
    "event_time",
    "event_location",
    "event_description",
    "activity_content_kind",
  ])
    expect(payload).not.toHaveProperty(key);
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  await page.getByText("查看旧版活动资料", { exact: true }).click();
  await expect(page.locator(".corp-legacy-activity")).toContainText(
    corpContent.event_title,
  );
});

test("审核中主要活动和自定义标签均只读", async ({ page }) => {
  await communityFixture(page, { auth: true, pending: true });
  await page.route("**/api/community/corporations/1/manage/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        is_listed: true,
        can_edit: true,
        published_revision: corporation.revision,
        working_revision: {
          ...corpContent,
          id: 11,
          status: "pending",
          version: 2,
          custom_activity_tags: ["反收割"],
          activity_description: "主要开展反收割",
          activity_content_kind: "overview",
        },
      }),
    ),
  );
  await page.goto("/corporations/manage?id=1");
  await expect(
    page.getByRole("textbox", { name: "自定义活动标签", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "移除标签：反收割" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "海盗作战", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "主要活动介绍", exact: true }),
  ).toBeDisabled();
});

test("公开页展示完整新活动，卡片收纳标签，清空介绍不复活旧活动", async ({
  page,
}) => {
  await communityFixture(page);
  let description = "主权战与反收割，欢迎各类飞行员参与。";
  const revised = () => ({
    ...corporation,
    revision: {
      ...corpContent,
      activity_description: description,
      activity_content_kind: "overview",
      activities: [
        "sovereignty_production",
        "pirate_combat",
        "pve",
        "industry",
        "training",
      ],
      custom_activity_tags: ["反收割", "小队游猎"],
    },
  });
  await page.route("**/api/community/corporations/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/community/corporations/")
      return route.fulfill(json({ count: 1, results: [revised()] }));
    if (url.pathname === "/api/community/corporations/1/")
      return route.fulfill(json(revised()));
    return route.fallback();
  });
  await page.goto("/corporations");
  const tags = page
    .locator(".corp-card")
    .getByLabel("活动方向标签", { exact: true });
  await expect(tags.locator("span")).toHaveCount(5);
  await expect(tags).toContainText("+3");
  await page.getByRole("link", { name: /远航者军团/ }).click();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
  await expect(page.getByLabel("活动方向标签", { exact: true })).toContainText(
    "反收割",
  );
  await expect(
    page.getByText(corpContent.event_title, { exact: true }),
  ).toHaveCount(0);
  description = "";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "关于军团", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "主要活动", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(corpContent.event_title, { exact: true }),
  ).toHaveCount(0);
});
