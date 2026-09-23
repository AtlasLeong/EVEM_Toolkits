import { test, expect } from "@playwright/test";
import {
  communityFixture,
  corporation,
  corpContent,
} from "../helpers/community";
import { json, TINY_ICON } from "../helpers/api";

async function editableFixture(page) {
  await communityFixture(page, { auth: true, staff: true });
  const state = {
    revision: {
      ...corpContent,
      id: 11,
      corporation_id: 1,
      status: "draft",
      version: 1,
    },
    fail: false,
    reads: 0,
    saves: [],
  };
  await page.route("**/api/community/corporations/1/manage/", (route) => {
    state.reads++;
    return route.fulfill(
      state.fail
        ? json({ detail: "后台暂时不可用" }, 503)
        : json({
            ...corporation,
            is_listed: true,
            can_edit: true,
            working_revision: state.revision,
            published_revision: corporation.revision,
          }),
    );
  });
  await page.route("**/api/community/revisions/11/", async (route) => {
    const body = route.request().postDataJSON();
    state.saves.push(body);
    if (body.expected_version !== state.revision.version)
      return route.fulfill(json({ detail: "草稿已被其他操作更新" }, 409));
    state.revision = {
      ...state.revision,
      ...body,
      version: state.revision.version + 1,
    };
    return route.fulfill(json(state.revision));
  });
  await page.clock.install();
  return state;
}

async function reconnect(page, state) {
  const reads = state.reads;
  await page.clock.fastForward(181000);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
}
const tagline = (page) =>
  page.getByRole("textbox", { name: "军团口号", exact: true });

test("保存同步基线：相同版本重取保留新编辑，远端新版本必须明确放弃后加载", async ({
  page,
}) => {
  const state = await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await tagline(page).fill("已保存 A");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  await tagline(page).fill("未保存 B");
  await reconnect(page, state);
  await expect(tagline(page)).toHaveValue("未保存 B");
  await expect(
    page.getByText("服务器资料已更新", { exact: false }),
  ).toHaveCount(0);
  state.revision = { ...state.revision, version: 3, tagline: "远端 C" };
  await reconnect(page, state);
  await expect(tagline(page)).toHaveValue("未保存 B");
  await expect(page.getByRole("alert")).toContainText("服务器资料已更新");
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "放弃本地修改并加载最新版本" })
    .click();
  await expect(tagline(page)).toHaveValue("未保存 B");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "放弃本地修改并加载最新版本" })
    .click();
  await expect(tagline(page)).toHaveValue("远端 C");
  await tagline(page).fill("加载后 D");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(state.saves.at(-1).expected_version).toBe(3);
});

test("背景请求失败不会卸载编辑器，重新加载也不丢失本地内容", async ({
  page,
}) => {
  const state = await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await tagline(page).fill("断线时继续保留");
  state.fail = true;
  await reconnect(page, state);
  await page.clock.fastForward(2000);
  await expect(page.getByRole("alert")).toContainText("后台暂时不可用");
  await expect(tagline(page)).toHaveValue("断线时继续保留");
  state.fail = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(tagline(page)).toHaveValue("断线时继续保留");
});

test("远端审核状态或新草稿不替换本地编辑，并禁止过期写入", async ({ page }) => {
  const state = await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await tagline(page).fill("本地保留的内容");
  state.revision = {
    ...state.revision,
    id: 12,
    version: 1,
    status: "pending",
    tagline: "远程审核中",
  };
  await reconnect(page, state);
  await expect(tagline(page)).toHaveValue("本地保留的内容");
  await expect(page.getByRole("alert")).toContainText("服务器资料已更新");
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "提交审核", exact: true }),
  ).toBeDisabled();
  expect(state.saves).toHaveLength(0);
});

test("未添加标签也触发离开保护，站内跳转与刷新取消后保留编辑", async ({
  page,
}) => {
  await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await page
    .getByRole("textbox", { name: "自定义活动标签", exact: true })
    .fill("未添加标签");
  let confirms = 0;
  page.on("dialog", async (dialog) => {
    confirms++;
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(page).toHaveURL(/manage\?id=1/);
  expect(confirms).toBe(1);
  await page.reload({ timeout: 2000 }).catch(() => {});
  await expect(
    page.getByRole("textbox", { name: "自定义活动标签", exact: true }),
  ).toHaveValue("未添加标签");
  expect(confirms).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("409 后保留输入并获取远端冲突，不重试覆盖新版本", async ({ page }) => {
  const state = await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await tagline(page).fill("即将保存的本地内容");
  state.revision = { ...state.revision, version: 2, tagline: "别人已保存" };
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "放弃本地修改并加载最新版本" }),
  ).toBeVisible();
  await expect(tagline(page)).toHaveValue("即将保存的本地内容");
  expect(state.saves).toHaveLength(1);
  expect(state.saves[0].expected_version).toBe(1);
});

test("图片引用修改后切换军团与浏览器后退均需确认，取消不丢失表单", async ({
  page,
}) => {
  await editableFixture(page);
  await page.route("**/api/community/mine/?*", (route) =>
    route.fulfill(
      json({
        claims: [],
        claims_count: 0,
        corporations_count: 2,
        corporations: [
          corporation,
          { ...corporation, id: 2, name: "另一军团", short_name: "TWO" },
        ],
      }),
    ),
  );
  await page.route("**/api/community/corporations/1/media/", (route) =>
    route.fulfill(
      json({ id: 101, private_url: "/api/community/media/101/private/" }, 201),
    ),
  );
  await page.route("**/api/community/media/101/private/", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(TINY_ICON.split(",")[1], "base64"),
    }),
  );
  await page.goto("/corporations");
  await page.getByRole("link", { name: "我的军团", exact: true }).click();
  await page.locator(".corp-owned-list button").first().click();
  await page.getByLabel("上传军团封面").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_ICON.split(",")[1], "base64"),
  });
  await expect(
    page
      .locator(".corp-media-field")
      .last()
      .getByText("图片已上传，请保存草稿。"),
  ).toBeVisible();
  let prompts = 0;
  page.on("dialog", async (dialog) => {
    prompts++;
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: /另一军团/ }).click();
  await expect(page).toHaveURL(/manage\?id=1/);
  await expect(
    page
      .locator(".corp-media-field")
      .last()
      .getByRole("button", { name: "移除图片" }),
  ).toBeVisible();
  await page.evaluate(() => history.back());
  await expect.poll(() => prompts).toBe(2);
  await expect(page).toHaveURL(/manage\?id=1/);
  await expect(
    page
      .locator(".corp-media-field")
      .last()
      .getByRole("button", { name: "移除图片" }),
  ).toBeVisible();
});

test("海报背景变化属于未保存修改，保存后离开不再提示", async ({ page }) => {
  const state = await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await page.getByRole("button", { name: "制作海报", exact: true }).click();
  await page.getByRole("button", { name: "冰封边境", exact: true }).click();
  await page.keyboard.press("Escape");
  let prompts = 0;
  page.on("dialog", async (dialog) => {
    prompts++;
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(page).toHaveURL(/manage\?id=1/);
  expect(prompts).toBe(1);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已保存");
  expect(state.saves.at(-1).poster_background).toBe("frozen-frontier");
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(page).toHaveURL(/\/corporations$/);
  expect(prompts).toBe(1);
});

test("同军团重复跳转后退取消仍保留编辑，确认离开后前进不会残留拦截", async ({
  page,
}) => {
  await editableFixture(page);
  await page.goto("/corporations");
  await page.getByRole("link", { name: "我的军团", exact: true }).click();
  await page.locator(".corp-owned-list button").first().click();
  await page.locator(".corp-owned-list button").first().click();
  const index = await page.evaluate(() => history.state.idx);
  await tagline(page).fill("同路径也要保留");
  let confirmations = 0;
  const cancel = async (dialog) => {
    confirmations++;
    await dialog.dismiss();
  };
  page.on("dialog", cancel);
  await page.evaluate(() => history.back());
  await expect.poll(() => confirmations).toBe(1);
  await expect.poll(() => page.evaluate(() => history.state.idx)).toBe(index);
  await expect(tagline(page)).toHaveValue("同路径也要保留");
  page.off("dialog", cancel);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(page).toHaveURL(/\/corporations$/);
  await page.goBack();
  await expect(tagline(page)).toHaveValue(corpContent.tagline);
  await page.goForward();
  await expect(page).toHaveURL(/\/corporations$/);
});

test("确认同页跳转后新修改仍会触发离开提醒", async ({ page }) => {
  await editableFixture(page);
  await page.goto("/corporations/manage?id=1");
  await tagline(page).fill("第一次修改");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".corp-owned-list button").first().click();
  await expect(page).toHaveURL(/manage\?id=1/);
  await tagline(page).fill("第二次修改");
  let prompts = 0;
  page.once("dialog", (dialog) => { prompts++; return dialog.dismiss(); });
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(tagline(page)).toHaveValue("第二次修改");
  expect(prompts).toBe(1);
});

test("审批后公开列表及详情不再复用旧缓存，下架立即清除公开详情", async ({
  page,
}) => {
  await communityFixture(page, { auth: true, staff: true });
  let title = "旧版口号";
  let listed = true;
  await page.route(
    (url) => url.pathname === "/api/community/corporations/",
    (route) =>
      route.fulfill(
        json({
          count: listed ? 1 : 0,
          results: listed
            ? [
                {
                  ...corporation,
                  revision: { ...corporation.revision, tagline: title },
                },
              ]
            : [],
        }),
      ),
  );
  await page.route("**/api/community/corporations/1/", (route) =>
    route.fulfill(
      listed
        ? json({
            ...corporation,
            revision: { ...corporation.revision, tagline: title },
          })
        : json({ detail: "军团不可用" }, 404),
    ),
  );
  await page.route("**/api/community/reviews/?*", (route) =>
    route.fulfill(
      json({ count: 1, results: [{ id: 11, corporation, status: "pending" }] }),
    ),
  );
  await page.route("**/api/community/reviews/revisions/11/", (route) =>
    route.fulfill(
      json({ ...corpContent, id: 11, status: "pending", corporation }),
    ),
  );
  await page.route(
    "**/api/community/reviews/revisions/11/decision/",
    (route) => {
      title = "审核发布的新口号";
      return route.fulfill(json({ id: 11, status: "approved" }));
    },
  );
  await page.route("**/api/community/corporations/1/visibility/", (route) => {
    listed = route.request().postDataJSON().is_listed;
    return route.fulfill(json({ ...corporation, is_listed: listed }));
  });
  await page.goto("/corporations");
  await page.getByRole("link", { name: /远航者军团/ }).click();
  await expect(page.getByText("旧版口号", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回军团大厅", exact: true }).click();
  await page.getByRole("link", { name: "审核管理", exact: true }).click();
  await page.getByRole("button", { name: "资料审核", exact: true }).click();
  await page.locator(".corp-review-list button").click();
  await page.getByRole("button", { name: "批准并发布", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("审核已完成");
  await page.getByRole("link", { name: "发现军团", exact: true }).click();
  await expect(
    page.getByText("审核发布的新口号", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /远航者军团/ }).click();
  await expect(
    page.getByText("审核发布的新口号", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "返回军团大厅", exact: true }).click();
  await page.getByRole("link", { name: "审核管理", exact: true }).click();
  await page.locator(".corp-visibility summary").click();
  await page.getByRole("textbox", { name: "军团编号", exact: true }).fill("1");
  await page
    .getByRole("textbox", { name: "管理原因", exact: true })
    .fill("已下架");
  await page.getByRole("button", { name: "下架军团", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("公开状态已更新");
  await page.goBack();
  await page.goBack();
  await expect(page.getByRole("alert")).toContainText("军团不可用");
  await expect(page.getByText("审核发布的新口号", { exact: true })).toHaveCount(
    0,
  );
});

test("归属审核显示本次申请名称简称，历史空值回退军团资料", async ({ page }) => {
  await communityFixture(page, { auth: true, staff: true });
  let proposed = { proposed_name: "本次申请名称", proposed_short_name: "NEW" };
  await page.route("**/api/community/reviews/claims/54/", (route) =>
    route.fulfill(
      json({
        id: 54,
        corporation: { id: 2, name: "历史名称", short_name: "OLD" },
        statement: "核实管理者",
        contact: "游戏内联系",
        status: "pending",
        ...proposed,
      }),
    ),
  );
  await page.goto("/corporations/review");
  await page.locator(".corp-review-list button").click();
  await expect(page.locator(".corp-review-detail")).toContainText(
    "本次申请名称",
  );
  await expect(page.locator(".corp-review-detail")).toContainText("NEW");
  proposed = { proposed_name: null, proposed_short_name: null };
  await page.reload();
  await page.locator(".corp-review-list button").click();
  await expect(page.locator(".corp-review-detail")).toContainText("历史名称");
  await expect(page.locator(".corp-review-detail")).toContainText("OLD");
});
