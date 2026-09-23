import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkerGroups, buildSystemCountMarkerGroups, fitMarkerText, textWidth, markerGroupsForViewport } from '../../src/utils/tacticalMapPresentation.js';
import { layoutForceMarkers } from '../../src/utils/tacticalMarkerLayout.js';

test('reports are bounded independently of forces and preserve authors and observation time', () => {
  const reports = Array.from({length: 20}, (_, id) => ({id, system_id: 1, report_kind:'fleet', author_name: `斥候${id}`, people: id, observed_at: '2026-09-22T00:00:00Z', status: 'pending'}));
  const groups = buildMarkerGroups([{id: 1, system_id: 1, side: 'enemy', people: 68}], reports);
  const force = groups.find(group => group.kind === 'force');
  const report = groups.find(group => group.kind === 'report');
  assert.equal(force.total, 1);
  assert.equal(report.visible.length, 2);
  assert.equal(report.hiddenCount, 18);
  assert.equal(report.visible[0].author_name, '斥候0');
  assert.equal(report.visible[0].observed_at, reports[0].observed_at);
  assert.equal(buildMarkerGroups([], [{...reports[0], status:'confirmed'}]).length, 0);
});

test('viewport marker filtering keeps selected and nearby reports while dropping distant groups', () => {
  const groups = buildMarkerGroups([], [
    {id:1, system_id:1, report_kind:'fleet', status:'pending', people:5},
    {id:2, system_id:99, report_kind:'fleet', status:'pending', people:8},
  ]);
  const nodes = [{system_id:1, px:100, py:100}, {system_id:99, px:900, py:700}];
  assert.deepEqual(markerGroupsForViewport(groups, nodes, {width:400, height:300}, {showReports:true}).map(group => group.system_id), [1]);
  assert.deepEqual(markerGroupsForViewport(groups, nodes, {width:400, height:300}, {selectedSystemId:99, showReports:true}).map(group => group.system_id), [1,99]);
});

test('historical report cards stay hidden by default and appear when requested or selected', () => {
  const groups = buildMarkerGroups([
    {id:4, system_id:1, side:'enemy', people:68},
  ], [
    {id:8, system_id:1, report_kind:'fleet', status:'pending', people:68},
    {id:9, system_id:2, report_kind:'fleet', status:'pending', people:42},
  ]);
  const nodes = [{system_id:1, px:100, py:100}, {system_id:2, px:180, py:100}];
  const compact = markerGroupsForViewport(groups, nodes, {width:400, height:300});
  assert.deepEqual(compact.map(group => group.kind), ['force']);
  const selected = markerGroupsForViewport(groups, nodes, {width:400, height:300}, {selectedSystemId:1});
  assert.deepEqual(selected.map(group => group.kind), ['force', 'report']);
  const expanded = markerGroupsForViewport(groups, nodes, {width:400, height:300}, {showReports:true});
  assert.deepEqual(expanded.map(group => group.kind), ['force', 'report', 'report']);
});

test('a moved named fleet has one live force badge without a detached source report card', () => {
  const force = {id:7, system_id:2, side:'friendly', name:'远炮战列队', people:100, source_report_id:51};
  const report = {id:51, system_id:1, report_kind:'fleet_intel', status:'pending', people:100,
    author_name:'atlas123', observed_at:'2026-09-22T00:00:00Z'};
  const groups = buildMarkerGroups([force], [report]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'force');
  assert.equal(groups[0].system_id, 2);
  assert.equal(groups[0].visible[0].source_report_id, 51);
  assert.equal(groups.some(group => group.kind === 'report'), false);
  const nodes = [{system_id:1, px:100, py:100}, {system_id:2, px:200, py:100}];
  const expanded = markerGroupsForViewport(groups, nodes, {width:400, height:300},
    {selectedSystemId:1, showReports:true});
  assert.deepEqual(expanded.map(group => group.kind), ['force']);
  assert.equal(report.system_id, 1);
  assert.equal(report.author_name, 'atlas123');
  assert.equal(report.observed_at, '2026-09-22T00:00:00Z');
});

test('archiving a named fleet leaves its historical observation off the map', () => {
  const report = {id:51, system_id:1, report_kind:'fleet_intel', status:'pending', people:100};
  const groups = buildMarkerGroups([], [report]);
  assert.deepEqual(groups, []);
  assert.deepEqual(markerGroupsForViewport(groups, [{system_id:1, px:100, py:100}],
    {width:400, height:300}, {selectedSystemId:1, showReports:true}), []);
  assert.equal(report.id, 51);
  assert.equal(report.status, 'pending');
});

test('count-only observations use only the dedicated count marker layer', () => {
  const report = {id:52, system_id:1, report_kind:'system_count', status:'pending', people:68,
    observed_at:'2026-09-22T01:00:00Z'};
  assert.deepEqual(buildMarkerGroups([], [report]), []);
  const countGroups = buildSystemCountMarkerGroups([report]);
  assert.equal(countGroups.length, 1);
  assert.equal(countGroups[0].kind, 'system_count');
  assert.equal(countGroups[0].visible[0].id, 52);
  assert.equal(countGroups[0].hiddenCount, 0);
});

test('only actionable map cards reserve the same 24px close slot', () => {
  const report = {id:52,system_id:1,report_kind:'system_count',status:'pending',people:68,
    observed_at:'2026-09-22T01:00:00Z'};
  const countOpen = buildSystemCountMarkerGroups([report],{canWithdrawCount:()=>true})[0];
  const countReadOnly = buildSystemCountMarkerGroups([report],{canWithdrawCount:()=>false})[0];
  assert.equal(countOpen.markerWidth-countReadOnly.markerWidth,24);
  assert.equal(countOpen.visible[0].markerWidth-countReadOnly.visible[0].markerWidth,24);
  const force = {id:11,system_id:1,side:'enemy',name:'大航队',people:100};
  const forceOpen = buildMarkerGroups([force],[],null,{canArchiveForce:true})[0];
  const forceReadOnly = buildMarkerGroups([force],[],null,{canArchiveForce:false})[0];
  assert.equal(forceOpen.visible[0].markerWidth-forceReadOnly.visible[0].markerWidth,24);
});

test('pending legacy fleet observations remain available in the generic report layer', () => {
  const report = {id:53, system_id:1, report_kind:'fleet', status:'pending', people:42,
    author_name:'旧斥候', observed_at:'2026-09-22T02:00:00Z'};
  const groups = buildMarkerGroups([], [report]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, 'report');
  assert.equal(groups[0].visible[0].id, 53);
  assert.equal(groups[0].visible[0].author_name, '旧斥候');
  assert.equal(groups[0].visible[0].observed_at, report.observed_at);
  assert.deepEqual(markerGroupsForViewport(groups, [{system_id:1, px:100, py:100}],
    {width:400, height:300}, {showReports:true}), groups);
});

test('deployment marker groups use stable system and force ordering', () => {
  const groups = buildMarkerGroups([
    {id:8, system_id:2, side:'enemy', name:'乙队', people:8},
    {id:2, system_id:1, side:'enemy', name:'甲队', people:2},
    {id:5, system_id:2, side:'enemy', name:'甲队', people:5},
  ], []);
  assert.deepEqual(groups.filter(group => group.kind === 'force').map(group => group.system_id), [1, 2]);
  assert.deepEqual(groups.find(group => group.system_id === 2).visible.map(force => force.id), [5, 8]);
});

test('viewport marker filtering applies the current pan and zoom transform', () => {
  const groups = buildMarkerGroups([], [{id:1, system_id:1, report_kind:'fleet', status:'pending', people:5}]);
  const nodes = [{system_id:1, px:1000, py:1000}];
  assert.deepEqual(markerGroupsForViewport(groups, nodes, {width:200, height:200}, {view:{x:-3900,y:-3900,scale:4}, showReports:true}), [groups[0]]);
});

test('text truncation measures Chinese glyphs and preserves short complete labels', () => {
  assert.equal(fitMarkerText('敌 · 68 人', 76 - 18, 12), '敌 · 68 人');
  const long = fitMarkerText('情报 · 999999 人 · 超长的前线斥候名称', 150, 11);
  assert.ok(long.endsWith('…'));
  assert.ok(textWidth(long, 11) <= 150);
});

test('force and report stacks at the same system do not cover one another', () => {
  const groups = buildMarkerGroups([{id:1,system_id:1,side:'enemy',people:68}], [{id:2,system_id:1,report_kind:'fleet',status:'pending',author_name:'斥候甲',people:80}]);
  const boxes = layoutForceMarkers(groups, [{system_id:1,px:400,py:350}], 1, {width:1000,height:800});
  assert.equal(boxes.length, 2);
  const [a,b] = boxes;
  assert.equal(a.x < b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y, false);
  assert.ok(b.rowHeight >= 44);
  assert.ok(a.rowWidths[0] < 104);
});

test('off-screen systems cannot drag their markers to an unrelated viewport edge', () => {
  const groups = buildMarkerGroups([{id:1,system_id:1,side:'enemy',people:68}], []);
  assert.equal(layoutForceMarkers(groups,[{system_id:1,px:-500,py:300}],1,{width:1000,height:600}).length, 0);
});

test('fleet badges use their names and count with content-adaptive widths', () => {
  const [group] = buildMarkerGroups([
    {id:1,system_id:1,side:'enemy',name:'大航队',people:100},
    {id:2,system_id:1,side:'enemy',name:'远炮战列队',people:50},
  ]);
  assert.equal(group.visible[0].label, '大航队 100人');
  assert.equal(group.visible[1].label, '远炮战列队 50人');
  assert.ok(group.visible[1].markerWidth > group.visible[0].markerWidth);
});

test('long fleet names are truncated without truncating the count', async () => {
  const { fleetMarkerLabel } = await import('../../src/utils/tacticalMapPresentation.js');
  assert.equal(typeof fleetMarkerLabel, 'function');
  const force = {name:'非常长的独立远程炮击战列舰编队',people:1234};
  const label = fleetMarkerLabel(force, 145);
  assert.ok(label.includes('…'));
  assert.ok(label.endsWith(' 1234人'));
  assert.ok(textWidth(label) <= 145 - 18);
  assert.equal(fleetMarkerLabel({name:'大航队',people:0},120),'大航队 0人');
  assert.equal(fleetMarkerLabel({name:'大航队',people:null},120),'大航队 未知');
});

test('same-name independent fleet IDs remain distinct rows', () => {
  const [group] = buildMarkerGroups([
    {id:11,system_id:1,side:'enemy',name:'大航队',people:100},
    {id:12,system_id:1,side:'enemy',name:'大航队',people:60},
  ]);
  assert.deepEqual(group.visible.map(row=>row.id),[11,12]);
  assert.deepEqual(group.visible.map(row=>row.label),['大航队 100人','大航队 60人']);
});

test('count-only markers show one latest observation per system, never a sum or a fleet', async () => {
  const { buildSystemCountMarkerGroups } = await import('../../src/utils/tacticalMapPresentation.js');
  assert.equal(typeof buildSystemCountMarkerGroups, 'function');
  const groups = buildSystemCountMarkerGroups([
    {id:1,system_id:8,report_kind:'system_count',people:100,observed_at:'2026-09-22T00:00:00Z'},
    {id:2,system_id:8,report_kind:'system_count',people:68,observed_at:'2026-09-22T01:00:00Z',author_name:'斥候甲'},
    {id:3,system_id:8,report_kind:'fleet_intel',people:40,observed_at:'2026-09-22T02:00:00Z'},
    {id:4,system_id:8,report_kind:'fleet',people:10,observed_at:'2026-09-22T03:00:00Z'},
  ]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].kind,'system_count');
  assert.equal(groups[0].system_id,8);
  assert.equal(groups[0].hiddenCount,0);
  assert.equal(groups[0].visible.length,1);
  assert.equal(groups[0].visible[0].label,'人数上报 68人');
  assert.equal(groups[0].visible[0].id,2);
  assert.equal(groups[0].visible[0].author_name,'斥候甲');
  assert.equal(groups[0].visible[0].observed_at,'2026-09-22T01:00:00Z');
});

test('count-only markers distinguish zero from unknown with bounded content-sized labels', async () => {
  const { buildSystemCountMarkerGroups } = await import('../../src/utils/tacticalMapPresentation.js');
  assert.equal(typeof buildSystemCountMarkerGroups, 'function');
  const groups = buildSystemCountMarkerGroups([
    {id:1,system_id:1,report_kind:'system_count',people:0},
    {id:2,system_id:2,report_kind:'system_count',people:null},
    {id:3,system_id:3,report_kind:'system_count',people:1000},
  ]);
  assert.deepEqual(groups.map(group=>group.visible[0].label),['人数上报 0人','人数上报 未知','人数上报 1000人']);
  assert.ok(groups[2].markerWidth>groups[0].markerWidth);
  for(const group of groups) {
    assert.equal(group.rowHeight,26);
    assert.ok(textWidth(group.visible[0].label)+18<=group.markerWidth);
    assert.ok(group.markerWidth<=220);
  }
});

test('count-only and three named fleets share collision layout without moving the star', async () => {
  const { buildSystemCountMarkerGroups } = await import('../../src/utils/tacticalMapPresentation.js');
  assert.equal(typeof buildSystemCountMarkerGroups, 'function');
  const fleetGroups=buildMarkerGroups(Array.from({length:4},(_,index)=>({id:index+1,system_id:1,name:'大航队',side:'enemy',people:100})));
  const countGroups=buildSystemCountMarkerGroups([{id:7,system_id:1,report_kind:'system_count',people:68}]);
  const nodes=[{system_id:1,px:500,py:400}];
  const boxes=layoutForceMarkers([...fleetGroups,...countGroups],nodes,1,{width:1000,height:800});
  assert.equal(fleetGroups[0].visible.length,3);
  assert.equal(fleetGroups[0].hiddenCount,1);
  assert.equal(boxes.length,2);
  const [a,b]=boxes;
  assert.equal(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,false);
  assert.equal(b.rowWidths[0]/2+b.rowOffsets[0],b.width/2);
  assert.deepEqual(b.leader.to,{x:500,y:400});
  assert.deepEqual(nodes,[{system_id:1,px:500,py:400}]);
});
