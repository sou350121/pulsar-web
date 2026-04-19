import type { APIRoute } from 'astro';

const SITE = 'https://sou350121.github.io/pulsar-web';

export const GET: APIRoute = async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head>
  <title>Pulsar 照見 · 完整订阅包</title>
  <dateCreated>${new Date().toUTCString()}</dateCreated>
  <ownerName>sou350121</ownerName>
  <ownerId>${SITE}</ownerId>
</head>
<body>
  <outline text="Pulsar 照見" title="Pulsar 照見">
    <outline type="rss" text="VLA 新文章" title="Pulsar · VLA 新文章"
      description="VLA-Handbook 理论章节每日新增文章"
      xmlUrl="${SITE}/rss/vla-theory.xml"
      htmlUrl="${SITE}/vla-deepdive" />
    <outline type="rss" text="VLA 每日信号" title="Pulsar · VLA 每日信号"
      description="⚡🔧级论文 + SOTA 榜变动"
      xmlUrl="${SITE}/rss/vla-daily.xml"
      htmlUrl="${SITE}/daily" />
    <outline type="rss" text="AI 每日" title="Pulsar · AI 每日"
      description="AI Agent 生态每日精选 + 深度解读"
      xmlUrl="${SITE}/rss/ai-daily.xml"
      htmlUrl="${SITE}/ai-deepdive" />
    <outline type="rss" text="周/双周深度报告" title="Pulsar · 周/双周深度报告"
      description="VLA + AI 周/双周深度分析"
      xmlUrl="${SITE}/rss/weekly.xml"
      htmlUrl="${SITE}/reports" />
  </outline>
</body>
</opml>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'text/x-opml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
