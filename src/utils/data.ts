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
  title:   string;
  url:     string;
  summary: string;
  rating:  '⚡' | '🔧' | '📖' | '❌' | string;
  source:  string;
  domain:  'ai' | 'vla' | string;
}

export interface DailyPickDay {
  date:  string;           // 'YYYY-MM-DD'
  items: DailyPickItem[];
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
}

interface VLARatingFile {
  ok:      boolean;
  papers:  VLARatingRaw[];
}

// Drift metrics — keyed by date string
export interface DriftMetricsFile {
  // date → domain → metric → number
  [date: string]: {
    vla?:    Record<string, number>;
    ai_app?: Record<string, number>;
  };
}

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
      items: papers
        .filter(p => p.rating !== '❌')   // skip low-relevance by default
        .map((raw): DailyPickItem => ({
          title:   raw.title            ?? '',
          url:     raw.url              ?? '#',
          summary: raw.reason           || raw.abstract_snippet || '',
          rating:  raw.rating           ?? '📖',
          source:  raw.source           ?? 'arxiv',
          domain:  'vla',
        })),
    };
  }).filter(day => day.items.length > 0);
}

// ---------------------------------------------------------------------------
// loadDriftMetrics
// Returns the full drift-metrics and drift-state objects.
// ---------------------------------------------------------------------------
export function loadDriftMetrics(): {
  metrics: DriftMetricsFile | null;
  state:   DriftStateFile   | null;
} {
  return {
    metrics: readJson<DriftMetricsFile>('drift-metrics.json'),
    state:   readJson<DriftStateFile>  ('drift-state.json'),
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
