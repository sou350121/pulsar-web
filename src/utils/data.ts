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

// Resolve the src/data directory relative to this file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.resolve(__dirname, '../data');

// ---------------------------------------------------------------------------
// Type definitions matching the pipeline's JSON schemas
// ---------------------------------------------------------------------------

export interface DailyPickItem {
  title:   string;
  url:     string;
  summary: string;
  rating:  '⚡' | '🔧' | '📖' | '❌' | string;
  source:  string;
  // domain may be absent in older files — treat as 'ai' by default
  domain?: 'ai' | 'vla' | string;
}

export interface DailyPickDay {
  date:  string;           // 'YYYY-MM-DD'
  items: DailyPickItem[];
}

export interface AIDailyPickFile {
  daily_picks: DailyPickDay[];
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

// ---------------------------------------------------------------------------
// loadAIDailyPicks
// Returns the N most recent daily-pick days from ai-daily-pick.json.
// Falls back to empty array if the file is missing (pre-first-sync).
// ---------------------------------------------------------------------------
export function loadAIDailyPicks(n: number = 7): DailyPickDay[] {
  const data = readJson<AIDailyPickFile>('ai-daily-pick.json');
  if (!data?.daily_picks) return [];
  // Sort descending by date and take N
  return [...data.daily_picks]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, n);
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
