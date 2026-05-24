/**
 * src/utils/ontology.ts
 * ---------------------
 * Ontology v2 — shadow-only loader and ranker.
 *
 * This module is a PURE ADDITION: nothing in the live reader path calls it
 * yet (that lands in PR 3). It exists so we can validate the v2 taxonomy
 * (~73 nodes across vla.json + ai.json) at build time, expose disjointness
 * constraints, and provide an alias bridge from V1 family slugs to V2 leaf
 * slugs without touching `talent.ts` V1 keyword tables.
 *
 * Design notes:
 *   - JSON loaded once at module init via Node fs (build-time only).
 *   - `rankMethodFamiliesV2` mirrors `rankMethodFamilies` in talent.ts, but
 *     routes by V2 leaves: highest `match_precedence` wins; among equal
 *     precedence, highest keyword-hit count wins. Catch-alls get
 *     match_precedence 10 in the JSON so a specific (100) hit always beats
 *     them on the same title.
 *   - `ALIAS_V1_TO_V2` is asserted complete at module load — any V1 family
 *     missing an entry throws immediately so review catches it.
 *   - `open_source` is intentionally aliased to `null` (RETIRED — it's a
 *     property, not a method). Consumers must treat null as "deprecated".
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OntologyDomain = 'vla' | 'ai';

export interface OntologyNode {
  slug:             string;
  parents:          string[];
  primary_parent:   string | null;
  domain:           OntologyDomain;
  scope:            string;
  keywords:         string[];
  match_precedence: number;
  effective_date:   string;
  examples:         string[];
  // Optional human label. JSON may carry a string OR null; null/missing falls
  // through to the leaf-slug derivation in displayLabel(). Surfaced via
  // BY_KEY.get(slug).display_name in talent.ts displayLabel().
  display_name?:    string | null;
}

export interface OntologyEdge {
  child:  string;
  parent: string;
}

interface OntologyFile {
  version:        string;
  effective_date: string;
  domain:         OntologyDomain;
  nodes:          OntologyNode[];
}

// ---------------------------------------------------------------------------
// JSON load (build-time only — no runtime fetch)
// ---------------------------------------------------------------------------

function resolveDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(__dirname, '../data/ontology');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* ignore */ }
  return path.resolve(process.cwd(), 'src/data/ontology');
}

function readOntologyFile(filename: string): OntologyFile {
  const full = path.join(resolveDataDir(), filename);
  const raw  = fs.readFileSync(full, 'utf-8');
  return JSON.parse(raw) as OntologyFile;
}

const VLA = readOntologyFile('vla.json');
const AI  = readOntologyFile('ai.json');

const ALL_NODES: OntologyNode[] = [...VLA.nodes, ...AI.nodes];
const BY_KEY: Map<string, OntologyNode> = new Map(
  ALL_NODES.map(n => [n.slug, n] as const)
);

export function getOntology(): { nodes: OntologyNode[]; byKey: Map<string, OntologyNode> } {
  return { nodes: ALL_NODES, byKey: BY_KEY };
}

// ---------------------------------------------------------------------------
// Disjointness pairs (inline — keeping these next to the loader keeps
// review surface small; promoting to JSON later is trivial)
// ---------------------------------------------------------------------------
export const DISJOINT_PAIRS: Array<[string, string]> = [
  ['vla.action.diffusion_policy', 'vla.action.flow_matching'],
  ['vla.world.world_model_dynamics', 'vla.world.video_generation_for_robotics'],
  ['vla.reasoning.embodied_cot', 'vla.reasoning.hierarchical_planning'],
  ['vla.manipulation.dexterous_manipulation', 'vla.locomotion.humanoid_whole_body'],
  ['vla.foundation.cross_embodiment_fm', 'vla.foundation.vla_generalist'],
  ['ai.rag.rag_classic', 'ai.context.agent_memory'],
  ['ai.tools.mcp_protocol', 'ai.tools.function_calling'],
  ['ai.context.context_engineering', 'ai.context.long_context'],
  ['ai.computer_use.computer_use_desktop', 'ai.tools.browser_use'],
  ['ai.infra.agent_framework', 'ai.infra.agent_runtime'],
  ['ai.safety.agent_safety', 'vla.eval.robot_safety'],
  ['vla.world.world_model_dynamics', 'ai.reasoning.world_model_llm'],
];

// ---------------------------------------------------------------------------
// V1 → V2 alias map
//
// V1 keys are pulled from talent.ts METHOD_FAMILY_KEYWORDS so we can assert
// completeness at module load. `null` = explicit retire (open_source).
// ---------------------------------------------------------------------------
export const ALIAS_V1_TO_V2: Record<string, string | null> = {
  // Shared / AI families
  flow_matching:        'vla.action.flow_matching',
  diffusion_policy:     'vla.action.diffusion_policy',
  world_model:          'vla.world.world_model_dynamics',
  agentic_coding:       'ai.coding.agentic_coding',
  mcp_protocol:         'ai.tools.mcp_protocol',
  multi_agent:          'ai.multi_agent.multi_agent',
  context_engineering:  'ai.context.context_engineering',
  agent_safety:         'ai.safety.agent_safety',
  agent_eval:           'ai.eval.agent_eval',
  agent_infra:          'ai.infra.agent_infra',
  open_source:          null,                              // RETIRED — property, not method
  voice_multimodal:     'ai.frontier.voice_multimodal',
  reasoning_planning:   'ai.reasoning.reasoning_planning',  // L2 parent (its L3s split CoT vs tree-search)
  frontier_model:       'ai.frontier.frontier_model',
  vertical_agent:       'ai.vertical.vertical_agent',
  '3d_representation':  'vla.perception.representation_3d',

  // Extended VLA-paradigm families
  vla_core:                  'vla.foundation.vla_generalist',
  // ── Server-side V1 slugs from _vla_method_families.py (15-family classifier).
  //     Most map cleanly; some pre-date V2's finer-grained partitioning so are
  //     marked LOSSY where the V1 bucket was strictly broader than V2's home.
  cross_embodiment:          'vla.foundation.cross_embodiment_fm',
  dexterous_hand:            'vla.manipulation.dexterous_manipulation',
  // V1 `human_robot` covered teleoperation + learning-from-demo + shared
  // autonomy. The HRI angle has no V2 home; the LfD angle becomes
  // imitation_learning. LOSSY but the largest semantic overlap.
  human_robot:               'vla.policy.imitation_learning',
  // V1 `instruction_tuning` = SFT / supervised fine-tuning of policies. V2
  // models that as imitation_learning (the supervised-on-demos lineage).
  instruction_tuning:        'vla.policy.imitation_learning',
  // V1 `language_grounding` keywords: 'vision-language-action', 'natural
  // language instruct', 'language conditioned'. That IS the VLA generalist
  // story. Route there.
  language_grounding:        'vla.foundation.vla_generalist',
  long_horizon:              'vla.reasoning.hierarchical_planning',
  mobile_manipulation:       'vla.manipulation.mobile_manipulation',
  // V1 `multi_task` overlapped 'generalist robot', 'foundation model',
  // 'general purpose robot'. Route to the generalist foundation bucket.
  multi_task:                'vla.foundation.vla_generalist',
  // V1 `rl_finetuning` was about post-training VLAs with RL (GRPO/PPO/DPO).
  // V2's vla_post_training_rl is exactly that lineage.
  rl_finetuning:             'vla.policy.robot_rl.vla_post_training_rl',
  // V1 `tactile` vs V2 `tactile_sensing` — same concept, namespaced.
  tactile:                   'vla.manipulation.tactile_sensing',
  // Lossy: old `manipulation` was a catch-all router covering ALL manipulation
  // sub-families. V2 retires manipulation-as-router; we point V1 callers at
  // the cluster slug (precedence 0 = never matches) so they get a structural
  // anchor without a false positive.
  manipulation:              'vla.manipulation',
  imitation_learning:        'vla.policy.imitation_learning',
  robot_rl:                  'vla.policy.robot_rl',           // L2 parent of the 3 L3 RL leaves
  dexterous_manipulation:    'vla.manipulation.dexterous_manipulation',
  tactile_sensing:           'vla.manipulation.tactile_sensing',
  // Lossy: V1 `efficient_inference` lumped acceleration + async chunking together;
  // V2 splits them. Default to acceleration (the larger of the two buckets).
  efficient_inference:       'vla.efficiency.vla_acceleration',
  sim_to_real:               'vla.sim_data.sim_to_real',
  navigation:                'vla.navigation.vision_language_navigation',
  // Lossy: V1 `data_generation` mixed real-data collection + synthetic gen +
  // dataset/pretraining/scaling. Pick synthetic_data_generation as the
  // closest single anchor; consumers needing finer split should re-key.
  data_generation:           'vla.sim_data.synthetic_data_generation',
};

// Assert every V1 key is mapped and every non-null target exists as a node.
// This runs at module init — any missing alias trips the build.
{
  // Static list of V1 family keys, mirrored from talent.ts METHOD_FAMILY_KEYWORDS.
  // We don't `import` METHOD_FAMILY_KEYWORDS because it isn't exported; mirroring
  // the keys here + asserting they're identical at smoke time is the next-best
  // contract. (smoke-ontology.ts cross-checks this list against talent.ts.)
  const V1_KEYS = [
    'flow_matching', 'diffusion_policy', 'world_model', 'agentic_coding',
    'mcp_protocol', 'multi_agent', 'context_engineering', 'agent_safety',
    'agent_eval', 'agent_infra', 'open_source', 'voice_multimodal',
    'reasoning_planning', 'frontier_model', 'vertical_agent', '3d_representation',
    'vla_core', 'manipulation', 'imitation_learning', 'robot_rl',
    'dexterous_manipulation', 'tactile_sensing', 'efficient_inference',
    'sim_to_real', 'navigation', 'data_generation',
  ];
  for (const k of V1_KEYS) {
    if (!(k in ALIAS_V1_TO_V2)) {
      throw new Error(`[ontology.ts] V1 family key "${k}" has no entry in ALIAS_V1_TO_V2`);
    }
    const target = ALIAS_V1_TO_V2[k];
    if (target !== null && !BY_KEY.has(target)) {
      throw new Error(`[ontology.ts] ALIAS_V1_TO_V2["${k}"] = "${target}" does not exist as a V2 node`);
    }
  }
}

// ---------------------------------------------------------------------------
// V2 ranking — mirrors rankMethodFamilies in talent.ts but routes by leaves.
//
// Per-title rule:
//   - Among all leaves with ≥1 keyword hit, the highest match_precedence wins.
//   - Within equal precedence, highest hit-count wins.
//   - Ties broken by declaration order (i.e. Map iteration).
// ---------------------------------------------------------------------------
export function rankMethodFamiliesV2(titles: string[]): Array<[string, number]> {
  const hits: Record<string, number> = {};

  // Precompute matchable leaves (skip structural nodes with match_precedence === 0
  // OR empty keyword lists — these are clusters and roots).
  const matchable = ALL_NODES.filter(n => n.match_precedence > 0 && n.keywords.length > 0);

  for (const t of titles) {
    if (!t) continue;
    // Pad with spaces so word-boundary keywords like ' mcp ' match at edges.
    const title = ` ${t.toLowerCase()} `;

    let best: { slug: string; precedence: number; hits: number } | null = null;
    for (const node of matchable) {
      let n = 0;
      for (const kw of node.keywords) if (title.includes(kw)) n++;
      if (n === 0) continue;
      if (
        !best ||
        node.match_precedence > best.precedence ||
        (node.match_precedence === best.precedence && n > best.hits)
      ) {
        best = { slug: node.slug, precedence: node.match_precedence, hits: n };
      }
    }
    if (best) hits[best.slug] = (hits[best.slug] ?? 0) + 1;
  }

  return Object.entries(hits).sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// Cross-parent DAG check — for PR 3 constellation bridge detection.
//
// Returns true iff a and b share NO common ancestor (including the implicit
// roots). Walks the parent chain via primary_parent (which for our DAG is
// also the only parent — multi-parent is not in use yet). If either slug is
// unknown, returns false (conservative: not "cross").
// ---------------------------------------------------------------------------
function ancestorsOf(slug: string): Set<string> {
  const out = new Set<string>();
  let cur: string | null = slug;
  while (cur) {
    out.add(cur);
    const node = BY_KEY.get(cur);
    if (!node) break;
    cur = node.primary_parent;
  }
  return out;
}

export function isCrossParent(a: string, b: string): boolean {
  if (!BY_KEY.has(a) || !BY_KEY.has(b)) return false;
  if (a === b) return false;
  const ancA = ancestorsOf(a);
  const ancB = ancestorsOf(b);
  // If they share ANY ancestor (including each other or a common cluster),
  // they're not cross-parent. The implicit root 'vla' / 'ai' would only
  // intersect within the same domain — distinct domains have no shared root.
  for (const x of ancA) if (ancB.has(x)) return false;
  return true;
}
