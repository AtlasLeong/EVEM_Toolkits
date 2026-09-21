import { test, expect } from "@playwright/test";
import { createFakeJwt, seedAuthenticatedSession } from "../e2e/helpers/auth.js";
import { installApiMock, json } from "../e2e/helpers/api.js";

async function fixture(
  page,
  { role = "scout", empty = false, conflict = false, full = false, createLost = false, overview = false } = {},
) {
  await page.routeWebSocket("**/ws/tactical/**", (socket) =>
    socket.close({ code: 1000 }),
  );
  await seedAuthenticatedSession(page, { user_id: 23 });
  const commands = [];
  const createRequests = [];
  const requests = [];
  let snapshot = {
    organization: { id: 1, name: "北境联合" },
    role,
    user_id: 23,
    permission_version: 1,
    scope: { region_ids: [1], border_hops: 1, version: 1 },
    online_count: 3,
    capacity: 100,
    forces: [
      {
        id: 11,
        version: 1,
        name: "敌方前锋",
        side: "enemy",
        system_id: 101,
        system_name: "德里克一",
        people: 32,
        ships: { cruiser: 12 },
        notes: "",
        observed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    reports: [
      {
        id: 21,
        version: 1,
        author_id: 23,
        author_name: "我的角色",
        system_id: 101,
        system_name: "德里克一",
        people: null,
        ships: { cruiser: 0 },
        notes: "自己的上报",
        observed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "confirmed",
      },
    ],
    ...(role !== "scout"
      ? {
          online: [
            {
              user_id: 23,
              display_name: "当前指挥",
              role,
              joined_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
          ],
        }
      : {}),
  };
  await installApiMock(page, ({ url, method, body }) => {
    requests.push(url.pathname);
    if (url.pathname.endsWith("/organizations/") && method === "GET")
      return json({
        organizations: empty
          ? []
          : [{ id: 1, name: "北境联合", role, status: "active" }],
      });
    if (url.pathname.endsWith("/organizations/") && method === "POST") {
      createRequests.push(body);
      if (createLost && createRequests.length === 1) return json({ detail: "连接中断，请重试" }, 503);
      return json({
        ok: true,
        result: { id: 1, name: body.name, role: "founder", status: "active" },
      });
    }
    if (url.pathname.endsWith("/join/"))
      return json({
        ok: true,
        result: {
          id: 3,
          organization_id: 1,
          organization_name: "北境联合",
          status: "pending",
        },
      });
    if (url.pathname.endsWith("/presence/"))
      return full && method === "POST"
        ? json({ detail: "战术板已满", code: "board_full" }, 409)
        : json({
            connection_id: body.connection_id,
            online_count: 3,
            capacity: 100,
            lease_seconds: 60,
          });
    if (url.pathname.endsWith("/snapshot/")) return json(snapshot);
    if (url.pathname.endsWith("/catalog/"))
      return json({
        results:
          url.searchParams.get("kind") === "regions"
            ? [
                { id: 1, name: "德里克" },
                { id: 2, name: "伏尔戈" },
              ]
            : [
                {
                  id: 101,
                  name: "德里克一",
                  security_status: 0.5,
                  region_name: "德里克",
                },
                {
                  id: 102,
                  name: "德里克二",
                  security_status: 0.4,
                  region_name: "德里克",
                },
              ],
      });
    if (url.pathname.endsWith("/map/"))
      return json({
        systems: overview ? [
          { system_id: 101, constellation_id: 201, zh_name: "德里克一", x: 0, z: 0, security_status: 0.5 },
          { system_id: 102, constellation_id: 201, zh_name: "德里克二", x: 100, z: 30, security_status: -0.24 },
          { system_id: 201, constellation_id: 202, zh_name: "边境一", x: 420, z: 260, security_status: 0.1 },
        ] : [
          { system_id: 101, zh_name: "德里克一", x: 0, z: 0, security_status: 0.5 },
          { system_id: 102, zh_name: "德里克二", x: 100, z: 30, security_status: -0.24 },
        ],
        stargates: [{ system_id: 101, destination_system_id: 102 }],
        regions: [],
        constellations: overview ? [
          { constellation_id: 201, region_id: 1, zh_name: "德里克核心" },
          { constellation_id: 202, region_id: 1, zh_name: "德里克边境" },
        ] : [],
        boundary_exits: [
          {
            system_id: 101,
            destination_system_id: 103,
            destination_name: "边界外星系",
          },
        ],
        scope: snapshot.scope,
      });
    if (url.pathname.endsWith("/members/"))
      return json({
        members: [
          {
            id: 1,
            user_id: 23,
            display_name: "当前指挥",
            role,
            status: "active",
          },
          {
            id: 2,
            user_id: 24,
            display_name: "斥候甲",
            role: "scout",
            status: "active",
          },
        ],
        applications: [
          { id: 4, user_id: 25, display_name: "申请者乙", status: "pending" },
        ],
        online: snapshot.online || [],
        online_count: 3,
        capacity: 100,
      });
    if (url.pathname.endsWith("/commands/")) {
      commands.push(body);
      if (conflict && body.action === "report.update")
        return json(
          { detail: "此情报已更新，请重新核对", code: "version_conflict" },
          409,
        );
      return json({
        ok: true,
        result:
          body.action === "invite.create"
            ? { invite_code: "TEST-CODE", expires_at: "2030-01-01T00:00:00Z" }
            : { id: 51 },
      });
    }
    return json({});
  });
  return {
    commands,
    createRequests,
    requests,
    setSnapshot: (next) => {
      snapshot = next;
    },
    snapshot,
  };
}

test("dense real map opens as constellation overview and drills into a local system view", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  await expect(page.getByRole("group", { name: "星座总览", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "进入星座 德里克核心", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "进入星座 德里克核心", exact: true }).click();
  await expect(page.getByRole("group", { name: "局部作战星图", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "返回星座总览", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回星座总览", exact: true }).click();
  await expect(page.getByRole("group", { name: "星座总览", exact: true })).toBeVisible();
});

test("dense map keeps a real-space mode and search focuses the selected constellation", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "切换真实空间", exact: true }).click();
  await expect(page.getByRole("group", { name: "真实空间星图", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "切换星座总览", exact: true }).click();
  await page.getByLabel("搜索当前星图").fill("德里克一");
  await page.getByRole("button", { name: /德里克一/ }).first().click();
  await expect(page.getByRole("group", { name: "局部作战星图", exact: true })).toBeVisible();
  await expect(page.getByText("德里克一", { exact: true }).first()).toBeVisible();
});

test("guest sees login call to action without private requests", async ({
  page,
}) => {
  await page.goto("/tactical");
  await expect(
    page.getByRole("heading", { name: "战术板", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "登录后进入战术板" }),
  ).toBeVisible();
});

test("immersive desktop map fills main area and floating drawer never changes its bounds", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map).toBeVisible();
  const before = await map.boundingBox();
  const main = await page.locator(".shell-main").boundingBox();
  expect(before.width).toBeGreaterThan(main.width * .94);
  expect(before.height).toBeGreaterThan(1050 * .8);
  expect(before.y).toBeLessThan(80);
  const panel = await page.getByRole("complementary", { name: "部署与情报" }).boundingBox();
  const overview = await page.getByRole("region", { name: "战术概览" }).boundingBox();
  expect(panel.x).toBeGreaterThan(before.x);
  expect(panel.y).toBeGreaterThan(before.y);
  expect(panel.x + panel.width).toBeLessThan(before.x + before.width);
  expect(overview.y).toBeGreaterThan(before.y);
  expect(overview.height).toBeLessThan(70);
  await page.getByRole("button", { name: "收起情报侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "部署与情报" })).toHaveCount(0);
  expect(await map.boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "展开情报侧栏" }).click();
  await expect(page.getByRole("complementary", { name: "部署与情报" })).toBeVisible();
  expect(await map.boundingBox()).toEqual(before);
  await expect(page.getByRole("button", { name: "快速上报", exact: true })).toBeEnabled();
  await page.screenshot({ path: "output/playwright/tactical-immersive-desktop.png" });
});

test("immersive map projects to its viewport and displays real security without inventing it", async ({ page }) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map.getByText("0.50", { exact: true })).toBeVisible();
  await expect(map.getByText("-0.24", { exact: true })).toBeVisible();
  const box = await map.boundingBox();
  const viewport = await map.getAttribute("viewBox");
  const [, , width, height] = viewport.split(" ").map(Number);
  expect(width / height).toBeCloseTo(box.width / box.height, 1);
  await page.getByRole("button", { name: "收起情报侧栏" }).click();
  expect(await map.getAttribute("viewBox")).toBe(viewport);
});

test("organization URL selects only active membership and selector keeps a shareable URL", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  await page.route("**/api/tactical/organizations/", (route) => route.fulfill(json({ organizations: [
    { id: 1, name: "北境联合", role: "commander", status: "active" },
    { id: 2, name: "真实演习", role: "commander", status: "active" },
    { id: 3, name: "待审批组织", role: "scout", status: "pending" },
  ] })));
  await page.goto("/tactical?organization=2");
  await expect(page.locator('summary[aria-label="选择组织"]')).toContainText("真实演习");
  await expect.poll(() => state.requests.some((url) => url.includes("/organizations/2/snapshot/"))).toBe(true);
  await page.locator('summary[aria-label="选择组织"]').click();
  await page.getByRole("button", { name: "北境联合", exact: true }).click();
  await expect(page).toHaveURL(/organization=1/);
  await page.goto("/tactical?organization=3");
  await expect(page.locator('summary[aria-label="选择组织"]')).toContainText("北境联合");
  await expect(page.getByRole("group", { name: "局部作战星图" })).toBeVisible();
  expect(state.requests.filter((url) => /organizations\/3\/(map|snapshot|presence)/.test(url))).toEqual([]);
});

test('organization creation retry preserves request identity after lost response', async ({ page }) => {
  const { createRequests } = await fixture(page, { empty: true, role: 'founder', createLost: true });
  await page.goto('/tactical');
  await page.getByRole('button', { name: '创建或加入组织', exact: true }).click();
  await page.getByLabel('组织名称').fill('重试同一组织');
  const submit = page.getByRole('dialog').getByRole('button', { name: '创建组织', exact: true }).last();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('连接中断');
  await submit.click();
  await expect(page.getByRole('status').filter({ hasText: '组织已创建' })).toBeVisible();
  expect(createRequests).toHaveLength(2);
  expect(createRequests[0].request_id).toBe(createRequests[1].request_id);
});
test("scout sees enemy forces and own reports, no friendly or membership controls", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/tactical");
  await expect(page.getByRole("complementary", { name: "部署与情报" }).getByText("敌方前锋", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "人员管理", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "添加己方部署", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "快速上报", exact: true })
    .first()
    .click();
  await page.getByLabel("搜索上报星系").fill("德里");
  await page
    .getByRole("dialog", { name: "快速上报", exact: true })
    .getByRole("button", { name: /德里克一/ })
    .click();
  await page.getByLabel("敌方人数").fill("0");
  await page.getByRole("button", { name: "提交上报", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "上报已提交" }),
  ).toBeVisible();
});
test("mobile uses intelligence list without downloading map", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { requests } = await fixture(page);
  await page.goto("/tactical");
  await expect(page.getByText("敌方前锋").first()).toBeVisible();
  expect(requests.some((path) => path.endsWith("/map/"))).toBe(false);
  await expect(page.locator(".tac-map")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "快速上报", exact: true })).toBeEnabled();
  const reportButton = await page.getByRole("button", { name: "快速上报", exact: true }).boundingBox();
  expect(reportButton.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: "output/playwright/tactical-immersive-mobile.png", fullPage: true });
});

test("tablet floating controls remain inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await expect(page.getByRole("button", { name: "快速上报", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ["快速上报", "人员管理", "创建 / 加入组织"]) {
    const bounds = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(820);
  }
});
test("confirmed report edit preserves text after version conflict", async ({
  page,
}) => {
  const { commands } = await fixture(page, { conflict: true });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "情报", exact: true }).click();
  await page.getByRole("button", { name: "修改我的上报", exact: true }).click();
  await expect(page.getByText(/不会直接覆盖已确认的部署/)).toBeVisible();
  await page.getByLabel("情报备注").fill("修订保留");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /已更新/ }),
  ).toBeVisible();
  await expect(page.getByLabel("情报备注")).toHaveValue("修订保留");
  expect(commands[0].expected_version).toBe(1);
  expect(commands[0].people).toBe(null);
  expect(commands[0].ships.cruiser).toBe(0);
});
test("commander can approve and remove scouts with confirmation but cannot assign roles", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "人员管理", exact: true }).click();
  await page.getByRole("button", { name: "批准申请者乙" }).click();
  await expect
    .poll(() =>
      commands.some(
        (c) => c.action === "join.review" && c.decision === "approve",
      ),
    )
    .toBe(true);
  await expect(page.getByRole("button", { name: /任命指挥/ })).toHaveCount(0);
  await page.getByRole("button", { name: "移除斥候甲" }).click();
  await expect(
    page.getByRole("dialog", { name: "确认移除成员" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect
    .poll(() =>
      commands.some((c) => c.action === "member.remove" && c.member_id === 2),
    )
    .toBe(true);
});
test("full board keeps membership administration available", async ({
  page,
}) => {
  await fixture(page, { role: "commander", full: true });
  await page.goto("/tactical");
  await expect(page.getByText("战术板已满").first()).toBeVisible();
  await page.getByRole("button", { name: "人员管理", exact: true }).click();
  await expect(page.getByText("申请者乙", { exact: true })).toBeVisible();
});

test("scope supports region search, multi selection and bounded gate buffer", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "founder" });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "调整范围" }).click();
  await page.getByLabel("搜索星域").fill("伏尔");
  await page.getByRole("checkbox", { name: "伏尔戈" }).check();
  await page.getByRole("button", { name: "2 跳星门" }).click();
  await page.getByRole("button", { name: "应用作战范围" }).click();
  await expect
    .poll(() => commands.find((command) => command.action === "scope.update"))
    .toMatchObject({ region_ids: [1, 2], border_hops: 2, expected_version: 1 });
});

test("create organization and invite application have functional forms", async ({
  page,
}) => {
  await fixture(page, { empty: true, role: "founder" });
  await page.goto("/tactical");
  await page
    .getByRole("button", { name: "创建或加入组织", exact: true })
    .click();
  await page.getByLabel("组织名称").fill("远征联合");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建组织", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "组织已创建" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "创建 / 加入组织" }).click();
  await page.getByRole("button", { name: "申请加入", exact: true }).click();
  await page.getByLabel("邀请码").fill("INVITE-CODE");
  await page.getByRole("button", { name: "提交加入申请" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "申请已提交" }),
  ).toBeVisible();
});

test("role downgrade clears friendly data, open dialogs and membership controls", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    forces: [
      ...state.snapshot.forces,
      {
        ...state.snapshot.forces[0],
        id: 12,
        name: "己方秘密集结",
        side: "friendly",
      },
    ],
  });
  await page.goto("/tactical");
  await expect(page.getByText("己方秘密集结", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加己方部署" }).click();
  await page.getByLabel("部队名称").fill("尚未发送的己方资料");
  state.setSnapshot({
    ...state.snapshot,
    role: "scout",
    permission_version: 2,
    online: undefined,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("己方秘密集结", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "人员管理", exact: true }),
  ).toHaveCount(0);
});

test("logout clears loaded deployments and drafts immediately", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/tactical");
  await expect(page.getByText("敌方前锋", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "快速上报", exact: true }).click();
  await page.getByLabel("情报备注").fill("会话私有草稿");
  await page.evaluate(() => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    window.dispatchEvent(new Event("auth:changed"));
  });
  await expect(
    page.getByRole("link", { name: "登录后进入战术板" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("敌方前锋", { exact: true })).toHaveCount(0);
});

test("force drag requests adjacent stable-id move without optimistic position changes", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await expect(page.getByText('拖动空白平移 · 按钮缩放 · 拖动部队到相邻星系', {exact:true})).toBeVisible();
  const marker = page.getByRole("button", {
    name: "敌方 敌方前锋 32 人，德里克一",
  });
  const destination = page.getByRole("button", { name: "选择星系 德里克二" });
  await expect(marker).toBeVisible();
  const start = await marker.boundingBox();
  const target = await destination.boundingBox();
  await page.mouse.move(start.x + 20, start.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2 - 8,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(() => commands.find((command) => command.action === "force.move"))
    .toMatchObject({
      force_id: 11,
      expected_version: 1,
      destination_system_id: 102,
      kind: "gate_move",
    });
  await expect(marker).toBeVisible();
});

test("desktop board and quick report remain readable at laptop size", async ({
  page,
}) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await expect(page.getByText("敌方前锋", { exact: true })).toBeVisible();
  await expect(page.getByRole('button',{name:'快速上报',exact:true})).toBeEnabled();
  const zoomIcon = await page
    .getByRole("button", { name: "放大地图" })
    .locator("svg")
    .boundingBox();
  expect(zoomIcon.height).toBeLessThanOrEqual(20);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/playwright/tactical-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "快速上报", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: "output/playwright/tactical-report.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "快速上报", exact: true }),
  ).toBeFocused();
});

test("full board demotion clears roster and invite despite absence of state subscription", async ({
  page,
}) => {
  await fixture(page, { role: "commander", full: true });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "人员管理" }).click();
  await page.getByRole("button", { name: "生成邀请链接" }).click();
  await expect(page.getByLabel("邀请链接", { exact: true })).toBeVisible();
  await page.route("**/api/tactical/organizations/1/members/", (route) =>
    route.fulfill(json({ detail: "无权查看人员" }, 403)),
  );
  await expect(page.getByRole("dialog", { name: "人员管理" })).toHaveCount(0, {
    timeout: 8000,
  });
  await expect(page.getByText("申请者乙", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("邀请链接", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "人员管理" })).toHaveCount(0);
});

test("commander can inspect another scout ship counts and evidence before confirming", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    reports: [
      {
        ...state.snapshot.reports[0],
        author_id: 99,
        author_name: "前沿斥候",
        status: "pending",
        ships: { cruiser: 14, battleship: 0 },
        notes: "从西侧星门进入",
      },
    ],
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "情报", exact: true }).click();
  await expect(page.getByText("巡洋舰 14", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认 / 关联" }).click();
  const dialog = page.getByRole("dialog", { name: "确认敌方部署" });
  await expect(dialog.getByText("巡洋舰 14", { exact: true })).toBeVisible();
  await expect(dialog.getByText("战列舰 0", { exact: true })).toBeVisible();
  await expect(dialog.getByText("泰坦 未知", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText("从西侧星门进入", { exact: true }),
  ).toBeVisible();
});

test("scope submission keeps the version reviewed when editor opened", async ({
  page,
}) => {
  const state = await fixture(page, { role: "founder" });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "调整范围" }).click();
  state.setSnapshot({
    ...state.snapshot,
    scope: { ...state.snapshot.scope, version: 2, region_ids: [2] },
  });
  await expect(page.getByRole("checkbox", { name: "德里克" })).toBeChecked();
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "应用作战范围" }).click();
  await expect
    .poll(() =>
      state.commands.find((command) => command.action === "scope.update"),
    )
    .toMatchObject({ expected_version: 1, region_ids: [1] });
});

test("confirming into existing force retains the version explicitly selected", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  const pending = {
    ...state.snapshot,
    reports: [{ ...state.snapshot.reports[0], status: "pending" }],
  };
  state.setSnapshot(pending);
  await page.goto("/tactical");
  await page.getByRole("button", { name: "情报", exact: true }).click();
  await page.getByRole("button", { name: "确认 / 关联" }).click();
  await page.locator('summary[aria-label="确认方式"]').click();
  await page.getByRole("button", { name: "关联：敌方前锋 · 德里克一" }).click();
  state.setSnapshot({
    ...pending,
    forces: [{ ...pending.forces[0], version: 2, people: 90 }],
  });
  await page.waitForTimeout(2200);
  await page.getByRole("button", { name: "确认部署", exact: true }).click();
  await expect
    .poll(() =>
      state.commands.find((command) => command.action === "report.confirm"),
    )
    .toMatchObject({ force_id: 11, force_expected_version: 1 });
});

test("corrected report requires explicit existing force selection", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    reports: [{ ...state.snapshot.reports[0], status: "corrected" }],
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "情报", exact: true }).click();
  await page.getByRole("button", { name: "确认 / 关联" }).click();
  await page.locator('summary[aria-label="确认方式"]').click();
  await expect(
    page.getByRole("button", { name: "建立新敌方部署" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关联：敌方前锋 · 德里克一" }).click();
  await page.getByRole("button", { name: "确认部署", exact: true }).click();
  await expect
    .poll(() =>
      state.commands.find((command) => command.action === "report.confirm"),
    )
    .toMatchObject({ force_id: 11 });
});

test("commander can archive a deployment only after confirmation with reviewed version", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await page.locator(".tac-force-main").first().click();
  await page.getByRole("button", { name: "归档部署", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "归档部署" })).toBeVisible();
  expect(commands).toHaveLength(0);
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect
    .poll(() => commands.find((command) => command.action === "force.archive"))
    .toMatchObject({ force_id: 11, expected_version: 1 });
});

test("commander filters enemy and friendly deployments without changing shared scope", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    forces: [
      ...state.snapshot.forces,
      {
        ...state.snapshot.forces[0],
        id: 12,
        name: "己方主力",
        side: "friendly",
      },
    ],
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "仅己方", exact: true }).click();
  await expect(page.getByText("己方主力", { exact: true })).toBeVisible();
  await expect(page.getByText("敌方前锋", { exact: true })).toHaveCount(0);
  expect(state.commands).toHaveLength(0);
});

test("selected force exposes boundary destinations and keeps gate move semantics", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await page.locator(".tac-force-main").first().click();
  await page.getByRole("button", { name: "移动到边界外星系" }).click();
  await expect
    .poll(() => commands.find((command) => command.action === "force.move"))
    .toMatchObject({
      force_id: 11,
      destination_system_id: 103,
      kind: "gate_move",
    });
});

test("many forces in one system aggregate instead of stacking off canvas", async ({
  page,
}) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    forces: Array.from({ length: 20 }, (_, index) => ({
      ...state.snapshot.forces[0],
      id: index + 1,
      name: `部队${index + 1}`,
    })),
  });
  await page.goto("/tactical");
  await expect(
    page.getByRole("button", { name: "查看德里克一全部20支部署" }),
  ).toBeVisible();
  await expect(page.locator(".tac-map-force")).toHaveCount(2);
});

test('access-only account switch unmounts old board and its private data',async({page})=>{
  await fixture(page)
  await page.addInitScript(()=>localStorage.removeItem('refresh_token'))
  await page.goto('/tactical')
  await expect(page.getByText('敌方前锋',{exact:true})).toBeVisible()
  await page.route('**/api/tactical/organizations/',route=>route.fulfill(json({organizations:[]})))
  const token=createFakeJwt({user_id:88,username:'new-account'})
  await page.evaluate(token=>{localStorage.setItem('access_token',token);window.dispatchEvent(new Event('auth:changed'))},token)
  await expect(page.getByText('敌方前锋',{exact:true})).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'建立你的指挥网络'})).toBeVisible()
})
