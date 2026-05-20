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
};

function familyDisplay(family: string): string {
  return METHOD_FAMILY_LABELS[family] ?? family
    .split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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
      // Find papers whose title contains a token derivable from the family key
      const tokens = t.family.split('_').filter(s => s.length >= 3);
      const evidence: Evidence[] = [];
      outer: for (const day of pool) {
        for (const item of day.items) {
          const title = (item.title || '').toLowerCase();
          if (tokens.every(tok => title.includes(tok))) {
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

      const topLabs = topLabsForMethod(t.family, entities);

      results.push({
        family:          t.family,
        displayName:     familyDisplay(t.family),
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

    // Method focus: scan signals' titles, count by method family keyword
    const methodHits: Record<string, number> = {};
    for (const sig of ent.signals.slice(0, 30)) {
      const title = (sig.title || '').toLowerCase();
      for (const [family] of Object.entries(METHOD_FAMILY_LABELS)) {
        const tokens = family.split('_').filter(s => s.length >= 3);
        if (tokens.every(tok => title.includes(tok))) {
          methodHits[family] = (methodHits[family] ?? 0) + 1;
          break;
        }
      }
    }
    const methodFocus = Object.entries(methodHits)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => familyDisplay(f));

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
      affiliation,
      paperCount90d:   deduped.length,
      topRating,
      contactStatus,
      evidence:        ev,
    });
  }

  return records.sort((a, b) => {
    // Rank: rated⚡ first, then 🔧, then by paper count
    const rOrder = (r: string) => r === '⚡' ? 0 : r === '🔧' ? 1 : 2;
    const rd = rOrder(a.topRating) - rOrder(b.topRating);
    if (rd !== 0) return rd;
    return b.paperCount90d - a.paperCount90d;
  });
}

// ---------------------------------------------------------------------------
// loadHRQueue
// ---------------------------------------------------------------------------

export interface HRGateCriteria {
  ratingFloor:        '⚡' | '🔧';
  minPaperCount90d:   number;
  requireAffiliation: boolean;
}

export const DEFAULT_HR_GATE: HRGateCriteria = {
  ratingFloor:        '🔧',
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
  const hits: Record<string, number> = {};
  for (const e of ev) {
    const title = (e.title ?? '').toLowerCase();
    for (const family of Object.keys(METHOD_FAMILY_LABELS)) {
      const tokens = family.split('_').filter(s => s.length >= 3);
      if (tokens.length > 0 && tokens.every(tok => title.includes(tok))) {
        hits[family] = (hits[family] ?? 0) + 1;
        break;
      }
    }
  }
  return Object.entries(hits)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([f]) => familyDisplay(f));
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
    const hasDurable = p.contactStatus !== 'not_linked';

    // HOT: full gate (≥🔧 + ≥2 papers + affiliation + durable contact)
    if (isRated && hasMulti && hasAff && hasDurable) {
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

export function loadHRQueue(opts: Partial<HRGateCriteria> = {}): HRCandidate[] {
  const gate: HRGateCriteria = { ...DEFAULT_HR_GATE, ...opts };
  const allPeople = loadPeople({ minPaperCount90d: 1 });

  const candidates: HRCandidate[] = [];
  for (const p of allPeople) {
    const gateHits: string[] = [];

    // Gate 1: rating floor
    const ratingOK = gate.ratingFloor === '🔧'
      ? p.topRating === '⚡' || p.topRating === '🔧'
      : p.topRating === '⚡';
    if (!ratingOK) continue;
    gateHits.push(`Top rating ≥ ${gate.ratingFloor}`);

    // Gate 2: paper count
    if (p.paperCount90d < gate.minPaperCount90d) continue;
    gateHits.push(`${p.paperCount90d} papers in 90 days`);

    // Gate 3: affiliation requirement
    if (gate.requireAffiliation && !p.affiliation) continue;
    if (p.affiliation) gateHits.push(`Affiliated: ${p.affiliation}`);

    // Gate 4: durable signal (contact_status != not_linked)
    if (p.contactStatus === 'not_linked') continue;
    gateHits.push(`Contact: ${p.contactStatus}`);

    const whyNow = p.topRating === '⚡'
      ? `Author on ⚡-rated paper in last 90 days`
      : `Author on ${p.paperCount90d} 🔧+ papers in last 90 days`;

    candidates.push({ ...p, whyNow, gateHits });
  }

  return candidates;
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
  hrQueueCount:      number;
  dataAsOf:          string;   // YYYY-MM-DD of latest field-state file
}

export function loadTalentStats(): TalentStats {
  const subs   = loadSubdirections({ domain: 'all' });
  const labs   = loadLabs();
  const people = loadPeople();
  const hr     = loadHRQueue();
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
    hrQueueCount:      hr.length,
    dataAsOf:          m?.[1] ?? '—',
  };
}
