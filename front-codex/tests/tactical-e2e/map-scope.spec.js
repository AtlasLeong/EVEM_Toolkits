import { test, expect } from '@playwright/test';
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js';
import { installApiMock, json } from '../e2e/helpers/api.js';

async function scopeFixture(page) {
  await seedAuthenticatedSession(page, {user_id:23});
  await page.routeWebSocket('**/ws/tactical/**', socket=>socket.close({code:1000}));
  const snapshot={organization:{id:1,name:'范围切换演练'},role:'commander',user_id:23,permission_version:1,
    scope:{region_ids:[1],border_hops:0,version:1},online_count:1,capacity:100,reports:[],online:[],
    forces:[{id:11,version:1,name:'测试部署',side:'enemy',system_id:101,system_name:'起点',people:32,ships:{},notes:'',observed_at:new Date().toISOString()}]};
  const commands=[];
  await installApiMock(page,({url,method,body})=>{
    if(url.pathname.endsWith('/organizations/'))return json({organizations:[{id:1,name:'范围切换演练',role:'commander',status:'active'}]});
    if(url.pathname.endsWith('/presence/'))return json({connection_id:body?.connection_id,online_count:1,capacity:100,lease_seconds:60});
    if(url.pathname.endsWith('/snapshot/'))return json(snapshot);
    if(url.pathname.endsWith('/map/')){return json({scope:snapshot.scope,stargates:[],boundary_exits:[],systems:[
      {system_id:101,name:snapshot.scope.version===1?'起点':'新范围起点',security_status:0.9,x:400,z:400},{system_id:102,name:'重叠甲',x:600,z:600},{system_id:103,name:'重叠乙',x:600,z:600},
      {system_id:104,name:'远端甲',x:0,z:0},{system_id:105,name:'远端乙',x:1000,z:1000},
    ]});}
    if(url.pathname.endsWith('/members/'))return json({members:[],applications:[],online:[],online_count:1,capacity:100});
    if(url.pathname.endsWith('/catalog/'))return json({results:[]});
    if(url.pathname.endsWith('/commands/')&&method==='POST'){commands.push(body);return json({ok:true,result:{id:1}});}
    return json({});
  });
  return {snapshot,commands};
}
const transform = page=>page.locator('.tac-map > svg > g').first();
async function center(locator){const box=await locator.boundingBox();return{x:box.x+box.width/2,y:box.y+box.height/2};}
async function waitForReplacedScope(page) {
  // StrictMode may fetch the initial map twice, so request counts do not prove
  // that the new scope has reached the rendered map. HTTP fallback polls every
  // five seconds; wait for the actual replacement node instead.
  await expect(page.getByRole('button',{name:'选择星系 新范围起点',exact:true})).toBeVisible({timeout:15000});
}

test('a new scope version fits the real map while unchanged polling preserves camera',async({page})=>{
  const fx=await scopeFixture(page);await page.goto('/tactical');
  await expect(page.locator('.tac-map-system')).toHaveCount(5);
  await page.getByRole('textbox',{name:'搜索当前星图'}).fill('起点');
  await page.locator('.tac-map-search-results button').click();
  await expect(page.getByRole('button',{name:'返回上一视野'})).toBeVisible();
  const zoomed=await transform(page).getAttribute('transform');
  expect(zoomed).not.toBe('translate(0 0) scale(1)');
  fx.snapshot.forces[0].people=33;
  await expect(page.getByRole('button',{name:'敌方 测试部署 33 人，起点',exact:true})).toBeVisible();
  expect(await transform(page).getAttribute('transform')).toBe(zoomed);
  fx.snapshot.scope={...fx.snapshot.scope,version:2,region_ids:[2]};
  await waitForReplacedScope(page);
  await expect(transform(page)).toHaveAttribute('transform','translate(0 0) scale(1)');
  await expect(page.getByRole('button',{name:'返回上一视野'})).toHaveCount(0);
});

test('map search uses localized names and ids, exposes scope metadata, and clears on escape', async ({ page }) => {
  await scopeFixture(page);
  await page.goto('/tactical');
  const search = page.getByRole('textbox', { name: '搜索当前星图' });
  await search.fill('101');
  const result = page.locator('.tac-map-search-results');
  await expect(result).toContainText('起点');
  await expect(result).toContainText('1');
  await expect(result).toContainText('当前高安');
  await search.fill('不存在的星系');
  await expect(result).toContainText('当前范围没有匹配的星系');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(result).toHaveCount(0);
});

test('scope replacement discards a pending ambiguous drop without sending a movement',async({page})=>{
  const fx=await scopeFixture(page);await page.goto('/tactical');
  await expect(page.getByRole('status').filter({hasText:'实时同步'})).toBeVisible();
  const source=await center(page.locator('.tac-map-force'));
  const target=await center(page.locator('[data-system-id="102"] .tac-star-dot'));
  await page.mouse.move(source.x,source.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});await page.mouse.up();
  const chooser=page.getByRole('dialog',{name:'选择部署目标星系'});
  await expect(chooser).toBeVisible();
  fx.snapshot.scope={...fx.snapshot.scope,version:2,region_ids:[2]};
  await waitForReplacedScope(page);
  await expect(chooser).toHaveCount(0);
  expect(fx.commands).toHaveLength(0);
});

test('a scope change cancels an in-progress captured fleet drag',async({page})=>{
  const fx=await scopeFixture(page);await page.goto('/tactical');
  await expect(page.getByRole('status').filter({hasText:'实时同步'})).toBeVisible();
  const source=await center(page.locator('.tac-map-force'));
  const target=await center(page.locator('[data-system-id="104"] .tac-star-dot'));
  await page.mouse.move(source.x,source.y);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:8});
  fx.snapshot.scope={...fx.snapshot.scope,version:2,region_ids:[2]};
  await waitForReplacedScope(page);
  await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'选择部署目标星系'})).toHaveCount(0);
  expect(fx.commands).toHaveLength(0);
});
