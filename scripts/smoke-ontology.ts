/**
 * scripts/smoke-ontology.ts
 * -------------------------
 * Build-time invariant check for the v2 ontology (vla.json + ai.json + ontology.ts).
 * Hard-fails on any violation; exit 0 means the v2 ontology is well-formed.
 *
 * Run: node --experimental-strip-types scripts/smoke-ontology.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getOntology,
  DISJOINT_PAIRS,
  ALIAS_V1_TO_V2,
  rankMethodFamiliesV2,
  type OntologyNode,
} from '../src/utils/ontology.ts';

const BANNED_BARE = new Set([
  'efficient', 'manipulation', 'reasoning', 'model', 'agent', 'tool',
  'framework', 'runtime', 'safety', 'memory', 'context', 'eval',
  'chain', 'plan',
]);
const ALLOW_BARE = new Set([
  'mcp', 'o3', 'o4', 'gpt-5', 'π0', 'gr00t', 'rt-2', 'openvla',
]);

const fail = (msg: string): never => {
  console.error(`[smoke-ontology] FAIL: ${msg}`);
  process.exit(1);
};

const { nodes, byKey } = getOntology();

// Roots = nodes with no parents. Structural cluster = match_precedence 0.
// "L2+ leaf" (per spec) = anything that is NOT a root and is meant to match
// titles. We treat it as: match_precedence > 0. Cluster nodes (precedence 0,
// empty keywords) are exempt from the keyword/examples checks.
const isRoot      = (n: OntologyNode) => n.parents.length === 0;
const isStructural = (n: OntologyNode) => n.match_precedence === 0;

// -- Invariant 1: every node has scope ≥ 30 chars ---------------------------
for (const n of nodes) {
  if (!n.scope || n.scope.trim().length < 30) {
    fail(`node ${n.slug} has scope shorter than 30 chars`);
  }
}

// -- Invariant 2: every matchable leaf has ≥1 keyword -----------------------
for (const n of nodes) {
  if (isStructural(n)) continue;
  if (!Array.isArray(n.keywords) || n.keywords.length === 0) {
    fail(`leaf ${n.slug} has no keywords`);
  }
}

// -- Invariant 3: every matchable leaf has ≥1 example -----------------------
for (const n of nodes) {
  if (isStructural(n)) continue;
  if (!Array.isArray(n.examples) || n.examples.length === 0) {
    fail(`leaf ${n.slug} has no examples`);
  }
}

// -- Invariant 4: no banned bare unigrams in keyword lists ------------------
for (const n of nodes) {
  for (const kw of n.keywords ?? []) {
    const trimmed = kw.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length !== 1) continue;
    const t = tokens[0].toLowerCase();
    if (ALLOW_BARE.has(t)) continue;
    if (BANNED_BARE.has(t)) {
      fail(`node ${n.slug} contains banned bare unigram "${kw}"`);
    }
  }
}

// -- Invariant 5: DAG has no cycles (DFS, color-marked) ---------------------
{
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.slug, WHITE);

  const visit = (slug: string, stack: string[]): void => {
    const c = color.get(slug);
    if (c === GRAY) {
      fail(`cycle detected at ${slug} via [${stack.concat(slug).join(' -> ')}]`);
    }
    if (c === BLACK) return;
    color.set(slug, GRAY);
    const node = byKey.get(slug);
    if (node) {
      for (const p of node.parents) {
        if (!byKey.has(p)) fail(`node ${slug} has unknown parent "${p}"`);
        visit(p, stack.concat(slug));
      }
    }
    color.set(slug, BLACK);
  };
  for (const n of nodes) visit(n.slug, []);
}

// -- Invariant 6: depth ≤ 4 levels from root --------------------------------
{
  // Depth = length of path from this node up to a root (parents.length === 0).
  // Root itself = depth 0. Cap at 4. Use memoization.
  const depth = new Map<string, number>();
  const compute = (slug: string): number => {
    if (depth.has(slug)) return depth.get(slug)!;
    const node = byKey.get(slug);
    if (!node) return 0;
    if (node.parents.length === 0) {
      depth.set(slug, 0);
      return 0;
    }
    let d = 0;
    for (const p of node.parents) d = Math.max(d, compute(p) + 1);
    depth.set(slug, d);
    return d;
  };
  for (const n of nodes) {
    const d = compute(n.slug);
    if (d > 4) fail(`node ${n.slug} has depth ${d} > 4`);
  }
}

// -- Invariant 7: DISJOINT_PAIRS well-formed --------------------------------
{
  const seen = new Set<string>();
  for (const [a, b] of DISJOINT_PAIRS) {
    if (a === b) fail(`DISJOINT_PAIRS has self-pair on ${a}`);
    if (!byKey.has(a)) fail(`DISJOINT_PAIRS references unknown slug ${a}`);
    if (!byKey.has(b)) fail(`DISJOINT_PAIRS references unknown slug ${b}`);
    const norm = [a, b].sort().join('|');
    if (seen.has(norm)) fail(`DISJOINT_PAIRS has duplicate pair [${a}, ${b}]`);
    seen.add(norm);
  }
}

// -- Invariant 8: ALIAS_V1_TO_V2 covers every V1 family key -----------------
{
  // Parse talent.ts and extract every V1 key from METHOD_FAMILY_KEYWORDS.
  // We do this as a regex pass rather than an import so this script doesn't
  // pull the full talent module (which would also trigger data.ts loaders).
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const talentPath = path.resolve(__dirname, '../src/utils/talent.ts');
  const src = fs.readFileSync(talentPath, 'utf-8');
  const startIdx = src.indexOf('METHOD_FAMILY_KEYWORDS');
  if (startIdx < 0) fail('could not locate METHOD_FAMILY_KEYWORDS in talent.ts');
  const tail = src.slice(startIdx);
  // Match start of the object literal and find its matching close brace.
  const openIdx = tail.indexOf('{');
  if (openIdx < 0) fail('could not locate METHOD_FAMILY_KEYWORDS opening brace');
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < tail.length; i++) {
    const c = tail[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { endIdx = i; break; }
    }
  }
  if (endIdx < 0) fail('METHOD_FAMILY_KEYWORDS object literal not closed');
  const body = tail.slice(openIdx + 1, endIdx);
  // Top-level keys appear at column 2 (indented by 2 spaces). We extract every
  // identifier-like or quoted top-level key by walking and tracking nest depth.
  const v1Keys: string[] = [];
  let d = 0;
  let cursor = 0;
  while (cursor < body.length) {
    const ch = body[cursor];
    if (ch === '{' || ch === '[') d++;
    else if (ch === '}' || ch === ']') d--;
    else if (d === 0) {
      // At top level — try to match a key at this position.
      const slice = body.slice(cursor);
      const m = slice.match(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*:/);
      if (m) {
        v1Keys.push(m[1] ?? m[2] ?? m[3]);
        cursor += m[0].length;
        continue;
      }
    }
    cursor++;
  }
  if (v1Keys.length === 0) fail('parsed 0 V1 keys from METHOD_FAMILY_KEYWORDS');

  for (const k of v1Keys) {
    if (!(k in ALIAS_V1_TO_V2)) {
      fail(`ALIAS_V1_TO_V2 is missing V1 key "${k}"`);
    }
    const target = ALIAS_V1_TO_V2[k];
    if (target !== null && !byKey.has(target)) {
      fail(`ALIAS_V1_TO_V2["${k}"] -> "${target}" is not a known V2 slug`);
    }
  }
  // Also: every alias key must correspond to a real V1 key (no orphan aliases).
  for (const k of Object.keys(ALIAS_V1_TO_V2)) {
    if (!v1Keys.includes(k)) {
      fail(`ALIAS_V1_TO_V2 has orphan key "${k}" not present in V1 METHOD_FAMILY_KEYWORDS`);
    }
  }
}

// -- Invariant 9: no leaf is its own ancestor (parent-chain acyclic) --------
for (const n of nodes) {
  const seen = new Set<string>();
  let cur: string | null = n.primary_parent;
  while (cur) {
    if (cur === n.slug) fail(`node ${n.slug} is its own ancestor`);
    if (seen.has(cur)) break; // unrelated cycle — caught by invariant 5
    seen.add(cur);
    const pnode = byKey.get(cur);
    if (!pnode) break;
    cur = pnode.primary_parent;
  }
}

// -- Invariant 10: ranker returns [] for clear non-matches ------------------
{
  const r = rankMethodFamiliesV2(['unknown topic xyz']);
  if (r.length !== 0) {
    fail(`rankMethodFamiliesV2(["unknown topic xyz"]) returned ${JSON.stringify(r)}, expected []`);
  }
}

const leafCount  = nodes.filter(n => !isStructural(n)).length;
const aliasCount = Object.keys(ALIAS_V1_TO_V2).length;
console.log(
  `OK: ontology smoke passed (${nodes.length} nodes / ${leafCount} leaves / ${aliasCount} aliases).`
);
