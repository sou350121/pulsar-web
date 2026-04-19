/**
 * src/lib/rss.ts
 * ──────────────
 * RSS 2.0 XML feed generator + validation + graceful degradation.
 *
 * Resilience strategy (Tier 1 defense against pipeline schema drift):
 *   1. validateItem(): reject malformed items at ingest, don't let them poison feed
 *   2. safeBuildFeed(): catch data-source crashes, return feed with "unavailable"
 *      placeholder item so subscribers know we know (better than silent empty)
 *   3. scripts/verify-feeds.ts (build step): fail CI if XML is missing/tiny/broken
 *
 * Philosophy: fail loud at build (CI red), fail safe at runtime (graceful fallback).
 */

export interface FeedItem {
  title: string;
  link: string;
  guid: string;               // stable unique id
  pubDate: Date;
  description?: string;       // plain-text snippet (≤ 400 chars ideal)
  categories?: string[];
  author?: string;
}

export interface FeedChannel {
  title: string;
  link: string;               // canonical page for the feed
  description: string;
  language?: string;          // e.g. "zh-CN"
  ttl?: number;               // minutes between recommended polls
  items: FeedItem[];
  feedSelfLink: string;       // absolute URL of this feed
}

// ---------------------------------------------------------------------------
// Validation — reject items that would produce garbage XML
// ---------------------------------------------------------------------------

export interface RawItemInput {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  pubDate?: unknown;          // accepts Date | string | number
  description?: unknown;
  categories?: unknown;
  author?: unknown;
}

/**
 * Append UTM params to outbound links so we can attribute traffic to feed
 * when/if we add analytics later. Deliberately standard utm_* so any
 * destination that tracks referrers (Umami / Plausible / GA) can segment.
 *
 * Skips links that already have query params (avoid double-?), and skips
 * arxiv / doi permalinks where UTM is noise.
 */
export function withUtm(url: string, campaign: string): string {
  if (!url || typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    // Don't touch permalink-like targets that already have state
    if (u.hostname === 'arxiv.org' || u.hostname === 'doi.org') return url;
    u.searchParams.set('utm_source', 'rss');
    u.searchParams.set('utm_medium', 'feed');
    u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    return url; // malformed URL — let validator catch it
  }
}

/**
 * Validate and coerce a raw item. Returns null if any required field is bad.
 * Required: title (non-empty string), link (http[s]://...), pubDate (valid Date).
 */
export function validateItem(raw: RawItemInput): FeedItem | null {
  if (!raw || typeof raw !== 'object') return null;

  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
  if (typeof raw.link !== 'string' || !/^https?:\/\//.test(raw.link)) return null;

  let pubDate: Date;
  if (raw.pubDate instanceof Date) {
    pubDate = raw.pubDate;
  } else if (typeof raw.pubDate === 'string' || typeof raw.pubDate === 'number') {
    pubDate = new Date(raw.pubDate);
  } else {
    return null;
  }
  if (isNaN(pubDate.getTime())) return null;

  const guid =
    typeof raw.guid === 'string' && raw.guid.length > 0 ? raw.guid : raw.link;

  const item: FeedItem = {
    title: raw.title.trim().slice(0, 500),
    link: raw.link,
    guid: String(guid),
    pubDate,
  };
  if (typeof raw.description === 'string' && raw.description.length > 0) {
    item.description = raw.description.slice(0, 2000);
  }
  if (Array.isArray(raw.categories)) {
    item.categories = raw.categories.filter((c): c is string => typeof c === 'string' && c.length > 0);
  }
  if (typeof raw.author === 'string' && raw.author.length > 0) {
    item.author = raw.author;
  }
  return item;
}

/**
 * Validate a batch; returns {valid items, count of rejected}.
 */
export function validateBatch(inputs: RawItemInput[]): { items: FeedItem[]; rejected: number } {
  const items: FeedItem[] = [];
  let rejected = 0;
  for (const raw of inputs) {
    const item = validateItem(raw);
    if (item) items.push(item);
    else rejected++;
  }
  return { items, rejected };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rfc822(d: Date): string {
  return d.toUTCString();
}

export function renderRss(ch: FeedChannel): string {
  const lang = ch.language || 'zh-CN';
  const ttl = ch.ttl ?? 60;
  const lastBuild = rfc822(new Date());

  const items = ch.items
    .map((it) => {
      const cats = (it.categories || [])
        .map((c) => `    <category>${escapeXml(c)}</category>`)
        .join('\n');
      const desc = it.description
        ? `    <description><![CDATA[${it.description}]]></description>`
        : '';
      const author = it.author ? `    <dc:creator>${escapeXml(it.author)}</dc:creator>` : '';
      return `  <item>
    <title>${escapeXml(it.title)}</title>
    <link>${escapeXml(it.link)}</link>
    <guid isPermaLink="false">${escapeXml(it.guid)}</guid>
    <pubDate>${rfc822(it.pubDate)}</pubDate>
${author}
${cats}
${desc}
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>${escapeXml(ch.title)}</title>
  <link>${escapeXml(ch.link)}</link>
  <atom:link href="${escapeXml(ch.feedSelfLink)}" rel="self" type="application/rss+xml" />
  <description>${escapeXml(ch.description)}</description>
  <language>${lang}</language>
  <ttl>${ttl}</ttl>
  <lastBuildDate>${lastBuild}</lastBuildDate>
  <generator>Pulsar 照見 · https://github.com/sou350121/pulsar-web</generator>
  <copyright>Content under CC BY 4.0 — sou350121</copyright>
${items}
</channel>
</rss>`;
}

// ---------------------------------------------------------------------------
// Graceful degradation wrapper
// ---------------------------------------------------------------------------

/**
 * Build a feed with 3 safety nets:
 *   1. If loader() throws, emit a placeholder "temporarily unavailable" item
 *      instead of crashing the entire Astro build.
 *   2. All items pass through validateItem() — malformed items get skipped.
 *   3. If no items survive validation, emit placeholder + log warning.
 *
 * CI build logs will show [RSS <name>] warnings; verify-feeds.ts will fail
 * deployment if feeds fall below minimum thresholds.
 */
export function safeBuildFeed(
  name: string,
  channelMeta: Omit<FeedChannel, 'items'>,
  loader: () => RawItemInput[],
): string {
  let items: FeedItem[] = [];
  try {
    const raw = loader();
    if (!Array.isArray(raw)) {
      throw new Error(`loader returned non-array (got ${typeof raw})`);
    }
    const { items: valid, rejected } = validateBatch(raw);
    items = valid;
    if (rejected > 0) {
      console.warn(`[RSS ${name}] skipped ${rejected}/${raw.length} invalid items — check schema`);
    }
  } catch (err) {
    console.error(`[RSS ${name}] loader crashed:`, err);
    items = [];
  }

  if (items.length === 0) {
    // No valid items — emit placeholder so subscribers see "we know".
    // Better than empty feed (looks like abandoned project).
    console.warn(`[RSS ${name}] 0 valid items — emitting placeholder`);
    items = [
      {
        title: `⚠️ ${channelMeta.title} · feed temporarily unavailable`,
        link: channelMeta.link,
        guid: `placeholder:${name}:${new Date().toISOString().slice(0, 10)}`,
        pubDate: new Date(),
        description:
          'This feed is being restored. Check the main site for latest content. — Pulsar 照見',
      },
    ];
  }

  return renderRss({ ...channelMeta, items });
}

export const rssHeaders = {
  'Content-Type': 'application/rss+xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
};

// ---------------------------------------------------------------------------
// Defensive data-file loading — fs-based so build doesn't crash if JSON missing
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

/**
 * Read JSON from src/data/, throwing descriptive errors for common failures.
 * Use inside safeBuildFeed() loader — errors are caught and degrade gracefully.
 */
export function readDataJson<T = unknown>(relPath: string): T {
  const resolved = path.resolve(process.cwd(), 'src/data', relPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`data file missing: ${relPath}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  if (raw.trim().length === 0) {
    throw new Error(`data file empty: ${relPath}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`data file malformed JSON: ${relPath} — ${(e as Error).message}`);
  }
}

/**
 * Read src/data/ directory entries matching predicate. Throws if dir missing.
 */
export function listDataFiles(predicate: (name: string) => boolean): string[] {
  const dir = path.resolve(process.cwd(), 'src/data');
  if (!fs.existsSync(dir)) throw new Error('src/data directory missing');
  return fs.readdirSync(dir).filter(predicate);
}

export function readDataFile(relPath: string): string {
  const resolved = path.resolve(process.cwd(), 'src/data', relPath);
  if (!fs.existsSync(resolved)) throw new Error(`data file missing: ${relPath}`);
  return fs.readFileSync(resolved, 'utf8');
}
