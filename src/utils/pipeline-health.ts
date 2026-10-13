/** Source freshness is independent of the website build/sync time. */
export type Freshness = 'fresh' | 'stale' | 'unknown';

export interface SourceFreshness {
  status: Freshness;
  date: string | null;
  expectedDate: string;
}

interface DriftMetricEvidence {
  streak?: number;
  ratio?: number | null;
  sustained_degradation?: boolean;
  evaluated_on?: string;
}

export interface PipelineEvidence {
  aiDate?: string | null;
  vlaDate?: string | null;
  aiSocialDate?: string | null;
  vlaSocialDate?: string | null;
  lastCheck?: string | null;
  driftMetricsDate?: string | null;
  driftSnapshot?: { date?: string } & Partial<Record<CoreMetric, number>>;
  driftActive?: boolean;
  driftMetrics?: Record<string, DriftMetricEvidence>;
}

const DAY = 86_400_000;
const SHANGHAI_OFFSET = 8 * 3_600_000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const CORE_METRICS = ['vla_papers_scanned', 'vla_final_in_report', 'vla_sources_active', 'aiapp_items_scanned', 'aiapp_items_report'] as const;
type CoreMetric = typeof CORE_METRICS[number];
const OUTPUT_QUALITY_METRICS = new Set(['vla_final_in_report', 'aiapp_items_report']);

export function driftVerdict(evidence: PipelineEvidence, now = new Date()): boolean | undefined {
  // An explicit warning remains visible even when other evidence is incomplete.
  if (evidence.driftActive === true) return true;
  const checkDate = sourceDate(evidence.lastCheck, now);
  const snapshotDate = sourceDate(evidence.driftSnapshot?.date, now);
  if (!checkDate || snapshotDate !== checkDate ||
    sourceDate(evidence.driftMetricsDate, now) !== checkDate) return undefined;
  const validMetric = (metric: DriftMetricEvidence) =>
    metric && typeof metric === 'object' && !Array.isArray(metric) &&
    Number.isInteger(metric.streak) && metric.streak! >= 0 &&
    typeof metric.ratio === 'number' && Number.isFinite(metric.ratio) && metric.ratio >= 0 &&
    (metric.sustained_degradation === undefined || typeof metric.sustained_degradation === 'boolean');
  // Retained state from an absent domain must not become current merely because
  // another domain advanced last_check. Old schemas cannot establish nominality.
  if (!CORE_METRICS.every(key => {
    const metric = evidence.driftMetrics?.[key];
    const value = evidence.driftSnapshot?.[key];
    return metric && validMetric(metric) && sourceDate(metric.evaluated_on, now) === checkDate &&
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
  })) return undefined;
  // Only the known core and a current optional upstream metric affect quality.
  // Retired Telegram state and unknown schema keys cannot establish evidence.
  const metrics = Object.entries(evidence.driftMetrics ?? {}).filter(([key, metric]) =>
    CORE_METRICS.includes(key as CoreMetric) || (key === 'vla_upstream_count' &&
      metric && sourceDate(metric.evaluated_on, now) === checkDate));
  if (metrics.some(([, metric]) => !validMetric(metric))) return undefined;
  // Match quality-drift-check.py: 3-day volume drop, severe single-day
  // output-quality drop, or sustained 7d/30d baseline degradation.
  if (metrics.some(([key, metric]) =>
    validMetric(metric) && (
    (metric.streak ?? 0) >= 3 ||
    (OUTPUT_QUALITY_METRICS.has(key) && (metric.streak ?? 0) >= 1 &&
      typeof metric.ratio === 'number' && metric.ratio < 0.3) ||
    metric.sustained_degradation === true))) return true;
  return false;
}

export function shanghaiDate(now: Date): string {
  return new Date(now.getTime() + SHANGHAI_OFFSET).toISOString().slice(0, 10);
}

export function shanghaiTimestamp(now: Date): string {
  return `${new Date(now.getTime() + SHANGHAI_OFFSET).toISOString().slice(0, 16).replace('T', ' ')} UTC+8`;
}

// Only explicit ISO dates or timestamps with an offset are accepted. Never use
// local machine timezone parsing, a file mtime, sync time, or build time as data.
export function sourceDate(value: string | null | undefined, now: Date): string | null {
  if (typeof value !== 'string' || !value) return null;
  const calendarDate = value.slice(0, 10);
  const calendar = new Date(`${calendarDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarDate) || !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== calendarDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value <= shanghaiDate(now) ? value : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed > now) return null;
  return shanghaiDate(parsed);
}

export function assessFreshness(
  value: string | null | undefined,
  now: Date,
  dueMinutes: number,
  publishingDays: readonly number[] = ALL_DAYS,
): SourceFreshness {
  const localNow = new Date(now.getTime() + SHANGHAI_OFFSET);
  let expected = new Date(`${shanghaiDate(now)}T00:00:00Z`);
  if (localNow.getUTCHours() * 60 + localNow.getUTCMinutes() < dueMinutes) {
    expected = new Date(expected.getTime() - DAY);
  }
  while (!publishingDays.includes(expected.getUTCDay())) {
    expected = new Date(expected.getTime() - DAY);
  }
  const expectedDate = expected.toISOString().slice(0, 10);
  const date = sourceDate(value, now);
  return { status: date === null ? 'unknown' : date < expectedDate ? 'stale' : 'fresh', date, expectedDate };
}

export function assessPipelineHealth(evidence: PipelineEvidence, now = new Date()) {
  // The VLA collector contract expects Tue–Sat 09:00 Shanghai time.
  // Sunday/Monday must not report a missing scheduled collection.
  const sources = {
    ai: assessFreshness(evidence.aiDate, now, 7 * 60),
    vla: assessFreshness(evidence.vlaDate, now, 9 * 60, [2, 3, 4, 5, 6]),
    aiSocial: assessFreshness(evidence.aiSocialDate, now, 9 * 60 + 30),
    vlaSocial: assessFreshness(evidence.vlaSocialDate, now, 9 * 60 + 30),
    drift: assessFreshness(evidence.lastCheck, now, 10 * 60 + 10),
    driftMetrics: assessFreshness(evidence.driftMetricsDate, now, 10 * 60 + 10),
  };
  const driftActive = driftVerdict(evidence, now);
  const driftCurrent = sources.drift.status === 'fresh' && sources.driftMetrics.status === 'fresh';
  const statuses = Object.values(sources).map(source => source.status);
  const status = statuses.includes('stale') ? 'stale'
    : statuses.includes('unknown') || driftActive === undefined ? 'unknown'
    : driftActive ? 'drift' : 'healthy';
  const label = {
    healthy: '資料正常 ✓', stale: '資料過期 ⚠', unknown: '待確認', drift: '品質漂移 ⚠',
  }[status];
  const driftStatus = sources.drift.status === 'stale' || sources.driftMetrics.status === 'stale' ? 'stale'
    : !driftCurrent || driftActive === undefined ? 'unknown'
    : driftActive ? 'drift' : 'healthy';
  const driftLabel = { stale: '資料過期 ⚠', unknown: '待確認', drift: '注意 ⚠', healthy: '正常 ✓' }[driftStatus];
  return {
    status, label, sources, healthy: status === 'healthy', driftLabel, driftActive, driftStatus,
    driftOk: driftStatus === 'healthy',
  };
}

/** A completed VLA run may legitimately contain no new papers. */
export function isSuccessfulVLARun(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const run = value as { ok?: unknown; papers?: unknown; total?: unknown; counts?: unknown; parse_error?: unknown; parse_failed?: unknown };
  if (run.ok !== true || !Array.isArray(run.papers) || run.total !== run.papers.length ||
    !run.counts || typeof run.counts !== 'object' || Array.isArray(run.counts) ||
    (run.parse_error !== undefined && run.parse_error !== '') ||
    (run.parse_failed !== undefined && run.parse_failed !== false)) return false;
  const ratings = ['⚡', '🔧', '📖', '❌'];
  if (!run.papers.every(paper =>
    paper && typeof paper === 'object' && !Array.isArray(paper) &&
    typeof paper.title === 'string' && paper.title.trim().length > 0 &&
    typeof paper.rating === 'string' && ratings.includes(paper.rating) &&
    typeof paper.reason === 'string' && paper.reason.trim().length > 0 &&
    !/^解析失败[，,]?\s*默认存档?$/.test(paper.reason.trim()))) return false;
  const counts = run.counts as Record<string, unknown>;
  const papers = run.papers as Array<{ rating: string }>;
  return Object.keys(counts).length === ratings.length && ratings.every(rating =>
    counts[rating] === papers.filter(paper => paper.rating === rating).length);
}

export function eligibleSocialDate(reports: Array<{ date: string; content: string }>): string | undefined {
  return reports.find(report => typeof report.content === 'string' && report.content.trim().length > 150)?.date;
}
