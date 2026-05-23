/**
 * Build-time embedding pipeline for /talent/match/.
 *
 * What this does:
 *   1. Loads the full rated researcher pool (⚡ + 🔧 + 📖).
 *   2. Builds a short text "profile" per person (name + affiliation + methods + recent paper titles).
 *   3. Calls DashScope text-embedding-v3 to embed every profile and every canonical query.
 *   4. Pre-computes:
 *        - per-query top-30 nearest persons (chip click → fetch top-30)
 *        - per-person top-10 nearest persons (find-similar feature)
 *   5. Writes a static JSON to src/data/talent-embeddings.json (committed to git).
 *
 * Static-site design:
 *   The browser NEVER calls DashScope. It only reads this pre-baked JSON. That's
 *   the whole point — GitHub Pages stays a pure static deploy with no backend
 *   and no client model download.
 *
 * Requires: DASHSCOPE_API_KEY in env (read from ~/.clawdbot/.env or shell).
 * Run locally:  pnpm embed:talent
 * Cost: ~$0.001 per run (300 calls × ~80 tokens each at $0.05/1M tokens).
 */
import { writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  loadPeople,
  loadPoolViz,
  rankMethodFamilies,
  topMethodsForEvidence,
} from '../src/utils/talent.ts';
import type { Evidence } from '../src/utils/talent.ts';

const API_KEY = process.env.DASHSCOPE_API_KEY;
if (!API_KEY) {
  console.error('FATAL: DASHSCOPE_API_KEY not set in environment.');
  console.error('Source ~/.clawdbot/.env or export DASHSCOPE_API_KEY=...');
  process.exit(1);
}

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';
const MODEL         = 'text-embedding-v3';
const OUTPUT        = 'src/data/talent-embeddings.json';

// ---------------------------------------------------------------------------
// Profile string per researcher. Short, dense, semantic-anchored.
// We deliberately do NOT include rating glyphs — the embedding should match
// on research substance, not on the rating label.
// ---------------------------------------------------------------------------
function buildProfile(p: { name: string; affiliation: string | null; evidence: { title: string }[] }): string {
  const methods = topMethodsForEvidence(p.evidence as Evidence[], 3).join(', ') || 'no labelled method family';
  const titles  = p.evidence.slice(0, 5).map(e => `- ${e.title}`).join('\n');
  const aff     = p.affiliation ?? 'no affiliation on record';
  return `Researcher: ${p.name}\nAffiliation: ${aff}\nMethod focus: ${methods}\nRecent papers (90d):\n${titles}`;
}

// ---------------------------------------------------------------------------
// Region inference — keep simple substring rules for now. Tagging here so the
// UI can offer "{family} · 中國機構" / "{family} · 北美機構" chips without
// shipping a registry.
// ---------------------------------------------------------------------------
function inferRegion(aff: string | null): 'cn' | 'us' | 'eu' | 'other' {
  if (!aff) return 'other';
  const a = aff.toLowerCase();
  const CN = ['清华', '北大', '中科院', '上交', '复旦', '浙大', '中大', '北航', '人大', '南大', 'tsinghua', 'peking', 'shanghai jiao', 'sjtu', 'fudan', 'zhejiang', 'cuhk', 'hkust', 'hku', 'chinese academy', 'baidu', 'alibaba', 'huawei', 'bytedance', 'tencent', 'beijing'];
  const US = ['stanford', 'cmu', 'mit', 'berkeley', 'princeton', 'harvard', 'cornell', 'columbia', 'nyu', 'caltech', 'ucla', 'ucsd', 'ucsb', 'umich', 'cornell', 'georgia tech', 'gatech', 'uw', 'washington', 'illinois', 'maryland', 'austin', 'wisconsin', 'usc', 'nvidia', 'google', 'meta', 'microsoft', 'apple', 'amazon', 'openai', 'anthropic', 'deepmind'];
  const EU = ['oxford', 'cambridge', 'imperial', 'ucl', 'eth', 'epfl', 'inria', 'mpi', 'max planck', 'tübingen', 'tubingen', 'amsterdam', 'leuven'];
  if (CN.some(k => a.includes(k))) return 'cn';
  if (US.some(k => a.includes(k))) return 'us';
  if (EU.some(k => a.includes(k))) return 'eu';
  return 'other';
}

// ---------------------------------------------------------------------------
// DashScope text-embedding-v3 call. Batched to 25 inputs per request (their
// documented cap). Retries with exponential backoff on transient errors.
// ---------------------------------------------------------------------------
// FatalError = config / auth / quota — retry won't help, fail fast.
class FatalError extends Error {}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const body = {
    model: MODEL,
    input: { texts },
    parameters: { text_type: 'document', dimension: 1024 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(DASHSCOPE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        // 429 (rate limit) + 5xx (server) are transient → retry
        if (res.status === 429 || res.status >= 500) throw new Error(`transient ${res.status}: ${txt.slice(0, 200)}`);
        // 4xx config / auth / bad-input — retrying is just burning time
        throw new FatalError(`DashScope ${res.status}: ${txt.slice(0, 300)}`);
      }
      const json = await res.json() as { output?: { embeddings?: Array<{ embedding: number[] }> } };
      const embs = json.output?.embeddings?.map(e => e.embedding) ?? [];
      if (embs.length !== texts.length) throw new Error(`got ${embs.length} embeddings for ${texts.length} inputs`);
      return embs;
    } catch (err) {
      if (err instanceof FatalError) throw err;     // no retry on 4xx
      if (attempt === 2) throw err;
      const wait = 5_000 * (attempt + 1);
      console.warn(`embedBatch retry ${attempt + 1} in ${wait}ms: ${(err as Error).message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

async function embedAll(texts: string[], label: string): Promise<number[][]> {
  const out: number[][] = [];
  // DashScope text-embedding-v3 caps batch input at 10 (observed 2026-05-24).
  // Their docs are silent on this; the error is `batch size is invalid, it
  // should not be larger than 10`. Don't raise this without re-testing.
  const BATCH = 10;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    console.log(`  ${label} batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(texts.length / BATCH)} (${slice.length})`);
    const embs = await embedBatch(slice);
    out.push(...embs);
  }
  return out;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------------------------------------------------------------------------
// Canonical query catalogue. Auto-generated from the live method-family list
// plus a handful of cross-cutting queries. Total ~16-20 chips.
// ---------------------------------------------------------------------------
interface QueryDef {
  id:      string;
  label:   string;
  labelSC: string;
  text:    string;   // what we actually embed
}

function buildQueries(poolViz: ReturnType<typeof loadPoolViz>): QueryDef[] {
  // Why ONLY family chips:
  //   The four-agent UX audit established that embedding-based chips work
  //   when the query is a single, vocabulary-anchored topic (method family).
  //   They FAIL on multi-concept queries (polymath, production-ready,
  //   safety-eval) and on regional intersections (family × CN/US) because:
  //     - profiles are too thin (96% of pool has 1 paper)
  //     - affiliation coverage is 2.7%, so region cannot be embedded
  //     - embedding clusters by surname phonetics + keyword, not concept
  //   The polymath / production / safety chips now ship as STRUCTURAL rules
  //   computed at match-page build time (see loadStructuralChips in talent.ts).
  //   Region selection moved to the facet UI (where it's honest about gaps).
  const queries: QueryDef[] = [];

  for (const f of poolViz.heatmapFamilies.slice(0, 8)) {
    queries.push({
      id:      `family:${f.family}`,
      label:   f.familyDisplay,
      labelSC: f.familyDisplay,
      text:    `Researcher working on ${f.familyDisplay}. ${f.domain === 'vla' ? 'Vision-language-action robotics' : 'AI agent infrastructure'}.`,
    });
  }

  return queries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Loading rated population…');
  const pool = loadPeople({ minPaperCount90d: 1 })
    .filter(p => p.topRating === '⚡' || p.topRating === '🔧' || p.topRating === '📖');
  const poolViz = loadPoolViz();
  console.log(`  ${pool.length} researchers (⚡ + 🔧 + 📖)`);
  console.log(`  ${poolViz.heatmapFamilies.length} method families`);

  console.log('Building profiles…');
  const profiles = pool.map(buildProfile);

  console.log('Building canonical queries…');
  const queries = buildQueries(poolViz);
  console.log(`  ${queries.length} queries`);

  console.log('Embedding profiles…');
  const personVecs = await embedAll(profiles, 'persons');

  console.log('Embedding queries…');
  const queryVecs  = await embedAll(queries.map(q => q.text), 'queries');

  console.log('Computing nearest neighbours…');
  // Per-query top-30
  const queryResults = queries.map((q, qi) => {
    const qv = queryVecs[qi];
    const scored = pool.map((p, pi) => ({ idx: pi, score: cosine(qv, personVecs[pi]) }));
    scored.sort((a, b) => b.score - a.score);
    return { ...q, results: scored.slice(0, 30).map(s => ({ pi: s.idx, score: +s.score.toFixed(4) })) };
  });

  // Per-person top-10 (skip self)
  const personNeighbors = pool.map((_, pi) => {
    const pv = personVecs[pi];
    const scored = pool.map((_, pj) => ({ idx: pj, score: pi === pj ? -1 : cosine(pv, personVecs[pj]) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 10).map(s => ({ pi: s.idx, score: +s.score.toFixed(4) }));
  });

  console.log('Materialising output…');
  // Person table — index-aligned with neighbor pi references
  const people = pool.map((p, i) => {
    const ranked = rankMethodFamilies(p.evidence.map(e => e.title ?? ''));
    const primaryFamily = ranked[0]?.[0] ?? null;
    return {
      idx:                 i,
      slug:                p.slug,
      name:                p.name,
      affiliation:         p.affiliation,
      topRating:           p.topRating,
      paperCount90d:       p.paperCount90d,
      contactStatus:       p.contactStatus,
      primaryFamily,
      primaryFamilyDisplay: ranked[0] ? poolViz.heatmapFamilies.find(f => f.family === primaryFamily)?.familyDisplay ?? null : null,
      region:              inferRegion(p.affiliation),
      topMethods:          topMethodsForEvidence(p.evidence as Evidence[], 3),
      neighbors:           personNeighbors[i],
    };
  });

  const output = {
    version:      1,
    generated_at: new Date().toISOString(),
    model:        MODEL,
    dim:          personVecs[0]?.length ?? 0,
    people,
    queries:      queryResults.map(q => ({
      id:      q.id,
      label:   q.label,
      labelSC: q.labelSC,
      text:    q.text,
      results: q.results,
    })),
    families: poolViz.heatmapFamilies,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  // Atomic write: write to .tmp first, then rename. POSIX rename is atomic
  // on the same filesystem, so if the embedding pipeline crashes mid-write
  // the previous good JSON stays intact (build-time fallback to last-known
  // good data instead of a half-written file).
  const tmp = `${OUTPUT}.tmp`;
  const serialised = JSON.stringify(output, null, 0);
  writeFileSync(tmp, serialised);
  renameSync(tmp, OUTPUT);
  const kb = (serialised.length / 1024).toFixed(1);
  console.log(`✅ wrote ${OUTPUT} (${kb} KB, ${people.length} people, ${queries.length} queries)`);
}

main().catch(err => {
  console.error('build-talent-embeddings failed:', err);
  process.exit(1);
});
