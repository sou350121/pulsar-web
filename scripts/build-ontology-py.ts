/**
 * Auto-generate scripts/_ontology_v2.py from src/data/ontology/{vla,ai}.json.
 *
 * Why this exists:
 *   PR 4 of the Ontology v2 migration switches the server-side Python pipeline
 *   (_vla_method_families.py, compute-field-state.py, compute-gh-adoption.py)
 *   to emit V2 slugs natively instead of V1. Both the TS site and the Python
 *   pipeline must share the same taxonomy, but Python can't import JSON the way
 *   TS does at module init. We therefore generate a Python module at build
 *   time so server-side scripts can:
 *
 *       from _ontology_v2 import (
 *           LEAVES, KEYWORDS, CATCH_ALL,
 *           ALIAS_V1_TO_V2, rank_method_families,
 *       )
 *
 *   This script is the SoT-converter. It is committed alongside the generated
 *   `_ontology_v2.py` so:
 *     - The data server pulls the latest by `curl` from GitHub raw, OR
 *     - It is sync'd via the existing pulsar-web checkout on the box.
 *
 *   Wired into `pnpm build` to guarantee the .py file never drifts from JSON.
 *
 * Output: scripts/_ontology_v2.py (committed; human-readable; ASCII-only-ish).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

type Node = {
  slug:             string;
  parents:          string[];
  primary_parent:   string | null;
  domain:           'vla' | 'ai';
  display_name?:    string;
  scope:            string;
  keywords:         string[];
  match_precedence: number;
  effective_date:   string;
  examples?:        string[];
};

function loadDomain(filename: string): { version: string; nodes: Node[] } {
  const path = resolve(REPO_ROOT, 'src/data/ontology', filename);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Pull the V1→V2 alias map straight out of ontology.ts. We export the raw
// object as a JSON-coercible literal so the regex below can lift it without
// running TypeScript.
function loadAliases(): Record<string, string | null> {
  const tsSource = readFileSync(resolve(REPO_ROOT, 'src/utils/ontology.ts'), 'utf8');
  const m = tsSource.match(/export const ALIAS_V1_TO_V2\s*:\s*Record<string,\s*string\s*\|\s*null>\s*=\s*(\{[\s\S]*?^\});/m);
  if (!m) throw new Error('ALIAS_V1_TO_V2 not found in ontology.ts');
  // Be permissive: strip TS comments, single→double quotes, drop trailing commas.
  // The const is hand-curated and stable; this parsing is brittle but covers
  // the current shape. If it ever fails, hand-translate.
  let body = m[1]
    .replace(/\/\/[^\n]*/g, '')             // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
    .replace(/'([^']*)'/g, '"$1"')          // single → double quotes
    .replace(/,(\s*[}\]])/g, '$1')          // trailing commas
    .replace(/(\w+):/g, '"$1":');           // BUT this would re-quote keys that are already quoted — guard:
  // Undo the re-quote on keys that were already quoted (rare): regex above only
  // matches BARE keys (no quote in front of `:`), so already-quoted keys stay fine.
  // However, identifiers like `null` become `"null"` — fix:
  body = body.replace(/:\s*"null"/g, ': null');
  return JSON.parse(body);
}

function pyRepr(s: string): string {
  // Python triple-quoted string with safe escaping. Keywords / scopes are
  // short, ASCII-leaning, no triple-quote sequences in practice.
  if (s.includes("'") && !s.includes('"')) return JSON.stringify(s);
  return JSON.stringify(s);  // double-quoted JSON string is valid Python
}

function emit(): string {
  const vla = loadDomain('vla.json');
  const ai  = loadDomain('ai.json');
  const allNodes = [...vla.nodes, ...ai.nodes];
  const aliasMap = loadAliases();

  const ontologyEntries: string[] = [];
  for (const n of allNodes) {
    ontologyEntries.push([
      `    ${pyRepr(n.slug)}: {`,
      `        "parents": ${JSON.stringify(n.parents)},`,
      `        "primary_parent": ${n.primary_parent === null ? 'None' : pyRepr(n.primary_parent)},`,
      `        "domain": ${pyRepr(n.domain)},`,
      `        "display_name": ${n.display_name ? pyRepr(n.display_name) : 'None'},`,
      `        "keywords": ${JSON.stringify(n.keywords)},`,
      `        "match_precedence": ${n.match_precedence},`,
      `        "effective_date": ${pyRepr(n.effective_date)},`,
      `    },`,
    ].join('\n'));
  }

  const aliasEntries: string[] = [];
  for (const [v1, v2] of Object.entries(aliasMap)) {
    aliasEntries.push(`    ${pyRepr(v1)}: ${v2 === null ? 'None' : pyRepr(v2)},`);
  }

  // Header / docstring + main body.
  const py = `"""
Auto-generated Python ontology module — DO NOT EDIT BY HAND.

Generated from:
  pulsar-web/src/data/ontology/vla.json (${vla.version})
  pulsar-web/src/data/ontology/ai.json  (${ai.version})

Regenerate with:
  cd pulsar-web && pnpm build-ontology-py
  (also runs as part of pnpm build)

Public API:
  ONTOLOGY: dict[slug, dict]               — every node by slug
  LEAVES: list[str]                        — slugs with match_precedence > 0
  CATCH_ALL: set[str]                      — match_precedence in (0, 10]
  KEYWORDS: dict[slug, list[str]]          — leaves only
  ALIAS_V1_TO_V2: dict[str, str | None]    — V1 → V2 alias map (None = retired)
  rank_method_families(titles: list[str]) -> list[tuple[str, int]]
      Per-title pick: highest match_precedence wins ties; among equals,
      highest keyword-hit count wins. Mirrors TS rankMethodFamiliesV2.

Generated at: ${new Date().toISOString()}
"""

ONTOLOGY = {
${ontologyEntries.join('\n')}
}

ALIAS_V1_TO_V2 = {
${aliasEntries.join('\n')}
}

LEAVES = [slug for slug, n in ONTOLOGY.items() if n["match_precedence"] > 0]
CATCH_ALL = {slug for slug, n in ONTOLOGY.items() if 0 < n["match_precedence"] <= 10}
KEYWORDS = {slug: n["keywords"] for slug, n in ONTOLOGY.items() if n["match_precedence"] > 0 and n["keywords"]}
DISPLAY_NAMES = {slug: n["display_name"] for slug, n in ONTOLOGY.items() if n["display_name"]}


def rank_method_families(titles):
    """Per-title family routing.

    Returns sorted [(slug, hit_count), ...] DESC. Per title: pick at most one
    family — specific (non-CATCH_ALL) families always beat catch-alls; within
    each tier the family with the most keyword hits wins.

    Mirrors the TS rankMethodFamiliesV2 exactly so server-side trends align
    with site-side display.
    """
    hits = {}
    for t in titles:
        if not t:
            continue
        title = f" {t.lower()} "
        specific_best = None
        catch_best = None
        for slug, kws in KEYWORDS.items():
            n = sum(1 for kw in kws if kw in title)
            if n == 0:
                continue
            if slug in CATCH_ALL:
                if not catch_best or n > catch_best[1]:
                    catch_best = (slug, n)
            else:
                if not specific_best or n > specific_best[1]:
                    specific_best = (slug, n)
        picked = specific_best or catch_best
        if picked:
            hits[picked[0]] = hits.get(picked[0], 0) + 1
    return sorted(hits.items(), key=lambda x: -x[1])


def resolve_v1_slug(slug):
    """Resolve a V1 slug to its V2 equivalent.

    Returns None if the V1 family has been retired (e.g. 'open_source').
    Pass-through if the input is already a V2 slug. Used for one-shot
    migration of existing JSON files.
    """
    if slug in ALIAS_V1_TO_V2:
        return ALIAS_V1_TO_V2[slug]
    if slug in ONTOLOGY:
        return slug  # already V2
    return None      # unknown — caller decides what to do


if __name__ == "__main__":
    import sys
    print(f"ONTOLOGY: {len(ONTOLOGY)} nodes")
    print(f"LEAVES: {len(LEAVES)}")
    print(f"CATCH_ALL: {len(CATCH_ALL)} ({sorted(CATCH_ALL)})")
    print(f"ALIAS_V1_TO_V2: {len(ALIAS_V1_TO_V2)} entries "
          f"({sum(1 for v in ALIAS_V1_TO_V2.values() if v is None)} retired)")
    if len(sys.argv) > 1:
        # Usage: python3 _ontology_v2.py "diffusion policy for manipulation"
        ranked = rank_method_families(sys.argv[1:])
        for slug, n in ranked[:5]:
            print(f"  {slug}: {n}")
`;
  return py;
}

const out = emit();
const outPath = resolve(REPO_ROOT, 'scripts/_ontology_v2.py');
writeFileSync(outPath, out);
console.log(`wrote ${outPath} (${(out.length / 1024).toFixed(1)} KB)`);
