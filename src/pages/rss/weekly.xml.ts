import type { APIRoute } from 'astro';
import {
  safeBuildFeed,
  rssHeaders,
  readDataFile,
  listDataFiles,
  type RawItemInput,
} from '../../lib/rss';

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/weekly.xml`;
const GITHUB_VLA = 'https://github.com/sou350121/VLA-Handbook/blob/main/memory/reports';
const GITHUB_AP = 'https://github.com/sou350121/Agent-Playbook/blob/main/memory/reports';

type Kind =
  | 'vla-weekly'
  | 'ai-weekly'
  | 'vla-biweekly'
  | 'ai-biweekly'
  | 'biweekly-reflection';

interface Entry {
  filename: string;
  date: string;
  kind: Kind;
  title: string;
  link: string;
}

function classify(name: string): Omit<Entry, 'filename' | 'link'> | null {
  const m = name.match(/^_(?:(ai)_)?(biweekly)(?:_(reflection))?_(\d{4}-\d{2}-\d{2})\.md$/);
  if (m) {
    const ai = !!m[1];
    const reflection = !!m[3];
    const date = m[4];
    if (reflection) return { date, kind: 'biweekly-reflection', title: `双周反思 · ${date}` };
    return {
      date,
      kind: ai ? 'ai-biweekly' : 'vla-biweekly',
      title: ai ? `AI 双周深度 · ${date}` : `VLA 双周深度 · ${date}`,
    };
  }
  const w = name.match(/^_(?:(ai)_)?weekly_(\d{4}-\d{2}-\d{2})\.md$/);
  if (w) {
    const ai = !!w[1];
    const date = w[2];
    return { date, kind: ai ? 'ai-weekly' : 'vla-weekly', title: ai ? `AI 周报 · ${date}` : `VLA 周报 · ${date}` };
  }
  return null;
}

function firstMeaningfulPara(raw: string): string {
  const lines = raw.split('\n');
  const paras: string[] = [];
  let buf: string[] = [];
  for (const ln of lines) {
    if (ln.trim() === '') {
      if (buf.length) paras.push(buf.join(' ').trim());
      buf = [];
    } else buf.push(ln);
  }
  if (buf.length) paras.push(buf.join(' ').trim());
  for (const p of paras) {
    const clean = p.replace(/^#+\s*/, '').replace(/^>\s*/, '').replace(/`/g, '').trim();
    if (clean.length > 40 && !clean.startsWith('---')) return clean.slice(0, 400);
  }
  return '';
}

export const GET: APIRoute = async () => {
  const xml = safeBuildFeed(
    'weekly',
    {
      title: 'Pulsar 照見 · 週/雙週深度報告',
      link: `${SITE}/reports`,
      feedSelfLink: FEED_URL,
      description:
        'VLA + AI 周/双周深度分析。周报 = 前瞻侦察（意外/可证伪命题/观察清单）；双周报 = 回顾分析（趋势/洞察/预测）。',
      language: 'zh-CN',
      ttl: 180,
    },
    () => {
      const files = listDataFiles((f) => f.startsWith('_') && f.endsWith('.md'));

      const entries: Array<Entry & { firstPara: string }> = [];
      for (const f of files) {
        const meta = classify(f);
        if (!meta) continue;
        const isAi = meta.kind.startsWith('ai') || (meta.kind === 'biweekly-reflection' && f.includes('ai'));
        const base = isAi ? GITHUB_AP : GITHUB_VLA;
        const link = `${base}/${f.replace(/^_/, '')}`;
        let firstPara = '';
        try {
          firstPara = firstMeaningfulPara(readDataFile(f));
        } catch (e) {
          console.warn(`[RSS weekly] could not read ${f}:`, (e as Error).message);
        }
        entries.push({ filename: f, ...meta, link, firstPara });
      }

      return entries
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40)
        .map<RawItemInput>((e) => ({
          title: e.title,
          link: e.link,
          guid: `weekly:${e.filename}`,
          pubDate: e.date,
          categories: [e.kind],
          description: e.firstPara || '查看 GitHub 上的完整周/双周报告。',
        }));
    },
  );

  return new Response(xml, { headers: rssHeaders });
};
