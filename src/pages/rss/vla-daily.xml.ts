import type { APIRoute } from 'astro';
import { renderRss, rssHeaders } from '../../lib/rss';
import hotspots from '../../data/vla-daily-hotspots.json';
import sotaData from '../../data/vla-sota-tracker.json';

interface HotspotPaper {
  title: string;
  date: string;
  url: string;
  source: string;
  tag?: string;
  repo_url?: string;
  abstract_snippet?: string;
  rating?: string;
  reason?: string;
  affiliation?: string;
}

interface SotaEntry {
  benchmark: string;
  split?: string;
  metric: string;
  value: string | number;
  model: string;
  paper_id?: string;
  date: string;
  source?: string;
  leaderboard_url?: string;
}

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/vla-daily.xml`;

export const GET: APIRoute = async () => {
  const papers = ((hotspots as { reported_papers?: HotspotPaper[] }).reported_papers) || [];
  const sotas = ((sotaData as { 'vla-sota-tracker'?: SotaEntry[] })['vla-sota-tracker']) || [];

  // ⚡ and 🔧 rated papers only — ❌ and 📖 are too noisy for a daily feed
  const curatedPapers = papers
    .filter((p) => p.date && p.title && (p.rating === '⚡' || p.rating === '🔧'))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)
    .map((p) => ({
      title: `${p.rating || ''} ${p.title}`.trim(),
      link: p.url,
      guid: `hotspot:${p.url}`,
      pubDate: new Date(p.date),
      categories: ['VLA 每日热点', p.tag, p.affiliation].filter(Boolean) as string[],
      description: [
        p.reason ? `理由：${p.reason}` : '',
        p.abstract_snippet ? `摘要：${p.abstract_snippet}` : '',
        p.repo_url ? `代码：${p.repo_url}` : '',
        `来源：${p.source}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    }));

  const recentSota = sotas
    .filter((s) => s.date && s.benchmark && s.model)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15)
    .map((s) => ({
      title: `🏆 SOTA: ${s.model} on ${s.benchmark} — ${s.metric} ${s.value}`,
      link: s.leaderboard_url || s.source || `${SITE}/vla-deepdive`,
      guid: `sota:${s.benchmark}:${s.model}:${s.date}`,
      pubDate: new Date(s.date),
      categories: ['SOTA 榜', s.benchmark].filter(Boolean) as string[],
      description: `Benchmark：${s.benchmark}${s.split ? ` · split=${s.split}` : ''}\n指标：${s.metric} = ${s.value}\n模型：${s.model}${s.paper_id ? ` · ${s.paper_id}` : ''}`,
    }));

  const items = [...curatedPapers, ...recentSota]
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 50);

  const xml = renderRss({
    title: 'Pulsar 照見 · VLA 每日信号',
    link: `${SITE}/daily`,
    feedSelfLink: FEED_URL,
    description:
      'VLA 每日筛选的⚡🔧级论文 + SOTA 榜变动。仅保留 Pulsar 评级认为值得读的工作 · ❌和📖不进此 feed。',
    language: 'zh-CN',
    ttl: 60,
    items,
  });

  return new Response(xml, { headers: rssHeaders });
};
