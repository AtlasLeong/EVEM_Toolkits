import { test, expect } from "@playwright/test";
import { createFakeJwt, seedAuthenticatedSession } from "../helpers/auth";
import { TINY_ICON } from "../helpers/api";

async function fixture(page, authenticated = true) {
  if (authenticated) await seedAuthenticatedSession(page, { user_id: 55 });
  const writes = [];
  let entry = {
    id: 1,
    author_name: "atlas123",
    is_listed: true,
    published_revision_id: null,
    revision: {
      id: 10,
      version: 1,
      status: "draft",
      content: {
        kind: "battle",
        title: "",
        body: "",
        occurred_at: null,
        location: null,
        corporation_id: null,
        images: [],
        battle: {
          sides: [
            { name: "A方", isk_loss: null, losses: [] },
            { name: "B方", isk_loss: null, losses: [] },
          ],
        },
      },
    },
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const body =
      route.request().method() === "GET"
        ? null
        : route
              .request()
              .headers()
              ["content-type"]?.includes("application/json")
          ? route.request().postDataJSON()
          : {};
    const json = (value) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (!path.includes("/starsea/")) return json({ results: [], count: 0 });
    if (path.endsWith("/capabilities/")) return json({ can_review: true });
    if (path.endsWith("/locations/"))
      return json({ results: [{ id: 1, name: "卡尼迪" }] });
    if (path.endsWith("/corporations/"))
      return json({ results: [{ id: 1, name: "远航军团" }] });
    if (path.endsWith("/ships/"))
      return json({
        results: [
          {
            id: 7,
            name: "灾难级",
            ship_class: "战列舰",
            source_version: "SWEET 218811",
          },
        ],
        count: 1,
        notice: "本地快照，不保证当前国服完整",
      });
    if (route.request().method() !== "GET") {
      writes.push({ path, body });
      if (body.content)
        entry = {
          ...entry,
          revision: {
            ...entry.revision,
            version: entry.revision.version + 1,
            content: body.content,
          },
        };
      if (path.endsWith("/submit/")) entry.revision.status = "pending";
      if (path.endsWith("/withdraw/")) entry.revision.status = "draft";
      return json(entry);
    }
    if (
      path.endsWith("/posts/") ||
      path.endsWith("/mine/") ||
      path.endsWith("/reviews/")
    )
      return json({
        count: 1,
        results: [
          {
            ...entry,
            revision: {
              ...entry.revision,
              content: {
                ...entry.revision.content,
                title: entry.revision.content.title || "边境交锋",
              },
            },
          },
        ],
      });
    return json(entry);
  });
  return {
    writes,
    setEntry: (value) => {
      entry = value;
    },
    getEntry: () => structuredClone(entry),
  };
}

test("星海编辑器支持真实目录、战损快捷操作、粘贴预览、保存和送审", async ({
  page,
}) => {
  const { writes } = await fixture(page);
  await page.goto("/starsea/new");
  // A cold Vite lazy module graph may still be loading after window.load.
  // Synchronize on route readiness before timing feature assertions.
  await page.getByLabel("加载星海见闻").waitFor({ state: "hidden" });
  await expect(
    page.getByRole("heading", { name: "发布见闻", exact: true }),
  ).toBeVisible();
  await page.getByLabel("标题", { exact: true }).fill("边境交锋");
  await page.getByLabel("A方名称").fill("北方舰队");
  await page.getByRole("button", { name: "A方添加损失" }).click();
  await page.getByLabel("A方第1行搜索舰船").fill("灾难");
  await page.getByRole("button", { name: /选择灾难级/ }).click();
  await page.getByLabel("A方第1行数量").fill("4");
  await page.getByRole("button", { name: "A方第1行复制" }).click();
  await expect(page.getByLabel("A方第2行数量")).toHaveValue("4");
  await page.getByText("批量粘贴清单", { exact: true }).nth(1).click();
  await page.getByLabel("B方粘贴清单").fill("护卫舰,未知,2");
  await page.getByRole("button", { name: "B方预览清单" }).click();
  await expect(page.getByText("待导入 1 行")).toBeVisible();
  await page.getByRole("button", { name: "B方确认导入" }).click();
  await page.screenshot({
    path: "output/playwright/starsea-editor-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(writes.at(-1).body.content.battle.sides[0].losses[0].ship_id).toBe(7);
  expect(writes.at(-1).body.content.battle.sides[0].isk_loss).toBeNull();
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(page.getByText("审核中，内容已锁定")).toBeVisible();
  await page.getByRole("button", { name: "撤回修改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
});

test("星海上传在客户端拒绝超过服务端限制的 6 MiB 图片", async ({ page }) => {
  const { writes } = await fixture(page);
  await page.goto("/starsea/new");
  await page.getByLabel("上传见闻图片").setInputFiles({
    name: "large.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(page.getByRole("alert")).toContainText("5 MB");
  expect(writes).toHaveLength(0);
});

test("新行搜索跨舰种真实目录并限制搜索词 80 字", async ({ page }) => {
  await fixture(page);
  let query;
  await page.route("**/api/starsea/ships/**", async (route) => {
    query = new URL(route.request().url()).searchParams;
    await route.fulfill({
      json: {
        count: 1,
        results: [
          {
            id: 9,
            name: "惩罚者级",
            ship_class: "护卫舰",
            source_version: "SWEET 218811",
          },
        ],
      },
    });
  });
  await page.goto("/starsea/new");
  await page.getByRole("button", { name: "A方添加损失" }).click();
  const search = page.getByLabel("A方第1行搜索舰船");
  await search.fill("惩罚者");
  await page.getByRole("button", { name: /选择惩罚者级/ }).click();
  expect(query.has("ship_class")).toBeFalsy();
  await expect(search).toHaveAttribute("maxlength", "80");
  await expect(page.getByLabel("A方第1行舰种")).toHaveValue("护卫舰");
});

test("审核清空最后一页后回到仍有待审内容的首页", async ({ page }) => {
  const f = await fixture(page),
    entry = f.getEntry();
  entry.revision.content.title = "待审见闻";
  entry.revision.status = "pending";
  f.setEntry(entry);
  let shrunk = false;
  await page.route("**/api/starsea/reviews/?*", async (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    await route.fulfill({
      json: {
        count: shrunk ? 20 : 21,
        results: second && shrunk ? [] : [entry],
      },
    });
  });
  await page.route("**/api/starsea/reviews/10/decision/", async (route) => {
    shrunk = true;
    await route.fulfill({ json: entry });
  });
  await page.goto("/starsea/review");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("第 2 / 2 页")).toBeVisible();
  await page.getByRole("button", { name: "查看审核快照" }).click();
  await page.getByRole("button", { name: "审核通过", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看审核快照" }),
  ).toBeVisible();
});

test("星海公开目录提供筛选和登录返回路径", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/starsea");
  await expect(
    page.getByRole("heading", { name: "星海见闻", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "战报", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "边境交锋", exact: true }),
  ).toBeVisible();
  await page.goto("/starsea/new");
  await expect(page.getByRole("link", { name: "登录后继续" })).toHaveAttribute(
    "href",
    "/login?next=%2Fstarsea%2Fnew",
  );
});

test("星海目录支持从军团页进入关联见闻", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/starsea?corporation_id=1");
  await expect(page.getByRole("status")).toContainText("关联军团");
  await page.getByRole("button", { name: "清除军团筛选", exact: true }).click();
  await expect(page).toHaveURL(/\/starsea$/);
});

test("星海未保存内容拦截应用内离开，手机页面无横向溢出", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/starsea/new");
  await page.getByLabel("标题", { exact: true }).fill("未保存的战报");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "返回见闻", exact: true }).click();
  await expect(page).toHaveURL(/starsea\/new/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "output/playwright/starsea-editor-mobile.png",
    fullPage: true,
  });
});

for (const [kind, label] of [
  ["story", "趣闻"],
  ["announcement", "活动"],
])
  test(`${label}投稿往返保存后送审`, async ({ page }) => {
    const { writes } = await fixture(page);
    await page.goto("/starsea/new");
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.getByLabel("标题", { exact: true }).fill(`${label}记录`);
    await page
      .getByLabel("见闻正文")
      .fill("我们在边境遇见了一支友善的舰队。\n下次再见，新伊甸。");
    await page.getByLabel("发生时间", { exact: true }).fill("2026-09-22T20:30");
    await page.getByLabel("发生星域", { exact: true }).selectOption("1");
    await page.getByLabel("发生星座", { exact: true }).selectOption("1");
    await page.getByLabel("发生星系", { exact: true }).selectOption("1");
    await page
      .getByLabel("关联军团（选填）", { exact: true })
      .selectOption("1");
    await page.getByRole("button", { name: "预览", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `${label}记录`, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page).toHaveURL(/starsea\/1\/edit/);
    await expect(page.getByLabel("见闻正文")).toHaveValue(/边境/);
    await page.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect(page.getByText("审核中，内容已锁定")).toBeVisible();
    const payload = writes.find((write) => write.body.content).body.content;
    expect(payload.kind).toBe(kind);
    expect(payload.battle).toBeNull();
    expect(payload.location).toEqual({
      region_id: 1,
      constellation_id: 1,
      solarsystem_id: 1,
    });
    expect(payload.corporation_id).toBe(1);
    await page.goto("/starsea/mine");
    await expect(
      page.getByRole("link", { name: `${label}记录`, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ss-status-pending")).toHaveText("审核中");
  });

test("上传失败可重试同一请求并保留说明，先创建草稿再上传", async ({ page }) => {
  const f = await fixture(page),
    ids = [];
  await page.route("**/api/starsea/posts/1/media/", async (route) => {
    expect(
      f.writes.some((write) => write.path.endsWith("/posts/")),
    ).toBeTruthy();
    ids.push(
      route
        .request()
        .postDataBuffer()
        .toString()
        .match(/name="request_id"\r\n\r\n([^\r]+)/)[1],
    );
    await route.fulfill(
      ids.length === 1
        ? { status: 503, json: { detail: "图片存储暂时不可用" } }
        : {
            json: { id: 8, url: "/api/starsea/media/8/", width: 1, height: 1 },
          },
    );
  });
  await page.route("**/api/starsea/media/8/", async (route) => {
    expect(route.request().headers().authorization).toContain("Bearer ");
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    });
  });
  await page.goto("/starsea/new");
  await page.getByLabel("标题", { exact: true }).fill("上传测试");
  await page.getByLabel("上传见闻图片").setInputFiles({
    name: "km.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  });
  await expect(
    page.getByText("图片存储暂时不可用", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重试上传", exact: true }).click();
  await page.getByLabel("第1张图片说明").fill("双方交战的 KM 记录");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/starsea\/1\/edit/);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  expect(f.writes.at(-1).body.content.images).toEqual([
    { id: 8, caption: "双方交战的 KM 记录" },
  ]);
});

test("账号同名切换不会呈现旧账号的迟到草稿", async ({ page }) => {
  const f = await fixture(page),
    old = f.getEntry(),
    next = f.getEntry(),
    token = createFakeJwt({ user_id: 56, userName: "atlas123" }),
    releases = [];
  old.revision.content.title = "旧账号秘密草稿";
  next.revision.content.title = "新账号自己的草稿";
  await page.route("**/api/starsea/posts/1/manage/", async (route) => {
    if (route.request().headers().authorization === `Bearer ${token}`)
      return route.fulfill({ json: next });
    await new Promise((resolve) => releases.push(resolve));
    await route.fulfill({ json: old }).catch(() => {});
  });
  await page.goto("/starsea/1/edit");
  await expect.poll(() => releases.length).toBeGreaterThan(0);
  await page.evaluate((token) => {
    localStorage.setItem("access_token", token);
    localStorage.setItem("refresh_token", token);
    window.dispatchEvent(new Event("auth:changed"));
  }, token);
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "新账号自己的草稿",
  );
  releases.forEach((resolve) => resolve());
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue(
    "新账号自己的草稿",
  );
  await expect(page.getByText("旧账号秘密草稿", { exact: true })).toHaveCount(
    0,
  );
});

test("公开详情使用服务端汇总、纯文本和匿名安全图片，分享只含公开路径", async ({
  page,
}) => {
  const f = await fixture(page, false),
    entry = f.getEntry();
  entry.revision.content.title = "公开战报";
  entry.revision.content.body = '<img src=x onerror="window.leaked=true">';
  entry.revision.content.images = [
    { id: 8, caption: "真实图片", url: "https://bad.test/private" },
  ];
  entry.summary = {
    sides: [
      {
        name: "A方",
        total_ships: 42,
        by_class: [{ name: "护卫舰", quantity: 42 }],
        isk_loss: null,
      },
      { name: "B方", total_ships: 0, by_class: [], isk_loss: "0.00" },
    ],
  };
  f.setEntry(entry);
  const imageHeaders = [];
  await page.route("**/api/starsea/media/8/", async (route) => {
    imageHeaders.push(route.request().headers());
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    });
  });
  await page.goto("/starsea/1?draft=secret#private");
  await page.getByLabel("加载星海见闻").waitFor({ state: "hidden" });
  await expect(page.locator(".ss-summary-side").first()).toContainText("42");
  await expect(page.locator(".ss-body")).toHaveText(
    '<img src=x onerror="window.leaked=true">',
  );
  await expect(page.getByRole("img", { name: "真实图片" })).toBeVisible();
  expect(await page.evaluate(() => window.leaked)).toBeUndefined();
  expect(imageHeaders.length).toBeGreaterThan(0);
  expect(imageHeaders.every((headers) => !headers.authorization)).toBeTruthy();
  await page.getByRole("button", { name: "分享见闻", exact: true }).click();
  await expect(page.getByLabel("见闻分享链接")).toHaveValue(
    "http://127.0.0.1:4173/starsea/1",
  );
});

test("已发布内容创建改稿保留公开版本提示，未知型号回载仍为未知", async ({
  page,
}) => {
  const f = await fixture(page),
    entry = f.getEntry();
  entry.revision.status = "approved";
  entry.published_revision_id = 9;
  entry.revision.content.title = "已发布旧版";
  entry.revision.content.battle.sides[0].losses = [
    { ship_id: null, ship_name: "未知型号", ship_class: "护卫舰", quantity: 1 },
  ];
  f.setEntry(entry);
  await page.route("**/api/starsea/posts/1/draft/", async (route) => {
    const next = f.getEntry();
    next.revision.status = "draft";
    next.revision.id = 11;
    f.setEntry(next);
    await route.fulfill({ json: next });
  });
  await page.goto("/starsea/1/edit");
  await page.getByRole("button", { name: "创建改稿", exact: true }).click();
  await expect(page.getByText(/已发布版本继续公开展示/)).toBeVisible();
  await expect(page.getByLabel("A方第1行型号来源")).toHaveValue("unknown");
});

test("首次创建的确定性校验错误允许修改后重新保存", async ({ page }) => {
  const f = await fixture(page),
    bodies = [];
  await page.route("**/api/starsea/posts/", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.content.title === "错误标题")
      return route.fulfill({ status: 400, json: { detail: "标题不符合要求" } });
    const entry = f.getEntry();
    entry.revision.content = body.content;
    f.setEntry(entry);
    await route.fulfill({ json: entry });
  });
  await page.goto("/starsea/new");
  await page.getByLabel("标题", { exact: true }).fill("错误标题");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("标题不符合要求");
  await page.getByLabel("标题", { exact: true }).fill("修正标题");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/starsea\/1\/edit/);
  expect(bodies[1].content.title).toBe("修正标题");
  expect(bodies[0].request_id).not.toBe(bodies[1].request_id);
});

test("目录型号切换自填后输入框保持可用", async ({ page }) => {
  await fixture(page);
  await page.goto("/starsea/new");
  await page.getByRole("button", { name: "A方添加损失" }).click();
  await page.getByLabel("A方第1行搜索舰船").fill("灾难");
  await page.getByRole("button", { name: /选择灾难级/ }).click();
  await page.getByLabel("A方第1行型号来源").selectOption("custom");
  await expect(page.getByLabel("A方第1行自填型号")).toBeVisible();
});

test("查询展示管理时锁定目标编号，避免迟到响应错配目标", async ({ page }) => {
  const f = await fixture(page);
  let release;
  await page.route("**/api/starsea/posts/1/manage/", async (route) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: f.getEntry() });
  });
  await page.goto("/starsea/review");
  await page.getByText("已发布内容的显示管理", { exact: true }).click();
  await page.getByLabel("见闻 ID").fill("1");
  await page.getByRole("button", { name: "查询内容", exact: true }).click();
  await expect(page.getByLabel("见闻 ID")).toBeDisabled();
  release?.();
});

test("删除已保存行不会把旧行搜索框带到下一行", async ({ page }) => {
  const f = await fixture(page),
    entry = f.getEntry();
  entry.revision.content.battle.sides[0].losses = [
    { ship_id: null, ship_name: "第一型号", ship_class: "护卫舰", quantity: 1 },
    { ship_id: null, ship_name: "第二型号", ship_class: "战列舰", quantity: 2 },
  ];
  f.setEntry(entry);
  await page.goto("/starsea/1/edit");
  await page.getByLabel("A方第1行搜索舰船").fill("未选择的搜索词");
  await page.getByRole("button", { name: "A方第1行删除" }).click();
  await expect(page.getByLabel("A方第1行搜索舰船")).toHaveValue("");
  await expect(page.getByLabel("A方第1行自填型号")).toHaveValue("第二型号");
});

test("星域目录失败有明确错误与重试入口", async ({ page }) => {
  await fixture(page, false);
  await page.route("**/api/starsea/locations/**", (route) =>
    route.fulfill({ status: 503, json: { detail: "星域目录暂时不可用" } }),
  );
  await page.goto("/starsea");
  await expect(page.getByRole("alert")).toContainText("星域目录暂时不可用");
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
});

test("搜索未选择新目录型号时不隐藏已有自填声明", async ({ page }) => {
  const f = await fixture(page),
    entry = f.getEntry();
  entry.revision.content.battle.sides[0].losses = [
    {
      ship_id: null,
      ship_name: "自定义护卫",
      ship_class: "护卫舰",
      quantity: 1,
    },
  ];
  f.setEntry(entry);
  await page.goto("/starsea/1/edit");
  await page.getByLabel("A方第1行搜索舰船").fill("灾难");
  await expect(page.getByLabel("A方第1行型号来源")).toHaveValue("custom");
  await expect(page.getByLabel("A方第1行自填型号")).toHaveValue("自定义护卫");
});

test("公开列表和我的发布自动纠正已缩减的末页", async ({ page }) => {
  const f = await fixture(page),
    entry = f.getEntry();
  entry.revision.content.title = "仍然存在的见闻";
  await page.route("**/api/starsea/posts/?*", (route) =>
    route.fulfill({
      json: {
        count: 20,
        results:
          new URL(route.request().url()).searchParams.get("page") === "2"
            ? []
            : [entry],
      },
    }),
  );
  await page.goto("/starsea?page=2");
  await expect(
    page.getByRole("link", { name: "仍然存在的见闻", exact: true }),
  ).toBeVisible();
  let requestedSecond = false;
  await page.route("**/api/starsea/mine/?*", (route) => {
    const page2 =
      new URL(route.request().url()).searchParams.get("page") === "2";
    if (page2) requestedSecond = true;
    return route.fulfill({
      json: { count: requestedSecond ? 20 : 21, results: page2 ? [] : [entry] },
    });
  });
  await page.goto("/starsea/mine");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => requestedSecond).toBeTruthy();
  await expect(
    page.getByRole("link", { name: "仍然存在的见闻", exact: true }),
  ).toBeVisible();
});

test("新草稿送审被拒绝时保留服务端错误而非重定向丢失提示", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/starsea/posts/1/submit/", (route) =>
    route.fulfill({ status: 400, json: { detail: "发布前请填写标题" } }),
  );
  await page.goto("/starsea/new");
  await page.getByRole("button", { name: "提交审核", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("发布前请填写标题");
  await expect(page).toHaveURL(/starsea\/new/);
});

test("列表搜索按钮在桌面和手机保持单行且输入框不挤压按钮", async ({ page }) => {
  await fixture(page, false);
  await page.goto("/starsea");
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const button = page.getByRole("button", { name: "搜索", exact: true });
    await expect(button).toBeVisible();
    const geometry = await button.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        lines: [...range.getClientRects()].filter((rect) => rect.width > 0)
          .length,
        width: element.getBoundingClientRect().width,
        nowrap: getComputedStyle(element).whiteSpace,
      };
    });
    expect(geometry.lines).toBe(1);
    expect(geometry.nowrap).toBe("nowrap");
    expect(geometry.width).toBeGreaterThanOrEqual(56);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  }
});

test("列表摘要折叠段落空白而详情保留原文换行", async ({ page }) => {
  const f = await fixture(page, false),
    entry = f.getEntry(),
    body = "本地虚构示例。\n\n第一段航行见闻。\n\t第二段战况说明。";
  entry.revision.content.body = body;
  f.setEntry(entry);
  await page.goto("/starsea");
  const excerpt = page.locator(".ss-excerpt").first();
  await expect(excerpt).toHaveJSProperty(
    "textContent",
    "本地虚构示例。 第一段航行见闻。 第二段战况说明。",
  );
  await expect(excerpt).toHaveCSS("white-space", "normal");
  await expect(excerpt).toHaveCSS("-webkit-line-clamp", "2");
  await page.getByRole("link", { name: "边境交锋", exact: true }).click();
  await expect(page.locator(".ss-body")).toHaveJSProperty("textContent", body);
  await expect(page.locator(".ss-body")).toHaveCSS("white-space", "pre-wrap");
});
