import type { APIRoute } from 'astro';
import { safeBuildFeed, rssHeaders, readDataJson, withUtm, type RawItemInput } from '../../lib/rss';

interface HotspotPaper {
  title?: string;
  date?: string;
  url?: string;
  source?: string;
  tag?: string;
  repo_url?: string;
  abstract_snippet?: string;
  rating?: string;
  reason?: string;
  affiliation?: string;
}

interface SotaEntry {
  benchmark?: string;
  split?: string;
  metric?: string;
  value?: string | number;
  model?: string;
  paper_id?: string;
  date?: string;
  source?: string;
  leaderboard_url?: string;
}

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/vla-daily.xml`;

export const GET: APIRoute = async () => {
  const xml = safeBuildFeed(
    'vla-daily',
    {
      title: 'Pulsar 照見 · VLA 每日信号',
      link: `${SITE}/daily`,
      feedSelfLink: FEED_URL,
      description:
        'VLA 每日筛选的⚡🔧级论文 + SOTA 榜变动。仅保留 Pulsar 评级认为值得读的工作 · ❌和📖不进此 feed。',
      language: 'zh-CN',
      ttl: 60,
    },
    () => {
      const hotspots = readDataJson<{ reported_papers?: HotspotPaper[] }>('vla-daily-hotspots.json');
      const sotaData = readDataJson<{ 'vla-sota-tracker'?: SotaEntry[] }>('vla-sota-tracker.json');

      const papers = hotspots.reported_papers || [];
      const sotas = sotaData['vla-sota-tracker'] || [];

      // ⚡🔧 only — filters noise
      const curated = papers
        .filter((p) => p.date && p.title && p.url && (p.rating === '⚡' || p.rating === '🔧'))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 30)
        .map<RawItemInput>((p) => ({
          title: `${p.rating || ''} ${p.title}`.trim(),
          link: withUtm(p.url as string, 'vla-daily'),
          guid: `hotspot:${p.url}`,
          pubDate: p.date,
          categories: ['VLA 每日热点', p.tag, p.affiliation].filter((x): x is string => !!x),
          description: [
            p.reason ? `理由：${p.reason}` : '',
            p.abstract_snippet ? `摘要：${p.abstract_snippet}` : '',
            p.repo_url ? `代码：${p.repo_url}` : '',
            p.source ? `来源：${p.source}` : '',
          ]
            .filter(Boolean)
            .join('\n\n'),
        }));

      const recentSota = sotas
        .filter((s) => s.date && s.benchmark && s.model)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 15)
        .map<RawItemInput>((s) => {
          const rawLink = s.leaderboard_url || s.source || `${SITE}/vla-deepdive`;
          return {
            title: `🏆 SOTA: ${s.model} on ${s.benchmark} — ${s.metric} ${s.value}`,
            link: withUtm(rawLink as string, 'vla-daily-sota'),
            guid: `sota:${s.benchmark}:${s.model}:${s.date}`,
            pubDate: s.date,
            categories: ['SOTA 榜', s.benchmark].filter((x): x is string => !!x),
            description: `Benchmark：${s.benchmark}${s.split ? ` · split=${s.split}` : ''}\n指标：${s.metric} = ${s.value}\n模型：${s.model}${s.paper_id ? ` · ${s.paper_id}` : ''}`,
          };
        });

      return [...curated, ...recentSota];
    },
  );

  return new Response(xml, { headers: rssHeaders });
};
