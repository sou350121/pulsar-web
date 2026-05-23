/**
 * Lightweight smoke test for talent utils.
 *
 * PR 3 (Ontology v2): exercises BOTH the V2 default and the V1 rollback
 * path so CI catches drift in either direction. The V1 path is exercised
 * by spawning a child process with USE_ONTOLOGY_V1=1 — talent.ts reads
 * that env var at module init, so the rollback only takes effect in a
 * fresh process.
 *
 * Two roles:
 *   - PARENT  (no PULSAR_SMOKE_MODE) — runs V2 (default) checks, then
 *               spawns a child for V1, then compares the two distributions
 *               with a loose ±30% drift gate.
 *   - CHILD   (PULSAR_SMOKE_MODE=V1 or V2) — runs its mode's checks and
 *               emits a single JSON line beginning with `__SMOKE_RESULT__`
 *               for the parent to parse.
 *
 * Verifies all 5 loaders return without crash and prints sample sizes.
 * Run: pnpm smoke-talent
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadSubdirections,
  loadLabs,
  loadPeople,
  loadHRScout,
  loadTalentStats,
  loadPoolViz,
  loadStructuralChips,
  loadResearcherConstellation,
} from '../src/utils/talent.ts';

interface SmokeResult {
  mode:               'V1' | 'V2';
  stats:              ReturnType<typeof loadTalentStats>;
  subdirectionsCount: number;
  subdirectionsTop:   string[];                  // "domain/family v7=N acc=N" strings
  scatterCount:       number;
  scatterFamilyTop5:  Array<[string, number]>;   // by primary family count
  polymathCount:      number;
  constellationBridges: number;
  constellationFamilies: number;
  labsCount:          number;
  labsMethodFocusSample: Array<{ name: string; focus: string[] }>;
}

function runChecks(mode: 'V1' | 'V2'): SmokeResult {
  const stats = loadTalentStats();
  const subs  = loadSubdirections({ domain: 'all' });
  const labs  = loadLabs({ minSignals: 3 });
  const people = loadPeople({ minPaperCount90d: 1 });
  const scout = loadHRScout();
  const poolViz = loadPoolViz();
  const pool = loadPeople({ minPaperCount90d: 1 });
  const chips = loadStructuralChips(pool);
  const constellation = loadResearcherConstellation();

  // Hard assertions — both modes must produce non-empty output. The whole
  // point of the V1 rollback is that it stays byte-for-byte functional;
  // the whole point of V2 is that it works on the same field-state files.
  if (subs.length === 0) {
    throw new Error(`[${mode}] loadSubdirections returned empty — alias resolution failed?`);
  }
  if (poolViz.scatter.length === 0) {
    throw new Error(`[${mode}] loadPoolViz scatter empty`);
  }
  if (chips[0].results.length === 0) {
    throw new Error(`[${mode}] loadStructuralChips polymath empty`);
  }
  if (constellation.methods.length === 0) {
    throw new Error(`[${mode}] loadResearcherConstellation produced 0 families`);
  }

  // No-email contract
  const allCandidates = [...scout.hot, ...scout.warm, ...scout.watch];
  for (const p of [...people, ...allCandidates]) {
    const rec = p as unknown as Record<string, unknown>;
    if ('email' in rec && rec.email != null) {
      throw new Error(`email leaked into PersonRecord for ${p.name}`);
    }
  }

  // Scatter family distribution — top 5 primary families
  const famCount = new Map<string, number>();
  for (const d of poolViz.scatter) {
    famCount.set(d.primaryFamily, (famCount.get(d.primaryFamily) ?? 0) + 1);
  }
  const scatterFamilyTop5 = [...famCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return {
    mode,
    stats,
    subdirectionsCount: subs.length,
    subdirectionsTop: subs.slice(0, 3).map(s =>
      `${s.domain}/${s.family} (v7=${s.velocity7d}, acc=${s.acceleration.toFixed(2)})`),
    scatterCount: poolViz.scatter.length,
    scatterFamilyTop5,
    polymathCount: chips[0].results.length,
    constellationBridges:  constellation.totals.bridges,
    constellationFamilies: constellation.methods.length,
    labsCount: labs.length,
    labsMethodFocusSample: labs.slice(0, 3).map(l => ({ name: l.name, focus: l.methodFocus })),
  };
}

const smokeMode = process.env.PULSAR_SMOKE_MODE;
const isChild   = smokeMode === 'V1' || smokeMode === 'V2';

if (isChild) {
  // CHILD: run checks, dump JSON for the parent. Stdout is read by spawn.
  const mode = smokeMode as 'V1' | 'V2';
  const result = runChecks(mode);
  process.stdout.write(`__SMOKE_RESULT__${JSON.stringify(result)}\n`);
  process.exit(0);
}

// ─── PARENT ──────────────────────────────────────────────────────────────
// Run V2 (default) in-process, then spawn a child for V1. We run V2 here
// rather than spawning two children because the parent must remain the
// authoritative reporter for the build log (the build script greps for
// "OK: smoke test passed" via exit code, not stdout parsing).
console.log('=== smoke-talent: V2 (default) ===');
const v2 = runChecks('V2');
console.log('stats:', v2.stats);
console.log(`subdirections: ${v2.subdirectionsCount}, top3:`, v2.subdirectionsTop);
console.log(`scatter:       ${v2.scatterCount}, top5 by family:`, v2.scatterFamilyTop5);
console.log(`polymath:      ${v2.polymathCount}`);
console.log(`constellation: ${v2.constellationFamilies} families, ${v2.constellationBridges} bridges`);
console.log(`labs:          ${v2.labsCount}, method focus sample:`, v2.labsMethodFocusSample);

console.log('\n=== smoke-talent: V1 (rollback) ===');
const __filename = fileURLToPath(import.meta.url);
const child = spawnSync(
  process.execPath,
  ['--experimental-strip-types', __filename],
  {
    env: { ...process.env, PULSAR_SMOKE_MODE: 'V1', USE_ONTOLOGY_V1: '1' },
    encoding: 'utf-8',
  },
);
if (child.status !== 0) {
  console.error('child stderr:', child.stderr);
  console.error('child stdout:', child.stdout);
  throw new Error(`V1 rollback child failed (exit ${child.status})`);
}
const marker = '__SMOKE_RESULT__';
const line = child.stdout.split('\n').find(l => l.startsWith(marker));
if (!line) {
  console.error('child stdout was:', child.stdout);
  throw new Error('V1 rollback child did not emit __SMOKE_RESULT__');
}
const v1: SmokeResult = JSON.parse(line.slice(marker.length));
console.log('stats:', v1.stats);
console.log(`subdirections: ${v1.subdirectionsCount}, top3:`, v1.subdirectionsTop);
console.log(`scatter:       ${v1.scatterCount}, top5 by family:`, v1.scatterFamilyTop5);
console.log(`polymath:      ${v1.polymathCount}`);
console.log(`constellation: ${v1.constellationFamilies} families, ${v1.constellationBridges} bridges`);
console.log(`labs:          ${v1.labsCount}, method focus sample:`, v1.labsMethodFocusSample);

// ─── Loose drift gate ────────────────────────────────────────────────────
// V2 leaves are finer-grained than V1 catch-alls (V1 `vla_core` matched
// ' vla ' on hundreds of titles; V2 `vla.foundation.vla_generalist` matches
// narrower like 'rt-2'/'openvla'). Expect 60-75% scatter drop on the V2
// path until PR 4/5 rebuild the field-state pipeline + embeddings against
// V2. The gate's job is to catch CATASTROPHIC failure (V2 empty, V2 < 5%
// of V1) — not to enforce parity. Per-metric thresholds reflect known
// behavioural shifts.
//
// Per-metric tolerances (V2 must be ≥ V2_FLOOR_FRAC * V1 in each):
//   subdirections — should be near-parity (field-state alias-resolve)
//   labs          — should be near-parity (uses same entities, same focus rank)
//   scatter       — expect deep drop until embeddings rebake (PR 5)
//   polymath      — expect drop: V2 doesn't catch-all so fewer people get ≥2 hits
//
// Tightens in PR 4 when compute-field-state.py emits V2 slugs natively.
console.log('\n=== drift gate (V2 vs V1 absolute counts) ===');
type Pair = { name: string; v1: number; v2: number; floorFrac: number };
const pairs: Pair[] = [
  { name: 'subdirections', v1: v1.subdirectionsCount, v2: v2.subdirectionsCount, floorFrac: 0.70 },
  { name: 'labs',          v1: v1.labsCount,          v2: v2.labsCount,          floorFrac: 0.70 },
  // Catch-all retirement: V2 scatter / polymath legitimately shrink. We
  // only block "V2 fell off a cliff" — V2 ≥ 15% of V1 is fine for now.
  { name: 'scatter',       v1: v1.scatterCount,       v2: v2.scatterCount,       floorFrac: 0.15 },
  { name: 'polymath',      v1: v1.polymathCount,      v2: v2.polymathCount,      floorFrac: 0.10 },
];
for (const p of pairs) {
  const lo = Math.min(p.v1, p.v2);
  const hi = Math.max(p.v1, p.v2);
  const ratio = hi > 0 ? lo / hi : 1;
  const drift = (1 - ratio) * 100;
  const v2Frac = p.v1 > 0 ? p.v2 / p.v1 : 1;
  const ok = v2Frac >= p.floorFrac || hi < 5;
  const marker = ok
    ? (drift > 30 ? 'OK (known shift)' : 'OK')
    : 'FAIL';
  console.log(
    `  ${p.name.padEnd(14)} v1=${p.v1.toString().padStart(4)} v2=${p.v2.toString().padStart(4)} ` +
    `drift=${drift.toFixed(1).padStart(5)}% (V2/V1=${(v2Frac * 100).toFixed(1)}%, floor=${(p.floorFrac * 100).toFixed(0)}%)  ${marker}`,
  );
  if (!ok) {
    throw new Error(`[drift gate] ${p.name}: V2/V1=${(v2Frac * 100).toFixed(1)}% below floor ${(p.floorFrac * 100).toFixed(0)}% (V1=${p.v1}, V2=${p.v2})`);
  }
}

// Print side-by-side family distributions for human eyeballing.
console.log('\n=== scatter top-family distribution (V1 vs V2) ===');
console.log('  V1:', v1.scatterFamilyTop5);
console.log('  V2:', v2.scatterFamilyTop5);

console.log('\nOK: smoke test passed.');
