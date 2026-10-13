import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeActivity } from '../src/utils/activity-calendar.ts';

test('Shanghai midnight moves today counts and seven-day bins before UTC midnight', () => {
  const summary = summarizeActivity(['2026-10-12', '2026-10-13', '2026-10-13'], new Date('2026-10-12T16:30:00Z'));
  assert.equal(summary.todayDelta, 2);
  assert.deepEqual(summary.bins, [0, 0, 0, 0, 0, 1, 2]);
  assert.equal(summary.lastDate, '2026-10-13');
  assert.equal(summary.agoLabel, '今天');
  assert.equal(summary.fresh, 'fresh');
});

test('date-only relative labels use calendar days without pretending an hour is known', () => {
  const now = new Date('2026-10-12T16:01:00Z');
  assert.equal(summarizeActivity(['2026-10-12'], now).agoLabel, '昨天');
  assert.equal(summarizeActivity(['2026-10-05'], now).agoLabel, '8 天前');
  assert.equal(summarizeActivity(['2026-10-11'], now).fresh, 'ok');
  assert.equal(summarizeActivity(['2026-10-07'], now).fresh, 'stale');
});

test('missing, malformed and future dates never count as fresh activity', () => {
  const now = new Date('2026-10-12T16:30:00Z');
  const invalid = [null, undefined, 123, '', 'bad', '2026-02-30', '2026-10-14', '2026-10-13T00:31:00+08:00'];
  const summary = summarizeActivity(invalid, now);
  assert.equal(summary.fresh, 'unknown');
  assert.equal(summary.agoLabel, '待確認');
  assert.equal(summary.lastDate, null);
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.bins, [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(summarizeActivity(['2026-10-12', ...invalid], now).lastDate, '2026-10-12');
});

test('timestamp activity normalizes to Shanghai day and rejects future instants', () => {
  const summary = summarizeActivity(['2026-10-12T16:00:00Z', '2026-10-13T00:10:00+08:00', '2026-10-12T16:31:00Z'],
    new Date('2026-10-12T16:30:00Z'));
  assert.equal(summary.total, 2);
  assert.equal(summary.todayDelta, 2);
  assert.equal(summary.lastDate, '2026-10-13');
});
