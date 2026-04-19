import type { APIRoute } from 'astro';
import { renderRss, rssHeaders } from '../../lib/rss';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/weekly.xml`;
const GITHUB_VLA = 'https://github.com/sou350121/VLA-Handbook/blob/main/memory/reports';
const GITHUB_AP = 'https://github.com/sou350121/Agent-Playbook/blob/main/memory/reports';

function resolveDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(__dirname, '../../data');
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    /* ignore */
  }
  return path.resolve(process.cwd(), 'src/data');
}

interface WeeklyEntry {
  filename: string;
  date: string;
  kind: 'vla-weekly' | 'ai-weekly' | 'vla-biweekly' | 'ai-biweekly' | 'biweekly-reflection';
  title: string;
  firstPara: string;
}

function classify(name: string): Omit<WeeklyEntry, 'filename' | 'firstPara'> | null {
  // Patterns:
  // _weekly_YYYY-MM-DD.md         → vla-weekly
  // _ai_weekly_YYYY-MM-DD.md      → ai-weekly
  // _biweekly_YYYY-MM-DD.md       → vla-biweekly
  // _ai_biweekly_YYYY-MM-DD.md    → ai-biweekly
  // _biweekly_reflection_YYYY-MM-DD.md → reflection
  const m = name.match(/^_(?:(ai)_)?(biweekly)(?:_(reflection))?_(\d{4}-\d{2}-\d{2})\.md$/);
  if (m) {
    const ai = !!m[1];
    const reflection = !!m[3];
    const date = m[4];
    if (reflection) {
      return { date, kind: 'biweekly-reflection', title: `双周反思 · ${date}` };
    }
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
  // Strip leading YAML / headings, take first non-empty > 40 char paragraph
  const lines = raw.split('\n');
  const paras: string[] = [];
  let buf: string[] = [];
  for (const ln of lines) {
    if (ln.trim() === '') {
      if (buf.length) paras.push(buf.join(' ').trim());
      buf = [];
    } else {
      buf.push(ln);
    }
  }
  if (buf.length) paras.push(buf.join(' ').trim());
  for (const p of paras) {
    const clean = p
      .replace(/^#+\s*/, '')
      .replace(/^>\s*/, '')
      .replace(/`/g, '')
      .trim();
    if (clean.length > 40 && !clean.startsWith('---')) {
      return clean.slice(0, 400);
    }
  }
  return '';
}

function buildEntries(): WeeklyEntry[] {
  const dir = resolveDataDir();
  const all = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f.startsWith('_'));
  const entries: WeeklyEntry[] = [];
  for (const f of all) {
    const meta = classify(f);
    if (!meta) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    entries.push({
      filename: f,
      ...meta,
      firstPara: firstMeaningfulPara(raw),
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export const GET: APIRoute = async () => {
  const entries = buildEntries().slice(0, 40);

  const items = entries.map((e) => {
    const isAi = e.kind.startsWith('ai') || e.kind === 'biweekly-reflection' && e.filename.includes('ai');
    const base = isAi ? GITHUB_AP : GITHUB_VLA;
    const link = `${base}/${e.filename.replace(/^_/, '')}`;
    return {
      title: e.title,
      link,
      guid: `weekly:${e.filename}`,
      pubDate: new Date(e.date),
      categories: [e.kind],
      description: e.firstPara || '查看 GitHub 上的完整周/双周报告。',
    };
  });

  const xml = renderRss({
    title: 'Pulsar 照見 · 週/雙週深度報告',
    link: `${SITE}/reports`,
    feedSelfLink: FEED_URL,
    description:
      'VLA + AI 周/双周深度分析。周报 = 前瞻侦察（意外/可证伪命题/观察清单）；双周报 = 回顾分析（趋势/洞察/预测）。',
    language: 'zh-CN',
    ttl: 180, // weekly doesn't need to be polled hourly
    items,
  });

  return new Response(xml, { headers: rssHeaders });
};
