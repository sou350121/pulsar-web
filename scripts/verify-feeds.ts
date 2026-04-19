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

// NOTE: we deliberately don't fetch-check link reachability in CI.
// External 404s (e.g. arxiv down, GitHub rate-limit) would cause flaky builds.
// Stale path issues (e.g. VLA-Handbook reorg) are a pipeline-data concern,
// tracked upstream.

// -------------------------------------------------------------------------

const results = FEEDS.map(checkFeed);
const failed = results.filter((r) => !r.ok);

console.log('\n🔍 RSS Feed Verification\n' + '─'.repeat(50));
for (const r of results) {
  const icon = r.ok ? '✓' : '✗';
  console.log(`${icon} ${r.name.padEnd(14)} ${r.bytes.toString().padStart(7)}B  ${r.items.toString().padStart(4)} items`);
  if (r.errors.length > 0) {
    for (const err of r.errors) console.log(`    ⛔ ${err}`);
  }
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
