import { shanghaiDate, sourceDate } from './pipeline-health.ts';

export type ActivityFreshness = 'fresh' | 'ok' | 'stale' | 'unknown';

/** Date-only reports describe a Shanghai calendar day, not an invented hour. */
export function summarizeActivity(values: readonly unknown[], now = new Date()) {
  const today = shanghaiDate(now);
  const dates = values.map(value => sourceDate(typeof value === 'string' ? value : undefined, now))
    .filter((date): date is string => date !== null);
  const bins = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${today}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    return dates.filter(date => date === day.toISOString().slice(0, 10)).length;
  });
  const lastDate = dates.slice().sort().at(-1) ?? null;
  const ageDays = lastDate === null ? null
    : (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / 86_400_000;
  const fresh: ActivityFreshness = ageDays === null ? 'unknown'
    : ageDays <= 1 ? 'fresh' : ageDays <= 5 ? 'ok' : 'stale';
  const agoLabel = ageDays === null ? '待確認' : ageDays === 0 ? '今天'
    : ageDays === 1 ? '昨天' : `${ageDays} 天前`;
  return { todayDelta: bins[6], total: dates.length, bins, lastDate, fresh, agoLabel };
}
