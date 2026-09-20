import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

test("军团编辑表单具有可读高度并保存主要活动与自定义标签", async ({ page }) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  const intro = page.getByRole("textbox", { name: "军团介绍", exact: true });
  await expect(intro).toBeVisible();
  expect((await intro.boundingBox()).height).toBeGreaterThanOrEqual(180);
  await expect(
    page.getByRole("checkbox", { name: "主权生产", exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "海盗作战", exact: true }).check();
  const tagInput = page.getByRole("textbox", {
    name: "自定义活动标签",
    exact: true,
  });
  await tagInput.fill("反收割");
  await tagInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "移除标签：反收割", exact: true }),
  ).toBeVisible();
  expect(posts).toHaveLength(0);
  await tagInput.fill("反收割");
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("重复");
  await tagInput.fill("小队游猎");
  await page.getByRole("button", { name: "添加标签", exact: true }).click();
  await page
    .getByRole("button", { name: "移除标签：小队游猎", exact: true })
    .click();
  await page.getByRole("button", { name: "招募信息", exact: true }).click();
  const support = page.getByRole("textbox", { name: "军团支持", exact: true });
  expect((await support.boundingBox()).height).toBeGreaterThanOrEqual(140);
  await support.fill("新人指导 · 舰船补损\n共享工业设施 · 定期舰队活动");
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  const overview = page.getByRole("textbox", {
    name: "主要活动介绍",
    exact: true,
  });
  expect((await overview.boundingBox()).height).toBeGreaterThanOrEqual(180);
  await overview.fill("主权战与反收割，日常开展生产协作。");
  await expect(
    page.getByRole("textbox", { name: "活动时间", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(posts.at(-1).body.activity_description).toBe(
    "主权战与反收割，日常开展生产协作。",
  );
  expect(posts.at(-1).body.custom_activity_tags).toEqual(["反收割"]);
  expect(posts.at(-1).body.activities).toEqual(
    expect.arrayContaining(["pvp", "pirate_combat"]),
  );
  expect(posts.at(-1).body).not.toHaveProperty("activity_content_kind");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "移除标签：反收割", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "主要活动", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "主要活动介绍", exact: true }),
  ).toHaveValue("主权战与反收割，日常开展生产协作。");
});
import { communityFixture, corporation } from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

const selectChoice = async (page, label, choice) => {
  await page.locator(`summary[aria-label^="${label}："]`).click();
  await page.getByRole("radio", { name: choice, exact: true }).check();
};

test("分享军团复制干净链接，失败时提供可选择的地址", async ({ page }) => {
  await communityFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
      configurable: true,
    });
  });
  await page.goto("/corporations/1?previewRole=user#private");
  await page.getByRole("button", { name: "分享军团", exact: true }).click();
  await expect(page.getByLabel("军团分享链接", { exact: true })).toHaveValue(
    "http://127.0.0.1:4173/corporations/1",
  );
  await expect(page.getByText(/自动复制未成功/)).toBeVisible();
});

test("海报以独立弹窗打开，不挤压详情且关闭后恢复焦点", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/1");
  const main = page.locator(".corp-detail-layout");
  await expect(main).toBeVisible();
  const before = await main.boundingBox();
  const trigger = page.getByRole("button", { name: "制作海报", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: /海报/ })).toBeVisible();
  expect(
    Math.abs((await main.boundingBox()).width - before.width),
  ).toBeLessThan(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("军团目录选择器支持搜索、空白点击和键盘关闭，导航留白紧凑", async ({
  page,
}) => {
  await communityFixture(page);
  await page.goto("/corporations");
  const nav = await page.locator(".corp-nav").boundingBox();
  const intro = await page.locator(".corp-directory-intro").boundingBox();
  expect(intro.y - nav.y - nav.height).toBeLessThanOrEqual(20);
  const trigger = page.locator('summary[aria-label^="活动星域："]');
  await trigger.click();
  await page
    .getByRole("textbox", { name: "搜索活动星域", exact: true })
    .fill("德里");
  await expect(
    page.getByRole("radio", { name: "德里克", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "伏尔戈", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("radiogroup", { name: "活动星域", exact: true })
    .click({ position: { x: 3, y: 3 } });
  await expect(
    page.getByRole("heading", { name: "军团大厅", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("驻地关联星域星座星系，只提交标识并在切换上级后清理下级", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.route("**/api/constellations?*", (route) =>
    route.fulfill(json([{ co_id: 11, co_title: "卡纳德", co_safetylvl: 0.2 }])),
  );
  await page.route("**/api/solarsystem?*", (route) =>
    route.fulfill(json([{ ss_id: 21, ss_title: "纳卡", ss_safetylvl: 0.1 }])),
  );
  await page.goto("/corporations/manage?id=1");
  await expect(page.getByText(/已有驻地文字：德里克/)).toBeVisible();
  await page.getByRole("button", { name: "关联星图驻地", exact: true }).click();
  await selectChoice(page, "驻地星域", "德里克");
  await selectChoice(page, "驻地星座", "卡纳德");
  await selectChoice(page, "驻地星系", "纳卡");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(posts.at(-1).body.base_location).toEqual({
    region_id: "derelik",
    constellation_id: "11",
    solarsystem_id: "21",
  });
  await selectChoice(page, "驻地星域", "伏尔戈");
  await expect(page.locator('summary[aria-label^="驻地星座："]')).toContainText(
    "全部星座",
  );
  await expect(
    page.locator('summary[aria-label^="驻地星系："]'),
  ).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect
    .poll(() => posts.at(-1).body.base_location)
    .toEqual({
      region_id: "volgo",
      constellation_id: null,
      solarsystem_id: null,
    });
  await page.getByRole("button", { name: "清除关联驻地", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => posts.at(-1).body.base_location).toBeNull();
});

test("目录缺失中文名和安等时不崩溃、不伪造零安，旧驻地文字仍可编辑", async ({
  page,
}) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.route("**/api/regions", (route) =>
    route.fulfill(
      json([
        {
          r_id: "fallback",
          r_title: null,
          r_titleen: "Unknown Frontier",
          r_safetylvl: null,
        },
      ]),
    ),
  );
  await page.goto("/corporations");
  await page.locator('summary[aria-label^="活动星域："]').click();
  await expect(
    page.getByRole("radio", { name: "Unknown Frontier", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".corp-select-options .corp-security")).toHaveCount(
    0,
  );
  await page.goto("/corporations/manage?id=1");
  await page
    .getByLabel("原驻地说明", { exact: true })
    .fill("德里克边境，具体星系请联系招募官");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect
    .poll(() => posts.at(-1)?.body.base_region)
    .toBe("德里克边境，具体星系请联系招募官");
});

test("军团目录星域加载失败可重试，搜索无结果有明确提示", async ({ page }) => {
  await communityFixture(page);
  let recovered = false;
  await page.route("**/api/regions", (route) =>
    route.fulfill(
      recovered
        ? json([{ r_id: "derelik", r_title: "德里克", r_safetylvl: 0.5 }])
        : json({ detail: "unavailable" }, 503),
    ),
  );
  await page.goto("/corporations");
  const trigger = page.locator('summary[aria-label^="活动星域："]');
  await expect(trigger).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByRole("alert")).toContainText("星域目录暂时不可用");
  recovered = true;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-disabled", "false");
  await trigger.click();
  await page
    .getByRole("textbox", { name: "搜索活动星域", exact: true })
    .fill("不存在的星域");
  await expect(
    page.getByText("没有匹配选项，试试其他名称。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "搜索活动星域", exact: true })
    .fill("");
  await page.getByRole("radio", { name: "德里克", exact: true }).check();
  await expect(trigger).toBeFocused();
});

test("审核中的驻地字段不可编辑，未上架军团不提供公开分享", async ({ page }) => {
  await communityFixture(page, { auth: true, pending: true });
  await page.route("**/api/community/corporations/1/manage/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        can_edit: true,
        is_listed: false,
        published_revision: corporation.revision,
        working_revision: {
          ...corporation.revision,
          id: 11,
          status: "pending",
          base_location: {
            region_id: "derelik",
            constellation_id: null,
            solarsystem_id: null,
            region_name: "德里克",
            security: 0.5,
          },
        },
      }),
    ),
  );
  await page.goto("/corporations/manage?id=1");
  await expect(
    page.locator('summary[aria-label^="驻地星域："]'),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(
    page.getByRole("button", { name: "清除关联驻地", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "分享军团", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "查看公开主页", exact: true }),
  ).toHaveCount(0);
});

test("公开详情展示星域星座星系及安等，复制链接不包含预览参数", async ({
  page,
}) => {
  await communityFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text) => {
          window.copiedCorporationLink = text;
        },
      },
      configurable: true,
    });
  });
  await page.route("**/api/community/corporations/1/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        revision: {
          ...corporation.revision,
          base_location: {
            region_id: "derelik",
            constellation_id: "11",
            solarsystem_id: "21",
            region_name: "德里克",
            constellation_name: "卡纳德",
            solarsystem_name: "纳卡",
            security: 0.1,
          },
        },
      }),
    ),
  );
  await page.goto("/corporations/1?previewRole=user");
  await expect(page.locator(".corp-facts")).toContainText(
    "德里克 / 卡纳德 / 纳卡",
  );
  await expect(page.locator(".corp-facts .corp-security")).toHaveText("0.10");
  await page.getByRole("button", { name: "分享军团", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.copiedCorporationLink))
    .toBe("http://127.0.0.1:4173/corporations/1");
  await expect(page.getByRole("status")).toContainText("本地链接仅本机可访问");
});

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

test("公开军团资料展示类型、区域、联盟与福利标签", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/1");
  for (const label of ["海盗", "低安", "00 地区", "舰船补损", "舰队培训"]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByText("新人有导师带队，定期发放舰队补给。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("远航联盟", { exact: true })).toBeVisible();
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
  await page.goto("/corporations");
  const controls = [
    page.locator(".corp-search-input"),
    page.locator('summary[aria-label^="活动星域："]'),
    page.locator('summary[aria-label^="活动方向："]'),
    page.getByRole("button", { name: "查找军团" }),
  ];
  for (const control of controls) await expect(control).toBeVisible();
  const boxes = await Promise.all(
    controls.map((control) => control.boundingBox()),
  );
  expect(
    Math.max(...boxes.map((box) => box.height)) -
      Math.min(...boxes.map((box) => box.height)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...boxes.map((box) => box.y)) -
      Math.min(...boxes.map((box) => box.y)),
  ).toBeLessThanOrEqual(1);
});

test("军团大厅可按活动星域筛选并与活动方向组合", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/community/corporations/")) {
      requests.push(new URL(request.url()).searchParams);
    }
  });
  await communityFixture(page);
  await page.goto("/corporations");
  const region = page.locator('summary[aria-label^="活动星域："]');
  await expect(region).toHaveAttribute("aria-disabled", "false");
  await selectChoice(page, "活动星域", "德里克");
  await expect(page.getByRole("link", { name: /远航者军团/ })).toBeVisible();
  await selectChoice(page, "活动方向", "海盗作战");
  await expect(page.getByText("筛选结果", { exact: true })).toBeVisible();
  const last = requests.at(-1);
  expect(last.get("region")).toBe("德里克");
  expect(last.get("activity")).toBe("pirate_combat");
  await selectChoice(page, "活动星域", "全部活动星域");
  await expect(page.getByText("1 个已公开军团", { exact: true })).toBeVisible();
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

test("编辑草稿可保存类型、区域、福利和海报背景选择", async ({ page }) => {
  const { posts } = await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("checkbox", { name: "主权", exact: true }).check();
  await page.getByRole("checkbox", { name: "高安" }).check();
  await page.getByRole("button", { name: "招募信息", exact: true }).click();
  await page.getByRole("checkbox", { name: "工业/生产支持" }).check();
  await page
    .locator('textarea[name="benefits_note"]')
    .fill("提供导师、补损和工业设施支持");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  await page.getByRole("button", { name: "星环巨行星", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  const payload = posts.at(-1).body;
  expect(payload.corp_types).toEqual(["pirate", "sovereignty"]);
  expect(payload.region_tags).toEqual(["lowsec", "nullsec", "highsec"]);
  expect(payload.benefit_keys).toEqual([
    "ship_reimbursement",
    "fleet_training",
    "industry_support",
  ]);
  expect(payload.benefits_note).toBe("提供导师、补损和工业设施支持");
  expect(payload.poster_background).toBe("ringed-planet");
});

test("草稿海报始终标记未审核，三个模板可以导出真实 PNG", async ({ page }) => {
  await communityFixture(page, { auth: true });
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  await expect(page.getByText("未审核 · 仅作预览")).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "制作军团海报" });
  for (const label of ["招募海报", "军团介绍", "主要活动"]) {
    await dialog.getByRole("button", { name: label, exact: true }).click();
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

test("军团详情顶部封面在桌面与手机端保持紧凑", async ({ page }) => {
  await communityFixture(page);
  await page.goto("/corporations/1");
  const desktopCover = page.locator(".corp-profile-cover");
  await expect(desktopCover).toBeVisible();
  expect((await desktopCover.boundingBox()).height).toBeLessThanOrEqual(162);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  expect((await desktopCover.boundingBox()).height).toBeLessThanOrEqual(130);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("海报图片临时加载失败后重试会重新请求图片", async ({ page }) => {
  await communityFixture(page);
  let recovered = false;
  let recoveredRequests = 0;
  // This case checks protected-media retry, not Vite static-file latency.
  // Serve the real bundled backdrop directly; artwork/export has its own suite.
  await page.route("**/posters/spiral-galaxy.webp", (route) =>
    route.fulfill({
      contentType: "image/webp",
      path: fileURLToPath(
        new URL(
          "../../../src/assets/corporations/posters/spiral-galaxy.webp",
          import.meta.url,
        ),
      ),
    }),
  );
  await page.route("**/api/community/corporations/1/", (route) =>
    route.fulfill(
      json({
        ...corporation,
        logo_url: "/api/community/corporations/1/media/7/",
      }),
    ),
  );
  await page.route("**/api/community/corporations/1/media/7/", (route) => {
    if (recovered) recoveredRequests += 1;
    return route.fulfill(
      recovered
        ? {
            status: 200,
            contentType: "image/png",
            body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
          }
        : json({ detail: "图片暂时不可用" }, 503),
    );
  });
  await page.goto("/corporations/1");
  await page.getByRole("button", { name: /制作海报/ }).click();
  const studio = page.getByRole("region", { name: "海报工作台" });
  await expect(studio.getByRole("alert")).toContainText("图片暂时不可用");
  recovered = true;
  await studio.getByRole("button", { name: "重新加载" }).click();
  await expect(studio.getByRole("button", { name: "导出 PNG" })).toBeEnabled();
  expect(recoveredRequests).toBeGreaterThan(0);
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
  await page.getByLabel("上传军团徽标").setInputFiles({
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
