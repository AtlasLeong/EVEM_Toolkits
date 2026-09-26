import { test, expect } from "@playwright/test";
import { createFakeJwt, seedAuthenticatedSession } from "../e2e/helpers/auth.js";
import { installApiMock, json } from "../e2e/helpers/api.js";

test("a stalled token refresh cannot block the member read deadline", async ({ page }) => {
  await fixture(page, { role: 'commander' });
  await page.clock.install();
  let refreshes = 0, memberReads = 0;
  await page.route('**/api/user/token/refresh', () => { refreshes++; });
  await page.route('**/api/tactical/organizations/1/members/', route => { memberReads++; return route.fallback(); });
  await page.goto('/tactical');
  await expect(page.getByRole('button', { name: '人员管理', exact: true })).toBeVisible();
  const expired = createFakeJwt({ user_id: 23, exp: 1 });
  await page.evaluate(token => localStorage.setItem('access_token', token), expired);
  await page.getByRole('button', { name: '人员管理', exact: true }).click();
  await expect.poll(() => refreshes).toBe(1);
  await page.clock.runFor(15100);
  await expect(page.getByRole('dialog', { name: '人员管理', exact: true }).getByRole('alert')).toContainText('人员列表刷新超时');
  expect(memberReads).toBe(0);
});

test("a stalled member request times out and a later poll recovers", async ({ page }) => {
  await fixture(page, { role: "commander" });
  await page.clock.install();
  let stalled = true, requests = 0;
  await page.route("**/api/tactical/organizations/1/members/", route => {
    requests++;
    if (stalled) return;
    return route.fulfill(json({ members: [{ id: 2, user_id: 24, display_name: "恢复后的成员", role: "scout", status: "active" }],
      applications: [], online: [], member_count: 1, online_count: 0, capacity: 100 }));
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "人员管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "人员管理", exact: true });
  await expect.poll(() => requests).toBeGreaterThan(0);
  const initialRequests = requests;
  await page.clock.runFor(10000);
  expect(requests).toBe(initialRequests); // Polls must not pile up while one read waits.
  await page.clock.runFor(5100);
  await expect(dialog.getByRole("alert")).toContainText("人员列表刷新超时");
  stalled = false;
  // A retry can have started on the same timer tick as the first timeout.
  // Let that in-flight read reach its own deadline before the next healthy poll.
  await page.clock.runFor(20100);
  await expect(dialog.getByText("恢复后的成员", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("a delayed member poll cannot overwrite the roster refreshed after an operation", async ({ page }) => {
  await fixture(page, { role: "commander" });
  const before = { members: [{ id: 2, user_id: 24, display_name: "旧成员", role: "scout", status: "active" }],
    applications: [], online: [], member_count: 1, online_count: 0, capacity: 100 };
  const after = { ...before, members: [{ ...before.members[0], display_name: "更新后的成员" }] };
  let hold = false, delayed, latest = before;
  let finishOld;
  const oldFinished = new Promise(resolve => { finishOld = resolve; });
  await page.route("**/api/tactical/organizations/1/members/", async route => {
    if (hold) { hold = false; delayed = async () => { await route.fulfill(json(before)); finishOld(); }; return; }
    await route.fulfill(json(latest));
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "人员管理", exact: true }).click();
  const members = page.getByRole("dialog", { name: "人员管理", exact: true });
  await expect(members.getByText("旧成员", { exact: true })).toBeVisible();
  hold = true;
  await expect.poll(() => Boolean(delayed), { timeout: 8000 }).toBe(true);
  latest = after;
  await members.getByRole("button", { name: "生成邀请链接", exact: true }).click();
  await expect(members.getByText("更新后的成员", { exact: true })).toBeVisible();
  await delayed();
  await oldFinished;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Immediate assertion: polling must not hide a rollback by healing it 5s later.
  expect(await members.getByText("旧成员", { exact: true }).count()).toBe(0);
  await expect(members.getByText("更新后的成员", { exact: true })).toBeVisible();
});

test("a transient map failure can be retried without leaving the current board", async ({ page }) => {
  await fixture(page, { role: "commander" });
  let unavailable = true;
  await page.route("**/api/tactical/organizations/1/map/", async route => {
    if (unavailable) return route.fulfill(json({ detail: "临时网络故障" }, 503));
    return route.fallback();
  });
  await page.goto("/tactical");
  await expect(page.getByRole("alert").filter({ hasText: "临时网络故障" })).toBeVisible();
  unavailable = false;
  await page.getByRole("button", { name: "重新加载星图", exact: true }).click();
  await expect(page.locator(".tac-map-system")).toHaveCount(2);
  await expect(page.getByRole("alert").filter({ hasText: "局部星图加载失败" })).toHaveCount(0);
});

test('empty scope offers a centered map action to its commander', async ({ page }) => {
  const fx = await fixture(page, { role: 'commander' });
  fx.setSnapshot({ ...fx.snapshot, scope: { region_ids: [], border_hops: 1, version: 1 } });
  await page.route('**/api/tactical/organizations/1/map/', route => route.fulfill(json({
    systems: [], stargates: [], constellations: [], boundary_exits: [],
    scope: { region_ids: [], border_hops: 1, version: 1 },
  })));
  await page.goto('/tactical');
  const map = page.getByRole('group', { name: '局部作战星图', exact: true });
  const action = page.getByRole('button', { name: '选择作战星域' });
  await expect(action).toBeVisible();
  const mapBox = await map.boundingBox(), actionBox = await action.boundingBox();
  expect(Math.abs(actionBox.x + actionBox.width / 2 - (mapBox.x + mapBox.width / 2))).toBeLessThan(24);
  await action.click();
  await expect(page.getByRole('dialog', { name: '设置作战星域' })).toBeVisible();
});

test('star intel replaces the overview context without leaving the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await fixture(page, { role: 'commander' });
  await page.goto('/tactical');
  await page.getByRole('button', { name: '展开兵力总览' }).click();
  await page.getByRole('button', { name: '选择星系 德里克一' }).click();
  const detail = page.getByRole('region', { name: '星系敌情详情' });
  await expect(detail).toBeVisible();
  await expect(page.getByRole('complementary', { name: '兵力总览与上报记录' })).toBeHidden();
  const rect = await detail.boundingBox();
  expect(rect.x + rect.width).toBeLessThanOrEqual(1100);
  expect(rect.y + rect.height).toBeLessThanOrEqual(800);
  await detail.getByRole('button', { name: '关闭星系详情' }).click();
  await expect(page.getByRole('complementary', { name: '兵力总览与上报记录' })).toBeVisible();
});

for (const side of ['all', 'friendly']) test(`typing in the overview search does not recompute unchanged force placement (${side})`, async ({ page }) => {
  const fx = await fixture(page, { role: "commander" });
  if (side === 'friendly') fx.setSnapshot({ ...fx.snapshot, forces: [{ ...fx.snapshot.forces[0], side: 'friendly' }] });
  // Count calls at the module boundary, but execute the real layout algorithm.
  await page.route("**/src/utils/tacticalMarkerLayout.js*", async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace("export function layoutForceMarkers(", "function measuredLayoutForceMarkers(");
    await route.fulfill({ response, body: `${source}\nexport function layoutForceMarkers(...args) { window.__forceLayoutCalls = (window.__forceLayoutCalls || 0) + 1; return measuredLayoutForceMarkers(...args); }` });
  });
  await page.goto("/tactical");
  await expect(page.locator(".tac-map-force")).toHaveCount(1);
  if (side === 'friendly') await page.getByRole('button', { name: '仅己方', exact: true }).click();
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  // Freeze snapshot traffic after initial data so this isolates local typing.
  await page.route("**/api/tactical/organizations/1/snapshot/**", () => {});
  const before = await page.evaluate(() => window.__forceLayoutCalls);
  expect(before).toBeGreaterThan(0);
  await page.getByPlaceholder("部队、星系或上报者").fill("无匹配项");
  await expect(page.locator(".tac-force-main")).toHaveCount(0);
  expect(await page.evaluate(() => window.__forceLayoutCalls)).toBe(before);
});

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
        in_scope: true,
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
        in_scope: true,
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
        member_count: 2,
        online_count: 3,
        capacity: 100,
      });
    if (url.pathname.endsWith("/commands/")) {
      commands.push(body);
      if (conflict && body.action === "report.update")
        return json(
          { detail: "此上报记录已更新，请重新核对", code: "version_conflict" },
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

test('strength overview count-only report is the default and needs no fleet name', async ({page}) => {
  const fx=await fixture(page);
  await page.goto('/tactical');
  await page.getByRole('button',{name:'快速上报',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'人数上报',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(dialog.getByRole('textbox',{name:'舰队名称',exact:true})).toHaveCount(0);
  await dialog.getByLabel('搜索上报星系').fill('德里克');
  await dialog.getByRole('button',{name:/德里克一/}).click();
  await dialog.getByLabel('敌方人数',{exact:true}).fill('70');
  await dialog.getByRole('button',{name:'提交上报',exact:true}).click();
  await expect.poll(()=>fx.commands.length).toBe(1);
  expect(fx.commands[0]).toMatchObject({action:'report.create',report_kind:'system_count',people:70});
  expect(fx.commands[0]).not.toHaveProperty('fleet_name');
});

test('strength overview uses system totals once, updates live and shows membership separately', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.member_count=8;
  fx.snapshot.forces.push({...fx.snapshot.forces[0],id:12,side:'friendly',name:'己方大航队',people:82});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70,in_scope:true}];
  await page.goto('/tactical');
  const enemy=page.getByRole('region',{name:'敌方兵力估计'});
  const friendly=page.getByRole('region',{name:'己方兵力估计'});
  await expect(enemy.locator('.tac-strength-number')).toHaveText('70');
  await expect(friendly.locator('.tac-strength-number')).toHaveText('82');
  const members=page.getByRole('button',{name:'人员管理',exact:true});
  await expect(members).toContainText('成员 8');
  await expect(members).toContainText('在线 3');
  await page.getByRole('button',{name:'展开兵力总览',exact:true}).click();
  const panel=page.getByRole('complementary',{name:'兵力总览与上报记录'});
  await expect(panel.getByRole('button',{name:'上报记录',exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'成员',exact:true})).toHaveCount(0);
  await expect(panel.locator('.tac-count-row')).toContainText(['德里克一']);
  fx.setSnapshot({...fx.snapshot,member_count:9,online_count:4,reports:[{...fx.snapshot.reports[0],version:2,people:90}]});
  // HTTP fallback polls at a minimum five-second cadence; allow one full
  // refresh window plus runner/network jitter before asserting the update.
  await expect(enemy.locator('.tac-strength-number')).toHaveText('90', { timeout: 15000 });
  await expect(members).toContainText('成员 9');
  await expect(members).toContainText('在线 4');
  await members.click();
  await expect(page.getByRole('dialog',{name:'人员管理',exact:true})).toBeVisible();
});

test('strength overview current scope excludes outside counts, search never changes totals, scout hides friendly',async({page})=>{
  const fx=await fixture(page);
  fx.snapshot.forces.push({...fx.snapshot.forces[0],id:13,system_id:999,system_name:'范围外',name:'边界远征',people:200,in_scope:false});
  await page.goto('/tactical');
  const enemy=page.getByRole('region',{name:'敌方兵力估计'});
  await expect(enemy.locator('.tac-strength-number')).toHaveText('32');
  await expect(page.getByRole('region',{name:'己方兵力估计'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'人员管理',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'展开兵力总览',exact:true}).click();
  await page.getByRole('button',{name:'组织全部',exact:true}).click();
  await expect(enemy.locator('.tac-strength-number')).toHaveText('232');
  await page.getByLabel('搜索部署或上报记录').fill('找不到');
  await expect(enemy.locator('.tac-strength-number')).toHaveText('232');
});

test('strength overview selection links list and map without moving camera on live updates', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  await page.goto('/tactical');
  await page.getByRole('button',{name:'展开兵力总览'}).click();
  const row=page.locator('[data-force-row-id="11"]');
  await row.locator('.tac-force-main').click();
  const mapView=page.locator('.tac-map > svg > g').first();
  await expect(page.getByRole('button',{name:'返回上一视野'})).toBeVisible();
  const camera=await mapView.getAttribute('transform');
  fx.setSnapshot({...fx.snapshot, forces:[{...fx.snapshot.forces[0],version:2,people:43,system_id:102,system_name:'德里克二'}]});
  // HTTP fallback polls at a minimum five-second cadence; allow one full
  // refresh window plus runner/network jitter before asserting the update.
  await expect(row).toContainText('德里克二', { timeout: 15000 });
  await expect(page.getByRole('region',{name:'敌方兵力估计'}).locator('.tac-strength-number')).toHaveText('43', { timeout: 15000 });
  expect(await mapView.getAttribute('transform')).toBe(camera);
  await page.getByRole('button',{name:'收起兵力总览'}).click();
  await expect(page.getByRole('region',{name:'星系敌情详情'}).getByRole('heading')).toHaveText('德里克二');
});

test('strength overview map selection scrolls its fleet into the open list', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.forces=Array.from({length:16},(_,index)=>({...fx.snapshot.forces[0],id:index+1,name:`舰队${index+1}`,system_id:index===15?102:101,system_name:index===15?'德里克二':'德里克一'}));
  await page.goto('/tactical');
  await page.getByRole('button',{name:'展开兵力总览'}).click();
  await page.locator('[data-force-id="16"]').focus();
  await page.keyboard.press('Enter');
  const selected=page.locator('[data-force-row-id="16"]');
  await expect(selected).toHaveClass(/is-selected/);
  await expect(selected.locator('.tac-force-main')).toBeInViewport();
});

test('strength overview count selection reveals its row from a filtered reporting tab',async({page})=>{
  const fx=await fixture(page);
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.goto('/tactical');
  await page.getByRole('button',{name:'展开兵力总览'}).click();
  await page.getByRole('button',{name:'上报记录',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索部署或上报记录'}).fill('不匹配的名称');
  await page.locator('.tac-map-count').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'兵力总览',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('textbox',{name:'搜索部署或上报记录'})).toHaveValue('');
  await expect(page.locator('.tac-count-row.is-selected')).toBeInViewport();
});

test('strength overview count marker coexists with a fleet and can be relocated', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.goto('/tactical');
  const marker=page.locator('.tac-map-count');
  await expect(marker).toContainText('人数上报 70人');
  await expect(page.locator('.tac-map-force')).toContainText('32');
  await marker.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region',{name:'星系敌情详情'})).toContainText('德里克一');
  const before=await page.locator('.tac-map > svg > g').first().getAttribute('transform');
  const box=await marker.boundingBox(), destination=await page.getByRole('button',{name:'选择星系 德里克二'}).boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(destination.x+destination.width/2,destination.y+destination.height/2,{steps:8}); await page.mouse.up();
  await expect.poll(()=>fx.commands.find(command=>command.action==='report.move')).toMatchObject({
    report_id:21, expected_version:1, destination_system_id:102,
  });
  expect(await page.locator('.tac-map > svg > g').first().getAttribute('transform')).toBe(before);
});

test('count card close asks for confirmation and withdraws the report without deleting it', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.goto('/tactical');
  const close=page.getByRole('button',{name:'撤下德里克一人数上报'});
  await close.click();
  const dialog=page.getByRole('dialog',{name:'撤下人数上报'});
  await expect(dialog).toBeVisible();
  expect(fx.commands).toHaveLength(0);
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await close.click();
  await page.getByRole('dialog',{name:'撤下人数上报'}).getByRole('button',{name:'确认撤下'}).click();
  await expect.poll(()=>fx.commands.find(command=>command.action==='report.withdraw')).toMatchObject({report_id:21,expected_version:1});
});

test('archive and withdraw confirmations are compact, readable and viewport-safe', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.forces[0].name='远炮战列队';
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.goto('/tactical');
  const inspect = async (dialog,target,kind) => {
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(target);
    await expect(dialog).toContainText('保留');
    expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(460);
    const margins=await dialog.locator('.tac-dialog-body > p').first().evaluate(node=>({
      top:getComputedStyle(node).marginTop,bottom:getComputedStyle(node).marginBottom,
    }));
    expect(margins).toEqual({top:'0px',bottom:'0px'});
    await page.screenshot({path:`output/playwright/tactical-${kind}-confirm-desktop.png`});
    await page.setViewportSize({width:320,height:640});
    const mobile=await dialog.boundingBox();
    expect(mobile.x).toBeGreaterThanOrEqual(0);
    expect(mobile.x+mobile.width).toBeLessThanOrEqual(320);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`output/playwright/tactical-${kind}-confirm-mobile.png`});
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({width:1440,height:1000});
  };
  await page.getByRole('button',{name:'归档远炮战列队'}).click();
  await expect(page.getByRole('dialog',{name:'归档部署'})).toContainText('已关联的上报不受影响');
  await inspect(page.getByRole('dialog',{name:'归档部署'}),'远炮战列队','archive');
  await page.getByRole('button',{name:'撤下德里克一人数上报'}).click();
  await inspect(page.getByRole('dialog',{name:'撤下人数上报'}),'德里克一 · 70 人','withdraw');
  expect(fx.commands).toHaveLength(0);
});

test('unknown count confirmation does not display a dangling people suffix', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:null}];
  await page.goto('/tactical');
  await page.getByRole('button',{name:'撤下德里克一人数上报'}).click();
  await expect(page.getByRole('dialog',{name:'撤下人数上报'}).locator('.tac-confirm-target strong'))
    .toHaveText('德里克一 · 人数未知');
});

test('failed confirmations keep error messages readable against the dark dialog', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.route('**/api/tactical/organizations/1/commands/',route=>route.fulfill(json({detail:'操作失败，请重试'},409)));
  await page.goto('/tactical');
  for (const {open,title,confirm} of [
    {open:'归档敌方前锋',title:'归档部署',confirm:'确认归档'},
    {open:'撤下德里克一人数上报',title:'撤下人数上报',confirm:'确认撤下'},
  ]) {
    await page.getByRole('button',{name:open}).click();
    const dialog=page.getByRole('dialog',{name:title});
    await dialog.getByRole('button',{name:confirm}).click();
    const alert=dialog.getByRole('alert');
    await expect(alert).toContainText('操作失败');
    const contrast=await alert.evaluate(node=>{
      const css=getComputedStyle(node);
      const channels=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
      const luminance=value=>channels(value).map(channel=>{
        const normalized=channel/255;
        return normalized<=.04045?normalized/12.92:((normalized+.055)/1.055)**2.4;
      }).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
      const first=luminance(css.color),second=luminance(css.backgroundColor);
      return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
  }
});

test('a scout sees the close control only on their own count card', async ({page}) => {
  const fx=await fixture(page,{role:'scout'});
  fx.snapshot.reports=[
    {...fx.snapshot.reports[0],report_kind:'system_count',people:70},
    {...fx.snapshot.reports[0],id:22,author_id:24,author_name:'斥候乙',report_kind:'system_count',system_id:102,system_name:'德里克二',people:44},
  ];
  await page.goto('/tactical');
  await expect(page.getByRole('button',{name:'撤下德里克一人数上报'})).toBeVisible();
  await expect(page.getByRole('button',{name:'撤下德里克二人数上报'})).toHaveCount(0);
  await expect(page.locator('[data-count-report-id="21"]')).toHaveCSS('cursor','grab');
  await expect(page.locator('[data-count-report-id="22"]')).toHaveCSS('cursor','pointer');
});

test('strength overview discloses stale sources and outside labels even without mobile graph',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.forces[0].in_scope=false;
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:80,in_scope:false,observed_at:new Date(Date.now()-600000).toISOString()}];
  await page.goto('/tactical');
  await page.getByRole('button',{name:'组织全部',exact:true}).click();
  await expect(page.locator('.tac-count-row')).toContainText('范围外');
  await expect(page.locator('.tac-count-row')).toContainText('待复核');
  await expect(page.locator('.tac-force-card')).toContainText('范围外');
  await expect(page.locator('.tac-overview-method')).toContainText('人数上报优先');
  await expect(page.locator('.tac-overview-method')).toContainText('不相加');
  await expect(page.getByRole('region',{name:'敌方兵力估计'}).locator('.tac-strength-number')).toHaveText('80');
});

test('strength overview is available on mobile with no graph download',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.member_count=8;
  fx.snapshot.forces[0].in_scope=true;
  await page.goto('/tactical');
  await expect(page.getByRole('region',{name:'敌方兵力估计'}).locator('.tac-strength-number')).toHaveText('32');
  await expect(page.getByRole('button',{name:'人员管理',exact:true})).toContainText('成员 8');
  expect(fx.requests.some(path=>path.endsWith('/map/'))).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("system-intel opens the real map with the list collapsed and no constellation cards", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  await expect(page.locator('.tac-map-system')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '进入星座 德里克核心', exact: true })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '兵力总览与上报记录' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '展开兵力总览' })).toBeVisible();
});

test("system-intel quick report publishes a system enemy snapshot without confirmation", async ({ page }) => {
  const fx = await fixture(page);
  await page.goto('/tactical');
  await page.getByRole('button', { name: '快速上报', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', {name:'人数上报', exact:true}).click();
  await dialog.getByRole('textbox', { name: '搜索上报星系' }).fill('德里克');
  await dialog.getByRole('button', { name: /德里克一/ }).click();
  await dialog.getByRole('spinbutton', { name: '敌方人数', exact: true }).fill('68');
  await dialog.getByRole('button', { name: '提交上报', exact: true }).click();
  await expect.poll(() => fx.commands.length).toBe(1);
  expect(fx.commands[0]).toMatchObject({ action: 'report.create', report_kind: 'system_count', people: 68, system_id: 101 });
});

test('named fleet quick report supports preset and custom names without a confirmation step', async ({page}) => {
  const fx = await fixture(page);
  await page.goto('/tactical');
  await page.getByRole('button',{name:'快速上报',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'新增舰队',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'新增舰队',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'大航队',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'舰队名称',exact:true})).toHaveValue('大航队');
  await dialog.getByRole('textbox',{name:'舰队名称',exact:true}).fill('远炮战列队');
  await dialog.getByRole('textbox',{name:'搜索上报星系'}).fill('德里克');
  await dialog.getByRole('button',{name:/德里克一/}).click();
  await dialog.getByRole('spinbutton',{name:'敌方人数',exact:true}).fill('50');
  await dialog.getByRole('button',{name:'提交上报',exact:true}).click();
  await expect.poll(()=>fx.commands.length).toBe(1);
  expect(fx.commands[0]).toMatchObject({action:'report.create',report_kind:'fleet_intel',fleet_name:'远炮战列队',people:50,system_id:101});
  expect(fx.commands[0]).not.toHaveProperty('force_id');
});

test('named fleet existing selection pins the reviewed version while live data changes', async ({page}) => {
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.forces.push({...fx.snapshot.forces[0],id:12,side:'friendly',name:'保密己方'});
  await page.goto('/tactical');
  await page.getByRole('button',{name:'快速上报',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'更新已有舰队',exact:true}).click();
  const choices=dialog.getByRole('group',{name:'选择已有敌方舰队'});
  await expect(choices.getByRole('button',{name:/保密己方/})).toHaveCount(0);
  await choices.getByRole('button',{name:/敌方前锋/}).click();
  fx.setSnapshot({...fx.snapshot,forces:fx.snapshot.forces.map(f=>f.id===11?{...f,version:2,people:90}:f)});
  await expect(page.locator('.tac-map-force').filter({hasText:'90'})).toBeVisible();
  await dialog.getByRole('spinbutton',{name:'敌方人数',exact:true}).fill('55');
  await dialog.getByRole('button',{name:'提交上报',exact:true}).click();
  await expect.poll(()=>fx.commands.length).toBe(1);
  expect(fx.commands[0]).toMatchObject({action:'report.create',report_kind:'fleet_intel',force_id:11,force_expected_version:1,people:55});
  expect(fx.commands[0]).not.toHaveProperty('fleet_name');
});

test('named fleet badges show separate names, centered content beside archive and three rows before overflow', async({page})=>{
  const fx=await fixture(page,{role:'commander'});
  fx.setSnapshot({...fx.snapshot,forces:['大航队','远炮战列队','后勤队','拦截队'].map((name,i)=>({...fx.snapshot.forces[0],id:11+i,name,people:i===0?100:50}))});
  await page.goto('/tactical');
  await expect(page.locator('.tac-map-force')).toHaveCount(3);
  await expect(page.locator('.tac-map-force').first()).toHaveText(/大航队.*100/);
  const alignment=await page.locator('.tac-map-force').evaluateAll(nodes=>nodes.map(node=>{
    const rect=node.querySelector('rect'), text=node.querySelector('text');
    return {centerX:Number(text.getAttribute('x'))===(Number(rect.getAttribute('width'))-24)/2,
      centerY:Number(text.getAttribute('y'))===Number(rect.getAttribute('height'))/2,
      anchor:text.getAttribute('text-anchor'),baseline:text.getAttribute('dominant-baseline')};
  }));
  expect(alignment.every(a=>a.centerX&&a.centerY&&a.anchor==='middle'&&a.baseline==='central')).toBe(true);
  await page.getByRole('button',{name:'查看德里克一全部4支部署'}).click();
  await expect(page.locator('.tac-force-card')).toHaveCount(4);
});

test('fleet and count cards share one centered close control and content area', async ({page}) => {
  const fx = await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:70}];
  await page.goto('/tactical');
  const fleet = page.locator('.tac-map-force').first(), count = page.locator('.tac-map-count').first();
  await expect(fleet).toBeVisible();
  await expect(count).toBeVisible();
  const centers = async card => card.evaluate(node => {
    const rect=node.querySelector(':scope > rect'), text=node.querySelector(':scope > text');
    return {width:Number(rect.getAttribute('width')),textX:Number(text.getAttribute('x'))};
  });
  for (const card of [fleet,count]) {
    const {width,textX} = await centers(card);
    expect(textX).toBe((width-24)/2);
  }
  const fleetClose=page.locator('.tac-force-close'),countClose=page.locator('.tac-count-close');
  const paths=[];
  for (const close of [fleetClose,countClose]) {
    await expect(close).toBeVisible();
    const hit=await close.locator('rect').boundingBox(),icon=await close.locator('path').boundingBox();
    expect(hit.width).toBe(24);
    expect(hit.height).toBe(24);
    expect(Math.abs(hit.x+hit.width/2-icon.x-icon.width/2)).toBeLessThan(.5);
    expect(Math.abs(hit.y+hit.height/2-icon.y-icon.height/2)).toBeLessThan(.5);
    paths.push(await close.locator('path').getAttribute('d'));
  }
  expect(paths[0]).toBe(paths[1]);
});

test('read-only count cards center their text without a phantom close slot', async ({page}) => {
  const fx=await fixture(page,{role:'scout'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],id:22,author_id:24,author_name:'斥候乙',
    report_kind:'system_count',system_id:102,system_name:'德里克二',people:44}];
  await page.goto('/tactical');
  const count=page.locator('.tac-map-count[data-count-report-id="22"]');
  await expect(count).toBeVisible();
  const {width,textX}=await count.evaluate(node=>({width:Number(node.querySelector(':scope > rect').getAttribute('width')),
    textX:Number(node.querySelector(':scope > text').getAttribute('x'))}));
  expect(textX).toBe(width/2);
  await expect(count.locator('.tac-count-close')).toHaveCount(0);
});

test('named fleet source and observation update are visible to scouts without force management',async({page})=>{
  const fx=await fixture(page);
  fx.snapshot.forces[0]={...fx.snapshot.forces[0],name:'大航队',source_report_id:22,source_author_id:24,source_author_name:'斥候乙'};
  await page.goto('/tactical');
  await page.locator('.tac-map-force').click();
  const detail=page.getByRole('region',{name:'星系敌情详情'});
  await expect(detail).toContainText('斥候乙');
  await detail.getByRole('button',{name:'更新这支舰队',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('大航队');
  await expect(page.getByRole('button',{name:'编辑部署',exact:true})).toHaveCount(0);
});

test('named fleet own revision retains linked identity and never exposes legacy adoption',async({page})=>{
  const fx=await fixture(page,{role:'commander'});
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'fleet_intel',fleet_name:'大航队',force_id:11,is_current:true,status:'pending'}];
  await page.goto('/tactical');
  await page.getByRole('button',{name:'展开兵力总览'}).click();
  await page.getByRole('button',{name:'上报记录',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认 / 关联',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'修改我的上报',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('group',{name:'上报方式'})).toHaveCount(0);
  await expect(dialog).toContainText('不改变舰队当前部署位置');
  await dialog.getByRole('spinbutton',{name:'敌方人数',exact:true}).fill('99');
  await dialog.getByRole('button',{name:'保存修订',exact:true}).click();
  await expect.poll(()=>fx.commands.length).toBe(1);
  expect(fx.commands[0]).toMatchObject({action:'report.update',report_id:21,expected_version:1,report_kind:'fleet_intel',fleet_name:'大航队',people:99});
  expect(fx.commands[0]).not.toHaveProperty('force_id');
});

test('named fleet long custom names keep counts and selections within narrow containers',async({page})=>{
  const fx=await fixture(page);
  const name='A'.repeat(80);
  fx.snapshot.forces[0].name=name;
  await page.goto('/tactical');
  await page.locator('.tac-map-force').first().click();
  const row=page.locator('.tac-system-fleet-row').first();
  await expect(row).toBeVisible();
  expect(await row.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'快速上报',exact:true}).first().click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'更新已有舰队',exact:true}).click();
  const choices=dialog.getByRole('group',{name:'选择已有敌方舰队'});
  expect(await choices.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await choices.getByRole('button').first().click();
  const selection=dialog.locator('.tac-fleet-selection');
  await expect(selection).toContainText(name);
  expect(await selection.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});

test('named fleet star typography is uniform with or without system-count intelligence',async({page})=>{
  const fx=await fixture(page);
  fx.snapshot.reports=[{...fx.snapshot.reports[0],report_kind:'system_count',people:68}];
  await page.goto('/tactical');
  await page.getByRole('button',{name:'显示全部星系名称'}).click();
  await expect(page.locator('.tac-star-name')).toHaveCount(2);
  const styles=await page.locator('.tac-star-name').evaluateAll(nodes=>nodes.map(n=>({size:getComputedStyle(n).fontSize,weight:getComputedStyle(n).fontWeight})));
  expect(new Set(styles.map(s=>JSON.stringify(s))).size).toBe(1);
  await expect(page.locator('.tac-intel-label')).not.toContainText(['敌方 68']);
});

async function installDenseMap(page, coincident = false) {
  await page.route('**/api/tactical/organizations/1/map/', route => route.fulfill(json({
    systems: [
      { system_id:101, zh_name:'德里克一', x:400,z:400,security_status:.5 },
      { system_id:102, zh_name:'密集甲', x:600,z:600,security_status:.3 },
      { system_id:201, zh_name:'密集乙', x:coincident?600:601,z:600,security_status:.2 },
      { system_id:301, zh_name:'远端甲',x:0,z:0,security_status:0 },
      { system_id:401, zh_name:'远端乙',x:1000,z:1000,security_status:-.1 },
    ], stargates:[], boundary_exits:[], scope:{region_ids:[1],border_hops:0},
  })));
}
const starDot = (page, id) => page.locator(`[data-system-id="${id}"] .tac-star-dot`);
async function center(locator) { const box = await locator.boundingBox(); return { x:box.x+box.width/2,y:box.y+box.height/2 }; }

test('dense real systems focus on actual mouse click and return to original view', async ({page}) => {
  await fixture(page,{role:'commander'}); await installDenseMap(page);
  await page.goto('/tactical');
  await expect(starDot(page,102)).toBeVisible();
  const original = await center(starDot(page,102));
  await page.mouse.click(original.x, original.y);
  await expect(page.getByRole('button',{name:'返回上一视野'})).toBeVisible();
  const after = await center(starDot(page,102));
  expect(Math.hypot(after.x-original.x,after.y-original.y)).toBeGreaterThan(30);
  await page.getByRole('button',{name:'返回上一视野'}).click();
  expect(await center(starDot(page,102))).toEqual(original);
});

test('coincident systems offer a named chooser and do not pick render order', async ({page}) => {
  await fixture(page,{role:'scout'}); await installDenseMap(page,true);
  await page.goto('/tactical'); await expect(starDot(page,102)).toBeVisible();
  const target = await center(starDot(page,102)); await page.mouse.click(target.x,target.y);
  const chooser = page.getByRole('dialog',{name:'选择重叠星系'});
  await expect(chooser).toBeVisible();
  await expect(chooser).toHaveCSS('position','absolute');
  await chooser.getByRole('button',{name:/密集乙/}).click();
  await expect(page.locator('.tac-system-detail h2')).toHaveText('密集乙');
});

test('ambiguous drop waits for chosen star and does not zoom during a fleet drag', async ({page}) => {
  const fx = await fixture(page,{role:'commander'}); await installDenseMap(page,true);
  await page.goto('/tactical'); await expect(page.locator('.tac-map-force')).toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'实时同步'})).toBeVisible();
  const source = await center(page.locator('.tac-map-force')), target=await center(starDot(page,102));
  await page.mouse.move(source.x,source.y); await page.mouse.down();
  await page.mouse.move(target.x,target.y,{steps:10});
  const transform = await page.locator('.tac-map > svg > g').first().getAttribute('transform');
  await page.mouse.wheel(0,-200);
  expect(await page.locator('.tac-map > svg > g').first().getAttribute('transform')).toBe(transform);
  await page.mouse.up();
  const chooser = page.getByRole('dialog',{name:'选择部署目标星系'});
  await expect(chooser).toBeVisible(); expect(fx.commands).toHaveLength(0);
  await chooser.getByRole('button',{name:/密集乙/}).click();
  await expect.poll(()=>fx.commands.find(c=>c.action==='force.move')).toMatchObject({destination_system_id:201,kind:'correction',expected_version:1});
});

test('blank, same-system and outside drops do not submit commands',async({page})=>{
  const fx=await fixture(page,{role:'commander'}); await page.goto('/tactical');
  await expect(page.locator('.tac-map-force')).toBeVisible();
  const own=await center(starDot(page,101));
  const map=await page.locator('.tac-map > svg').boundingBox();
  for(const target of [own,{x:map.x+map.width/2,y:map.y+map.height/2},{x:map.x-20,y:map.y+map.height/2}]){
    const start=await center(page.locator('.tac-map-force'));
    await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(target.x,target.y,{steps:6}); await page.mouse.up();
  }
  expect(fx.commands).toHaveLength(0);
});

test("real map retains systems across constellation boundaries without card modes", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  await expect(page.getByRole("group", { name: "局部作战星图", exact: true })).toBeVisible();
  await expect(page.locator(".tac-map-gate")).toHaveCount(1);
  await expect(page.locator(".tac-map-caption")).toHaveCount(0);
  await expect(page.locator(".tac-map-bottom")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /选择星系/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: /星座总览/ })).toHaveCount(0);
});

test("tactical map uses a compact feedback toast and a shared boundary dock", async ({ page }) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");

  const mapSection = page.locator(".tac-map-section");
  const dock = mapSection.locator(".tac-map-dock");
  await expect(dock).toBeVisible();

  await page.locator(".tac-map-force").first().click();
  await page.locator('.tac-system-exits > summary').click();
  const boundaryList = dock.locator(".tac-boundary-list");
  await expect(boundaryList).toBeVisible();
  expect(await boundaryList.evaluate((node) => node.closest(".tac-map-dock") !== null)).toBe(true);

  await page.getByRole("button", { name: "移动到边界外星系" }).click();
  const notice = page.locator(".tac-board-messages .tac-notice");
  await expect(notice).toBeVisible();

  const mapBox = await mapSection.boundingBox();
  const noticeBox = await notice.boundingBox();
  expect(noticeBox.width).toBeLessThan(mapBox.width * 0.55);
  await expect(notice).toBeHidden({ timeout: 4000 });
});

test("inactive map topology and view filters remain visually discoverable", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map.locator(".tac-map-gate")).toHaveCount(1);

  const gateOpacity = Number(await map.locator(".tac-map-gate").getAttribute("opacity"));
  expect(gateOpacity).toBeGreaterThanOrEqual(0.3);

  const viewFilters = page.locator(".tac-map-mode-switch button");
  await expect(viewFilters).toHaveCount(2);
  const idle = viewFilters.filter({ hasText: "名称" });
  const active = viewFilters.filter({ hasText: "上报" });
  const idleStyle = await idle.evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  await active.click();
  await expect(active).toHaveAttribute("aria-pressed", "true");
  const activeStyle = await active.evaluate(node => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, border: style.borderTopColor };
  });
  expect(activeStyle.background !== idleStyle.background || activeStyle.border !== idleStyle.border).toBe(true);
});

test('search and bottom map controls have separate clear positions', async ({page}) => {
  await fixture(page,{role:'commander',overview:true});
  await page.goto('/tactical');
  const dock = page.locator('.tac-map-controls');
  const summary = await page.getByRole('region',{name:'战术概览'}).boundingBox();
  const rect = await dock.boundingBox();
  expect(rect.y).toBeGreaterThan(summary.y + summary.height);
  const toolbar = await page.locator('.tac-map-toolbar').boundingBox();
  expect(toolbar.y).toBeGreaterThan(rect.y + rect.height);
  await expect(page.getByRole('button', {name: '切换真实空间', exact: true})).toHaveCount(0);
});

test('many reports produce one latest system count and retain accessible author history', async ({page}) => {
  const state=await fixture(page,{role:'commander'});
  state.setSnapshot({...state.snapshot,reports:Array.from({length:12},(_,index)=>({...state.snapshot.reports[0],report_kind:'system_count',id:index+30,status:'pending',author_name:'超长名字的前线斥候'+index,people:index+50,ships:{assault_carrier:1,heavy_carrier:5}}))});
  await page.goto('/tactical');
  await expect(page.locator('.tac-map-report-marker')).toHaveCount(0);
  await page.getByRole('button', {name:'选择星系 德里克一', exact:true}).click();
  await expect(page.locator('.tac-system-count')).toContainText('61');
  await expect(page.locator('.tac-system-source')).toContainText('超长名字的前线斥候11');
  await page.locator('.tac-system-history > summary').click();
  await expect(page.locator('.tac-system-history > div')).toHaveCount(12);
  await page.getByRole('button',{name:'展开兵力总览'}).click();
  await page.getByRole('button',{name:'上报记录',exact:true}).click();
  await expect(page.locator('.tac-report-card')).toHaveCount(12);
  await expect(page.getByRole('button',{name:'确认 / 关联',exact:true})).toHaveCount(0);
});

test('all system names can be shown and a selected system exposes loaded and boundary gates',async({page})=>{
  await fixture(page,{role:'commander',overview:true});
  await page.goto('/tactical');
  await page.getByRole('button',{name:'显示全部星系名称',exact:true}).click();
  await expect(page.getByRole('button',{name:'显示全部星系名称',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('.tac-map-force').first().click();
  await page.locator('.tac-system-exits > summary').click();
  const exits=page.locator('.tac-boundary-list');
  await expect(exits.getByRole('button',{name:'移动到德里克二'})).toBeVisible();
  await expect(exits.getByRole('button',{name:'移动到边界外星系'})).toBeVisible();
});

test("search focuses the selected system without replacing real map with constellation cards", async ({ page }) => {
  await fixture(page, { role: "commander", overview: true });
  await page.goto("/tactical");
  await page.getByLabel("搜索当前星图").fill("德里克一");
  await page.locator('.tac-map-search-results').getByRole("option", { name: /德里克一/ }).click();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  const panel = await page.getByRole("complementary", { name: "兵力总览与上报记录" }).boundingBox();
  const overview = await page.getByRole("region", { name: "战术概览" }).boundingBox();
  expect(panel.x).toBeGreaterThan(before.x);
  expect(panel.y).toBeGreaterThan(before.y);
  expect(panel.x + panel.width).toBeLessThan(before.x + before.width);
  expect(overview.y).toBeGreaterThan(before.y);
  // Two estimate cards now disclose scope and freshness, without covering search.
  expect(overview.height).toBeLessThan(100);
  await page.getByRole("button", { name: "收起兵力总览" }).click();
  await expect(page.getByRole("complementary", { name: "兵力总览与上报记录" })).toHaveCount(0);
  expect(await map.boundingBox()).toEqual(before);
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await expect(page.getByRole("complementary", { name: "兵力总览与上报记录" })).toBeVisible();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  expect(await map.getAttribute("viewBox")).toBe(viewport);
});

function tacticalRgbLuminance(value) {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
  return channels.reduce((sum, channel, index) => {
    const normalized = channel / 255;
    const linear = normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function tacticalContrast(foreground, background) {
  const light = Math.max(tacticalRgbLuminance(foreground), tacticalRgbLuminance(background));
  const dark = Math.min(tacticalRgbLuminance(foreground), tacticalRgbLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test('tactical sidebar keeps key metadata readable and selected states explicit', async ({ page }) => {
  await fixture(page, { role: 'commander', overview: true });
  await page.goto('/tactical');
  const reopen = page.getByRole('button', { name: '展开兵力总览' });
  await expect(page.locator('.tac-map-force')).toBeVisible();
  await expect(reopen).toHaveCount(1);
  await reopen.click();
  const panel = page.locator('.tac-side-panel');
  await expect(panel).toBeVisible();

  const styles = await panel.evaluate(element => {
    const read = selector => {
      const node = element.querySelector(selector);
      const style = getComputedStyle(node);
      return {
        color: style.color,
        background: style.backgroundColor,
        fontSize: Number.parseFloat(style.fontSize),
      };
    };
    return {
      idleTab: read('.tac-panel-tabs > button:not([aria-pressed="true"])'),
      location: read('.tac-force-location'),
      age: read('.tac-age'),
      source: read('.tac-fleet-source'),
      panelBackground: getComputedStyle(element).backgroundColor,
    };
  });

  expect(styles.idleTab.fontSize).toBeGreaterThanOrEqual(12);
  expect(styles.location.fontSize).toBeGreaterThanOrEqual(12);
  expect(styles.age.fontSize).toBeGreaterThanOrEqual(12);
  expect(styles.source.fontSize).toBeGreaterThanOrEqual(12);
  expect(tacticalContrast(styles.idleTab.color, styles.panelBackground)).toBeGreaterThanOrEqual(4.5);
  expect(tacticalContrast(styles.location.color, styles.panelBackground)).toBeGreaterThanOrEqual(4.5);

  const idleBackground = await panel.locator('.tac-panel-tabs > button:not([aria-pressed="true"]):not(.tac-panel-collapse)').evaluate(node => getComputedStyle(node).backgroundColor);
  const activeBackground = await panel.locator('.tac-panel-tabs > button[aria-pressed="true"]').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(activeBackground).not.toBe(idleBackground);
});

test("tactical cards keep a visible connector before selection", async ({ page }) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map.locator(".tac-map-force")).toBeVisible();
  const leaders = map.locator(".tac-map-marker-leader");
  expect(await leaders.count()).toBeGreaterThan(0);
  await map.locator(".tac-map-force").first().click();
  await expect(map.locator(".tac-map-marker-leader.is-active")).toHaveCount(1);
});

test("map wheel zoom does not scroll the surrounding page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map).toBeVisible();
  await expect.poll(() => map.evaluate((element) => getComputedStyle(element).overscrollBehavior)).toBe("contain");
  await page.evaluate(() => window.scrollTo(0, 220));
  const before = await page.evaluate(() => window.scrollY);
  await map.hover({ position: { x: 600, y: 450 } });
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});

test("wheel bursts zoom gently around the pointer while names settle once", async ({ page }) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const map = page.getByRole("group", { name: "局部作战星图", exact: true });
  await expect(map).toBeVisible();
  const mapSurface = page.locator(".tac-system-intel-map");
  const camera = map.locator('g[transform^="translate("]').first();
  const readCamera = async () => {
    const transform = await camera.getAttribute("transform");
    const match = transform.match(/^translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)$/);
    expect(match).not.toBeNull();
    return { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) };
  };
  const [, , width, height] = (await map.getAttribute("viewBox")).split(" ").map(Number);
  const anchor = { x: width * .56, y: height * .42 };
  const before = await readCamera();
  await map.evaluate((svg, point) => {
    const rect = svg.getBoundingClientRect();
    for (let index = 0; index < 8; index++) svg.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaY: -100,
      clientX: rect.left + point.x * rect.width / point.width,
      clientY: rect.top + point.y * rect.height / point.height,
    }));
  }, { ...anchor, width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await readCamera();
  expect(after.scale).toBeGreaterThan(before.scale);
  expect(after.scale / before.scale).toBeLessThan(1.16);
  expect(Math.abs((anchor.x - after.x) / after.scale - (anchor.x - before.x) / before.scale)).toBeLessThan(1);
  expect(Math.abs((anchor.y - after.y) / after.scale - (anchor.y - before.y) / before.scale)).toBeLessThan(1);
  await expect(mapSurface).toHaveClass(/is-wheel-zooming/);
  await expect(mapSurface).toHaveClass(/is-label-moving/);
  await expect(mapSurface).not.toHaveClass(/is-wheel-zooming/, { timeout: 1500 });
  await expect.poll(() => mapSurface.evaluate(element => element.classList.contains('is-label-settling'))).toBe(true);

  let previousScale=after.scale;
  await map.hover({position:{x:600,y:300}});
  for (let index=0;index<4;index++) {
    await page.mouse.wheel(0,-100);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const currentScale=(await readCamera()).scale;
    expect(currentScale).toBeGreaterThan(previousScale);
    expect(currentScale/previousScale).toBeLessThan(1.16);
    previousScale=currentScale;
  }
  await expect(mapSurface).not.toHaveClass(/is-wheel-zooming/, { timeout: 1500 });

  for (let index = 0; index < 15; index++) await page.getByRole("button", { name: "放大地图" }).click();
  const limit = await readCamera();
  expect(limit.scale).toBe(16);
  await map.evaluate(svg => svg.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true, cancelable: true, deltaY: -100, clientX: 400, clientY: 400,
  })));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await readCamera()).toEqual(limit);
  await expect(mapSurface).not.toHaveClass(/is-wheel-zooming/);
});

test("marker zoom keeps a centered card centered and never flips a side callout", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  const original = state.snapshot.forces[0];
  state.setSnapshot({ ...state.snapshot, forces: [
    { ...original, id: 11, name: "敌方主力", system_id: 101, system_name: "前沿一" },
    { ...original, id: 12, name: "敌方主力", system_id: 102, system_name: "前沿二" },
    { ...original, id: 13, name: "敌方主力", system_id: 103, system_name: "前沿三" },
  ] });
  await page.route('**/api/tactical/organizations/1/map/', route => route.fulfill(json({
    systems: [
      {system_id:101,zh_name:'前沿一',x:-300,z:267,security_status:-.2},
      {system_id:102,zh_name:'前沿二',x:-257,z:264,security_status:-.2},
      {system_id:103,zh_name:'前沿三',x:-214,z:267,security_status:-.2},
      {system_id:104,zh_name:'西侧边界',x:-500,z:-500,security_status:-.2},
      {system_id:105,zh_name:'东侧边界',x:500,z:500,security_status:-.2},
    ], stargates: [], boundary_exits: [], scope: state.snapshot.scope,
  })));
  await page.goto('/tactical');
  const map = page.getByRole('group', { name: '局部作战星图', exact: true });
  const badge = page.locator('.tac-map-force[data-force-id="11"]');
  const dot = page.locator('.tac-map-system[data-system-id="101"] .tac-star-dot');
  await expect(badge).toBeVisible();
  const mapBox = await map.boundingBox();
  await page.mouse.move(mapBox.x + 350, mapBox.y + 190);
  const offset = async () => {
    const b = await badge.boundingBox(), d = await dot.boundingBox();
    return {x:b.x+b.width/2-d.x-d.width/2,y:b.y+b.height/2-d.y-d.height/2};
  };
  for (let step = 0; step < 2; step++) {
    await page.mouse.wheel(0, -100);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  }
  const before = await offset();
  for (let step=0;step<3;step++) {
    await page.mouse.wheel(0,-100);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const after=await offset();
    if (Math.abs(before.x) <= 2) expect(Math.abs(after.x)).toBeLessThanOrEqual(2);
    else if (Math.abs(after.x) > 2) expect(Math.sign(after.x)).toBe(Math.sign(before.x));
    if (Math.abs(before.y)>10) expect(Math.sign(after.y)).toBe(Math.sign(before.y));
    expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(90);
  }
  await page.screenshot({path:'output/playwright/tactical-stable-slots-after-zoom.png'});
});

test("fleet and count cards remain centered on their own stars after zoom settles", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  const original = state.snapshot.forces[0];
  state.setSnapshot({
    ...state.snapshot,
    forces: [
      { ...original, id: 11, name: "无畏队", people: 30, system_id: 101, system_name: "西侧" },
      { ...original, id: 12, name: "远炮战列队", people: 120, system_id: 102, system_name: "东侧" },
    ],
    reports: [{ ...state.snapshot.reports[0], id: 21, report_kind: "system_count", status: "pending",
      people: 24, system_id: 103, system_name: "中部" }],
  });
  await page.route('**/api/tactical/organizations/1/map/', route => route.fulfill(json({
    systems: [
      { system_id: 101, zh_name: "西侧", x: -160, z: 0, security_status: -.7 },
      { system_id: 102, zh_name: "东侧", x: 160, z: 0, security_status: -.7 },
      { system_id: 103, zh_name: "中部", x: 0, z: 0, security_status: -.7 },
      { system_id: 104, zh_name: "西上界", x: -500, z: -500, security_status: -.7 },
      { system_id: 105, zh_name: "东下界", x: 500, z: 500, security_status: -.7 },
    ], stargates: [], boundary_exits: [], scope: state.snapshot.scope,
  })));
  await page.goto('/tactical');
  const map = page.getByRole('group', { name: '局部作战星图', exact: true });
  const targets = [
    { card: '.tac-map-force[data-force-id="11"]', system: 101 },
    { card: '.tac-map-force[data-force-id="12"]', system: 102 },
    { card: '.tac-map-count[data-count-system-id="103"]', system: 103 },
  ];
  const expectCentered = async () => {
    for (const { card, system } of targets) {
      const badge = await map.locator(card).boundingBox();
      const star = await map.locator(`[data-system-id="${system}"] .tac-star-dot`).boundingBox();
      expect(badge).not.toBeNull();
      expect(star).not.toBeNull();
      const badgeCenter = badge.x + badge.width / 2;
      const starCenter = star.x + star.width / 2;
      expect(Math.abs(badgeCenter - starCenter), `${card} aligns with its own star`).toBeLessThanOrEqual(2);
      expect(badge.y + badge.height < star.y || badge.y > star.y + star.height,
        `${card} sits above or below, not on top of the star`).toBe(true);
    }
  };
  await expect(map.locator('.tac-map-force')).toHaveCount(2);
  await expect(map.locator('.tac-map-count')).toHaveCount(1);
  await expectCentered();
  const box = await map.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 2; step++) {
    await page.mouse.wheel(0, -100);
    await expect(page.locator('.tac-map')).toHaveClass(/is-wheel-zooming/);
    await expect(page.locator('.tac-map')).not.toHaveClass(/is-wheel-zooming/, { timeout: 1500 });
    await expectCentered();
  }
});

test("pending intelligence appears on the map with its reporter without inflating deployments", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    reports: [{
      ...state.snapshot.reports[0],
      status: "pending",
      report_kind: "system_count",
      author_id: 24,
      author_name: "前沿斥候",
      people: 68,
      ships: { cruiser: 12 },
    }],
  });
  await page.goto("/tactical");
  await expect(page.locator(".tac-map-force")).toHaveCount(1);
  await page.getByRole('button', {name:'选择星系 德里克一', exact:true}).click();
  await expect(page.locator('.tac-system-count')).toContainText('68');
  await expect(page.locator('.tac-system-source')).toContainText('前沿斥候');
  await expect(page.locator('.tac-map-force')).toContainText('32');
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
  await page.getByRole("option", { name: "北境联合", exact: true }).click();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await expect(page.getByRole("complementary", { name: "兵力总览与上报记录" }).getByText("敌方前锋", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole("button", { name: "上报记录", exact: true }).click();
  await page.getByRole("button", { name: "修改我的上报", exact: true }).click();
  await expect(page.getByText(/不会直接覆盖已确认的部署/)).toBeVisible();
  await page.getByLabel("上报记录备注").fill("修订保留");
  await page.getByRole("button", { name: "保存修订", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /已更新/ }),
  ).toBeVisible();
  await expect(page.getByLabel("上报记录备注")).toHaveValue("修订保留");
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await expect(page.getByText("敌方前锋", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "快速上报", exact: true }).click();
  await page.locator('.tac-report-optional > summary').click();
  await page.getByLabel("上报记录备注").fill("会话私有草稿");
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

test("force drag requests versioned manual correction without optimistic position changes", async ({
  page,
}) => {
  const { commands } = await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const marker = page.getByRole("button", {
    name: "敌方 敌方前锋 32 人，德里克一",
  });
  const destination = page.getByRole("button", { name: "选择星系 德里克二" });
  await expect(marker).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "实时同步" })).toBeVisible();
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
      kind: "correction",
      reason: "指挥通过星图拖拽调整部署位置",
    });
  await expect(marker).toBeVisible();
});

test('non-adjacent direct drag is allowed and pointer-up uses final coordinates, not stale hover',async({page})=>{
  const state=await fixture(page,{role:'commander',overview:true});
  await page.goto('/tactical');
  const marker=page.locator('.tac-map-force').first();
  await expect(page.getByRole('status').filter({hasText:'实时同步'})).toBeVisible();
  const destination=page.getByRole('button',{name:'选择星系 德里克二'});
  const nonAdjacent=page.getByRole('button',{name:'选择星系 边境一'});
  const start=await marker.boundingBox(), target=await destination.boundingBox(), invalid=await nonAdjacent.boundingBox();
  await page.mouse.move(start.x+15,start.y+10);
  await page.mouse.down();
  const map=page.getByRole('group',{name:'局部作战星图',exact:true});
  await page.mouse.move(target.x+target.width/2,target.y+target.height/2);
  await map.dispatchEvent('pointerup',{pointerId:1,clientX:invalid.x+invalid.width/2,clientY:invalid.y+invalid.height/2});
  await page.mouse.up();
  await expect.poll(() => state.commands.find(command => command.action === 'force.move')).toMatchObject({ destination_system_id: 201, kind: 'correction' });
});

test('shared system counts are visible to a scout but other authors remain read-only',async({page})=>{
  const state=await fixture(page);
  state.setSnapshot({...state.snapshot,reports:[...state.snapshot.reports,{...state.snapshot.reports[0],report_kind:'system_count',people:80,id:22,author_id:24,author_name:'前线斥候乙',status:'pending'}]});
  await page.goto('/tactical');
  await page.getByRole('button', {name:'选择星系 德里克一', exact:true}).click();
  await expect(page.locator('.tac-system-source')).toContainText('前线斥候乙');
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole('button',{name:'上报记录',exact:true}).click();
  await expect(page.locator('.tac-report-card')).toHaveCount(2);
  await expect(page.locator('.tac-report-card').filter({hasText:'前线斥候乙'}).getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'修改我的上报',exact:true})).toHaveCount(1);
  await expect(page.getByText('星系人数',{exact:true})).toBeVisible();
});

test('system counts respect side filter and cannot be adopted as a fleet',async({page})=>{
  const state=await fixture(page,{role:'commander'});
  state.setSnapshot({...state.snapshot,reports:[{...state.snapshot.reports[0],report_kind:'system_count',people:68,status:'pending'}]});
  await page.goto('/tactical');
  await expect(page.locator('.tac-intel-label.has-count')).toHaveCount(1);
  await page.getByRole('button',{name:'仅己方',exact:true}).click();
  await expect(page.locator('.tac-intel-label.has-count')).toHaveCount(0);
  await page.getByRole('button',{name:'全部阵营',exact:true}).click();
  await expect(page.locator('.tac-intel-label.has-count')).toHaveCount(1);
  state.setSnapshot(state.snapshot);
  await expect(page.locator('.tac-intel-label.has-count')).toHaveCount(0);
  await expect(page.locator('.tac-map-force')).toHaveCount(1);
});

test("desktop board and quick report remain readable at laptop size", async ({
  page,
}) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  await expect(page.locator('.tac-map-force')).toBeVisible();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole("button", { name: "上报记录", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "兵力总览与上报记录" }).getByText("巡洋舰 14", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole("button", { name: "上报记录", exact: true }).click();
  await page.getByRole("button", { name: "确认 / 关联" }).click();
  await page.locator('summary[aria-label="确认方式"]').click();
  await page.getByRole("option", { name: "关联：敌方前锋 · 德里克一" }).click();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole("button", { name: "上报记录", exact: true }).click();
  await page.getByRole("button", { name: "确认 / 关联" }).click();
  await page.locator('summary[aria-label="确认方式"]').click();
  await expect(
    page.getByRole("option", { name: "建立新敌方部署" }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "关联：敌方前锋 · 德里克一" }).click();
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.locator(".tac-force-main").first().click();
  await page.getByRole("button", { name: "归档部署", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "归档部署" })).toBeVisible();
  expect(commands).toHaveLength(0);
  await page.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect
    .poll(() => commands.find((command) => command.action === "force.archive"))
    .toMatchObject({ force_id: 11, expected_version: 1 });
});

test('top-left fleet badges remain visible beside floating map search at desktop widths', async ({page}) => {
  const state = await fixture(page,{role:'commander'});
  await page.route('**/api/tactical/organizations/1/map/', route => route.fulfill(json({
    systems: [
      {system_id:101,zh_name:'德里克一',x:0,z:240,security_status:.5},
      {system_id:102,zh_name:'德里克二',x:420,z:0,security_status:.4},
      {system_id:103,zh_name:'边界星系',x:-60,z:260,security_status:.3},
    ],
    stargates:[{system_id:101,destination_system_id:102}],
    regions:[],constellations:[],boundary_exits:[],
    scope:{region_ids:[1],border_hops:1,version:1},
  })));
  await page.goto('/tactical');
  const marker = page.locator('.tac-map-force');
  const controls = page.locator('.tac-map-controls');
  const labels = page.locator('.tac-intel-label');
  await expect(marker).toHaveCount(1);
  const overlapsRect = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
  for(const [width,height] of [[1366,768],[1440,900]]) {
    await page.setViewportSize({width,height});
    await expect.poll(async () => overlapsRect(await marker.boundingBox(),await controls.boundingBox()),
      {message:`fleet badge should not hide beneath map controls at ${width}×${height}`}).toBe(false);
    await expect.poll(async () => {
      const controlBox = await controls.boundingBox();
      return labels.evaluateAll((nodes,control) => nodes.filter(node => {
        const rect=node.getBoundingClientRect();
        return rect.x<control.x+control.width && rect.x+rect.width>control.x &&
          rect.y<control.y+control.height && rect.y+rect.height>control.y;
      }).length,controlBox);
    },{message:`star names should not sit beneath map controls at ${width}×${height}`}).toBe(0);
  }
  await page.setViewportSize({width:1366,height:768});
  await expect.poll(async () => overlapsRect(await marker.boundingBox(),await controls.boundingBox())).toBe(false);
  const before = await marker.boundingBox();
  const reads = state.requests.filter(path => path.endsWith('/snapshot/')).length;
  await expect.poll(() => state.requests.filter(path => path.endsWith('/snapshot/')).length,
    {timeout:20000,message:'two live snapshot refreshes complete'}).toBeGreaterThanOrEqual(reads+2);
  const after = await marker.boundingBox();
  for(const key of ['x','y','width','height'])
    expect(Math.abs(after[key]-before[key]),`fleet badge ${key} should not drift on snapshot refresh`).toBeLessThan(.5);
  await page.getByRole('button',{name:'选择星系 德里克一'}).focus();
  await page.keyboard.press('Enter');
  const selectedLabel=page.locator('.tac-intel-label').filter({hasText:'德里克一'});
  await expect(selectedLabel).toBeVisible();
  expect(overlapsRect(await selectedLabel.boundingBox(),await controls.boundingBox())).toBe(false);
});

test("quick archive opens the existing confirmation for the clicked fleet without moving or selecting a star", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    forces: [{ ...state.snapshot.forces[0], name: "远炮战列队", version: 4 }],
  });
  await page.goto("/tactical");
  await page.getByRole("button", { name: "选择星系 德里克二" }).click();
  const detail = page.getByRole("region", { name: "星系敌情详情" });
  await expect(detail.getByRole("heading", { name: "德里克二" })).toBeVisible();
  const badge = page.locator(".tac-map-force[data-force-id='11']");
  await expect(badge).toContainText("远炮战列队 32人");
  const close = page.getByRole("button", { name: "归档远炮战列队" });
  await expect(close).toHaveAttribute("data-archive-force-id", "11");
  await close.click();
  const dialog = page.getByRole("dialog", { name: "归档部署" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("远炮战列队");
  await expect(detail.getByRole("heading", { name: "德里克二" })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect.poll(() => state.commands.find(command => command.action === "force.archive"))
    .toMatchObject({ force_id: 11, expected_version: 4 });
  expect(state.commands.filter(command => command.action === "force.move")).toHaveLength(0);
});

test("quick archive is keyboard operable without selecting its fleet", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  state.setSnapshot({
    ...state.snapshot,
    forces: [{ ...state.snapshot.forces[0], name: "远炮战列队" }],
  });
  await page.goto("/tactical");
  const close = page.getByRole("button", { name: "归档远炮战列队" });
  await close.focus();
  await close.press("Enter");
  await expect(page.getByRole("dialog", { name: "归档部署" })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  await page.getByRole("dialog", { name: "归档部署" })
    .getByRole("button", { name: "取消", exact: true }).click();
  await close.focus();
  await close.press("Space");
  await expect(page.getByRole("dialog", { name: "归档部署" })).toBeVisible();
  expect(state.commands).toHaveLength(0);
  await expect(page.getByRole("region", { name: "星系敌情详情" })).toHaveCount(0);
});

test("quick archive is unavailable to a scout", async ({ page }) => {
  const state = await fixture(page, { role: "scout" });
  state.setSnapshot({
    ...state.snapshot,
    forces: [{ ...state.snapshot.forces[0], name: "远炮战列队" }],
  });
  await page.goto("/tactical");
  await expect(page.locator(".tac-map-force")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "归档远炮战列队" })).toHaveCount(0);
});

test("history stays in reports after its fleet is archived without returning to the map", async ({ page }) => {
  const state = await fixture(page, { role: "commander" });
  const report = {
    ...state.snapshot.reports[0],
    report_kind: "fleet_intel",
    fleet_name: "远炮战列队",
    force_id: 11,
    is_current: true,
    status: "confirmed",
    people: 100,
  };
  const sourceForce = { ...state.snapshot.forces[0], name: "远炮战列队", source_report_id: report.id };
  state.setSnapshot({ ...state.snapshot, forces: [sourceForce], reports: [report] });
  await page.goto("/tactical");
  await expect(page.locator(".tac-map-force[data-force-id='11']")).toHaveCount(1);
  await page.getByRole("button", { name: "归档远炮战列队" }).click();
  await page.getByRole("dialog", { name: "归档部署" })
    .getByRole("button", { name: "确认归档", exact: true }).click();
  await expect.poll(() => state.commands.find(command => command.action === "force.archive"))
    .toMatchObject({ force_id: sourceForce.id, expected_version: sourceForce.version });
  // The archive response no longer includes the deployment, while its
  // original fleet_intel observation and force_id relation remain.
  state.setSnapshot({ ...state.snapshot, forces: [], reports: [{ ...report, is_current: false }] });
  await expect(page.locator(".tac-map-force")).toHaveCount(0);
  await page.getByRole("button", { name: "显示上报标记" }).click();
  await page.getByRole("button", { name: "选择星系 德里克一" }).click();
  await expect(page.locator(".tac-map-report")).toHaveCount(0);
  await page.getByRole("button", { name: "展开兵力总览" }).click();
  await page.getByRole("button", { name: "上报记录", exact: true }).click();
  const history = page.locator(".tac-report-card[data-report-row-id='21']");
  await expect(history).toContainText("远炮战列队");
  await expect(history).toContainText("历史观察");
  await expect(history).toContainText("舰队 #11");
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
  await page.getByRole("button", { name: "展开兵力总览" }).click();
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
  await page.locator(".tac-map-force").first().click();
  await page.locator('.tac-system-exits > summary').click();
  await page.getByRole("button", { name: "移动到边界外星系" }).click();
  await expect
    .poll(() => commands.find((command) => command.action === "force.move"))
    .toMatchObject({
      force_id: 11,
      destination_system_id: 103,
      kind: "gate_move",
    });
});

test("collapsed intelligence panel keeps clear space below the scope controls", async ({
  page,
}) => {
  await fixture(page, { role: "commander" });
  await page.goto("/tactical");
  const scope = await page.locator(".tac-scope-label").boundingBox();
  const reopen = await page.locator(".tac-panel-reopen").boundingBox();
  expect(scope).not.toBeNull();
  expect(reopen).not.toBeNull();
  expect(reopen.y).toBeGreaterThanOrEqual(scope.y + scope.height + 10);
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
  await expect(page.locator(".tac-map-force")).toHaveCount(3, { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "查看德里克一全部20支部署" }),
  ).toBeVisible();
});

test('access-only account switch unmounts old board and its private data',async({page})=>{
  await fixture(page)
  await page.addInitScript(()=>localStorage.removeItem('refresh_token'))
  await page.goto('/tactical')
  await page.getByRole('button', { name: '展开兵力总览' }).click()
  await expect(page.getByText('敌方前锋',{exact:true})).toBeVisible()
  await page.route('**/api/tactical/organizations/',route=>route.fulfill(json({organizations:[]})))
  const token=createFakeJwt({user_id:88,username:'new-account'})
  await page.evaluate(token=>{localStorage.setItem('access_token',token);window.dispatchEvent(new Event('auth:changed'))},token)
  await expect(page.getByText('敌方前锋',{exact:true})).toHaveCount(0)
  await expect(page.getByRole('heading',{name:'建立你的指挥网络'})).toBeVisible()
})
