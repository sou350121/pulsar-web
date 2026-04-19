import type { APIRoute } from 'astro';
import { safeBuildFeed, rssHeaders, readDataJson, type RawItemInput } from '../../lib/rss';

interface DailyItem {
  title?: string;
  category?: string;
  source?: string;
  url?: string;
  why_picked?: string;
  so_what?: string;
}

interface DailyRecord {
  date?: string;
  items?: DailyItem[];
}

interface DeepDiveArticle {
  date?: string;
  title?: string;
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
  const xml = safeBuildFeed(
    'ai-daily',
    {
      title: 'Pulsar 照見 · AI 每日',
      link: `${SITE}/ai-deepdive`,
      feedSelfLink: FEED_URL,
      description:
        'AI Agent 生态每日精选 + 深度解读文章。从 28 个源 + 21 个 GitHub repo 提纯；Pulsar 照见每日 08:00-17:00 自动产出。',
      language: 'zh-CN',
      ttl: 60,
    },
    () => {
      const pickData = readDataJson<{ daily_picks?: DailyRecord[] }>('ai-daily-pick.json');
      const deepData = readDataJson<{ deep_dive_articles?: DeepDiveArticle[] }>(
        'ai-app-deep-dive-articles.json',
      );

      const picks = pickData.daily_picks || [];
      const deepDives = deepData.deep_dive_articles || [];

      const pickItems = picks
        .filter((d) => d.date && Array.isArray(d.items))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 14)
        .flatMap((rec) =>
          (rec.items || [])
            .filter((it) => it.title && it.url)
            .map<RawItemInput>((it, idx) => ({
              title: `⭐ ${it.title}`,
              link: it.url,
              guid: `pick:${rec.date}:${idx}:${it.url}`,
              pubDate: rec.date,
              categories: ['AI 每日精选', it.category, it.source].filter((x): x is string => !!x),
              description: [
                it.why_picked ? `为什么选：${it.why_picked}` : '',
                it.so_what ? `\nSo What：${it.so_what}` : '',
                it.source ? `\n来源：${it.source}` : '',
              ]
                .filter(Boolean)
                .join(''),
            })),
        );

      const deepItems = deepDives
        .filter((a) => a.date && a.title && (a.html_url || a.url))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 30)
        .map<RawItemInput>((a) => ({
          title: `📘 ${a.title}`,
          link: a.html_url || a.url,
          guid: `ai-deep:${a.slug || a.github_path || a.html_url || a.url}`,
          pubDate: a.date,
          categories: ['AI 深度解读', a.signal_type].filter((x): x is string => !!x),
          description: [
            `信号类型：${a.signal_type || 'deep-dive'}`,
            a.source ? `来源：${a.source}` : '',
            a.quality_warnings?.length ? `⚠️ 质量提示：${a.quality_warnings.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        }));

      return [...pickItems, ...deepItems];
    },
  );

  return new Response(xml, { headers: rssHeaders });
};
