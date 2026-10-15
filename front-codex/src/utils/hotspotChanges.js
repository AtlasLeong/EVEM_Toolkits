const invalid = () => { throw new Error('变化榜数据无效') }
const integer = value => Number.isSafeInteger(value) && value >= 0
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const intervalKeys = ['id', 'start_at_ms', 'end_at_ms', 'elapsed_ms']
function validInterval(value) {
  return exact(value, intervalKeys) && intervalKeys.every(key => integer(value[key]) && value[key] > 0)
    && value.end_at_ms > value.start_at_ms && value.elapsed_ms === value.end_at_ms - value.start_at_ms
}
export function validateHotspotChanges(data) {
  if (!exact(data, ['version', 'status', 'statistics_window', 'interval', 'coverage', 'systems', 'intervals', 'next_before'])
    || data.version !== 1 || !['ok', 'baseline', 'unavailable'].includes(data.status) || data.statistics_window !== null
    || !exact(data.coverage, ['comparable', 'new', 'missing', 'negative', 'unchanged'])
    || !Object.values(data.coverage).every(integer) || !Array.isArray(data.systems) || data.systems.length > 10_000
    || !Array.isArray(data.intervals) || data.intervals.length > 100 || !data.intervals.every(validInterval)
    || !(data.next_before === null || integer(data.next_before) && data.next_before > 0)
    || (data.status === 'ok' ? !validInterval(data.interval) : data.interval !== null || data.systems.length !== 0)) invalid()
  const ids = new Set(), intervals = new Set()
  for (const item of data.intervals) {
    if (intervals.has(item.id)) invalid()
    intervals.add(item.id)
  }
  for (const row of data.systems) {
    if (!exact(row, ['solar_system_id', 'previous_destroy_num', 'destroy_num', 'delta', 'system_name', 'region_id', 'region_name'])
      || !integer(row.solar_system_id) || row.solar_system_id === 0 || ids.has(row.solar_system_id)
      || !integer(row.previous_destroy_num) || !integer(row.destroy_num) || !Number.isSafeInteger(row.delta)
      || row.destroy_num - row.previous_destroy_num !== row.delta
      || !(row.region_id === null || integer(row.region_id) && row.region_id > 0)
      || !['system_name', 'region_name'].every(key => row[key] === null || typeof row[key] === 'string' && row[key].length <= 500)) invalid()
    ids.add(row.solar_system_id)
  }
  return data
}
export function rankHotspotChanges(rows = []) {
  return rows.filter(row => row.delta > 0).sort((a, b) => b.delta - a.delta || a.solar_system_id - b.solar_system_id)
    .map((row, index) => ({ ...row, displayName: row.system_name || `星系 ${row.solar_system_id}`, globalRank: index + 1 }))
}
export function formatHotspotElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000), minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${minutes} 分钟`
}
