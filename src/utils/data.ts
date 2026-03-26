/**
 * src/utils/data.ts
 * ------------------
 * TypeScript utilities for loading pipeline data at Astro build time.
 * All functions read from src/data/ — kept in sync via scripts/sync-data.py.
 *
 * These run only at SSG build time (Node/Bun), never in the browser.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve src/data — try import.meta.url first, fall back to process.cwd()
// (Astro SSG build may run utils from a temp location where import.meta.url differs)
function resolveDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(__dirname, '../data');
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* ignore */ }
  // Fallback: project root / src/data
  return path.resolve(process.cwd(), 'src/data');
}
const DATA_DIR = resolveDataDir();

// ---------------------------------------------------------------------------
// Type definitions matching the pipeline's JSON schemas
// ---------------------------------------------------------------------------

export interface DailyPickItem {
  title:       string;
  url:         string;
  summary:     string;
  rating:      '⚡' | '🔧' | '📖' | '❌' | string;
  source:      string;
  domain:      'ai' | 'vla' | string;
  affiliation?: string;
  soWhat?:     string;   // "So What" — why this matters to practitioners
}

export interface DailyPickDay {
  date:   string;           // 'YYYY-MM-DD'
  items:  DailyPickItem[];
  daText?: string;          // Devil's Advocate analysis (Phase 2.7)
}

// Raw shape from ai-daily-pick.json (pipeline format)
interface AIDailyPickRaw {
  title:      string;
  category:   string;   // "行业" | "工具" | "趋势" | "实验" | "新发布" | "更新" | "观点"
  source:     string;
  url:        string;
  why_picked: string;   // maps to summary
  so_what?:   string;   // "So What" — practitioner impact statement
}

export interface AIDailyPickFile {
  daily_picks: Array<{ date: string; items: AIDailyPickRaw[] }>;
}

// Raw shape from vla-daily-rating-out-YYYY-MM-DD.json
interface VLARatingRaw {
  title:            string;
  date:             string;
  url:              string;
  source:           string;
  rating:           '⚡' | '🔧' | '📖' | '❌' | string;
  reason:           string;   // maps to summary
  abstract_snippet: string;
  affiliation:      string;
  // New fields from 3-pass pipeline (2026-03-05)
  full_abstract?:   string;   // full arXiv abstract ~800-1500 chars
  pass3_note?:      string;   // Pass3 challenge reason if downgraded
  pass1_reason?:    string;   // Pass1 bucket reason if bucket B
}

// Filter funnel counts from 3-pass pipeline
export interface VLAFilterFunnel {
  total_rss:        number;
  pass1_a:          number;
  pass1_b:          number;
  pass2_promoted:   number;
  pass3_downgraded: number;
  final_star:       number;
  final_gear:       number;
  final_book:       number;
  final_x:          number;
}

// Pass1 bucket B item (filtered out, not promoted)
export interface VLABucketBItem {
  title:  string;
  reason: string;
}

interface VLARatingFile {
  ok:              boolean;
  papers:          VLARatingRaw[];
  da_text?:        string;
  // New fields from 3-pass pipeline (2026-03-05)
  filter_funnel?:  VLAFilterFunnel;
  pass1_bucket_b?: VLABucketBItem[];
}

// Extended item type for VLA detail pages — carries 3-pass pipeline fields
export interface VLAPickItem extends DailyPickItem {
  full_abstract: string;
  pass3_note:    string;
  affiliation:   string;
}

// Extended day type returned by loadVLADailyPicksV2 — includes funnel + bucket B
export interface VLAPickDay {
  date:          string;
  items:         VLAPickItem[];
  filter_funnel: VLAFilterFunnel | null;
  bucket_b:      VLABucketBItem[];
  daText?:       string;
}

// Drift metrics — flat array of daily snapshots (actual pipeline format)
export interface DriftMetricsEntry {
  date:                 string;
  vla_papers_scanned?:  number;
  vla_final_in_report?: number;
  vla_sources_active?:  number;
  vla_tg_msg_len?:      number;
  aiapp_items_scanned?: number;
  aiapp_items_report?:  number;
}

export type DriftMetricsFile = DriftMetricsEntry[];

// Drift state
export interface DriftStateFile {
  last_check:  string;   // ISO date
  drift_active: boolean;
  streaks?: {
    vla?:    number;
    ai_app?: number;
  };
  alerts?: string[];
}

// Entity index
export interface EntitySignal {
  date:   string;
  title:  string;
  url:    string;
  rating: string;
  domain: string;
}

export interface Entity {
  type:    string;  // 'lab' | 'method' | 'benchmark' | 'researcher'
  name:    string;
  signals: EntitySignal[];
}

export interface EntityIndexFile {
  entities:     Record<string, Entity>;
  last_updated: string;
}

// Upstream signals
export interface UpstreamSignal {
  date:    string;
  domain:  'vla' | 'ai_app';
  title:   string;
  url:     string;
  keyword?: string;
  keywords_matched?: string[];
  arxiv_id?: string;
}

export interface UpstreamSignalsFile {
  signals: UpstreamSignal[];
}

// AI Deep Dive articles
export interface AIDeepDiveArticle {
  date:        string;
  title:       string;
  url:         string;
  slug:        string;
  html_url?:   string;
  source:      string;
  signal_type: string;
}

interface AIDeepDiveFile {
  deep_dive_articles: AIDeepDiveArticle[];
}

// ---------------------------------------------------------------------------
// AI Deep Dive tag taxonomy — practitioner-oriented categorization
// ---------------------------------------------------------------------------
export interface AIDeepDiveTag {
  id:       string;
  label:    string;    // TC
  labelSC:  string;    // SC
  accent:   string;
  keywords: string[];  // lowercase; matched against title.toLowerCase()
}

export const AI_DEEP_DIVE_TAGS: AIDeepDiveTag[] = [
  { id: 'framework',    label: '框架',       labelSC: '框架',       accent: 'purple',
    keywords: ['framework', 'autogen', 'langchain', 'langsmith', 'strands', 'jido', 'sdk', 'ag-ui'] },
  { id: 'safety',       label: '安全',       labelSC: '安全',       accent: 'red',
    keywords: ['guardrail', 'security', 'safehouse', 'sandbox', 'injection', 'trust'] },
  { id: 'coding-agent', label: '編碼Agent',  labelSC: '编码Agent',  accent: 'amber',
    keywords: ['coding agent', 'claude code', 'agentic engineering', 'vibe', 'tmux-ide', 'verification'] },
  { id: 'infra',        label: '基礎設施',   labelSC: '基础设施',   accent: 'blue',
    keywords: ['inference', 'apple silicon', 'ane', 'npu', 'flashattention', 'sagemaker', 'bedrock', 'embedding', 'context'] },
  { id: 'product',      label: '產品',       labelSC: '产品',       accent: 'green',
    keywords: ['gpt', 'openai', 'anthropic', 'launch hn', 'lerobot'] },
  { id: 'paradigm',     label: '範式',       labelSC: '范式',       accent: 'cyan',
    keywords: ['paradigm', 'reshaping', 'operationalizing', 'end of', 'mcp is dead'] },
  { id: 'tool-rag',     label: '工具RAG',    labelSC: '工具RAG',    accent: 'teal',
    keywords: ['mcp', 'tool', 'retrieval', 'search', 'memory', 'rag', 'spine swarm', 'gui agent'] },
];

/** Match an article title against the tag taxonomy. Returns all matching tag IDs. */
export function matchDeepDiveTags(title: string): string[] {
  const lower = title.toLowerCase();
  return AI_DEEP_DIVE_TAGS
    .filter(tag => tag.keywords.some(kw => lower.includes(kw)))
    .map(tag => tag.id);
}

// VLA SOTA tracker
export interface VLASOTAEntry {
  benchmark:      string;
  split?:         string;
  metric:         string;
  value:          number;
  model:          string;
  paper_id?:      string;
  baseline?:      string;
  date:           string;
  source?:        string;
  leaderboard_url?: string;
  paper_url?:     string;
}

interface VLASOTAFile {
  'vla-sota-tracker': VLASOTAEntry[];
  last_checked?: string;
}

// VLA Theory articles
export interface VLATheoryArticle {
  date:       string;
  slug:       string;
  title:      string;
  url:        string;
  target_dir?: string;
  html_url?:  string;
}

interface VLATheoryFile {
  theory_articles: VLATheoryArticle[];
}

// VLA GitHub full theory library (fetched by fetch-vla-github.py)
export interface VLAGitHubArticle {
  path:     string;
  title:    string;
  url:      string;
  html_url: string;
  date:     string;
  topic:    string;
}

interface VLAGitHubFile {
  fetched_at: string;
  articles:   VLAGitHubArticle[];
}

// ---------------------------------------------------------------------------
// Helper: safe JSON read — returns null on any error (missing file, parse fail)
// ---------------------------------------------------------------------------
function readJson<T>(filename: string): T | null {
  const fullPath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    // File missing or malformed — caller handles null gracefully
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: list .md files matching a glob-style prefix, sorted descending
// ---------------------------------------------------------------------------
function listMdFiles(prefix: string): string[] {
  try {
    return fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith(prefix) && f.endsWith('.md'))
      .sort()
      .reverse();   // newest first (date-based filenames sort lexicographically)
  } catch {
    return [];
  }
}

// Category label → display text mapping for AI daily items.
// Pipeline writes Chinese category names; we surface them as-is.
const CATEGORY_DISPLAY: Record<string, string> = {
  '工具':  '🔧 工具',
  '实验':  '🔧 實驗',
  '新发布': '⚡ 新發布',
  '更新':  '🔧 更新',
  '行业':  '📰 行業',
  '观点':  '💬 觀點',
  '趋势':  '📊 趨勢',
};

// ---------------------------------------------------------------------------
// loadAIDailyPicks
// Returns the N most recent daily-pick days from ai-daily-pick.json.
// Maps raw pipeline fields (category, why_picked) to the DailyPickItem shape.
// ---------------------------------------------------------------------------
export function loadAIDailyPicks(n: number = 7): DailyPickDay[] {
  const data = readJson<AIDailyPickFile>('ai-daily-pick.json');
  if (!data?.daily_picks) return [];
  return [...data.daily_picks]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n)
    .map(day => ({
      date: day.date,
      items: (day.items ?? []).map((raw): DailyPickItem => ({
        title:   raw.title   ?? '',
        url:     raw.url     ?? '#',
        summary: raw.why_picked ?? '',
        // Keep category display label; falls back to raw value for unknown
        rating:  CATEGORY_DISPLAY[raw.category] ?? raw.category ?? '',
        source:  raw.source  ?? '',
        domain:  'ai',
        soWhat:  raw.so_what || undefined,
      })),
    }));
}

// ---------------------------------------------------------------------------
// loadVLADailyPicks
// Returns the N most recent VLA daily rating days from
// vla-daily-rating-out-YYYY-MM-DD.json files synced into src/data/.
// Returns DailyPickDay[] — used by non-VLA-detail pages (index, dashboard, daily).
// ---------------------------------------------------------------------------
export function loadVLADailyPicks(n: number = 7): DailyPickDay[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('vla-daily-rating-out-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, n);
  } catch {
    return [];
  }

  return files.map(filename => {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch?.[1] ?? 'unknown';
    const data = readJson<VLARatingFile>(filename);
    const papers = data?.papers ?? [];
    return {
      date,
      daText: data?.da_text || '',
      items: papers
        .filter(p => p.rating !== '❌')   // skip low-relevance by default
        .map((raw): DailyPickItem => ({
          title:   raw.title            ?? '',
          url:     raw.url              ?? '#',
          // reason is a short eval tag (≤40 chars) when generated by old pipeline.
          // Supplement with abstract_snippet for richer subtitle display.
          summary: (() => {
            const r   = (raw.reason || '').trim();
            const abs = (raw.abstract_snippet || '')
              .replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*/i, '')
              .replace(/^Abstract:\s*/i, '')
              .trim();
            if (r.length > 40) return r;           // new pipeline: reason is full summary
            if (r && abs) return r + '  ' + abs;   // old pipeline: pad with abstract
            return r || abs;
          })(),
          rating:  raw.rating           ?? '📖',
          source:      raw.source      ?? 'arxiv',
          domain:      'vla',
          affiliation: raw.affiliation  || '',
        })),
    };
  }).filter(day => day.items.length > 0);
}

// ---------------------------------------------------------------------------
// loadVLADailyPicksV2
// Like loadVLADailyPicks but returns the richer VLAPickDay type that carries
// 3-pass pipeline fields: filter_funnel, bucket_b, full_abstract, pass3_note.
// Used exclusively by the VLA detail page (src/pages/vla/[date].astro).
// ---------------------------------------------------------------------------
export function loadVLADailyPicksV2(n: number = 7): VLAPickDay[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('vla-daily-rating-out-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, n);
  } catch {
    return [];
  }

  return files
    .map(filename => {
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch?.[1] ?? 'unknown';
      const data = readJson<VLARatingFile>(filename);
      const papers = data?.papers ?? [];
      return {
        date,
        items: papers
          .filter(p => p.rating !== '❌')
          .map((raw): VLAPickItem => ({
            title:         raw.title            ?? '',
            url:           raw.url              ?? '#',
            summary:       raw.reason           || raw.abstract_snippet || '',
            rating:        raw.rating           ?? '📖',
            source:        raw.source           ?? 'arxiv',
            domain:        'vla' as const,
            full_abstract: raw.full_abstract    ?? '',
            pass3_note:    raw.pass3_note       ?? '',
            affiliation:   raw.affiliation      ?? '',
          })),
        filter_funnel: data?.filter_funnel ?? null,
        bucket_b:      data?.pass1_bucket_b ?? [],
      };
    })
    // Keep days that have at least one displayable paper OR funnel/bucket data
    .filter(day => day.items.length > 0 || day.filter_funnel !== null || day.bucket_b.length > 0);
}

// ---------------------------------------------------------------------------
// loadDriftMetrics
// Returns the flat drift-metrics array and drift-state object.
// drift-metrics.json is a plain array of DriftMetricsEntry (one per day).
// ---------------------------------------------------------------------------
export function loadDriftMetrics(): {
  metrics: DriftMetricsEntry[];
  state:   DriftStateFile | null;
} {
  return {
    // The file is a top-level array; fall back to empty array when missing
    metrics: readJson<DriftMetricsEntry[]>('drift-metrics.json') ?? [],
    state:   readJson<DriftStateFile>('drift-state.json'),
  };
}

// ---------------------------------------------------------------------------
// loadEntityIndex
// Returns the full entity index; empty entities if file is missing.
// ---------------------------------------------------------------------------
export function loadEntityIndex(): EntityIndexFile {
  const data = readJson<EntityIndexFile>('entity-index.json');
  return data ?? { entities: {}, last_updated: '' };
}

// ---------------------------------------------------------------------------
// getTopEntities
// Returns the N entities with the most signals, optionally filtered by type.
// ---------------------------------------------------------------------------
export function getTopEntities(
  n:    number  = 10,
  type?: string,
): Entity[] {
  const { entities } = loadEntityIndex();
  return Object.values(entities)
    .filter(e => !type || e.type === type)
    .sort((a, b) => b.signals.length - a.signals.length)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// getTopInstitutions
// Returns top N lab entities with VLA-domain signals in the last `days` days,
// sorted by recent signal count. Used by the TOP INSTITUTIONS panel.
// ---------------------------------------------------------------------------
export interface InstitutionTrend {
  name:          string;
  recentCount:   number;   // signals within the caller's `days` window
  totalCount:    number;   // all signals (90d rolling)
  lastSeen:      string;   // most recent signal date
  topRating:     string;   // best rating seen (⚡ > 🔧 > 📖)
}

export function getTopInstitutions(n: number = 20, days: number = 7): InstitutionTrend[] {
  const { entities } = loadEntityIndex();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const ratingRank: Record<string, number> = { '⚡': 3, '🔧': 2, '📖': 1 };

  const results: InstitutionTrend[] = [];
  for (const entity of Object.values(entities)) {
    if (entity.type !== 'lab') continue;
    const vlaSignals = entity.signals.filter(s => s.domain === 'vla');
    if (vlaSignals.length === 0) continue;

    const recent = vlaSignals.filter(s => s.date >= cutoffStr);
    const lastSeen = vlaSignals.reduce((max, s) => s.date > max ? s.date : max, '');
    let topRating = '📖';
    let topRank = 0;
    for (const s of vlaSignals) {
      const rank = ratingRank[s.rating] ?? 0;
      if (rank > topRank) { topRank = rank; topRating = s.rating; }
    }

    results.push({
      name: entity.name,
      recentCount: recent.length,
      totalCount: vlaSignals.length,
      lastSeen,
      topRating,
    });
  }

  return results
    .sort((a, b) => b.recentCount - a.recentCount || b.totalCount - a.totalCount)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// getTopAIOrgs
// Returns top N lab entities with AI-domain signals, sorted by signal count.
// Used by the TOP AI ORGS panel on the AI Deep Dive page.
// ---------------------------------------------------------------------------
export function getTopAIOrgs(n: number = 15): InstitutionTrend[] {
  const { entities } = loadEntityIndex();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const ratingRank: Record<string, number> = { '⚡': 3, '🔧': 2, '📖': 1 };

  const results: InstitutionTrend[] = [];
  for (const entity of Object.values(entities)) {
    if (entity.type !== 'lab') continue;
    const aiSignals = entity.signals.filter(s => s.domain === 'ai_app');
    if (aiSignals.length === 0) continue;

    const recent = aiSignals.filter(s => s.date >= cutoffStr);
    const lastSeen = aiSignals.reduce((max, s) => s.date > max ? s.date : max, '');
    let topRating = '📖';
    let topRank = 0;
    for (const s of aiSignals) {
      const rank = ratingRank[s.rating] ?? 0;
      if (rank > topRank) { topRank = rank; topRating = s.rating; }
    }

    results.push({
      name: entity.name,
      recentCount: recent.length,
      totalCount: aiSignals.length,
      lastSeen,
      topRating,
    });
  }

  return results
    .sort((a, b) => b.totalCount - a.totalCount || b.recentCount - a.recentCount)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// loadSocialIntel
// Loads the N most recent daily social intel .md files for ai or vla.
// Returns array of { date, content } objects.
// ---------------------------------------------------------------------------
export function loadSocialIntel(
  domain: 'ai' | 'vla',
  n:      number = 5,
): Array<{ date: string; content: string; filename: string }> {
  const prefix = domain === 'ai' ? '_ai_social_' : '_vla_social_';
  const files  = listMdFiles(prefix).slice(0, n);

  return files.map(filename => {
    // Extract date from filename pattern _ai_social_YYYY-MM-DD.md
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date      = dateMatch?.[1] ?? 'unknown';
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
      return { date, content, filename };
    } catch {
      return { date, content: '', filename };
    }
  });
}

// ---------------------------------------------------------------------------
// loadBiweeklyReports
// Loads the N most recent biweekly report .md files.
// Optionally loads reflections instead (prefix: _biweekly_reflection_).
// ---------------------------------------------------------------------------
export function loadBiweeklyReports(
  n:           number  = 6,
  reflections: boolean = false,
): Array<{ date: string; content: string; filename: string; isReflection: boolean; domain: 'vla' | 'ai' }> {
  const vlaPfx = reflections ? '_biweekly_reflection_' : '_biweekly_';
  const aiPfx  = reflections ? '_ai_biweekly_reflection_' : '_ai_biweekly_';

  const vlaFiles = listMdFiles(vlaPfx).filter(f => !f.startsWith('_ai_'));
  const aiFiles  = listMdFiles(aiPfx);

  const toEntry = (filename: string, domain: 'vla' | 'ai') => {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date      = dateMatch?.[1] ?? 'unknown';
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
      return { date, content, filename, isReflection: reflections, domain };
    } catch {
      return { date, content: '', filename, isReflection: reflections, domain };
    }
  };

  const all = [
    ...vlaFiles.map(f => toEntry(f, 'vla')),
    ...aiFiles.map(f => toEntry(f, 'ai')),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return all.slice(0, n);
}

// ---------------------------------------------------------------------------
// loadWeeklyReports
// Loads the N most recent weekly recon report .md files (VLA + AI).
// ---------------------------------------------------------------------------
export function loadWeeklyReports(
  n: number = 24,
): Array<{ date: string; content: string; filename: string; domain: 'vla' | 'ai' }> {
  const vlaPfx = '_weekly_';
  const aiPfx  = '_ai_weekly_';

  const vlaFiles = listMdFiles(vlaPfx).filter(f => !f.startsWith('_ai_'));
  const aiFiles  = listMdFiles(aiPfx);

  const toEntry = (filename: string, domain: 'vla' | 'ai') => {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date      = dateMatch?.[1] ?? 'unknown';
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
      return { date, content, filename, domain };
    } catch {
      return { date, content: '', filename, domain };
    }
  };

  const all = [
    ...vlaFiles.map(f => toEntry(f, 'vla')),
    ...aiFiles.map(f => toEntry(f, 'ai')),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return all.slice(0, n);
}

// ---------------------------------------------------------------------------
// loadUpstreamSignals
// Returns the N most recent upstream arxiv signals.
// ---------------------------------------------------------------------------
export function loadUpstreamSignals(n: number = 20): UpstreamSignal[] {
  const data = readJson<UpstreamSignalsFile>('upstream-signals.json');
  if (!data?.signals) return [];
  return [...data.signals]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// loadAIDeepDive
// Returns the N most recent AI deep dive articles.
// ---------------------------------------------------------------------------
export function loadAIDeepDive(n: number = 20): AIDeepDiveArticle[] {
  const data = readJson<AIDeepDiveFile>('ai-app-deep-dive-articles.json');
  if (!data?.deep_dive_articles) return [];
  return [...data.deep_dive_articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// AI Field State — method family trends for AI Agent ecosystem
// ---------------------------------------------------------------------------
export interface AIMethodTrend {
  family:           string;
  label:            string;
  count_7d:         number;
  count_prior_7d:   number;
  count_14d:        number;
  daily_avg_recent: number;
  daily_avg_prior:  number;
  acceleration:     number;
  status:           string;
}

export interface AICompetitionPair {
  familyA: string;
  familyB: string;
  label:   string;
}

export interface AIFieldStateFile {
  date:              string;
  trend_version:     number;
  total_mentions_7d: number;
  method_trends:     AIMethodTrend[];
  competition_pairs?: AICompetitionPair[];
}

export function loadLatestAIFieldState(): AIFieldStateFile | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('ai-field-state-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return readJson<AIFieldStateFile>(files[0]);
}

// ---------------------------------------------------------------------------
// loadVLASOTA
// Returns all VLA SOTA tracker entries, sorted by date desc.
// ---------------------------------------------------------------------------
export function loadVLASOTA(n: number = 20): VLASOTAEntry[] {
  const data = readJson<VLASOTAFile>('vla-sota-tracker.json');
  if (!data?.['vla-sota-tracker']) return [];
  return [...data['vla-sota-tracker']]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// loadVLATheory
// Returns the N most recent VLA theory articles.
// ---------------------------------------------------------------------------
export function loadVLATheory(n: number = 20): VLATheoryArticle[] {
  const data = readJson<VLATheoryFile>('vla-theory-articles.json');
  if (!data?.theory_articles) return [];
  return [...data.theory_articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// loadVLAGitHubArticles
// Returns up to N VLA theory articles fetched from GitHub (all theory/ files).
// Sorted by date descending.
// ---------------------------------------------------------------------------
export function loadVLAGitHubArticles(n: number = 100): VLAGitHubArticle[] {
  const data = readJson<VLAGitHubFile>('vla-github-theory.json');
  if (!data?.articles) return [];
  return [...data.articles]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Utility: summarise first N chars of markdown content
// ---------------------------------------------------------------------------
export function extractMarkdownSummary(content: string, maxLen: number = 300): string {
  // Strip markdown headings, links, bold, etc. for a plain-text excerpt
  return content
    .replace(/^#{1,6}\s+/gm, '')   // remove headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // unwrap links
    .replace(/[*_`~]/g, '')         // remove emphasis markers
    .replace(/\n{2,}/g, ' ')        // collapse blank lines
    .trim()
    .slice(0, maxLen)
    .concat(content.length > maxLen ? '…' : '');
}

// Cross-domain insights
export interface CrossDomainInsight {
  rule_id:            string;
  label:              string;
  source_domain:      string;
  target_domain:      string;
  title:              string;
  url:                string;
  rating:             string;
  matched_keywords:   string[];
  abstract:           string;
  date:               string;
  significance?:      string;
  practitioner_note?: string;
  rule_description?:  string;
  vla_need?:          string;
}

interface CrossDomainFile {
  cross_domain_insights: CrossDomainInsight[];
}

// VLA tag distribution per day
export interface VLATagDay {
  date:   string;
  flash:  number;   // ⚡
  wrench: number;   // 🔧
  book:   number;   // 📖
  x:      number;   // ❌
  total:  number;
}

// AI category count
export interface AICategoryCount {
  category: string;
  count:    number;
}

// Calibration trigger entry
export interface CalibTriggerEntry {
  date:    string;
  trigger: string;
}

// ---------------------------------------------------------------------------
// CalibrationCheck — shape of calibration-check-YYYY-MM-DD.json
// ---------------------------------------------------------------------------
export interface CalibrationCheck {
  triggered: boolean;
  triggers: string[];          // triggered assumption descriptions
  vla_assumptions_scanned: number;
  ai_assumptions_scanned: number;
  executed_at: string;
}

// ---------------------------------------------------------------------------
// loadLatestCalibration
// Reads the newest calibration-check-YYYY-MM-DD.json from src/data/.
// ---------------------------------------------------------------------------
export function loadLatestCalibration(): CalibrationCheck | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('calibration-check-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  const data = readJson<CalibrationCheck>(files[0]);
  return data ?? null;
}

// ---------------------------------------------------------------------------
// loadCrossDomainInsights
// Returns the N most recent cross-domain insight entries.
// ---------------------------------------------------------------------------
export function loadCrossDomainInsights(n: number = 20): CrossDomainInsight[] {
  const data = readJson<CrossDomainFile>('cross-domain-insight.json');
  if (!data?.cross_domain_insights) return [];
  return [...data.cross_domain_insights]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// loadRecentCalibrationTriggers
// Collects all triggered assumptions from the last N calibration check files.
// ---------------------------------------------------------------------------
export function loadRecentCalibrationTriggers(maxFiles: number = 14): CalibTriggerEntry[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('calibration-check-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, maxFiles);
  } catch {
    return [];
  }
  const result: CalibTriggerEntry[] = [];
  for (const filename of files) {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch?.[1] ?? '';
    const data = readJson<CalibrationCheck>(filename);
    if (data?.triggers?.length) {
      for (const trigger of data.triggers) {
        result.push({ date, trigger });
      }
    }
  }
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// loadVLATagDistribution
// Returns per-day breakdown of ⚡/🔧/📖/❌ counts from VLA rating files.
// ---------------------------------------------------------------------------
export function loadVLATagDistribution(n: number = 7): VLATagDay[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('vla-daily-rating-out-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, n);
  } catch {
    return [];
  }
  return files
    .map(filename => {
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      const date  = dateMatch?.[1] ?? 'unknown';
      const data  = readJson<{ papers: VLARatingRaw[] }>(filename);
      const papers = data?.papers ?? [];
      return {
        date,
        flash:  papers.filter(p => p.rating === '⚡').length,
        wrench: papers.filter(p => p.rating === '🔧').length,
        book:   papers.filter(p => p.rating === '📖').length,
        x:      papers.filter(p => p.rating === '❌').length,
        total:  papers.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date)); // ascending for timeline view
}

// ---------------------------------------------------------------------------
// loadAICategoryDistribution
// Returns category counts from the most recent N days of AI daily picks.
// ---------------------------------------------------------------------------
export function loadAICategoryDistribution(days: number = 7): AICategoryCount[] {
  const data = readJson<AIDailyPickFile>('ai-daily-pick.json');
  if (!data?.daily_picks) return [];
  const recent = [...data.daily_picks]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, days);
  const counts: Record<string, number> = {};
  for (const day of recent) {
    for (const item of day.items ?? []) {
      const cat = item.category ?? '其他';
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// GraphData — shape of graph-data.json (built by build-graph-data.py)
// ---------------------------------------------------------------------------

export interface GraphNode {
  id:      string;   // e.g. "paper:0", "theory:2", "ai_pick:5"
  label:   string;
  type:    'paper' | 'theory' | 'ai_pick';
  date:    string;
  url:     string;
  rating:  string;
  snippet: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;  // cosine similarity [0.15, 1.0]
}

export interface GraphStats {
  nodes:   number;
  edges:   number;
  sources: { paper: number; theory: number; ai_pick: number };
}

export interface GraphData {
  generated: string;
  stats:     GraphStats;
  nodes:     GraphNode[];
  edges:     GraphEdge[];
}

// ---------------------------------------------------------------------------
// loadGraphData
// Reads graph-data.json from src/data/. Returns null if file is missing.
// ---------------------------------------------------------------------------
export function loadGraphData(): GraphData | null {
  return readJson<GraphData>('graph-data.json');
}

// ---------------------------------------------------------------------------
// AIGitHubArticle — shape of ai-github-theory.json (fetched by fetch-ai-github.py)
// Each article is a theory/**/*.md file in Agent-Playbook repo.
// ---------------------------------------------------------------------------
export interface AIGitHubArticle {
  path:     string;   // e.g. "theory/03-engineering/context-engineering-field-guide.md"
  title:    string;
  url:      string;
  html_url: string;
  date:     string;   // YYYY-MM-DD, from last commit
  topic:    string;   // module label (e.g. "工程實戰")
  module:   string;   // e.g. "03-engineering"
  slug:     string;   // filename without .md
}

interface AIGitHubFile {
  fetched_at: string;
  repo:       string;
  stats:      { total: number; by_module: Record<string, number> };
  articles:   AIGitHubArticle[];
}

// ---------------------------------------------------------------------------
// loadAIGitHubArticles
// Returns up to N articles from ai-github-theory.json, sorted date desc.
// ---------------------------------------------------------------------------
export function loadAIGitHubArticles(n: number = 200): AIGitHubArticle[] {
  const data = readJson<AIGitHubFile>('ai-github-theory.json');
  if (!data?.articles) return [];
  return [...data.articles]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// relativeDay
// Returns a Chinese relative-day string ("今天", "昨天", "N 天前").
// Uses Shanghai (UTC+8) midnight baseline. Runs at SSG build time; the site
// is rebuilt daily so the offset stays accurate.
// ---------------------------------------------------------------------------
export function relativeDay(dateStr: string): string {
  const now = new Date();
  const d   = new Date(dateStr + 'T00:00:00+08:00');
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff <= 0)  return '今天';
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

// ---------------------------------------------------------------------------
// Field-State — method trend + benchmark health from compute-field-state.py
// ---------------------------------------------------------------------------
export interface MethodTrend {
  family:           string;
  count_7d:         number;
  count_14d:        number;
  share_7d?:        number;   // v1 only; v2 drops this — compute from count_7d / total_papers_scanned
  acceleration:     number;
  acceleration_14d?: number;  // v3: supplementary 14d acceleration
  status:           string;
  new_family_since?: string;  // v3: date when family was added (suppressed <14d)
}

export interface BenchmarkHealth {
  benchmark:  string;
  max_value:  number;
  model:      string;
  status:     string;
  reason:     string;
}

export interface FieldStateFile {
  date:                 string;
  data_confidence:      string;
  total_papers_scanned: number;
  method_trends:        MethodTrend[];
  benchmark_health:     BenchmarkHealth[];
}

// ---------------------------------------------------------------------------
// loadLatestFieldState
// Reads the newest field-state-YYYY-MM-DD.json from src/data/.
// ---------------------------------------------------------------------------
export function loadLatestFieldState(): FieldStateFile | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('field-state-') && f.endsWith('.json'))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return readJson<FieldStateFile>(files[0]);
}

// ---------------------------------------------------------------------------
// FamilyTimeSeries — time-series view across multiple field-state snapshots
// Used by the financial terminal dashboard on vla-deepdive.
// ---------------------------------------------------------------------------
export interface FamilyTimeSeries {
  family: string;
  dates:  string[];    // aligned date axis
  shares: number[];    // share_7d per day
  counts: number[];    // count_7d per day
  accels: number[];    // acceleration per day
  latest: { share: number; count: number; accel: number; accel14d: number; status: string; isNew: boolean };
  delta:  number;      // shares[last] - shares[first] (pp change over window)
}

export interface FieldStateHistory {
  families:    FamilyTimeSeries[];
  dates:       string[];
  latestDate:  string;
  totalPapers: number;
  confidence:  string;
}

// Competition pair definition (from METHOD_COMPETITION in _vla_method_families.py)
export interface CompetitionPair {
  familyA: string;
  familyB: string;
  label:   string;
}

export const COMPETITION_PAIRS: CompetitionPair[] = [
  { familyA: 'language_grounding', familyB: 'world_model',      label: 'VLA vs WAM' },
  { familyA: 'diffusion_policy',   familyB: 'flow_matching',    label: 'ACTION HEAD ROUTE' },
  { familyA: 'instruction_tuning', familyB: 'rl_finetuning',    label: 'POST-TRAINING ROUTE' },
  { familyA: 'world_model',        familyB: 'rl_finetuning',    label: 'LEARNING SIGNAL' },
  { familyA: 'tactile',            familyB: 'dexterous_hand',   label: 'MANIPULATION SENSING' },
  { familyA: 'sim_to_real',        familyB: 'cross_embodiment', label: 'TRANSFER APPROACH' },
];

// ---------------------------------------------------------------------------
// loadFieldStateHistory
// Reads all field-state-YYYY-MM-DD.json files and builds per-family time series.
// ---------------------------------------------------------------------------
export function loadFieldStateHistory(): FieldStateHistory | null {
  let files: string[];
  try {
    files = fs
      .readdirSync(DATA_DIR)
      .filter(f => f.startsWith('field-state-') && f.endsWith('.json'))
      .sort();   // ascending by date
  } catch {
    return null;
  }
  if (files.length < 2) return null;  // need >=2 points for a trend

  const snapshots: FieldStateFile[] = [];
  for (const f of files) {
    const data = readJson<FieldStateFile>(f);
    if (data?.method_trends?.length) snapshots.push(data);
  }
  if (snapshots.length < 2) return null;

  const dates = snapshots.map(s => s.date);
  const latest = snapshots[snapshots.length - 1];

  // Collect all family names across all snapshots
  const familySet = new Set<string>();
  for (const s of snapshots) {
    for (const m of s.method_trends) familySet.add(m.family);
  }

  // Helper: get share_7d, computing from count_7d / total if absent (v2 schema)
  const getShare = (m: MethodTrend | undefined, totalPapers: number): number => {
    if (!m) return 0;
    if (m.share_7d != null) return m.share_7d;
    return totalPapers > 0 ? +(m.count_7d / totalPapers).toFixed(4) : 0;
  };

  const families: FamilyTimeSeries[] = [];
  for (const family of familySet) {
    const shares: number[] = [];
    const counts: number[] = [];
    const accels: number[] = [];
    for (const s of snapshots) {
      const m = s.method_trends.find(t => t.family === family);
      shares.push(getShare(m, s.total_papers_scanned));
      counts.push(m?.count_7d ?? 0);
      accels.push(m?.acceleration ?? 1);
    }
    const latestTrend = latest.method_trends.find(t => t.family === family);
    families.push({
      family,
      dates,
      shares,
      counts,
      accels,
      latest: {
        share:   getShare(latestTrend, latest.total_papers_scanned),
        count:   latestTrend?.count_7d ?? 0,
        accel:   latestTrend?.acceleration ?? 1,
        accel14d: latestTrend?.acceleration_14d ?? latestTrend?.acceleration ?? 1,
        status:  latestTrend?.status ?? 'stable',
        isNew:   latestTrend?.status === 'new_family',
      },
      delta: (shares[shares.length - 1] ?? 0) - (shares[0] ?? 0),
    });
  }

  // Sort by latest share descending
  families.sort((a, b) => b.latest.share - a.latest.share);

  // data_confidence may be missing on older files; fall back to 'low'
  const confidence = (latest as any).data_confidence ?? 'low';

  return {
    families,
    dates,
    latestDate:  latest.date,
    totalPapers: latest.total_papers_scanned,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Atlas types and loader
// ---------------------------------------------------------------------------

export interface AtlasPaper {
  n:  string;          // short name
  t:  string;          // full title
  ax?: string;         // arxiv ID
  v?: string;          // venue
  c?: string;          // code URL
  w?: string;          // website URL
  f?: number;          // featured flag (1 = featured)
  o?: string;          // one-line Chinese description
  isNew?: boolean;     // auto-injected recent paper
}

export interface AtlasSub {
  id:    string;
  label: string;
  papers:       AtlasPaper[];
  recentPapers?: AtlasPaper[];
}

export interface AtlasCategory {
  id:       string;
  label:    string;
  labelZh:  string;
  icon:     string;
  momentum: number | null;
  desc:     string;
  subs:     AtlasSub[];
}

export interface AtlasStats {
  total:    number;
  featured: number;
  code:     number;
  cats:     number;
}

export interface AtlasData {
  categories: AtlasCategory[];
  stats?:     AtlasStats;
  momentum?:  Record<string, number>;
  updated?:   string;
}

// ---------------------------------------------------------------------------
// Emerging Terms types and loader
// ---------------------------------------------------------------------------

export interface EmergingTerm {
  term:          string;
  normalized:    string;
  first_seen:    string;
  last_seen:     string;
  daily_counts:  Record<string, number>;
  total_count:   number;
  days_active:   number;
  velocity:      number;
  acceleration:  number;
  status:        'new' | 'rising' | 'candidate' | 'promoted' | string;
  sample_titles: string[];
  llm_verified:  boolean | null;
  llm_verdict:   string | null;
}

export interface EmergingTermsData {
  date:                 string;
  window_days:          number;
  total_papers_scanned: number;
  unmatched_papers:     number;
  candidates:           EmergingTerm[];
  promoted:             EmergingTerm[];
  archive:              EmergingTerm[];
  stats: {
    total_ngrams_extracted: number;
    after_stopword_filter:  number;
    candidates_count:       number;
    promoted_count:         number;
  };
  updated_at: string;
}

/**
 * Load emerging terms data for the VLA deep dive page.
 */
export function loadEmergingTerms(): EmergingTermsData | null {
  return readJson<EmergingTermsData>('emerging-terms.json');
}

/**
 * Load Paper Atlas data.
 * Prefers the auto-generated atlas-papers.json (with momentum + recentPapers).
 * Falls back to atlas-curated.json (static curated data) if the generated file is missing.
 */
export function loadAtlasData(): AtlasData | null {
  // Try generated file first
  const generated = readJson<AtlasData>('atlas-papers.json');
  if (generated?.categories) return generated;

  // Fallback to curated base
  const curated = readJson<{ categories: AtlasCategory[] }>('atlas-curated.json');
  if (!curated?.categories) return null;

  // Compute stats from curated data
  const flat = curated.categories.flatMap(c => c.subs.flatMap(s => s.papers));
  return {
    categories: curated.categories,
    stats: {
      total:    flat.length,
      featured: flat.filter(p => p.f).length,
      code:     flat.filter(p => p.c).length,
      cats:     curated.categories.length,
    },
  };
}
