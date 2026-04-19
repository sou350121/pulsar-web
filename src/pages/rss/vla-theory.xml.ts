import type { APIRoute } from 'astro';
import { renderRss, rssHeaders } from '../../lib/rss';
import vlaTheory from '../../data/vla-github-theory.json';

interface TheoryArticle {
  path: string;
  title: string;
  url: string;
  html_url: string;
  date: string;
  topic?: string;
  sha: string;
}

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/vla-theory.xml`;

export const GET: APIRoute = async () => {
  const articles = (vlaTheory.articles as TheoryArticle[]) || [];

  // Most recent first; cap at 50 for feed size
  const sorted = [...articles]
    .filter((a) => a.date && a.title && a.html_url)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 50);

  const items = sorted.map((a) => ({
    title: a.title,
    link: a.html_url,
    guid: a.sha || a.html_url,
    pubDate: new Date(a.date),
    categories: a.topic ? [a.topic] : undefined,
    description: `新 VLA 深度解读文章 · 归类：${a.topic || 'theory'} · 点击链接到 GitHub 阅读全文。`,
  }));

  const xml = renderRss({
    title: 'Pulsar 照見 · VLA 新文章',
    link: `${SITE}/vla-deepdive`,
    feedSelfLink: FEED_URL,
    description:
      'VLA-Handbook 理论章节每日新增文章 — 每日 10:00-17:00 Pulsar 照见自动生成 · 涵盖架构、扩散、世界模型、强化学习、触觉、感知、规划、基础、部署、前沿 10 个主题方向。',
    language: 'zh-CN',
    ttl: 60,
    items,
  });

  return new Response(xml, { headers: rssHeaders });
};
