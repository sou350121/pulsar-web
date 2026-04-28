#!/usr/bin/env node
/**
 * scripts/verify-feeds.ts
 * ────────────────────────
 * Post-build CI smoke test for RSS feeds.
 *
 * Runs after `astro build`. Fails (exit 1) if any feed is:
 *   - missing
 *   - too small (likely empty / placeholder-only after schema break)
 *   - missing required XML elements
 *   - has items missing <title> or <link>
 *
 * Philosophy: fail LOUD at build, so schema drift in pipeline data never
 * reaches subscribers silently.
 */
import fs from 'node:fs';
import path from 'node:path';

interface FeedSpec {
  name: string;
  file: string;
  minBytes: number;
  minItems: number;
  // Some feeds may tolerate placeholder mode (1 item saying "unavailable")
  // but we want CI red even for placeholder, so subscribers never actually see it.
  allowPlaceholder: boolean;
}

const FEEDS: FeedSpec[] = [
  { name: 'vla-theory', file: 'dist/rss/vla-theory.xml', minBytes: 1500, minItems: 5, allowPlaceholder: false },
  { name: 'vla-daily',  file: 'dist/rss/vla-daily.xml',  minBytes: 1500, minItems: 5, allowPlaceholder: false },
  { name: 'ai-daily',   file: 'dist/rss/ai-daily.xml',   minBytes: 1500, minItems: 5, allowPlaceholder: false },
  { name: 'weekly',     file: 'dist/rss/weekly.xml',     minBytes: 1500, minItems: 3, allowPlaceholder: false },
  { name: 'opml',       file: 'dist/rss/opml.xml',       minBytes: 500,  minItems: 0, allowPlaceholder: true },
];

interface CheckResult {
  name: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  bytes: number;
  items: number;
}

function checkFeed(spec: FeedSpec): CheckResult {
  const r: CheckResult = { name: spec.name, ok: true, errors: [], warnings: [], bytes: 0, items: 0 };

  const full = path.resolve(spec.file);
  if (!fs.existsSync(full)) {
    r.errors.push(`file missing: ${spec.file}`);
    r.ok = false;
    return r;
  }

  const xml = fs.readFileSync(full, 'utf8');
  r.bytes = xml.length;

  if (xml.length < spec.minBytes) {
    r.errors.push(`too small: ${xml.length}B < ${spec.minBytes}B threshold`);
    r.ok = false;
  }

  // Basic XML well-formedness (light check; full parse would need xmldom)
  if (!xml.trim().startsWith('<?xml')) r.errors.push('missing XML declaration');
  if (!xml.includes('</rss>') && !xml.includes('</opml>')) r.errors.push('missing root closing tag');

  // Item count (feed-specific)
  const itemMatches = xml.match(/<item>/g);
  r.items = itemMatches ? itemMatches.length : 0;
  if (spec.minItems > 0 && r.items < spec.minItems) {
    r.errors.push(`too few items: ${r.items} < ${spec.minItems}`);
    r.ok = false;
  }

  // Placeholder detection
  const hasPlaceholder = xml.includes('feed temporarily unavailable') || xml.includes('being restored');
  if (hasPlaceholder && !spec.allowPlaceholder) {
    r.errors.push('feed is in placeholder state — upstream data source broken');
    r.ok = false;
  }

  // Required per-item fields for RSS feeds
  if (spec.minItems > 0) {
    // Crude but fast: count titles/links within items
    const itemBlocks = xml.split('<item>').slice(1).map((b) => b.split('</item>')[0]);
    itemBlocks.forEach((block, i) => {
      if (!block.includes('<title>')) r.warnings.push(`item ${i}: missing <title>`);
      if (!block.includes('<link>')) r.warnings.push(`item ${i}: missing <link>`);
      if (!block.includes('<guid')) r.warnings.push(`item ${i}: missing <guid>`);
    });
    if (r.warnings.length > 0) {
      r.errors.push(`${r.warnings.length} items failed field check (first: ${r.warnings[0]})`);
      r.ok = false;
    }
  }

  return r;
}

/**
 * Sample N item <link> URLs, HEAD-check each. Returns 404s as warnings.
 * Intentionally does NOT fail the build — network is flaky and a transient
 * 404 shouldn't block deployment. Warning is enough for human triage.
 *
 * Respects env var SKIP_LINK_CHECK=1 for offline CI / dev.
 */
async function sampleLinkHealth(spec: FeedSpec, xml: string, sample: number): Promise<string[]> {
  if (process.env.SKIP_LINK_CHECK === '1') return [];
  if (spec.minItems === 0) return []; // OPML etc. — no item links

  // Pick N random item links (not channel self-link)
  const matches = [...xml.matchAll(/<item>[\s\S]*?<link>(https?:\/\/[^<]+)<\/link>/g)];
  // Unescape XML entities back into real URL
  const urls = matches.map((m) =>
    m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'"),
  );
  if (urls.length === 0) return [];

  // Uniform random sample — seeded by feed name for reproducibility in logs
  const picks: string[] = [];
  const step = Math.max(1, Math.floor(urls.length / sample));
  for (let i = 0; i < urls.length && picks.length < sample; i += step) picks.push(urls[i]);

  const warnings: string[] = [];
  await Promise.all(
    picks.map(async (url) => {
      try {
        const controller = new AbortController();
        const to = setTimeout(() => controller.abort(), 5000);
        // GET not HEAD — many sites (news, Cloudflare) block HEAD and return
        // false 403/404. Browser UA avoids anti-bot false positives.
        const r = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Pulsar-FeedVerify; +https://sou350121.github.io/pulsar-web)' },
        });
        clearTimeout(to);
        if (r.status === 404) warnings.push(`404: ${url}`);
        else if (r.status >= 500) warnings.push(`${r.status}: ${url}`);
      } catch (e) {
        // Network/timeout — don't treat as failure (not our problem)
      }
    }),
  );
  return warnings;
}

// -------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Extra health: scan recent VLA rating files for parse-failure regressions
// If >30% of a day's papers are parse-failures, the pipeline had a bad day.
// This is a WARNING only (not fail build) — helps catch silent regressions
// like 2026-04-15 (30/30 fails) and 2026-04-21 (17/17 fails).
// ---------------------------------------------------------------------------
function checkRecentRatingHealth(): string[] {
  const warnings: string[] = [];
  const dataDir = path.resolve('src/data');
  if (!fs.existsSync(dataDir)) return warnings;

  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.startsWith('vla-daily-rating-out-') && f.endsWith('.json'))
    .sort();

  const recent7 = files.slice(-7);
  const recent14 = files.slice(-14);

  // Check 1: parse-failure regression (each file)
  for (const f of recent7) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      const papers = data.papers || [];
      if (papers.length === 0) continue;
      const fails = papers.filter((p: any) =>
        /^解析失败[，,]?\s*默认存档?$/.test((p.reason || '').trim()),
      ).length;
      const ratio = fails / papers.length;
      if (ratio > 0.3) {
        const date = f.replace('vla-daily-rating-out-', '').replace('.json', '');
        warnings.push(
          `${date}: ${fails}/${papers.length} (${(ratio * 100).toFixed(0)}%) parse-failures → pipeline regression`,
        );
      }
    } catch {
      /* skip */
    }
  }

  // Check 2: ⚡ drought — calibration may be drifting strict if <3 ⚡ in 14 days
  let flashTotal = 0;
  let validDays = 0;
  for (const f of recent14) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      const papers = data.papers || [];
      if (papers.length < 3) continue;
      const fails = papers.filter((p: any) =>
        /^解析失败[，,]?\s*默认存档?$/.test((p.reason || '').trim()),
      ).length;
      if (fails / papers.length > 0.5) continue;
      validDays++;
      flashTotal += papers.filter((p: any) => p.rating === '⚡').length;
    } catch {
      /* skip */
    }
  }
  if (validDays >= 7 && flashTotal < 3) {
    warnings.push(
      `⚡ drought: only ${flashTotal} ⚡ papers in last ${validDays} valid days → possible calibration drift (rater too strict)`,
    );
  }

  // Check 3: weekly/biweekly stub files (pipeline LLM-fail produces ~50B placeholder)
  // Scan recent 14 weekly + biweekly files; warn if any < 200 bytes
  try {
    const allMd = fs
      .readdirSync(dataDir)
      .filter((f) => /^_(?:ai_)?(?:weekly|biweekly)/.test(f) && f.endsWith('.md'))
      .sort()
      .slice(-14);
    for (const f of allMd) {
      const stat = fs.statSync(path.join(dataDir, f));
      if (stat.size < 200) {
        warnings.push(`${f}: only ${stat.size}B → pipeline stub (LLM call likely failed)`);
      }
    }
  } catch { /* skip */ }

  // Check 4: consecutive ⚡-zero days at the end (recent drift signal)
  let consecutiveZero = 0;
  for (let i = recent14.length - 1; i >= 0; i--) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dataDir, recent14[i]), 'utf8'));
      const papers = data.papers || [];
      if (papers.length < 3) continue;
      const fails = papers.filter((p: any) =>
        /^解析失败[，,]?\s*默认存档?$/.test((p.reason || '').trim()),
      ).length;
      if (fails / papers.length > 0.5) continue;
      const flash = papers.filter((p: any) => p.rating === '⚡').length;
      if (flash === 0) consecutiveZero++;
      else break;
    } catch {
      break;
    }
  }
  if (consecutiveZero >= 4) {
    warnings.push(
      `⚡ recent streak: ${consecutiveZero} consecutive days with 0 ⚡ → watch for calibration drift`,
    );
  }

  return warnings;
}

const results = FEEDS.map(checkFeed);
const failed = results.filter((r) => !r.ok);
const ratingWarnings = checkRecentRatingHealth();

// Sample link health — warning only, doesn't fail build
console.log('\n🔍 RSS Feed Verification\n' + '─'.repeat(50));
const linkWarnings: Record<string, string[]> = {};
for (const spec of FEEDS) {
  if (spec.minItems === 0) continue;
  try {
    const xml = fs.readFileSync(path.resolve(spec.file), 'utf8');
    const warns = await sampleLinkHealth(spec, xml, 3);
    if (warns.length > 0) linkWarnings[spec.name] = warns;
  } catch { /* file missing already reported */ }
}

for (const r of results) {
  const icon = r.ok ? '✓' : '✗';
  console.log(`${icon} ${r.name.padEnd(14)} ${r.bytes.toString().padStart(7)}B  ${r.items.toString().padStart(4)} items`);
  if (r.errors.length > 0) {
    for (const err of r.errors) console.log(`    ⛔ ${err}`);
  }
  if (linkWarnings[r.name]?.length) {
    for (const w of linkWarnings[r.name]) console.log(`    ⚠️  ${w}`);
  }
}

// VLA rating quality warnings (upstream pipeline health)
if (ratingWarnings.length > 0) {
  console.log('\n⚠️  Upstream rating pipeline warnings:');
  for (const w of ratingWarnings) console.log(`    ⚠️  ${w}`);
}
console.log('─'.repeat(50));

if (failed.length > 0) {
  console.error(`\n❌ ${failed.length}/${results.length} feeds FAILED validation.`);
  console.error('   → CI build should be treated as RED.');
  console.error('   → Check data source (src/data/*.json) for schema drift.\n');
  process.exit(1);
}

console.log(`\n✅ All ${results.length} feeds pass validation.\n`);
process.exit(0);
