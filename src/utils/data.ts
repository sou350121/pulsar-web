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
  type:    string;  // 'lab' | 'method' | 'benchmark' | 'org'
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
  keyword: string;
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
): Array<{ date: string; content: string; filename: string; isReflection: boolean }> {
  const prefix = reflections ? '_biweekly_reflection_' : '_biweekly_';
  const files  = listMdFiles(prefix).slice(0, n);

  return files.map(filename => {
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    const date      = dateMatch?.[1] ?? 'unknown';
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, filename), 'utf-8');
      return { date, content, filename, isReflection: reflections };
    } catch {
      return { date, content: '', filename, isReflection: reflections };
    }
  });
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
  rule_id:          string;
  label:            string;
  source_domain:    string;
  target_domain:    string;
  title:            string;
  url:              string;
  rating:           string;
  matched_keywords: string[];
  abstract:         string;
  date:             string;
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
  family:       string;
  count_7d:     number;
  count_14d:    number;
  share_7d:     number;
  acceleration: number;
  status:       string;
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
