const time = value => Date.parse(value) || 0;
const compare = (a, b) => time(a.observed_at) - time(b.observed_at) ||
  time(a.updated_at) - time(b.updated_at) || Number(a.version || 0) - Number(b.version || 0) || Number(a.id || 0) - Number(b.id || 0);

// A local-channel count is a snapshot, not an additional fleet. Never combine
// scouts' counts or infer this meaning for older fleet-observation records.
export function latestSystemIntel(reports = []) {
  const latest = new Map();
  for (const report of reports) {
    if (report?.report_kind !== 'system_count' || !Number.isSafeInteger(Number(report.system_id)) || Number(report.system_id) <= 0) continue;
    const id = Number(report.system_id), previous = latest.get(id);
    if (!previous || compare(report, previous) > 0) latest.set(id, report);
  }
  return [...latest.entries()].sort(([a], [b]) => a - b)
    .map(([, report]) => report).filter(report => report.status !== 'withdrawn');
}
