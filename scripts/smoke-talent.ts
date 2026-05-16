/**
 * Lightweight smoke test for talent utils.
 * Verifies all 5 loaders return without crash and prints sample sizes.
 * Run: node --experimental-strip-types scripts/smoke-talent.ts
 */
import {
  loadSubdirections,
  loadLabs,
  loadPeople,
  loadHRQueue,
  loadTalentStats,
} from '../src/utils/talent.ts';

const stats = loadTalentStats();
console.log('stats:', stats);

const subs = loadSubdirections({ domain: 'all' });
console.log(`subdirections: ${subs.length}, top3:`,
  subs.slice(0, 3).map(s => `${s.domain}/${s.family} (v7=${s.velocity7d}, acc=${s.acceleration.toFixed(2)})`));

const labs = loadLabs({ minSignals: 3 });
console.log(`labs: ${labs.length}, top3:`,
  labs.slice(0, 3).map(l => `${l.name} (n90=${l.signalCount90d}, n7=${l.recentSignalCount7d})`));

const people = loadPeople({ minPaperCount90d: 1 });
console.log(`people: ${people.length}, top3:`,
  people.slice(0, 3).map(p => `${p.name} [${p.topRating}] @ ${p.affiliation ?? '?'} (${p.contactStatus})`));

const hr = loadHRQueue();
console.log(`hr_queue: ${hr.length}, top3:`,
  hr.slice(0, 3).map(h => `${h.name} — ${h.whyNow}`));

// No-email contract: hard runtime assert (defense in depth alongside
// the `email?: never` field on PersonRecord). Cast to opaque record so
// the probe doesn't imply `email` is a real field on the type.
for (const p of [...people, ...hr]) {
  const rec = p as unknown as Record<string, unknown>;
  if ('email' in rec && rec.email != null) {
    throw new Error(`email leaked into PersonRecord for ${p.name}`);
  }
}

console.log('\nOK: smoke test passed.');
