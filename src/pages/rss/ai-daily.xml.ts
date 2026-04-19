import type { APIRoute } from 'astro';
import { renderRss, rssHeaders } from '../../lib/rss';
import aiDailyPick from '../../data/ai-daily-pick.json';
import aiDeepDive from '../../data/ai-app-deep-dive-articles.json';

interface DailyItem {
  title: string;
  category?: string;
  source?: string;
  url: string;
  why_picked?: string;
  so_what?: string;
}

interface DailyRecord {
  date: string;
  items: DailyItem[];
}

interface DeepDiveArticle {
  date: string;
  title: string;
  url?: string;
  slug?: string;
  github_path?: string;
  html_url?: string;
  source?: string;
  signal_type?: string;
  quality_warnings?: string[];
}

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/ai-daily.xml`;

export const GET: APIRoute = async () => {
  const picks = ((aiDailyPick as { daily_picks?: DailyRecord[] }).daily_picks) || [];
  const deepDives =
    ((aiDeepDive as { deep_dive_articles?: DeepDiveArticle[] }).deep_dive_articles) || [];

  // Daily picks: flatten last 14 days × items
  const pickItems = picks
    .filter((d) => d.date && Array.isArray(d.items))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14)
    .flatMap((rec) =>
      rec.items.map((it, idx) => ({
        title: `⭐ ${it.title}`,
        link: it.url,
        guid: `pick:${rec.date}:${idx}:${it.url}`,
        pubDate: new Date(rec.date),
        categories: ['AI 每日精选', it.category, it.source].filter(Boolean) as string[],
        description: [
          it.why_picked ? `为什么选：${it.why_picked}` : '',
          it.so_what ? `\nSo What：${it.so_what}` : '',
          it.source ? `\n来源：${it.source}` : '',
        ]
          .filter(Boolean)
          .join(''),
      })),
    );

  // Deep-dive articles
  const deepItems = deepDives
    .filter((a) => a.date && a.title && (a.html_url || a.url))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
    .map((a) => ({
      title: `📘 ${a.title}`,
      link: (a.html_url || a.url) as string,
      guid: `ai-deep:${a.slug || a.github_path || a.html_url || a.url}`,
      pubDate: new Date(a.date),
      categories: ['AI 深度解读', a.signal_type].filter(Boolean) as string[],
      description: [
        `信号类型：${a.signal_type || 'deep-dive'}`,
        a.source ? `来源：${a.source}` : '',
        a.quality_warnings?.length ? `⚠️ 质量提示：${a.quality_warnings.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }));

  const items = [...pickItems, ...deepItems]
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 60);

  const xml = renderRss({
    title: 'Pulsar 照見 · AI 每日',
    link: `${SITE}/ai-deepdive`,
    feedSelfLink: FEED_URL,
    description:
      'AI Agent 生态每日精选 + 深度解读文章。从 28 个源 + 21 个 GitHub repo 提纯；Pulsar 照见每日 08:00-17:00 自动产出。',
    language: 'zh-CN',
    ttl: 60,
    items,
  });

  return new Response(xml, { headers: rssHeaders });
};
