// Read-only microbenchmark. Run from front-codex; timings are not browser FPS.
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { projectSystemsScoped } from '../src/utils/tacticalMapLayout.js';
import { layoutForceMarkers, budgetMarkerGroups, rememberVisibleMarkerSlots } from '../src/utils/tacticalMarkerLayout.js';
import { buildSystemCountMarkerGroups, markerGroupsForViewport } from '../src/utils/tacticalMapPresentation.js';
import { layoutIntelLabels } from '../src/utils/tacticalMapInteraction.js';

const baseline = '41f0157dbf1886b31fa7f73164d14825168f6fa1';
const source = execFileSync('git', ['show', `${baseline}:front-codex/src/utils/tacticalMarkerLayout.js`], { encoding: 'utf8' });
const { layoutForceMarkers: oldLayout } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const round = value => Math.round(value * 10) / 10;
const median = values => round([...values].sort((a, b) => a - b)[1]);

console.log(JSON.stringify({ baseline, runtime: process.version, platform: process.platform,
  arch: process.arch, notes: 'Pure JS layout; no browser/DOM/gates; not FPS' }));

for (const count of [50, 100, 300, 900]) {
  const side = Math.ceil(Math.sqrt(count)), viewport = { width: 1200, height: 700 };
  const nodes = projectSystemsScoped(Array.from({ length: count }, (_, i) => ({
    system_id: i + 1, name: 'Dense' + (i + 1), region_id: 7,
    x: (i % side) * 100, z: Math.floor(i / side) * 100,
  })), { ...viewport, padding: { left: 76, right: 76, top: 175, bottom: 70 } });
  const reports = nodes.map(n => ({ id: n.system_id, system_id: n.system_id,
    report_kind: 'system_count', status: 'pending', people: 1, observed_at: '2026-09-26T00:00:00Z' }));
  const all = buildSystemCountMarkerGroups(reports);
  const options = { ...viewport, padding: { left: 16, right: 16, top: 175, bottom: 60 } };
  const intelById = new Map(reports.map(r => [r.system_id, r]));
  let preferred = new Map();
  const samples = [];
  for (let pass = 0; pass < 3; pass++) {
    const view = { x: pass * 2, y: 0, scale: 1 };
    const groups = markerGroupsForViewport(all, nodes, viewport, { view });
    const visible = nodes.map(n => ({ ...n, px: n.px + view.x }));
    const oldStart = performance.now();
    const oldBase = oldLayout(groups, nodes, 1, options);
    const oldCards = oldLayout(groups, visible, 1, { ...options,
      preferredSlots: new Map(oldBase.map(g => [g.key, g.slot])) });
    const oldCardsEnd = performance.now();
    const oldLabels = layoutIntelLabels(visible, { ...options, intelById, occupied: oldCards });
    const oldEnd = performance.now();
    const nextStart = performance.now();
    const budget = budgetMarkerGroups(groups, { selectedSystemId: 1 });
    const cards = layoutForceMarkers(budget.groups, visible, 1, { ...options, preferredSlots: preferred });
    preferred = rememberVisibleMarkerSlots(preferred, cards);
    const cardsEnd = performance.now();
    const labels = layoutIntelLabels(visible, { ...options, intelById, occupied: cards });
    const end = performance.now();
    const sample = { oldMs: oldEnd - oldStart, newMs: end - nextStart,
      newCardMs: cardsEnd - nextStart, newLabelMs: end - cardsEnd };
    samples.push(sample);
    console.log(JSON.stringify({ count, pass, oldCardMs: round(oldCardsEnd - oldStart),
      oldLabelMs: round(oldEnd - oldCardsEnd),
      ...Object.fromEntries(Object.entries(sample).map(([k, v]) => [k, round(v)])),
      oldCards: oldCards.length, newCards: cards.length,
      oldNames: oldLabels.length, newNames: labels.length, omitted: budget.omittedCount }));
  }
  console.log(JSON.stringify({ summary: count, oldMedianMs: median(samples.map(row => row.oldMs)),
    newMedianMs: median(samples.map(row => row.newMs)), newCardMedianMs: median(samples.map(row => row.newCardMs)),
    newLabelMedianMs: median(samples.map(row => row.newLabelMs)) }));
}
