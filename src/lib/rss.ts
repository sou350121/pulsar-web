/**
 * src/lib/rss.ts
 * RSS 2.0 XML feed generator.
 * Keeps feeds lightweight: title + snippet + link + date.
 * Readers click through to GitHub / pulsar-web for full content — this gives us:
 *   1. Pageview stats for what resonates
 *   2. SEO benefit (readers land on canonical URLs)
 *   3. Smaller XML files → lower bandwidth
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

export const rssHeaders = {
  'Content-Type': 'application/rss+xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600',
};
