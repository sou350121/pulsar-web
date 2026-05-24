/**
 * src/utils/talent.ts
 * --------------------
 * Stage-4 "Talent Radar" derivation: invert the data lens from
 *   papers → methods → labs → people → HR queue.
 *
 * Pure build-time module. No I/O beyond reading src/data/ JSON via the
 * helpers exposed from data.ts. Never reads or stores email addresses.
 *
 * Design constraints:
 *   - 先有论文池, 后有小方向; 先归纳方向, 再反推人才
 *   - Every record carries `evidence: Evidence[]` (paper title + URL + date + rating)
 *   - PersonRecord carries `contact_status` (enum), never raw contact details
 *   - No external API calls — derive everything from existing src/data/*.json
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadEntityIndex,
  loadVLADailyPicks,
  loadAIDailyPicks,
  loadSocialIntel,
  type Entity,
} from './data.ts';

import {
  rankMethodFamiliesV2,
  getOntology,
  ALIAS_V1_TO_V2,
  isCrossParent,
} from './ontology.ts';

// PR 3 — Ontology v2 readers.
//
// Set USE_ONTOLOGY_V1=1 in the build env to roll back to V1 reader paths
// without reverting the commit. Each reader below has a V1 fallback branch
// that mirrors the pre-PR-3 behaviour byte-for-byte. Rollback = redeploy
// with the env var set; takes ~3 minutes via GH Actions trigger.
//
// V2 is the new default. PR 4 will switch the upstream Python pipeline
// (compute-field-state.py, _vla_method_families.py) to emit V2 slugs
// natively. Until then, loadSubdirections alias-resolves V1 slugs from
// field-state-*.json at read time via ALIAS_V1_TO_V2.
const ONTOLOGY_V2_ACTIVE = process.env.USE_ONTOLOGY_V1 !== '1';

// Unified label resolver. In V2 mode, look the slug up in the ontology and
// prefer its display_name; otherwise derive from the leaf segment of the
// slug (e.g. "vla.action.diffusion_policy" → "Diffusion Policy"). In V1
// mode, defer to the legacy familyDisplay(). Defined as a closure-bound
// helper because it must reach METHOD_FAMILY_LABELS / familyDisplay below.
export function displayLabel(family: string): string {
  if (ONTOLOGY_V2_ACTIVE) {
    const node = getOntology().byKey.get(family);
    if (node?.display_name) return node.display_name;
    // Leaf-of-slug fallback. Handles both V2 slugs ("vla.action.flow_matching"
    // → "Flow Matching") and bare V1 slugs that got passed through unchanged
    // (e.g. an alias target of `null` like open_source → "Open Source").
    const leaf = family.split('.').at(-1) ?? family;
    return leaf.split('_')
      .map(w => w.length === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return familyDisplay(family);
}

// PR 3: helper for the match page chip rendering. Chip IDs are baked into
// talent-embeddings.json as `family:<v1_slug>` (e.g. `family:vla_core`).
// When V2 is active, resolve the V1 slug through ALIAS_V1_TO_V2 and emit
// the V2 display label so users see "Vla Generalist" / "Manipulation"
// rather than the legacy V1 hand-curated labels. Falls back to the raw
// pre-baked label string when alias resolution finds nothing (e.g. for
// `null`-aliased families like open_source — chip stays as-is, and the
// chip's `results` still work because they reference person indices).
//
// The chip embedding vectors themselves stay V1-keyed until PR 4/5 re-bake.
export function chipLabelV2(chipId: string, fallbackLabel: string): string {
  if (!ONTOLOGY_V2_ACTIVE) return fallbackLabel;
  if (!chipId.startsWith('family:')) return fallbackLabel;
  const v1 = chipId.slice('family:'.length);
  if (!(v1 in ALIAS_V1_TO_V2)) return fallbackLabel;
  const v2 = ALIAS_V1_TO_V2[v1];
  if (v2 === null) return fallbackLabel;
  return displayLabel(v2);
}

// ---------------------------------------------------------------------------
// Local DATA_DIR resolution (mirrors data.ts) for reading field-state and
// emerging-terms which don't yet have first-class loaders in data.ts.
// ---------------------------------------------------------------------------
function resolveDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(__dirname, '../data');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* ignore */ }
  return path.resolve(process.cwd(), 'src/data');
}
const DATA_DIR = resolveDataDir();

function readJsonLocal<T>(filename: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8')) as T;
  } catch {
    return null;
  }
}

function listLocal(prefix: string, ext: string = '.json'): string[] {
  try {
    return fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith(ext))
      .sort().reverse();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Evidence {
  title:        string;
  url:          string;
  date:         string;
  rating:       string;
  authorMention?: string;   // first author byline as it appeared on the paper
  domain:       'vla' | 'ai' | string;
}

export interface SubdirectionRecord {
  family:           string;   // canonical key e.g. 'flow_matching'
  displayName:      string;   // human label
  velocity7d:       number;   // count in last 7d
  velocityPrior7d:  number;   // count in days 8-14
  acceleration:     number;   // (recent - prior) / max(prior, 1)
  status:           string;   // 'accelerating' | 'declining' | 'stable' | 'low_confidence'
  domain:           'vla' | 'ai';
  evidence:         Evidence[];   // sample papers
  topLabs:          string[];     // top 3 labs with this method in 90d
}

export interface LabRecord {
  name:            string;
  signalCount90d:  number;
  recentSignalCount7d: number;
  velocityBars:    number[];   // per-day counts last 14 days, for sparkline
  methodFocus:     string[];   // top 3 method families seen at this lab
  topRating:       string;     // best rating in 90d (⚡ > 🔧 > 📖)
  lastSeen:        string;     // YYYY-MM-DD
  evidence:        Evidence[]; // top recent papers
  domains:         Array<'vla' | 'ai_app'>;  // domains observed in signals
}

// URL-anchor / id-safe slug. Keeps unicode letters (CJK works in fragments),
// strips punctuation/whitespace. "清华" → "清华"; "UT Austin" → "ut-austin".
export function slugifyName(s: string): string {
  return s.toLowerCase().trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-]/gu, '');
}

export type ContactStatus =
  | 'linked_via_lab'
  | 'social_mention'
  | 'not_linked';

export interface PersonRecord {
  name:           string;      // canonical display name
  normalizedKey:  string;      // lowercased / trimmed for dedup
  // Stable, anchor-safe slug. Guaranteed unique across the PersonRecord set
  // returned by loadPeople — collisions from slugifyName (e.g. "J. Smith"
  // vs "J Smith" both → "j-smith") are disambiguated with a numeric suffix
  // (`-2`, `-3`, …) on the later occurrence. All downstream callers should
  // use this field instead of slugifying `name` ad-hoc.
  slug:           string;
  affiliation:    string | null;
  paperCount90d:  number;
  topRating:      string;
  contactStatus:  ContactStatus;
  evidence:       Evidence[];   // up to 5 most recent papers
  // Hard contract: email is NEVER stored. `never` makes any future
  // assignment a compile error, beyond comment-level documentation.
  readonly email?: never;
}

export interface HRCandidate extends PersonRecord {
  whyNow:        string;       // human-readable summary of gate hit
  gateHits:      string[];     // list of gate criteria this candidate satisfies
}

// ---------------------------------------------------------------------------
// Author name normalization
//   - NFKC, strip middle initials, lowercase
//   - "Smith, J." == "J. Smith" == "J Smith"  → "j smith"
//
// We can never enumerate co-authors because arXiv truncates to "First et al."
// so we only ever see the FIRST author. We surface them as such.
// ---------------------------------------------------------------------------
function normalizeName(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFKC').trim();
  // "Smith, John" → "John Smith"
  if (s.includes(',') && !s.includes(' and ')) {
    const [last, ...rest] = s.split(',').map(p => p.trim());
    if (last && rest.length > 0) s = `${rest.join(' ')} ${last}`;
  }
  // Drop trailing "et al" and parenthesized affiliations
  s = s.replace(/\bet\s*al\.?$/i, '').replace(/\(.*?\)/g, '').trim();
  // Collapse whitespace, lowercase, drop middle initials like "J."
  s = s.toLowerCase().replace(/\s+/g, ' ');
  // Drop initials only if doing so leaves ≥2 real-name tokens; otherwise
  // keep them so "J. Smith" / "K. Smith" stay distinct (was: pre-filter
  // length check, which collapsed "J. K. Smith" → "smith").
  const tokens = s.split(' ');
  const nonInitials = tokens.filter(tok => !/^[a-z]\.?$/.test(tok));
  s = nonInitials.length >= 2 ? nonInitials.join(' ') : tokens.join(' ');
  return s;
}

function displayName(normalized: string): string {
  return normalized.split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractFirstAuthor(authors: string | undefined): string {
  if (!authors) return '';
  const first = authors.split(',')[0]?.trim() || '';
  // Drop trailing "et al" tokens that arXiv often appends to single-author papers
  return first.replace(/\s+et\s+al\.?$/i, '').trim();
}

// ---------------------------------------------------------------------------
// Field state — surface method family trends from the pre-computed mechanical
// trigger output. We don't recompute trends here; just read latest snapshot.
// ---------------------------------------------------------------------------

interface FieldStateMethodTrend {
  family:          string;
  // PR 4: Python pipeline dual-writes a V2 slug here once it migrates. If
  // present, prefer this over alias-resolving `family`. Absent during/after
  // rollback — readers fall through to the V1 alias map.
  family_v2?:      string;
  count_7d:        number;
  count_prior_7d:  number;
  count_14d:       number;
  daily_avg_recent: number;
  daily_avg_prior: number;
  acceleration:    number;
  status:          string;
  trend_version:   number;
  source_type:     string;
}

interface FieldStateFile {
  date:             string;
  method_trends?:   FieldStateMethodTrend[];
}

function latestFieldState(prefix: 'field-state-' | 'ai-field-state-'): FieldStateFile | null {
  const files = listLocal(prefix);
  if (files.length === 0) return null;
  return readJsonLocal<FieldStateFile>(files[0]);
}

// ---------------------------------------------------------------------------
// Data-quality filters
//
// The byline extractor that builds the people index can be tricked by paper
// summaries that lack a real byline — the regex grabs the leading sentence
// fragment and treats it as the first author's name. Likewise, the entity-
// index has occasional researcher surnames mis-labelled as labs. These two
// filters keep that noise out of the UI.
// ---------------------------------------------------------------------------

const NAME_BAD_TOKEN = /\b(models?|tasks?|approach|method|policy|policies|emerged|using|trained|propose|present|introduce|prompt|reasoning|manipulation|require|combining|advanced|enable|robots?|observations?|instructions?|directly|alternatively|whereas|however|consequently|moreover|furthermore|typically|increasingly|repeatedly|mirroring|despite|finetun|sampling)\b/i;
const NAME_BAD_PHRASE = /\b(such as|fine[- ]tun)\b/i;

export function isPlausibleName(raw: string): boolean {
  if (!raw) return false;
  const s = raw.trim();
  if (s.length < 2 || s.length > 50) return false;
  if (NAME_BAD_TOKEN.test(s) || NAME_BAD_PHRASE.test(s)) return false;
  const tokens = s.split(/\s+/);
  if (tokens.length > 5) return false;
  // Punctuation followed by a lowercase letter → sentence fragment
  if (/[.,;:]\s*[a-z]/.test(s)) return false;
  // Looks like a clause: leading 'the/a/an/this/that'
  if (/^(the|a|an|this|that|these|those|our|we|in|on|with|by|for)\s/i.test(s)) return false;
  return true;
}

// Whitelist of single-token labs the entity-index should be allowed to
// surface. Anything single-token not on this list and not all-caps / CJK
// gets dropped, because that's how surnames ("Ryoo") leak through.
const KNOWN_SINGLE_TOKEN_LABS = new Set<string>([
  'NVIDIA', 'CMU', 'MIT', 'Stanford', 'Berkeley', 'DeepMind', 'Meta',
  'Microsoft', 'Princeton', 'ETH', 'KAIST', 'USC', 'IIT', 'Imperial',
  'Freiburg', 'Tongji', 'HKUST', 'UCSD', 'UCLA', 'UCSB', 'UCB',
  'OpenAI', 'Anthropic', 'Google', 'Apple', 'Amazon',
  'Tencent', 'Bytedance', 'ByteDance', 'Alibaba', 'Baidu', 'Huawei',
  'EPFL', 'Inria', 'RIKEN', 'Oxford', 'Cambridge', 'Yale', 'Harvard',
  'Columbia', 'Cornell', 'Caltech', 'Toronto', 'Waterloo', 'McGill',
  'Tsinghua', 'PKU', 'SJTU', 'Fudan', 'NTU', 'NUS',
]);

export function isPlausibleLab(name: string, signalCount: number): boolean {
  if (!name) return false;
  const s = name.trim();
  if (s.length < 2 || s.length > 80) return false;
  // Multi-token (institution-shaped) → keep
  if (/\s/.test(s)) return true;
  // Whitelisted single token → keep
  if (KNOWN_SINGLE_TOKEN_LABS.has(s)) return true;
  // All-caps acronym (EPFL, RIKEN, KAIST…) → keep if any signal
  if (/^[A-Z]{2,}$/.test(s) && signalCount >= 1) return true;
  // CJK single token (清華 / 北大 / 上交 / …) → keep
  if (/^[一-鿿]+$/.test(s)) return true;
  // Mixed-case single token (likely a surname) → drop
  return false;
}

const METHOD_FAMILY_LABELS: Record<string, string> = {
  // Original 16 (kept verbatim for back-compat with field-state trends + UI tags)
  flow_matching:        'Flow Matching',
  diffusion_policy:     'Diffusion Policy',
  world_model:          'World Models',
  agentic_coding:       'Agentic Coding',
  mcp_protocol:         'MCP Protocol',
  multi_agent:          'Multi-Agent',
  context_engineering:  'Context Engineering',
  agent_safety:         'Agent Safety',
  agent_eval:           'Agent Eval',
  agent_infra:          'Agent Infra',
  open_source:          'Open Source',
  voice_multimodal:     'Voice / Multimodal',
  reasoning_planning:   'Reasoning / Planning',
  frontier_model:       'Frontier Models',
  vertical_agent:       'Vertical Agents',
  '3d_representation':  '3D Representation',
  // Extended VLA-paradigm families — surfaced only via keyword matching;
  // not driven by field-state. These bring researcher coverage from
  // ~22% to ~80% by giving the most common VLA work an actual bucket.
  vla_core:                  'VLA Core',
  manipulation:              'Manipulation',
  imitation_learning:        'Imitation Learning',
  robot_rl:                  'Robot RL',
  dexterous_manipulation:    'Dexterous Manipulation',
  tactile_sensing:           'Tactile / Sensing',
  efficient_inference:       'Efficient Inference',
  sim_to_real:               'Sim-to-Real',
  navigation:                'Navigation',
  data_generation:           'Data / Demonstrations',
};

// Per-family keyword vocabulary. Match = ANY phrase appears in the
// lowercased title. Order is irrelevant — ranking is by total hits.
//
// Design notes:
//   - Prefer multi-word phrases over single tokens to avoid false positives.
//   - "model"/"models" alone is too broad → never used as a bare keyword.
//   - For each family, the FIRST phrase is the canonical form; later
//     phrases capture common synonyms / abbreviations observed in titles.
//   - Some VLA-paradigm families (vla_core, manipulation, …) are wider on
//     purpose — they're meant to be the catch-all primary for researchers
//     whose work doesn't cleanly fit a method-specific bucket. Specific
//     buckets (flow_matching, diffusion_policy, …) beat them on ranking
//     when a paper genuinely mentions the technique.
const METHOD_FAMILY_KEYWORDS: Record<string, string[]> = {
  flow_matching: [
    'flow matching', 'flow-matching', 'rectified flow', 'rectflow',
    'mean flow', 'mean-flow', 'consistency flow', 'flow-based',
    'flow policy', 'flow vla', 'discrete flow',
  ],
  diffusion_policy: [
    'diffusion policy', 'diffusion policies', 'diffusion-policy',
    'diffusion-based policy', 'score-based policy', 'denoising policy',
    'diffusion model for', 'diffusion vla', 'diffusion-based vla',
    'diffusion transformer', 'dp3', 'diffusion-based action',
    'noise vector', 'generative policy', 'generative policies',
  ],
  world_model: [
    'world model', 'world-model', 'world action model', 'world-action model',
    'video prediction', 'next-frame prediction', 'dreamer',
    'video foundation model', 'physical world model', 'world foundation model',
    'video planner', 'world knowledge', 'video dynamics',
  ],
  agentic_coding: [
    'coding agent', 'code agent', 'agentic coding', 'coding harness',
    'claude code', 'codex', 'code generation', 'software engineer agent',
    'coding sandbox', 'autocode',
  ],
  mcp_protocol: [
    'mcp ', ' mcp', 'model context protocol', 'context protocol',
  ],
  multi_agent: [
    'multi-agent', 'multi agent', 'multiagent', 'agent collaboration',
    'agent orchestration', 'multi-robot', 'multi robot',
  ],
  context_engineering: [
    'context engineering', 'long context', 'long-context', 'context window',
    'context compression', 'kv cache', 'kv-cache', 'context memory',
    'memory policy', 'gated memory', 'experience replay', 'success memory',
    'hierarchical memory', 'long-horizon memory', 'continual learning',
  ],
  agent_safety: [
    'agent safety', 'safety in vision', 'adversarial', 'red team',
    'red-team', 'backdoor', 'jailbreak', 'attack framework',
    'safe contact', 'safety-aware', 'safety filter', 'safety agent',
    'iso-compliant',
  ],
  agent_eval: [
    'benchmark', 'evaluation framework', 'evaluating', 'leaderboard',
    'eval suite', 'roboeval', 'roboplayground', 'robofac',
    'failure analysis', 'failure taxonomy', 'metacognitive',
  ],
  agent_infra: [
    'cache', 'inference framework', 'serving', 'edge-cloud',
    'edge cloud', 'deployment', 'asynchronous inference', 'parallelism',
    'cross-session memory', 'agentcore', 'runtime', 'orchestration',
    'middle-layer', 'infrastructure for', 'edge robotics',
    'agentic framework', 'agent framework',
  ],
  open_source: [
    'open-source', 'open source', 'apache 2.0', 'open infrastructure',
    'open dataset', 'open foundation',
  ],
  voice_multimodal: [
    'voice', 'speech', 'audio', 'tts ', 'asr ', 'full-duplex',
    'omni-modal', 'omnimodal', 'omni modality', 'speech-to-speech',
  ],
  reasoning_planning: [
    'reasoning', 'chain of thought', 'chain-of-thought', 'task planning',
    'tree search', 'monte carlo tree', 'planning failures', 'subgoal',
    'plan rewind', 'long-horizon planning', 'plan-and-execute',
    'react agent', 'thinking traces', 'neuro-symbolic', 'see, plan',
    'anticipation', 'progress-aware',
  ],
  frontier_model: [
    'gpt-5', 'gpt-6', 'gpt 5', 'claude opus', 'claude sonnet',
    'gemini ', 'deepseek', 'llama ', 'mistral', 'qwen',
    'frontier model', 'foundation model', 'general-purpose model',
  ],
  vertical_agent: [
    'medical', 'clinical', 'legal agent', 'finance agent', 'biomedical',
    'healthcare', 'surgical', 'aerial manipulation', 'industrial robot',
  ],
  '3d_representation': [
    '3d gaussian', 'gaussian splatting', 'neural radiance', 'nerf',
    'point cloud', 'occupancy network', 'voxel', '3d scene',
    '3d perception', '3d representation', '3d-aware', '3d scene flow',
    'spatial understanding', 'spatially-aware', 'geometry grounding',
  ],

  // --- Extended VLA-paradigm families ---
  vla_core: [
    'vision-language-action', 'vision language action', 'vla model',
    'vla models', ' vla ', ' vla:', ' vla,', ' vlas', '-vla:', '-vla ',
    '-vlas', 'vla policy', 'vla-', 'vla:', 'vlas:',
    'visuomotor policy', 'visuomotor policies',
    'language-conditioned policy', 'instruction policy',
    'language gap', 'language grounding', 'linguistic grounding',
    'goal-conditioned', 'robot policy', 'robot policies', 'generative robot',
    'generalist robot', 'language model for robot', 'embodied agent',
    'embodied agents', 'embodied intelligence',
  ],
  manipulation: [
    'manipulation', 'manipulator', 'manipulate', 'grasping', 'grasp',
    'pick-and-place', 'pick and place', 'robot control', 'robotic control',
    'object manipulation', 'deformable object', 'contact-rich',
    'contact rich', 'bimanual', 'whole-body manipulation',
    'long-horizon manipulation', 'visuotactile', 'mobile manipulation',
    'assembly', 'robotic tasks', 'robot tasks',
  ],
  imitation_learning: [
    'imitation learning', 'behavior cloning', 'behavioral cloning',
    'demonstration', 'teleoperation', 'demo data', 'umi',
    'one-shot demonstration', 'imitation from', 'cross-embodiment',
    'cross embodiment', 'skill transfer',
  ],
  robot_rl: [
    'reinforcement learning', 'online rl', 'offline rl', 'online robot rl',
    'rl token', 'reward model', 'reward generation', 'on-robot rl',
    'q-functions', 'q-values', 'policy optimization', 'fine-tuning vla',
    'rlhf', 'distillation',
  ],
  dexterous_manipulation: [
    'dexterous', 'dexgrasp', 'fingertip', 'dexterous grasp',
    'dexterous manipulation', 'hand manipulation', 'humanoid',
    'multi-finger', 'in-hand',
  ],
  tactile_sensing: [
    'tactile', 'touch', 'haptic', 'visuo-tactile', 'visuotactile',
    'force feedback', 'contact sensing', 'tactile simulation',
    'tactile feedback', 'impedance',
  ],
  efficient_inference: [
    'efficient', 'efficiency', 'real-time', 'realtime', 'real time',
    'acceleration', 'fast-', 'fast ', 'low-latency', 'quantization',
    'pruning', 'speculative decoding', 'speedup', 'one-step', 'one step',
    'token pruning', 'sparse sampling', 'distillation',
  ],
  sim_to_real: [
    'sim-to-real', 'sim to real', 'sim2real', 'real-to-sim',
    'real to sim', 'simulation framework', 'simulator',
    'simulation distillation', 'real-world deployment', 'sim-real',
    'photorealistic simulator', 'simulation for',
  ],
  navigation: [
    'navigation', 'vision-language navigation', 'visual navigation',
    'traversability', 'embodied navigation', 'autonomous driving',
    'vln', 'mapping', 'wayfinding',
  ],
  data_generation: [
    'data generation', 'data engine', 'dataset', 'data collection',
    'demonstrations', 'data augmentation', 'pretraining',
    'large-scale dataset', 'scalable data', 'data downsampling',
    'data selection',
  ],
};

function familyDisplay(family: string): string {
  return METHOD_FAMILY_LABELS[family] ?? family
    .split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Catch-all families. These have wide vocabularies and exist mainly so the
// constellation has a bucket for researchers whose papers don't mention a
// specific technique. When ranking a single title, any specific family
// with ≥1 hit beats a catch-all family — even if the catch-all matched
// more keywords. This is what keeps "Diffusion Policy for Manipulation"
// in the Diffusion Policy bucket instead of getting absorbed by Manipulation.
const CATCH_ALL_FAMILIES = new Set([
  'vla_core',
  'manipulation',
  'data_generation',
  'efficient_inference',  // 'efficient' / 'real-time' qualify a lot of work
  'agent_infra',
]);

// Rank families by total keyword hits across a set of titles.
// Returns descending-sorted [family, hitCount] pairs; empty if no family
// matched any title. Unlike the prior token-AND tokenizer, this is an
// OR across an explicit per-family phrase list — much higher coverage
// while avoiding the "model" / "world" false positives that the old
// `family.split('_')` approach produced.
//
// Per-title rule: assign at most one family. Among matching families,
// specific (non-catch-all) families always win over catch-alls; within
// each tier, the family with the most keyword hits wins. Ties broken
// by the order families are declared in METHOD_FAMILY_KEYWORDS.
export function rankMethodFamilies(titles: string[]): Array<[string, number]> {
  const hits: Record<string, number> = {};
  for (const t of titles) {
    if (!t) continue;
    // Pad with spaces so word-boundary keywords like ' mcp ' or ' vla '
    // match at the start/end of the title without a custom regex.
    const title = ` ${t.toLowerCase()} `;

    let specificBest: { family: string; hits: number } | null = null;
    let catchAllBest: { family: string; hits: number } | null = null;
    for (const [family, kws] of Object.entries(METHOD_FAMILY_KEYWORDS)) {
      let n = 0;
      for (const kw of kws) if (title.includes(kw)) n++;
      if (n === 0) continue;
      if (CATCH_ALL_FAMILIES.has(family)) {
        if (!catchAllBest || n > catchAllBest.hits) catchAllBest = { family, hits: n };
      } else {
        if (!specificBest || n > specificBest.hits) specificBest = { family, hits: n };
      }
    }
    const picked = specificBest ?? catchAllBest;
    if (picked) hits[picked.family] = (hits[picked.family] ?? 0) + 1;
  }
  return Object.entries(hits).sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------------------
// loadSubdirections
// ---------------------------------------------------------------------------

export function loadSubdirections(opts: { domain?: 'vla' | 'ai' | 'all' } = {}): SubdirectionRecord[] {
  const { domain = 'all' } = opts;
  const results: SubdirectionRecord[] = [];

  const sources: Array<{ key: 'vla' | 'ai'; prefix: 'field-state-' | 'ai-field-state-' }> = [
    { key: 'vla', prefix: 'field-state-' },
    { key: 'ai',  prefix: 'ai-field-state-' },
  ];

  // 90-day paper pool for evidence sampling (per domain)
  const vlaPool = loadVLADailyPicks(90);
  const aiPool  = loadAIDailyPicks(90);
  // Hoist once; topLabsForMethod was re-reading 552KB JSON per trend.
  const { entities } = loadEntityIndex();

  for (const src of sources) {
    if (domain !== 'all' && domain !== src.key) continue;
    const fs = latestFieldState(src.prefix);
    const trends = fs?.method_trends ?? [];
    const pool = src.key === 'vla' ? vlaPool : aiPool;

    for (const t of trends) {
      // PR 3/4: family slug resolution chain.
      //   1. If Python pipeline emitted `family_v2` natively (PR 4 dual-write),
      //      use it directly — no aliasing needed.
      //   2. Else if `family` is a V1 slug, alias-resolve via ALIAS_V1_TO_V2.
      //      open_source aliases to null = retired; skip those trends.
      //   3. Else pass `family` through (already V2 or unknown).
      // The upstream Python pipeline migration is documented in
      // scripts/ONTOLOGY_V2_SERVER_PATCH.md.
      let v2Family: string | null = t.family;
      if (ONTOLOGY_V2_ACTIVE) {
        if (t.family_v2) {
          v2Family = t.family_v2;          // PR 4 native V2 emit — preferred
        } else if (t.family in ALIAS_V1_TO_V2) {
          v2Family = ALIAS_V1_TO_V2[t.family];
        }
        if (v2Family === null) continue;   // retired family
      }

      // Find sample papers for this family. In V1 mode, use the per-family
      // keyword vocabulary (matches any phrase) with a token-AND fallback.
      // In V2 mode, pull keywords from the V2 ontology node (if known) and
      // fall back to the legacy V1 keyword set keyed by the ORIGINAL V1
      // family — V1 keywords are more permissive and field-state aliases
      // are sometimes lossy (e.g. data_generation → synthetic_data_generation
      // would lose the broader 'dataset'/'pretraining' matches).
      let kws: string[] | undefined;
      if (ONTOLOGY_V2_ACTIVE && v2Family) {
        const node = getOntology().byKey.get(v2Family);
        kws = node?.keywords && node.keywords.length > 0
          ? node.keywords
          : METHOD_FAMILY_KEYWORDS[t.family];
      } else {
        kws = METHOD_FAMILY_KEYWORDS[t.family];
      }
      const tokens = t.family.split('_').filter(s => s.length >= 3);
      const titleMatches = (title: string): boolean => {
        if (kws && kws.length > 0) return kws.some(k => title.includes(k));
        return tokens.length > 0 && tokens.every(tok => title.includes(tok));
      };
      const evidence: Evidence[] = [];
      outer: for (const day of pool) {
        for (const item of day.items) {
          const title = ` ${(item.title || '').toLowerCase()} `;
          if (titleMatches(title)) {
            evidence.push({
              title:        item.title,
              url:          item.url,
              date:         day.date,
              rating:       item.rating,
              domain:       src.key,
              authorMention: extractFirstAuthor(item.summary),
            });
            if (evidence.length >= 3) break outer;
          }
        }
      }

      // topLabsForMethod still tokenizes by V1 slug (it scans entity-index
      // titles with a token-AND rule). Pass the V1 slug regardless of mode
      // so the lab attribution remains stable — switching this to V2 token
      // sets would change lab rankings; that's out of PR 3 scope.
      const topLabs = topLabsForMethod(t.family, entities);

      // Emitted family key: V2 leaf when active, V1 slug otherwise. The
      // displayName always reflects ONTOLOGY_V2_ACTIVE through displayLabel().
      const emittedFamily = ONTOLOGY_V2_ACTIVE ? (v2Family as string) : t.family;
      results.push({
        family:          emittedFamily,
        displayName:     displayLabel(emittedFamily),
        velocity7d:      t.count_7d ?? 0,
        velocityPrior7d: t.count_prior_7d ?? 0,
        acceleration:    t.acceleration ?? 0,
        status:          t.status ?? 'unknown',
        domain:          src.key,
        evidence,
        topLabs,
      });
    }
  }

  // Order: higher velocity first, then acceleration
  return results.sort((a, b) =>
    (b.velocity7d - a.velocity7d) || (b.acceleration - a.acceleration),
  );
}

function topLabsForMethod(family: string, entities: Record<string, Entity>): string[] {
  const methodTokens = family.split('_').filter(s => s.length >= 3);
  // For each lab, score by how many of its signals' titles match the method.
  const scored: Array<{ lab: string; score: number }> = [];
  for (const ent of Object.values(entities)) {
    if (ent.type !== 'lab') continue;
    let score = 0;
    for (const sig of ent.signals.slice(0, 50)) {
      const t = (sig.title || '').toLowerCase();
      if (methodTokens.every(tok => t.includes(tok))) score++;
    }
    if (score > 0) scored.push({ lab: ent.name, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.lab);
}

// ---------------------------------------------------------------------------
// loadLabs
// ---------------------------------------------------------------------------

export function loadLabs(opts: { minSignals?: number } = {}): LabRecord[] {
  const { minSignals = 1 } = opts;
  const { entities } = loadEntityIndex();
  const now = Date.now();

  const labs: LabRecord[] = [];
  for (const ent of Object.values(entities)) {
    if (ent.type !== 'lab') continue;
    if (ent.signals.length < minSignals) continue;
    // Drop entries that look like researcher surnames mis-labelled as labs
    if (!isPlausibleLab(ent.name, ent.signals.length)) continue;

    const ratedSignals = ent.signals.filter(s => s.rating === '⚡' || s.rating === '🔧' || s.rating === '📖');
    if (ratedSignals.length === 0) continue;

    // 14-day sparkline
    const bars = new Array(14).fill(0) as number[];
    let recent7 = 0;
    for (const sig of ent.signals) {
      const t = Date.parse(sig.date + 'T00:00:00Z');
      if (Number.isNaN(t)) continue;
      const ageDays = Math.floor((now - t) / 86_400_000);
      if (ageDays >= 0 && ageDays < 14) bars[13 - ageDays]++;
      if (ageDays >= 0 && ageDays < 7) recent7++;
    }

    // Top rating
    const ratingOrder = ['⚡', '🔧', '📖', '❌'];
    let topRating = '📖';
    for (const r of ratingOrder) {
      if (ent.signals.some(s => s.rating === r)) { topRating = r; break; }
    }

    // Method focus: scan signals' titles, rank by per-family keyword vocabulary.
    const focusTitles = ent.signals.slice(0, 30).map(s => s.title || '');
    const focusRanked = ONTOLOGY_V2_ACTIVE
      ? rankMethodFamiliesV2(focusTitles)
      : rankMethodFamilies(focusTitles);
    const methodFocus = focusRanked.slice(0, 3).map(([f]) => displayLabel(f));

    const evidence: Evidence[] = ent.signals
      .filter(s => s.rating === '⚡' || s.rating === '🔧')
      .slice(0, 3)
      .map(s => ({
        title:  s.title,
        url:    s.url,
        date:   s.date,
        rating: s.rating,
        domain: s.domain,
      }));

    const domains = Array.from(
      new Set(ent.signals.map(s => s.domain).filter(d => d === 'vla' || d === 'ai_app')),
    ) as Array<'vla' | 'ai_app'>;

    labs.push({
      name:            ent.name,
      signalCount90d:  ent.signals.length,
      recentSignalCount7d: recent7,
      velocityBars:    bars,
      methodFocus,
      topRating,
      lastSeen:        ent.signals[0]?.date ?? '',
      evidence,
      domains,
    });
  }

  return labs.sort((a, b) =>
    (b.signalCount90d - a.signalCount90d) || (b.recentSignalCount7d - a.recentSignalCount7d),
  );
}

// ---------------------------------------------------------------------------
// loadPeople
//
// Two pathways: existing researchers in entity-index (type=researcher) +
// first-author extraction from rated papers (authors field on VLA picks).
// ---------------------------------------------------------------------------

interface ResearcherAffiliation {
  all_institutions:        Record<string, string[]>;
  researcher_affiliation:  Record<string, string>;
}

let _registryCache: ResearcherAffiliation | null | undefined;
function loadResearcherRegistry(): ResearcherAffiliation {
  if (_registryCache === undefined) {
    _registryCache = readJsonLocal<ResearcherAffiliation>('institution-registry.json');
  }
  return _registryCache ?? { all_institutions: {}, researcher_affiliation: {} };
}

function lookupAffiliation(normalized: string): string | null {
  const reg = loadResearcherRegistry();
  if (reg.researcher_affiliation[normalized]) return reg.researcher_affiliation[normalized];
  // Try last-name match
  const parts = normalized.split(' ');
  const lastName = parts[parts.length - 1];
  for (const [name, aff] of Object.entries(reg.researcher_affiliation)) {
    const regParts = name.split(' ');
    if (regParts[regParts.length - 1] === lastName && parts[0]?.charAt(0) === regParts[0]?.charAt(0)) {
      return aff;
    }
  }
  return null;
}

function socialMentions(normalized: string, daysWindow: number = 90): boolean {
  const aiFiles  = loadSocialIntel('ai',  daysWindow);
  const vlaFiles = loadSocialIntel('vla', daysWindow);
  const all = [...aiFiles, ...vlaFiles];
  const tokens = normalized.split(' ');
  if (tokens.length < 2) return false;
  return all.some(f => {
    const c = (f.content || '').toLowerCase();
    return tokens.every(tok => c.includes(tok));
  });
}

export function loadPeople(opts: { minPaperCount90d?: number } = {}): PersonRecord[] {
  const { minPaperCount90d = 1 } = opts;

  // Step 1: enumerate first authors across the rated paper pool
  const vlaDays = loadVLADailyPicks(90);
  const peopleMap = new Map<string, {
    canonical: string;
    evidence: Evidence[];
    ratings: string[];
  }>();

  for (const day of vlaDays) {
    for (const item of day.items) {
      // First author is encoded as the leading byline "Name et al. · summary…"
      // (set by data.ts loadVLADailyPicks line 457). Recover it.
      const bylineMatch = (item.summary || '').match(/^([^·]+?)\s+(et al\.?\s+)?·/);
      const author = bylineMatch?.[1]?.trim() || '';
      if (!author) continue;
      // Reject paper-abstract fragments masquerading as bylines. About 30%
      // of byline regex matches are noise; this drops them before they
      // populate the people index.
      if (!isPlausibleName(author)) continue;
      const norm = normalizeName(author);
      if (!norm || norm.length < 3) continue;

      const entry = peopleMap.get(norm) ?? {
        canonical: displayName(norm),
        evidence: [] as Evidence[],
        ratings:  [] as string[],
      };
      entry.evidence.push({
        title:        item.title,
        url:          item.url,
        date:         day.date,
        rating:       item.rating,
        domain:       'vla',
        authorMention: author,
      });
      entry.ratings.push(item.rating);
      peopleMap.set(norm, entry);
    }
  }

  // Step 2: enrich with entity-index researchers (already curated)
  const { entities } = loadEntityIndex();
  for (const ent of Object.values(entities)) {
    if (ent.type !== 'researcher') continue;
    if (!isPlausibleName(ent.name)) continue;
    const norm = normalizeName(ent.name);
    if (!norm) continue;
    const entry = peopleMap.get(norm) ?? {
      canonical: ent.name,
      evidence: [] as Evidence[],
      ratings:  [] as string[],
    };
    for (const sig of ent.signals) {
      // Merge but dedup by URL
      if (!entry.evidence.some(e => e.url === sig.url)) {
        entry.evidence.push({
          title:  sig.title,
          url:    sig.url,
          date:   sig.date,
          rating: sig.rating,
          domain: sig.domain,
          authorMention: ent.name,
        });
        entry.ratings.push(sig.rating);
      }
    }
    peopleMap.set(norm, entry);
  }

  // Step 3: materialize records, look up affiliation + contact_status
  const records: PersonRecord[] = [];
  for (const [norm, entry] of peopleMap.entries()) {
    if (entry.evidence.length < minPaperCount90d) continue;

    const affiliation = lookupAffiliation(norm);
    // Order: linked_via_lab > social_mention > not_linked
    let contactStatus: ContactStatus = 'not_linked';
    if (affiliation) contactStatus = 'linked_via_lab';
    else if (socialMentions(norm, 90)) contactStatus = 'social_mention';

    const ratingOrder = ['⚡', '🔧', '📖', '❌'];
    let topRating = '📖';
    for (const r of ratingOrder) {
      if (entry.ratings.includes(r)) { topRating = r; break; }
    }

    // Sort evidence newest first, dedup by url. Keep the pre-slice
    // count so paperCount90d reflects the TRUE deduped paper count
    // rather than the display-only cap of 5.
    const seen = new Set<string>();
    const deduped = entry.evidence
      .filter(e => {
        if (seen.has(e.url)) return false;
        seen.add(e.url);
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    const ev = deduped.slice(0, 5);

    records.push({
      name:            entry.canonical,
      normalizedKey:   norm,
      // Placeholder; replaced below once we have the full set so we can
      // dedup slug collisions (e.g. "J. Smith" vs "J Smith" both → "j-smith").
      slug:            '',
      affiliation,
      paperCount90d:   deduped.length,
      topRating,
      contactStatus,
      evidence:        ev,
    });
  }

  // Slug dedup pass. slugifyName can collide for distinct normalized names
  // (`normalizeName` keeps initials when needed, but slugifyName strips
  // punctuation, so "J. Smith" / "J Smith" both → "j-smith"). Walk records
  // in a stable order (name asc) and append `-2`, `-3`, … to LATER
  // occurrences. Without this, anchor IDs collide and the find-similar
  // lookup on /talent/match/ resolves the wrong person.
  const stableForSlug = [...records].sort((a, b) => a.name.localeCompare(b.name));
  const slugSeen = new Map<string, number>();
  for (const rec of stableForSlug) {
    const base = slugifyName(rec.name) || 'person';
    const n = slugSeen.get(base) ?? 0;
    rec.slug = n === 0 ? base : `${base}-${n + 1}`;
    slugSeen.set(base, n + 1);
  }

  return records.sort((a, b) => {
    // Rank: rated⚡ first, then 🔧, then by paper count
    const rOrder = (r: string) => r === '⚡' ? 0 : r === '🔧' ? 1 : 2;
    const rd = rOrder(a.topRating) - rOrder(b.topRating);
    if (rd !== 0) return rd;
    return b.paperCount90d - a.paperCount90d;
  });
}

// HOT-tier gate criteria, exposed as a display constant so the HR queue page
// can render the rule values without re-deriving them. Match the predicate
// inside loadHRScout — if you change the gate there, change it here too.
export const HOT_GATE_DISPLAY = {
  ratingFloor:        '🔧' as const,
  minPaperCount90d:   2,
  requireAffiliation: true,
};

// ---------------------------------------------------------------------------
// Method-tag derivation
//
// Use the same family-token approach as loadSubdirections to assign each
// candidate the top method families their evidence papers fall into. Keeps
// HR informed about what to interview them on without inventing labels.
// ---------------------------------------------------------------------------

export function topMethodsForEvidence(ev: Evidence[], maxTags: number = 2): string[] {
  if (!ev || ev.length === 0) return [];
  const titles = ev.map(e => e.title ?? '');
  const ranked = ONTOLOGY_V2_ACTIVE
    ? rankMethodFamiliesV2(titles)
    : rankMethodFamilies(titles);
  return ranked.slice(0, maxTags).map(([f]) => displayLabel(f));
}

// ---------------------------------------------------------------------------
// HR Scout funnel
//
// Real scouting needs more than the 4 gate-passers. We surface a funnel:
//   HOT   — full gate passers (interview-ready)
//   WARM  — close-to-gate; missing exactly one criterion (rising star,
//           prolific-but-unaffiliated, etc.). Each carries `gateMissed`.
//   WATCH — ⚡-rated outliers without durable signal (curiosity tier)
// Each candidate is enriched with `topMethods` derived from their papers.
// ---------------------------------------------------------------------------

export interface ScoutEntry extends HRCandidate {
  topMethods: string[];
  gateMissed?: string;  // why this person isn't in HOT (warm/watch only)
}

export interface HRScout {
  hot:   ScoutEntry[];
  warm:  ScoutEntry[];
  watch: ScoutEntry[];
  totals: { hot: number; warm: number; watch: number; pool: number };
}

export function loadHRScout(): HRScout {
  const allPeople = loadPeople({ minPaperCount90d: 1 });

  const enrich = (p: PersonRecord, opts: { whyNow: string; gateHits: string[]; gateMissed?: string }): ScoutEntry => ({
    ...p,
    whyNow:     opts.whyNow,
    gateHits:   opts.gateHits,
    topMethods: topMethodsForEvidence(p.evidence, 2),
    gateMissed: opts.gateMissed,
  });

  const hot:   ScoutEntry[] = [];
  const warm:  ScoutEntry[] = [];
  const watch: ScoutEntry[] = [];

  for (const p of allPeople) {
    const isRated = p.topRating === '⚡' || p.topRating === '🔧';
    if (!isRated) continue;

    const hasAff   = !!p.affiliation;
    const hasMulti = p.paperCount90d >= 2;
    // `hasDurable` (contactStatus !== 'not_linked') is implied by `hasAff`
    // on the HOT branch: loadPeople sets contactStatus = 'linked_via_lab'
    // whenever an affiliation resolves, so the durable check is redundant
    // there. WARM/WATCH below still use it because they relax `hasAff`.
    const hasDurable = p.contactStatus !== 'not_linked';

    // HOT: full gate (≥🔧 + ≥2 papers + affiliation)
    if (isRated && hasMulti && hasAff) {
      hot.push(enrich(p, {
        whyNow: p.topRating === '⚡'
          ? `Author on ⚡-rated paper in last 90 days`
          : `Author on ${p.paperCount90d} 🔧+ papers in last 90 days`,
        gateHits: [
          `Top rating ${p.topRating}`,
          `${p.paperCount90d} papers · 90d`,
          `Affiliated: ${p.affiliation}`,
          `Contact: ${p.contactStatus}`,
        ],
      }));
      continue;
    }

    // WARM-A: rising star — ⚡ × 1 paper + affiliation (missing volume)
    if (p.topRating === '⚡' && p.paperCount90d === 1 && hasAff) {
      warm.push(enrich(p, {
        whyNow:     `⚡ debut at ${p.affiliation} — single paper, watch for follow-ups`,
        gateHits:   [`⚡ rating`, `1 paper`, `Affiliated: ${p.affiliation}`],
        gateMissed: 'paper count < 2',
      }));
      continue;
    }

    // WARM-B: prolific without verified org (≥🔧 × ≥2 papers, no affiliation)
    if (isRated && hasMulti && !hasAff) {
      warm.push(enrich(p, {
        whyNow:     `${p.paperCount90d} ${p.topRating}+ papers in 90d — affiliation unresolved`,
        gateHits:   [`Top rating ${p.topRating}`, `${p.paperCount90d} papers · 90d`],
        gateMissed: hasDurable ? 'affiliation unknown' : 'affiliation + durable signal unknown',
      }));
      continue;
    }

    // WATCH: ⚡ outlier with no other gate signal
    if (p.topRating === '⚡' && (!hasAff || !hasDurable)) {
      watch.push(enrich(p, {
        whyNow:     `⚡-rated, ${p.paperCount90d} paper${p.paperCount90d > 1 ? 's' : ''}, no verified org`,
        gateHits:   [`⚡ rating`, `${p.paperCount90d} paper(s)`],
        gateMissed: 'no affiliation or durable contact',
      }));
      continue;
    }
  }

  // Ranking inside each tier: rating, then paper count, then name
  const rOrder = (r: string) => r === '⚡' ? 0 : r === '🔧' ? 1 : 2;
  const cmp = (a: ScoutEntry, b: ScoutEntry) =>
    rOrder(a.topRating) - rOrder(b.topRating) ||
    b.paperCount90d - a.paperCount90d ||
    a.name.localeCompare(b.name);
  hot.sort(cmp);
  warm.sort(cmp);
  watch.sort(cmp);

  return {
    hot, warm, watch,
    totals: { hot: hot.length, warm: warm.length, watch: watch.length, pool: hot.length + warm.length + watch.length },
  };
}

// ---------------------------------------------------------------------------
// Researcher Constellation
//
// A bipartite layout: rated researchers (⚡/🔧) anchored around the method
// families they publish in. Reveals three things a flat list can't:
//   1. method concentration — which families have crowded talent pools
//   2. bridge researchers   — people working across two methods (placed inward)
//   3. starved methods       — families with few/no rated authors
//
// arXiv truncates author lists to "First et al." so we never see co-authors;
// a real person↔person network is impossible from this corpus. The
// person↔method bipartite is the strongest relational view we can offer.
// ---------------------------------------------------------------------------

export interface ConstellationMethod {
  family:      string;
  displayName: string;
  domain:      'vla' | 'ai';
  angle:       number;   // radians
  count:       number;
  cx:          number;
  cy:          number;
  // label position pushed slightly outward from the anchor
  labelX:      number;
  labelY:      number;
}

export interface ConstellationPerson {
  name:           string;
  slug:           string;
  affiliation:    string | null;
  topRating:      string;
  contactStatus:  ContactStatus;
  paperCount90d:  number;
  primaryFamily:  string;
  secondaryFamily: string | null;
  x:              number;
  y:              number;
}

export interface ResearcherConstellation {
  width:   number;
  height:  number;
  centerX: number;
  centerY: number;
  methodRadius: number;
  methods: ConstellationMethod[];
  people:  ConstellationPerson[];
  totals:  { researchers: number; familiesShown: number; bridges: number; unmatched: number };
}

export function loadResearcherConstellation(): ResearcherConstellation {
  const W = 900, H = 580;
  const cx = W / 2;
  const cy = H / 2 + 4;
  const methodR = 188;
  const personRBase = 240;

  // Rated researchers (we want signal, not noise)
  const rated = loadPeople({ minPaperCount90d: 1 })
    .filter(p => p.topRating === '⚡' || p.topRating === '🔧');

  // For each rated researcher, derive method-family hits from evidence titles.
  // Use the same token-match rule as topMethodsForEvidence so the constellation
  // is consistent with the method tags shown on cards.
  type Ranked = Array<[string, number]>;
  const matched: Array<{ p: PersonRecord; ranked: Ranked; majorityDomain: 'vla' | 'ai' }> = [];
  const familyHits = new Map<string, { count: number; vla: number; ai: number }>();
  let unmatched = 0;

  for (const p of rated) {
    let vla = 0, ai = 0;
    for (const e of p.evidence) {
      if (e.domain === 'vla') vla++;
      else if (e.domain === 'ai') ai++;
    }
    // Per-family keyword match across this person's paper titles.
    const titles = p.evidence.map(e => e.title ?? '');
    const ranked: Ranked = ONTOLOGY_V2_ACTIVE
      ? rankMethodFamiliesV2(titles)
      : rankMethodFamilies(titles);
    if (ranked.length === 0) { unmatched++; continue; }
    const majorityDomain: 'vla' | 'ai' = vla >= ai ? 'vla' : 'ai';
    matched.push({ p, ranked, majorityDomain });
    for (const [f] of ranked) {
      if (!familyHits.has(f)) familyHits.set(f, { count: 0, vla: 0, ai: 0 });
      const fh = familyHits.get(f)!;
      fh.count++;
      if (majorityDomain === 'vla') fh.vla++; else fh.ai++;
    }
  }

  // Keep families with ≥ 2 researchers; cap at 10 to fit comfortably on
  // the rim. The remainder of matched researchers (mapped only to dropped
  // families) get accounted as "unmatched" so callers can report coverage.
  const topFamilyKeys = [...familyHits.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([f]) => f);

  // Even angular distribution; start at -π/2 (12 o'clock) and walk clockwise.
  const familyAngle: Record<string, number> = {};
  const N = topFamilyKeys.length || 1;
  topFamilyKeys.forEach((f, i) => {
    familyAngle[f] = -Math.PI / 2 + (i / N) * Math.PI * 2;
  });

  const methods: ConstellationMethod[] = topFamilyKeys.map(f => {
    const a = familyAngle[f];
    const v = familyHits.get(f)!;
    return {
      family:      f,
      displayName: displayLabel(f),
      domain:      v.vla >= v.ai ? 'vla' : 'ai',
      angle:       a,
      count:       v.count,
      cx:          cx + Math.cos(a) * methodR,
      cy:          cy + Math.sin(a) * methodR,
      labelX:      cx + Math.cos(a) * (methodR + 42),
      labelY:      cy + Math.sin(a) * (methodR + 42),
    };
  });

  // Bucket matched researchers by their primary KEPT family.
  // A researcher whose top family was dropped gets demoted to their secondary
  // (if it's kept); otherwise they fall out of the constellation.
  type Bucket = { p: PersonRecord; secondary: string | null };
  const peoplePerFamily = new Map<string, Bucket[]>();
  for (const { p, ranked } of matched) {
    const kept = ranked.filter(([f]) => familyAngle[f] !== undefined);
    if (kept.length === 0) { unmatched++; continue; }
    const primary   = kept[0][0];
    const rawSecondary = kept[1]?.[0] ?? null;
    // PR 3: bridges are CROSS-PARENT families only. Two leaves under the same
    // V2 parent (e.g. vla.action.diffusion_policy + vla.action.flow_matching)
    // are siblings, not a bridge — they belong to one cluster. V1 mode keeps
    // the old "any secondary counts" rule for byte-for-byte fallback parity.
    const secondary = rawSecondary
      ? (ONTOLOGY_V2_ACTIVE
          ? (isCrossParent(primary, rawSecondary) ? rawSecondary : null)
          : rawSecondary)
      : null;
    if (!peoplePerFamily.has(primary)) peoplePerFamily.set(primary, []);
    peoplePerFamily.get(primary)!.push({ p, secondary });
  }

  // Layout: per family, sort by rating (⚡ first), then by paperCount desc.
  // Non-bridges fan out evenly within a ±halfSpread arc centered on the
  // family anchor. Bridges (have valid secondary) get pulled inward and
  // angled 35% of the way toward their secondary — they sit visually between
  // two anchors so the eye reads them as polymaths.
  const halfSpread = Math.min(0.38, (Math.PI / Math.max(N, 2)) * 0.78);
  const peopleArr: ConstellationPerson[] = [];
  let bridges = 0;

  const rOrder = (r: string) => (r === '⚡' ? 0 : r === '🔧' ? 1 : 2);

  for (const family of topFamilyKeys) {
    const group = peoplePerFamily.get(family) ?? [];
    group.sort((a, b) =>
      rOrder(a.p.topRating) - rOrder(b.p.topRating) ||
      b.p.paperCount90d - a.p.paperCount90d ||
      a.p.name.localeCompare(b.p.name));

    const nonBridges = group.filter(g => !g.secondary);
    const bridgeSet  = group.filter(g => g.secondary);
    const familyAng  = familyAngle[family];

    // Place non-bridges along the outer arc
    const n = nonBridges.length;
    nonBridges.forEach((entry, i) => {
      // Map index 0..n-1 to t in [-1, +1] (symmetric fan)
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
      const a = familyAng + t * halfSpread;
      // Stagger radius slightly so dots in adjacent slots don't collide
      const r = personRBase + (i % 3) * 14;
      peopleArr.push({
        name:           entry.p.name,
        slug:           entry.p.slug,
        affiliation:    entry.p.affiliation,
        topRating:      entry.p.topRating,
        contactStatus:  entry.p.contactStatus,
        paperCount90d:  entry.p.paperCount90d,
        primaryFamily:  family,
        secondaryFamily: null,
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
      });
    });

    // Place bridges inward, between primary and secondary anchor angles
    bridgeSet.forEach(entry => {
      const sa = familyAngle[entry.secondary!];
      let delta = sa - familyAng;
      if (delta > Math.PI)  delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      const a = familyAng + delta * 0.35;
      const r = personRBase - 70; // inward — visually distinct from rim
      bridges++;
      peopleArr.push({
        name:           entry.p.name,
        slug:           entry.p.slug,
        affiliation:    entry.p.affiliation,
        topRating:      entry.p.topRating,
        contactStatus:  entry.p.contactStatus,
        paperCount90d:  entry.p.paperCount90d,
        primaryFamily:  family,
        secondaryFamily: entry.secondary,
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
      });
    });
  }

  return {
    width:        W,
    height:       H,
    centerX:      cx,
    centerY:      cy,
    methodRadius: methodR,
    methods,
    people:       peopleArr,
    totals: {
      researchers:   peopleArr.length,
      familiesShown: methods.length,
      bridges,
      unmatched,
    },
  };
}

// ---------------------------------------------------------------------------
// Lab Network — concrete relational view at the LAB level.
//
// Each top-N lab is a labelled bubble. Edges run between labs that share any
// method-family focus. Edge weight = number of shared methods. The chart
// answers questions a flat list can't:
//   - Which labs compete for the same talent? (edges)
//   - Which methods connect the most labs? ('hub' method — biggest cluster)
//   - Which labs are isolated? (no edges — protected, distinctive talent)
//
// We deliberately do NOT try to embed researcher dots inside the lab bubbles:
// of the 261 rated researchers in the pipeline, only ~10 carry an affiliation
// that joins to a lab record. Showing 0–2 dots per lab would be misleading.
// Researchers live in the grid below; this chart is about labs.
// ---------------------------------------------------------------------------

export interface LabNetworkNode {
  name:              string;
  slug:              string;
  domain:            'vla' | 'ai' | 'mixed';
  signalCount90d:    number;
  recentSignal7d:    number;
  methodFocus:       string[];   // display names; up to 3
  topMethodDisplay:  string;
  cx:                number;
  cy:                number;
  radius:            number;
  labelX:            number;     // pushed outside bubble for legibility
  labelY:            number;
  labelAnchor:       'start' | 'middle' | 'end';
}

export interface LabNetworkEdge {
  fromIdx:        number;
  toIdx:          number;
  sharedMethods:  string[];      // display names
  weight:         number;        // count
  // pre-computed bezier control point for curve rendering
  ctrlX:          number;
  ctrlY:          number;
}

export interface LabNetwork {
  width:    number;
  height:   number;
  centerX:  number;
  centerY:  number;
  ringRadius: number;
  nodes:    LabNetworkNode[];
  edges:    LabNetworkEdge[];
  // method → number of edges spanned (which method connects the most labs)
  methodHubs: Array<{ method: string; spans: number; labCount: number }>;
  totals: {
    labs:          number;
    edges:         number;
    connectedLabs: number;   // labs with ≥1 edge
    isolatedLabs:  number;   // labs with 0 edges
  };
}

export function loadLabNetwork(opts: { maxLabs?: number } = {}): LabNetwork {
  const W = 980;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const maxLabs = opts.maxLabs ?? 14;
  const ringR = 232;

  const labs = loadLabs({ minSignals: 2 }).slice(0, maxLabs);

  // Domain assignment from LabRecord.domains
  const labWithMeta = labs.map(l => {
    const hasVLA = (l.domains ?? []).includes('vla');
    const hasAI  = (l.domains ?? []).includes('ai_app');
    const domain: 'vla' | 'ai' | 'mixed' =
      hasVLA && hasAI ? 'mixed' :
      hasAI           ? 'ai'    :
                        'vla';
    return { lab: l, domain };
  });

  // Cluster labs angularly: same dominant method → adjacent angles.
  // Labs without methodFocus go to the end (their angular cluster doesn't matter).
  const dominantOf = (l: LabRecord) => l.methodFocus[0] ?? '~unknown~';
  const methodOrder: string[] = [];
  for (const { lab } of labWithMeta) {
    const m = dominantOf(lab);
    if (!methodOrder.includes(m)) methodOrder.push(m);
  }
  labWithMeta.sort((a, b) => {
    const ai = methodOrder.indexOf(dominantOf(a.lab));
    const bi = methodOrder.indexOf(dominantOf(b.lab));
    return ai - bi || b.lab.signalCount90d - a.lab.signalCount90d;
  });

  const N = labWithMeta.length;
  const nodes: LabNetworkNode[] = labWithMeta.map((x, i) => {
    // Start at -π/2 (top), walk clockwise
    const angle = -Math.PI / 2 + (i / N) * Math.PI * 2;
    // Bubble radius from signal count (sqrt to dampen the spread)
    const r = 24 + Math.sqrt(x.lab.signalCount90d) * 5;
    const bx = cx + Math.cos(angle) * ringR;
    const by = cy + Math.sin(angle) * ringR;
    // Label position pushed further out from the bubble center.
    // Use angular position to decide text-anchor so labels don't overlap bubbles.
    const labelDist = r + 22;
    const lx = cx + Math.cos(angle) * (ringR + labelDist - r);
    const ly = cy + Math.sin(angle) * (ringR + labelDist - r) + 4;
    const cosA = Math.cos(angle);
    const anchor: 'start' | 'middle' | 'end' =
      cosA > 0.35 ? 'start' :
      cosA < -0.35 ? 'end' :
      'middle';
    return {
      name:             x.lab.name,
      slug:             slugifyName(x.lab.name),
      domain:           x.domain,
      signalCount90d:   x.lab.signalCount90d,
      recentSignal7d:   x.lab.recentSignalCount7d,
      methodFocus:      x.lab.methodFocus,
      topMethodDisplay: x.lab.methodFocus[0] ?? '—',
      cx:               bx,
      cy:               by,
      radius:           r,
      labelX:           lx,
      labelY:           ly,
      labelAnchor:      anchor,
    };
  });

  // Edges: every pair of labs sharing ≥1 method (display-name match)
  const edges: LabNetworkEdge[] = [];
  const methodSpans = new Map<string, Set<number>>();   // method → labs it touches in edges
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i].methodFocus;
      const b = nodes[j].methodFocus;
      const shared = a.filter(m => b.includes(m));
      if (shared.length === 0) continue;
      // Bezier control point pulled toward center, biased by edge midpoint
      const mx = (nodes[i].cx + nodes[j].cx) / 2;
      const my = (nodes[i].cy + nodes[j].cy) / 2;
      const ctrlX = mx + (cx - mx) * 0.55;
      const ctrlY = my + (cy - my) * 0.55;
      edges.push({
        fromIdx: i,
        toIdx:   j,
        sharedMethods: shared,
        weight:        shared.length,
        ctrlX,
        ctrlY,
      });
      for (const m of shared) {
        if (!methodSpans.has(m)) methodSpans.set(m, new Set());
        methodSpans.get(m)!.add(i);
        methodSpans.get(m)!.add(j);
      }
    }
  }

  const connected = new Set<number>();
  for (const e of edges) {
    connected.add(e.fromIdx);
    connected.add(e.toIdx);
  }

  const methodHubs = [...methodSpans.entries()]
    .map(([method, labSet]) => {
      const spans = edges.filter(e => e.sharedMethods.includes(method)).length;
      return { method, spans, labCount: labSet.size };
    })
    .sort((a, b) => b.spans - a.spans || b.labCount - a.labCount);

  return {
    width: W,
    height: H,
    centerX: cx,
    centerY: cy,
    ringRadius: ringR,
    nodes,
    edges,
    methodHubs,
    totals: {
      labs:          nodes.length,
      edges:         edges.length,
      connectedLabs: connected.size,
      isolatedLabs:  nodes.length - connected.size,
    },
  };
}

// ---------------------------------------------------------------------------
// Watchlist — full rated population for Section 04 grid.
// Returns ALL rated researchers (⚡ or 🔧 + ≥1 paper) sorted by rating then
// recency. This is the dense list that lives below the constellation; we no
// longer cap at 6 — readers should see the whole talent pool.
// ---------------------------------------------------------------------------

export function loadWatchlist(): PersonRecord[] {
  const ppl = loadPeople({ minPaperCount90d: 1 })
    .filter(p => p.topRating === '⚡' || p.topRating === '🔧');
  const rOrder = (r: string) => (r === '⚡' ? 0 : r === '🔧' ? 1 : 2);
  return ppl.sort((a, b) =>
    rOrder(a.topRating) - rOrder(b.topRating) ||
    b.paperCount90d - a.paperCount90d ||
    a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Pool Viz — makes the rating distribution legible.
//
// Two charts share one upstream pass over the watchlist:
//   * scatter — every rated person as a dot in (paperCount × rating) space,
//     coloured by their primary method family. Reveals the "high-volume but
//     📖" cluster vs the "single-⚡-spike" cluster vs the polish-grinders.
//   * heatmap — method-family × rating tier matrix. Cells show count plus
//     top 2 names. Reveals where the talent is dense and where it's thin.
//
// Both surfaces share the same family-ranking pass so a researcher's primary
// family is consistent with their constellation position.
// ---------------------------------------------------------------------------

export interface ScatterDot {
  name:                 string;
  slug:                 string;
  paperCount90d:        number;
  rating:               string;           // ⚡ | 🔧 | 📖
  primaryFamily:        string;
  primaryFamilyDisplay: string;
  domain:               'vla' | 'ai';
  affiliation:          string | null;
}

export interface HeatmapCell {
  family:       string;
  familyDisplay: string;
  domain:       'vla' | 'ai';
  rating:       '⚡' | '🔧' | '📖';
  count:        number;
  topNames:     string[];        // up to 2
  topSlugs:     string[];
}

export interface PoolViz {
  // scatter dataset — pre-rated 📖 + 🔧 + ⚡, every rated person we tracked
  scatter:     ScatterDot[];
  scatterMaxPapers: number;      // x-axis max for SVG scaling
  // heatmap rows ordered by family popularity descending
  heatmapFamilies: Array<{ family: string; familyDisplay: string; domain: 'vla' | 'ai' }>;
  heatmapCells:    HeatmapCell[];
  ratingTiers:     Array<'⚡' | '🔧' | '📖'>;
  totals: {
    rated:    number;             // ⚡ + 🔧
    read:     number;             // 📖
    flashes:  number;
    polish:   number;
    families: number;
  };
}

// ---------------------------------------------------------------------------
// Embedding-backed match data — produced by scripts/build-talent-embeddings.ts.
// The file is committed to src/data/talent-embeddings.json. If absent, the
// /talent/match/ page degrades gracefully to facet-only mode.
// ---------------------------------------------------------------------------

export interface MatchPerson {
  idx:                  number;
  slug:                 string;
  name:                 string;
  affiliation:          string | null;
  topRating:            string;
  paperCount90d:        number;
  contactStatus:        ContactStatus;
  primaryFamily:        string | null;
  primaryFamilyDisplay: string | null;
  region:               'cn' | 'us' | 'eu' | 'other';
  topMethods:           string[];
  neighbors:            Array<{ pi: number; score: number }>;
}

export interface MatchQuery {
  id:      string;
  label:   string;
  labelSC: string;
  text:    string;
  results: Array<{ pi: number; score: number }>;
}

export interface MatchData {
  version:      number;
  generated_at: string;
  model:        string;
  dim:          number;
  people:       MatchPerson[];
  queries:      MatchQuery[];
  families:     Array<{ family: string; familyDisplay: string; domain: 'vla' | 'ai' }>;
}

export function loadMatchData(): MatchData | null {
  return readJsonLocal<MatchData>('talent-embeddings.json');
}

// ---------------------------------------------------------------------------
// Structural chips — what embedding can't do, simple rules CAN.
//
// Three "concept" chips were originally embedding-based and they all failed
// the four-agent UX audit (polymath returned 0/30 multi-method people;
// production-ready returned RL students; safety-eval returned random
// students). Root cause: 96% of our pool has only 1 paper, so profiles are
// uniformly thin and the embedding ends up clustering by surname phonetics
// + keyword.
//
// These three chips are reimplemented as structural rules over the same
// PersonRecord pool. No DashScope call, no cosine, no false promises.
// Each chip returns up to 30 candidates with a `score` reflecting evidence
// strength (normalised 0-1). When the rule's gate fails for everyone the
// chip emits an empty list — better than embedding noise.
// ---------------------------------------------------------------------------

export interface StructuralChip {
  id:      string;
  label:   string;
  labelSC: string;
  text:    string;
  results: Array<{ pi: number; score: number }>;
}

const PRODUCTION_KEYWORDS = [
  'efficient', 'real-time', 'realtime', 'real time',
  'deploy', 'deployment', 'production',
  'latency', 'inference', 'optimize', 'optimization',
  'edge', 'on-device', 'mobile', 'compress', 'distill',
  'quantiz', 'pruning', 'speedup', 'throughput',
];
const SAFETY_KEYWORDS = [
  'safety', 'safe ', 'safe-',
  'eval', 'evaluation', 'evaluate',
  'benchmark', 'harness',
  'align', 'alignment',
  'robust', 'reliability',
  'verif', 'validation',
  'failure', 'risk',
];

function titleKeywordHits(p: PersonRecord, keywords: string[]): number {
  let hits = 0;
  for (const ev of p.evidence) {
    const t = (ev.title ?? '').toLowerCase();
    for (const kw of keywords) {
      if (t.includes(kw)) hits++;
    }
  }
  return hits;
}

/**
 * Compute the three structural chips against a pre-ordered person pool.
 *
 * Caller passes the SAME ordered list that will be inlined as `peopleClient`
 * on the match page; `pi` indices reference this caller-supplied ordering so
 * client lookups stay consistent.
 */
export function loadStructuralChips(orderedPool: PersonRecord[]): StructuralChip[] {
  // ── polymath: distinct method-family count (≥ 2 to qualify) ─────────
  const polymath: Array<{ pi: number; families: number; papers: number }> = [];
  orderedPool.forEach((p, pi) => {
    const titles = p.evidence.map(e => e.title ?? '');
    const ranked = ONTOLOGY_V2_ACTIVE
      ? rankMethodFamiliesV2(titles)
      : rankMethodFamilies(titles);
    if (ranked.length >= 2) polymath.push({ pi, families: ranked.length, papers: p.paperCount90d });
  });
  polymath.sort((a, b) => b.families - a.families || b.papers - a.papers);
  const polyMax = Math.max(1, ...polymath.map(x => x.families));
  const polymathResults = polymath.slice(0, 30).map(x => ({
    pi:    x.pi,
    score: +(x.families / polyMax).toFixed(3),
  }));

  // ── production: keyword hits in paper titles ────────────────────────
  const production: Array<{ pi: number; hits: number; papers: number }> = [];
  orderedPool.forEach((p, pi) => {
    const hits = titleKeywordHits(p, PRODUCTION_KEYWORDS);
    if (hits > 0) production.push({ pi, hits, papers: p.paperCount90d });
  });
  production.sort((a, b) => b.hits - a.hits || b.papers - a.papers);
  const prodMax = Math.max(1, ...production.map(x => x.hits));
  const productionResults = production.slice(0, 30).map(x => ({
    pi:    x.pi,
    score: +(x.hits / prodMax).toFixed(3),
  }));

  // ── safety / eval: keyword hits ─────────────────────────────────────
  const safety: Array<{ pi: number; hits: number; papers: number }> = [];
  orderedPool.forEach((p, pi) => {
    const hits = titleKeywordHits(p, SAFETY_KEYWORDS);
    if (hits > 0) safety.push({ pi, hits, papers: p.paperCount90d });
  });
  safety.sort((a, b) => b.hits - a.hits || b.papers - a.papers);
  const safetyMax = Math.max(1, ...safety.map(x => x.hits));
  const safetyResults = safety.slice(0, 30).map(x => ({
    pi:    x.pi,
    score: +(x.hits / safetyMax).toFixed(3),
  }));

  return [
    {
      id:      'structural:polymath',
      label:   'Polymath (≥2 methods)',
      labelSC: '橋樑型（≥2 方法族）',
      text:    'Researchers whose 90d papers span at least 2 distinct method families.',
      results: polymathResults,
    },
    {
      id:      'structural:production',
      label:   'Production-deployable',
      labelSC: '可落地工程',
      text:    'Papers mention efficiency / deployment / real-time / inference / edge keywords.',
      results: productionResults,
    },
    {
      id:      'structural:safety',
      label:   'Safety / Eval',
      labelSC: '安全 / 評測',
      text:    'Papers mention safety / evaluation / benchmark / alignment keywords.',
      results: safetyResults,
    },
  ];
}

// ---------------------------------------------------------------------------
// Pool sanity stats — surfaced BEFORE the HR clicks anything.
//
// The four-agent audit hit the same wall: 2.7% affiliation coverage,
// max papers/90d = 4. The chip semantics over-promise relative to data
// reality. Show the ceiling so HR doesn't fiddle for 10 min before
// realising the pool can't fill their role.
// ---------------------------------------------------------------------------

export interface PoolSanity {
  total:              number;
  withAffiliation:    number;
  withAffiliationPct: number;
  maxPapers90d:       number;
  countWith3Plus:     number;
  countFlash:         number;
  countPolish:        number;
  countRead:          number;
}

export function loadPoolSanity(pool: PersonRecord[]): PoolSanity {
  const total           = pool.length;
  const withAffiliation = pool.filter(p => p.affiliation).length;
  const maxPapers       = Math.max(0, ...pool.map(p => p.paperCount90d));
  return {
    total,
    withAffiliation,
    withAffiliationPct: total > 0 ? Math.round((withAffiliation / total) * 100) : 0,
    maxPapers90d:       maxPapers,
    countWith3Plus:     pool.filter(p => p.paperCount90d >= 3).length,
    countFlash:         pool.filter(p => p.topRating === '⚡').length,
    countPolish:        pool.filter(p => p.topRating === '🔧').length,
    countRead:          pool.filter(p => p.topRating === '📖').length,
  };
}

export function loadPoolViz(): PoolViz {
  // We include 📖 here, not just ⚡/🔧. The whole point of the chart is to
  // show "here's why ⚡ is rare and where the read-only volume lives".
  // 📖 with paperCount=1 is the bulk of the right side — that's the story.
  const pool = loadPeople({ minPaperCount90d: 1 })
    .filter(p => p.topRating === '⚡' || p.topRating === '🔧' || p.topRating === '📖');

  // Assign primary family by ranking each person's evidence titles. Match the
  // constellation logic so colours line up across charts.
  type Hit = { p: PersonRecord; family: string; domain: 'vla' | 'ai' };
  const hits: Hit[] = [];
  const familyTotals = new Map<string, { count: number; vla: number; ai: number }>();

  for (const p of pool) {
    const titles = p.evidence.map(e => e.title ?? '');
    const ranked = ONTOLOGY_V2_ACTIVE
      ? rankMethodFamiliesV2(titles)
      : rankMethodFamilies(titles);
    if (ranked.length === 0) continue;
    const family = ranked[0][0];
    let vla = 0, ai = 0;
    for (const e of p.evidence) {
      if (e.domain === 'vla') vla++;
      else if (e.domain === 'ai') ai++;
    }
    const domain: 'vla' | 'ai' = vla >= ai ? 'vla' : 'ai';
    hits.push({ p, family, domain });
    if (!familyTotals.has(family)) familyTotals.set(family, { count: 0, vla: 0, ai: 0 });
    const ft = familyTotals.get(family)!;
    ft.count++;
    if (domain === 'vla') ft.vla++; else ft.ai++;
  }

  // Heatmap: keep the families with ≥3 researchers; everything else collapses
  // into the "long tail" handled by the scatter colour-coding only.
  const heatmapFamilies = [...familyTotals.entries()]
    .filter(([, v]) => v.count >= 3)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 12)
    .map(([f, v]) => ({
      family:        f,
      familyDisplay: displayLabel(f),
      domain:        (v.vla >= v.ai ? 'vla' : 'ai') as 'vla' | 'ai',
    }));
  const keptFamilies = new Set(heatmapFamilies.map(f => f.family));

  // Cell builder: per (family, rating), pull names sorted by paperCount desc.
  const ratingTiers: Array<'⚡' | '🔧' | '📖'> = ['⚡', '🔧', '📖'];
  const cellMap = new Map<string, HeatmapCell>();
  for (const hf of heatmapFamilies) {
    for (const r of ratingTiers) {
      cellMap.set(`${hf.family}|${r}`, {
        family:       hf.family,
        familyDisplay: hf.familyDisplay,
        domain:       hf.domain,
        rating:       r,
        count:        0,
        topNames:     [],
        topSlugs:     [],
      });
    }
  }
  // We need names per cell sorted by paperCount; collect first, then trim.
  const cellPicks = new Map<string, PersonRecord[]>();
  for (const h of hits) {
    if (!keptFamilies.has(h.family)) continue;
    const k = `${h.family}|${h.p.topRating}`;
    const cell = cellMap.get(k);
    if (!cell) continue;
    cell.count++;
    if (!cellPicks.has(k)) cellPicks.set(k, []);
    cellPicks.get(k)!.push(h.p);
  }
  for (const [k, ppl] of cellPicks.entries()) {
    const cell = cellMap.get(k)!;
    ppl.sort((a, b) => b.paperCount90d - a.paperCount90d || a.name.localeCompare(b.name));
    cell.topNames = ppl.slice(0, 2).map(p => p.name);
    cell.topSlugs = ppl.slice(0, 2).map(p => p.slug);
  }

  // Scatter dataset — emit one dot per matched person (even outside heatmap families).
  const scatter: ScatterDot[] = hits.map(h => ({
    name:                 h.p.name,
    slug:                 h.p.slug,
    paperCount90d:        h.p.paperCount90d,
    rating:               h.p.topRating,
    primaryFamily:        h.family,
    primaryFamilyDisplay: displayLabel(h.family),
    domain:               h.domain,
    affiliation:          h.p.affiliation,
  }));
  const scatterMaxPapers = Math.max(1, ...scatter.map(s => s.paperCount90d));

  const flashes = pool.filter(p => p.topRating === '⚡').length;
  const polish  = pool.filter(p => p.topRating === '🔧').length;
  const read    = pool.filter(p => p.topRating === '📖').length;

  return {
    scatter,
    scatterMaxPapers,
    heatmapFamilies,
    heatmapCells: [...cellMap.values()],
    ratingTiers,
    totals: {
      rated:    flashes + polish,
      read,
      flashes,
      polish,
      families: heatmapFamilies.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Talent stats — small overview for /talent hub
// ---------------------------------------------------------------------------

export interface TalentStats {
  subdirectionCount: number;
  acceleratingCount: number;
  labCount:          number;
  activeLabCount7d:  number;
  peopleCount:       number;
  // Size of the 3-tier HR scout pool (HOT + WARM + WATCH).
  // Replaces the older single-gate hrQueueCount which under-reported by
  // counting only HOT candidates and disagreed visibly with Section 01.
  hrPoolCount:       number;
  dataAsOf:          string;   // YYYY-MM-DD of latest field-state file
}

export function loadTalentStats(): TalentStats {
  const subs   = loadSubdirections({ domain: 'all' });
  const labs   = loadLabs();
  const people = loadPeople();
  const scout  = loadHRScout();
  // Latest VLA field-state filename — proxy for pipeline freshness.
  // Format: field-state-YYYY-MM-DD.json → slice the date portion.
  const latestFs = listLocal('field-state-')[0] ?? '';
  const m = latestFs.match(/(\d{4}-\d{2}-\d{2})/);
  return {
    subdirectionCount: subs.length,
    acceleratingCount: subs.filter(s => s.acceleration > 0.15).length,
    labCount:          labs.length,
    activeLabCount7d:  labs.filter(l => l.recentSignalCount7d > 0).length,
    peopleCount:       people.length,
    hrPoolCount:       scout.totals.pool,
    dataAsOf:          m?.[1] ?? '—',
  };
}
