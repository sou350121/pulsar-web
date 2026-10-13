import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessFreshness, assessPipelineHealth, sourceDate, driftVerdict, shanghaiTimestamp, isSuccessfulVLARun, eligibleSocialDate } from '../src/utils/pipeline-health.ts';

const now = new Date('2026-10-12T04:00:00Z'); // Monday noon, Shanghai
const coreKeys = ['vla_papers_scanned', 'vla_final_in_report', 'vla_sources_active', 'aiapp_items_scanned', 'aiapp_items_report'];
const metric = { streak: 0, ratio: 1, sustained_degradation: false, evaluated_on: '2026-10-12' };
const current = {
  aiDate: '2026-10-12', vlaDate: '2026-10-10',
  aiSocialDate: '2026-10-12', vlaSocialDate: '2026-10-12',
  lastCheck: '2026-10-12', driftMetricsDate: '2026-10-12', driftActive: false,
  driftSnapshot: { date: '2026-10-12', ...Object.fromEntries(coreKeys.map(key => [key, 10])) },
  driftMetrics: Object.fromEntries(coreKeys.map(key => [key, { ...metric }])),
};

test('a new website build cannot make the October 6 inputs healthy on October 12', () => {
  const health = assessPipelineHealth({
    aiDate: '2026-10-06', vlaDate: '2026-10-06',
    aiSocialDate: '2026-10-06', vlaSocialDate: '2026-10-06',
    lastCheck: '2026-10-06', driftMetricsDate: '2026-10-06', driftActive: false,
  }, now);
  assert.equal(health.status, 'stale');
  assert.equal(health.healthy, false);
  assert.equal(health.driftOk, false);
  assert.equal(health.sources.vla.date, '2026-10-06');
});

test('current source evidence is healthy; a single stale stream prevents green status', () => {
  assert.equal(assessPipelineHealth(current, now).status, 'healthy');
  for (const key of ['aiDate', 'vlaDate', 'aiSocialDate', 'vlaSocialDate', 'lastCheck', 'driftMetricsDate']) {
    assert.equal(assessPipelineHealth({ ...current, [key]: '2026-10-06' }, now).status, 'stale', key);
  }
});

test('missing, invalid, and future source dates never count as current evidence', () => {
  for (const value of [undefined, null, '', 'bad', '2026-02-30', '2026-02-30T00:00:00Z', '2026-10-13', '2026-10-12T12:00:00']) {
    assert.equal(sourceDate(value, now), null, String(value));
    assert.equal(assessPipelineHealth({ ...current, lastCheck: value }, now).status, 'unknown');
  }
  assert.equal(assessPipelineHealth({ ...current, driftActive: undefined, driftMetrics: undefined }, now).status, 'unknown');
  assert.equal(assessPipelineHealth(current, now).driftOk, true);
  assert.equal(assessPipelineHealth({ ...current, driftActive: true }, now).status, 'drift');
});

test('a placeholder check timestamp cannot hide an old or missing metrics snapshot', () => {
  assert.equal(assessPipelineHealth({ ...current, driftMetricsDate: '2026-10-06' }, now).status, 'stale');
  assert.equal(assessPipelineHealth({ ...current, driftMetricsDate: undefined }, now).status, 'unknown');
});

test('actual metric-state schema detects producer thresholds and rejects incomplete evidence', () => {
  const evidence = { ...current, driftActive: undefined };
  const withMetric = (key: string, value: typeof metric) => ({ ...evidence,
    driftMetrics: { ...evidence.driftMetrics, [key]: value },
  });
  assert.equal(driftVerdict(evidence, now), false);
  assert.equal(driftVerdict(withMetric('aiapp_items_scanned', { ...metric, streak: 3 }), now), true);
  assert.equal(driftVerdict(withMetric('aiapp_items_scanned', { ...metric, streak: 2, ratio: 0.2 }), now), false);
  assert.equal(driftVerdict(withMetric('aiapp_items_report', { ...metric, streak: 1, ratio: 0.29 }), now), true);
  assert.equal(driftVerdict(withMetric('aiapp_items_report', { ...metric, streak: 1, ratio: 0.3 }), now), false);
  assert.equal(driftVerdict(withMetric('aiapp_items_report', { ...metric, sustained_degradation: true }), now), true);
  assert.equal(driftVerdict({ driftMetrics: { aiapp_items_report: {} } }), undefined);
  assert.equal(driftVerdict({ driftMetrics: {} }), undefined);
  assert.equal(driftVerdict(JSON.parse('{"driftMetrics":{"invalid":null}}')), undefined);
  assert.equal(assessPipelineHealth(evidence, now).status, 'healthy');
  const warning = assessPipelineHealth({ ...evidence,
    driftMetrics: { ...current.driftMetrics, aiapp_items_scanned: { ...metric, sustained_degradation: true } },
  }, now);
  assert.equal(warning.status, 'drift');
  assert.equal(warning.driftActive, true);
  assert.equal(warning.driftLabel, '注意 ⚠');
});

test('explicit false cannot bypass missing, malformed, or active metric evidence', () => {
  for (const driftMetrics of [undefined, {}, { aiapp_items_scanned: metric }, { unrelated: metric },
    JSON.parse('{"aiapp_items_report":null}')]) {
    assert.equal(assessPipelineHealth({ ...current, driftMetrics }, now).status, 'unknown');
  }
  assert.equal(assessPipelineHealth({ ...current,
    driftMetrics: { ...current.driftMetrics, aiapp_items_report: { ...metric, streak: 3, ratio: 0.1 } },
  }, now).status, 'drift');
  assert.equal(driftVerdict({ driftActive: true, driftMetrics: {} }, now), true);
  assert.equal(driftVerdict({ driftActive: true, driftMetrics: JSON.parse('{"invalid":null}') }, now), true);
});

test('all core metric states must be evaluated for the same checked snapshot', () => {
  for (const key of coreKeys) {
    for (const evaluated_on of [undefined, '2026-10-11', 'bad', '2026-10-13']) {
      assert.equal(assessPipelineHealth({ ...current,
        driftMetrics: { ...current.driftMetrics, [key]: { ...metric, evaluated_on } },
      }, now).status, 'unknown', `${key} evaluated_on=${evaluated_on}`);
    }
    assert.equal(assessPipelineHealth({ ...current,
      driftMetrics: { ...current.driftMetrics, [key]: { ...metric, ratio: null } },
    }, now).status, 'unknown', `${key} without baseline ratio`);
  }
});

test('a date-only or partial snapshot cannot establish current metric coverage', () => {
  for (const driftSnapshot of [undefined, { date: '2026-10-12' },
    { ...current.driftSnapshot, date: '2026-10-11' },
    { ...current.driftSnapshot, aiapp_items_report: NaN },
    { ...current.driftSnapshot, vla_papers_scanned: -1 }]) {
    assert.equal(assessPipelineHealth({ ...current, driftSnapshot }, now).status, 'unknown');
  }
  const partial = { ...current,
    driftSnapshot: { date: '2026-10-12', vla_papers_scanned: 10, vla_final_in_report: 10, vla_sources_active: 10 },
    driftMetrics: { ...current.driftMetrics,
      aiapp_items_scanned: { ...metric, streak: 3, ratio: 0.1, evaluated_on: '2026-10-11' },
    },
  };
  assert.equal(assessPipelineHealth(partial, now).status, 'unknown');
  assert.equal(assessPipelineHealth({ ...partial, driftActive: true }, now).driftStatus, 'drift');
});

test('optional upstream state is evaluated only for the current check', () => {
  const upstream = { ...metric, streak: 3, ratio: 0.1, evaluated_on: '2026-10-11' };
  const evidence = { ...current, driftMetrics: { ...current.driftMetrics, vla_upstream_count: upstream } };
  assert.equal(driftVerdict(evidence, now), false);
  assert.equal(driftVerdict({ ...evidence, driftMetrics: { ...evidence.driftMetrics,
    vla_upstream_count: { ...upstream, evaluated_on: '2026-10-12' },
  } }, now), true);
});

test('drift scalar status matches the label when an explicit warning lacks a snapshot date', () => {
  const health = assessPipelineHealth({ ...current, driftActive: true, driftMetricsDate: undefined }, now);
  assert.equal(health.driftStatus, 'unknown');
  assert.equal(health.driftLabel, '待確認');
  assert.equal(health.driftOk, false);
  assert.equal(sourceDate(JSON.parse('123'), now), null);
});

test('only successful VLA runs establish a source date; a successful empty run is valid', () => {
  const paper = { title: 'paper', rating: '❌', reason: 'not selected' };
  const complete = { ok: true, total: 1, counts: { '⚡': 0, '🔧': 0, '📖': 0, '❌': 1 }, papers: [paper] };
  assert.equal(isSuccessfulVLARun({ ...complete, total: 0, counts: { '⚡': 0, '🔧': 0, '📖': 0, '❌': 0 }, papers: [] }), true);
  assert.equal(isSuccessfulVLARun(complete), true);
  assert.equal(isSuccessfulVLARun({ ...complete, parse_error: '', parse_failed: false }), true);
  for (const changed of [{ total: 2 }, { total: true }, { counts: {} }, { counts: { ...complete.counts, '❌': 0 } },
    { parse_failed: true }, { parse_error: 'partial parse' }, { papers: [{ ...paper, reason: '解析失败，默认存档' }] },
    { papers: [{ ...paper, title: ' ' }] }, { papers: [{ ...paper, rating: 'unknown' }] },
    { papers: [{ ...paper, reason: '' }] }]) {
    assert.equal(isSuccessfulVLARun({ ...complete, ...changed }), false);
  }
  for (const run of [null, {}, { ok: false, papers: [paper] }, { ok: 'true', papers: [] },
    { ok: true }, { ok: true, papers: {} }, { ok: true, papers: [null] },
    { ok: true, papers: [{ ...paper, reason: '解析失败，默认存档' }] },
    { ok: true, papers: [{ ...paper, title: ' ' }] },
    { ok: true, papers: [{ ...paper, rating: 'unknown' }] },
    { ok: true, papers: [{ ...paper, reason: '' }] }]) {
    assert.equal(isSuccessfulVLARun(run), false);
  }
});

test('an empty current social stub cannot advance an older eligible report date', () => {
  const report = { date: '2026-10-11', content: 'real report '.repeat(20) };
  assert.equal(eligibleSocialDate([{ date: '2026-10-12', content: '' }, report]), '2026-10-11');
  assert.equal(eligibleSocialDate([{ date: '2026-10-12', content: ' '.repeat(200) }, report]), '2026-10-11');
  assert.equal(eligibleSocialDate([{ date: '2026-10-12', content: '' }]), undefined);
});

test('retired Telegram metrics neither trigger drift nor establish nominal quality', () => {
  const retired = { streak: 9, ratio: 0.1, sustained_degradation: true };
  assert.equal(driftVerdict({ driftMetrics: { vla_tg_msg_len: retired } }), undefined);
  assert.equal(driftVerdict({ driftMetrics: { vla_tg_msg_len: { streak: 0, ratio: 1 } } }), undefined);
  assert.equal(driftVerdict({ ...current, driftMetrics: {
    ...current.driftMetrics, vla_tg_msg_len: retired,
  } }, now), false);
  assert.equal(assessPipelineHealth({ ...current, driftActive: undefined,
    driftMetrics: { vla_tg_msg_len: retired },
  }, now).status, 'unknown');
});

test('daily publishing deadline uses Shanghai time and switches exactly when due', () => {
  assert.equal(assessFreshness('2026-10-11', new Date('2026-10-12T02:09:59Z'), 610).status, 'fresh');
  assert.equal(assessFreshness('2026-10-11', new Date('2026-10-12T02:10:00Z'), 610).status, 'stale');
  assert.equal(assessFreshness('2026-10-11', new Date('2026-10-11T16:01:00Z'), 610).status, 'fresh');
  assert.equal(sourceDate('2026-10-11T16:05:00Z', now), '2026-10-12');
  assert.equal(sourceDate('2026-10-12T12:01:00+08:00', now), null);
  assert.equal(shanghaiTimestamp(new Date('2026-10-11T16:01:00Z')), '2026-10-12 00:01 UTC+8');
});

test('VLA accepts Saturday data through Monday and Tuesday before 09:00, then requires Tuesday', () => {
  const days = [2, 3, 4, 5, 6];
  assert.equal(assessFreshness('2026-10-10', new Date('2026-10-11T04:00:00Z'), 540, days).status, 'fresh');
  assert.equal(assessPipelineHealth(current, now).sources.vla.status, 'fresh');
  assert.equal(assessFreshness('2026-10-10', new Date('2026-10-13T00:59:59Z'), 540, days).status, 'fresh');
  assert.equal(assessFreshness('2026-10-10', new Date('2026-10-13T01:00:00Z'), 540, days).status, 'stale');
  assert.equal(assessFreshness('2026-10-09', new Date('2026-10-10T01:00:00Z'), 540, days).status, 'stale');
});
