import type { APIRoute } from 'astro';
import { safeBuildFeed, rssHeaders, readDataJson, type RawItemInput } from '../../lib/rss';

const SITE = 'https://sou350121.github.io/pulsar-web';
const FEED_URL = `${SITE}/rss/vla-theory.xml`;

interface TheoryArticle {
  path?: string;
  title?: string;
  url?: string;
  html_url?: string;
  date?: string;
  topic?: string;
  sha?: string;
}

export const GET: APIRoute = async () => {
  const xml = safeBuildFeed(
    'vla-theory',
    {
      title: 'Pulsar 照見 · VLA 新文章',
      link: `${SITE}/vla-deepdive`,
      feedSelfLink: FEED_URL,
      description:
        'VLA-Handbook 理论章节每日新增文章 — 每日 10:00-17:00 Pulsar 照见自动生成 · 涵盖架构、扩散、世界模型、强化学习、触觉、感知、规划、基础、部署、前沿 10 个主题方向。',
      language: 'zh-CN',
      ttl: 60,
    },
    () => {
      const data = readDataJson<{ articles?: TheoryArticle[] }>('vla-github-theory.json');
      const articles = data.articles;
      if (!Array.isArray(articles)) throw new Error('articles field is not array');

      return articles
        .filter((a) => a.date && a.title && (a.html_url || a.url))
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 50)
        .map<RawItemInput>((a) => ({
          title: a.title,
          link: a.html_url || a.url,
          guid: a.sha || a.html_url || a.url,
          pubDate: a.date,
          categories: a.topic ? [a.topic] : undefined,
          description: `新 VLA 深度解读文章 · 归类：${a.topic || 'theory'} · 点击链接到 GitHub 阅读全文。`,
        }));
    },
  );

  return new Response(xml, { headers: rssHeaders });
};
