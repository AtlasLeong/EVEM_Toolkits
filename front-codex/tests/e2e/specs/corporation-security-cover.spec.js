import { test, expect } from "@playwright/test";
import { communityFixture, corporation } from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

const location = {
  region_id: "derelik",
  region_name: "德里克",
  region_security: 0.5,
  constellation_id: "11",
  constellation_name: "卡纳德",
  constellation_security: 0,
  solarsystem_id: "21",
  solarsystem_name: "纳卡",
  solarsystem_security: -0.22,
  security: -0.22,
};
const choose = async (page, label, name) => {
  await page.locator(`summary[aria-label^="${label}："]`).click();
  await page.getByRole("radio", { name, exact: true }).check();
};
const badges = (page, label) =>
  page.locator(`summary[aria-label^="${label}："] .corp-security`);

test("目录中的非数字类型不转换成零安或高安", async ({ page }) => {
  await communityFixture(page);
  await page.route("**/api/regions", (route) =>
    route.fulfill(
      json([
        { r_id: "bad-false", r_title: "错误布尔", r_safetylvl: false },
        { r_id: "bad-true", r_title: "错误真值", r_safetylvl: true },
        { r_id: "bad-array", r_title: "错误数组", r_safetylvl: [] },
        { r_id: "bad-object", r_title: "错误对象", r_safetylvl: {} },
        { r_id: "bad-hex", r_title: "错误进制", r_safetylvl: "0x10" },
        { r_id: "zero", r_title: "真实零安", r_safetylvl: "0.00" },
      ]),
    ),
  );
  await page.goto("/corporations");
  await page.locator('summary[aria-label^="活动星域："]').click();
  await expect(page.locator(".corp-select-options .corp-security")).toHaveText([
    "0.00",
  ]);
  await page.getByRole("radio", { name: "错误布尔", exact: true }).check();
  await expect(badges(page, "活动星域")).toHaveCount(0);
});

test("军团卡片与星域筛选的选中状态显示星域自身安等", async ({ page }) => {
  await communityFixture(page);
  await page.route(
    (url) => url.pathname === "/api/community/corporations/",
    (route) =>
      route.fulfill(
        json({
          count: 1,
          results: [
            {
              ...corporation,
              revision: { ...corporation.revision, base_location: location },
            },
          ],
        }),
      ),
  );
  await page.goto("/corporations");
  await expect(page.locator(".corp-card-meta .corp-security")).toHaveText(
    "0.50",
  );
  await choose(page, "活动星域", "德里克");
  await expect(badges(page, "活动星域")).toHaveText("0.50");
});

test("星域星座星系选中值与驻地摘要分别显示安等，切换上级清空旧值", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.route("**/api/constellations?*", (route) =>
    route.fulfill(json([{ co_id: "11", co_title: "卡纳德", co_safetylvl: 0 }])),
  );
  await page.route("**/api/solarsystem?*", (route) =>
    route.fulfill(
      json([{ ss_id: "21", ss_title: "纳卡", ss_safetylvl: -0.22 }]),
    ),
  );
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("button", { name: "关联星图驻地", exact: true }).click();
  await choose(page, "驻地星域", "德里克");
  await expect(badges(page, "驻地星域")).toHaveText("0.50");
  await choose(page, "驻地星座", "卡纳德");
  await expect(badges(page, "驻地星座")).toHaveText("0.00");
  await choose(page, "驻地星系", "纳卡");
  await expect(badges(page, "驻地星系")).toHaveText("-0.22");
  await expect(page.locator(".corp-location-label .corp-security")).toHaveText([
    "0.50",
    "0.00",
    "-0.22",
  ]);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(posts.at(-1).body.base_location).toEqual({
    region_id: "derelik",
    constellation_id: "11",
    solarsystem_id: "21",
  });
  await choose(page, "驻地星域", "伏尔戈");
  await expect(badges(page, "驻地星域")).toHaveText("0.59");
  await expect(badges(page, "驻地星座")).toHaveCount(0);
  await expect(badges(page, "驻地星系")).toHaveCount(0);
  await expect(page.locator(".corp-location-label .corp-security")).toHaveText([
    "0.59",
  ]);
});

test("公开驻地各层显示各自安等，旧数据不冒充祖先安等且缺失不填零", async ({
  page,
}) => {
  await communityFixture(page);
  let snapshot = location;
  await page.route("**/api/community/corporations/1/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        revision: { ...corporation.revision, base_location: snapshot },
      }),
    ),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/corporations/1");
    await expect(page.locator(".corp-facts .corp-security")).toHaveText([
      "0.50",
      "0.00",
      "-0.22",
    ]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const {
    region_security,
    constellation_security,
    solarsystem_security,
    ...legacy
  } = location;
  snapshot = legacy;
  await page.reload();
  await expect(page.locator(".corp-facts .corp-security")).toHaveText([
    "-0.22",
  ]);
  snapshot = {
    ...location,
    region_security: null,
    constellation_security: true,
    solarsystem_security: null,
  };
  await page.reload();
  await expect(page.locator(".corp-facts .corp-location-label")).toContainText(
    "纳卡",
  );
  await expect(page.locator(".corp-facts .corp-security")).toHaveCount(0);
});

test("目录加载失败时保留已保存的三级名称和安等", async ({ page }) => {
  await communityFixture(page, { auth: true });
  await page.route("**/api/community/corporations/1/manage/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        can_edit: true,
        working_revision: {
          ...corporation.revision,
          id: 11,
          status: "draft",
          base_location: location,
        },
      }),
    ),
  );
  for (const url of [
    "**/api/regions",
    "**/api/constellations?*",
    "**/api/solarsystem?*",
  ]) {
    await page.route(url, (route) =>
      route.fulfill(json({ detail: "unavailable" }, 503)),
    );
  }
  await page.goto("/corporations/manage?id=1");
  for (const [label, name, security] of [
    ["驻地星域", "德里克", "0.50"],
    ["驻地星座", "卡纳德", "0.00"],
    ["驻地星系", "纳卡", "-0.22"],
  ]) {
    const control = page.locator(`summary[aria-label^="${label}："]`);
    await expect(control).toContainText(name);
    await expect(badges(page, label)).toHaveText(security);
    await expect(control).toHaveAttribute("aria-disabled", "true");
  }
});

test("未上传封面显示实际默认图与提示，上传后消失，移除后恢复", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.route("**/api/community/corporations/1/media/", (route) =>
    route.fulfill(
      json({ id: 7, private_url: "/api/community/media/7/private/" }, 201),
    ),
  );
  await page.route("**/api/community/media/7/private/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    }),
  );
  await page.goto("/corporations/1");
  const key = await page
    .locator(".corp-cover-surface")
    .getAttribute("data-cover-key");
  await expect(
    page.getByText("当前使用默认封面，上传图片后可替换", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/corporations/manage?id=1");
  const field = page
    .locator(".corp-media-field")
    .filter({ has: page.getByLabel("上传军团封面") });
  const hint = field.getByText("当前使用默认封面，上传图片后可替换", {
    exact: true,
  });
  const cover = field.locator(".corp-cover-surface");
  await expect(hint).toBeVisible();
  const uploadButtons = page.locator(".corp-media-field .corp-file-label");
  const logoButton = await uploadButtons.nth(0).boundingBox();
  const coverButton = await uploadButtons.nth(1).boundingBox();
  expect(Math.abs(logoButton.y - coverButton.y)).toBeLessThanOrEqual(1);
  await expect(cover).toHaveAttribute("data-cover-key", key);
  await expect
    .poll(() =>
      cover
        .locator(".corp-cover-default")
        .evaluate((el) => el.complete && el.naturalWidth > 0),
    )
    .toBe(true);
  await expect(
    page
      .locator(".corp-media-field")
      .filter({ has: page.getByLabel("上传军团徽标") })
      .getByText(/默认封面/),
  ).toHaveCount(0);
  await page.getByLabel("上传军团封面").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  });
  await expect(field.getByText("图片已上传，请保存草稿。")).toBeVisible();
  await expect(hint).toHaveCount(0);
  await expect(field.locator("img[src^='blob:']")).toBeVisible();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(posts.at(-1).body.cover_asset_id).toBe(7);
  await field.getByRole("button", { name: "移除图片", exact: true }).click();
  await expect(hint).toBeVisible();
  await expect(cover).toHaveAttribute("data-cover-key", key);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(hint).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => posts.at(-1).body.cover_asset_id).toBeNull();
});
