import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = await readFile(new URL('../../src/pages/TacticalBoard.jsx', import.meta.url), 'utf8')
const map = await readFile(new URL('../../src/components/tactical/TacticalStarMap.jsx', import.meta.url), 'utf8')
const panel = await readFile(new URL('../../src/components/tactical/AnomalyHotspotLeaderboard.jsx', import.meta.url), 'utf8').catch(() => '')
const globalStyles = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8')
const scopedStyles = await readFile(new URL('../../src/components/tactical/AnomalyHotspotLeaderboard.css', import.meta.url), 'utf8').catch(() => '')
const styles = globalStyles + scopedStyles

test('the dynamic query has its own visibility-bounded polling and never gates the static map', () => {
  assert.match(page, /queryKey: \['anomaly-hotspots'\]/)
  assert.match(page, /queryFn: \(\{ signal \}\) => getAnomalyHotspots\(\{ signal, previous: queryClient\.getQueryData\(\['anomaly-hotspots'\]\) \}\)/)
  assert.match(page, /refetchInterval: isPageVisible \? 60_000 : false/)
  assert.match(page, /enabled: isPageVisible/)
  assert.match(page, /refetchIntervalInBackground: false/)
  assert.match(page, /visibilitychange/)
  assert.doesNotMatch(page, /hotspotsQuery\.isPending\s*\|\|/)
  assert.equal((page.match(/staleTime: STATIC_MAP_CACHE_TIME/g) || []).length, 4)
})

test('hotspot changes redraw but cannot rebuild static model or reset the map camera', () => {
  assert.match(map, /drawAnomalyHeat\(ctx,/)
  const model = map.slice(map.indexOf('const model = useMemo('), map.indexOf('const systemAliasMap'))
  assert.doesNotMatch(model, /hotspot|anomaly/i)
  const fit = map.slice(map.indexOf('const fitScale = Math.min('), map.indexOf('const shouldRevealLabels'))
  assert.doesNotMatch(fit, /hotspot|anomaly/i)
  assert.ok(map.indexOf('drawAnomalyHeat(ctx,') < map.indexOf('if (pathSegments.length)'))
  assert.ok(map.indexOf('drawAnomalyHeat(ctx,') < map.indexOf('model.systems.forEach((item) => {\n      if (item.px < left'))
  assert.match(map, /if \(canvas\.width !== width\) canvas\.width = width/)
  assert.match(map, /if \(canvas\.height !== height\) canvas\.height = height/)
})

test('folding, layer visibility, verified location and mobile ranking are separate controls', () => {
  assert.match(panel, /aria-expanded=\{!collapsed\}/)
  assert.match(panel, /onLayerVisibilityChange/)
  assert.match(panel, /定位该星域热点/)
  assert.match(panel, /暂无地图坐标/)
  assert.match(panel, /onWheel=\{stopMapInteraction\}/)
  assert.match(panel, /onMouseDown=\{stopMapInteraction\}/)
  assert.match(page, /className="anomaly-hotspots-mobile"/)
  assert.match(page, /allowLocate=\{false\}/)
  assert.match(styles, /\.anomaly-hotspots-mobile\s*\{\s*display: none/)
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.anomaly-hotspots-mobile\s*\{\s*display: block/)
})

test('the lazy map feature owns its stylesheet instead of expanding the entry CSS bundle', () => {
  assert.match(panel, /import '\.\/AnomalyHotspotLeaderboard\.css'/)
  assert.match(scopedStyles, /\.anomaly-hotspots-panel/)
  assert.doesNotMatch(globalStyles, /\.anomaly-hotspots-panel/)
})
