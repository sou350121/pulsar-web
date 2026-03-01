# Pulsar · 照見

**AI Research Intelligence Website**

Pulsar is the web front-end for the 照見 (Zhàojiàn) pipeline — an automated AI research monitoring system that tracks VLA robotics research and AI application trends, generates daily picks, biweekly reports, and quality drift alerts.

## Stack

| Layer       | Technology            |
|-------------|----------------------|
| Framework   | Astro 5 (static SSG) |
| Styling     | Tailwind CSS 4       |
| Language    | TypeScript (strict)  |
| Fonts       | Lora, IBM Plex Mono, Noto Serif SC |
| Deployment  | GitHub Pages         |
| Data sync   | Python 3.11 script   |

## Project Structure

```
pulsar-web/
├── src/
│   ├── components/       # Reusable Astro components
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── ArticleCard.astro
│   │   ├── RatingBadge.astro
│   │   ├── SocialCard.astro
│   │   ├── MetricCard.astro
│   │   └── ThemeToggle.astro
│   ├── layouts/
│   │   └── BaseLayout.astro  # Full HTML shell
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   ├── ai-daily/
│   │   │   ├── index.astro       # AI 日報 archive
│   │   │   └── [date].astro      # Individual day view
│   │   ├── vla/index.astro       # VLA research archive
│   │   ├── social/index.astro    # Social intel
│   │   ├── reports/index.astro   # Biweekly reports
│   │   └── dashboard/index.astro # Data dashboard
│   ├── styles/
│   │   └── global.css            # CSS variables + base styles
│   ├── utils/
│   │   └── data.ts               # Build-time data loading utilities
│   └── data/                     # Synced pipeline data (git-ignored)
│       └── README.md             # Placeholder
├── scripts/
│   └── sync-data.py              # Copies data from pipeline memory dir
├── .github/workflows/
│   └── deploy.yml                # GitHub Pages CI/CD
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
└── package.json
```

## Pages

| Route               | Description                                      |
|---------------------|--------------------------------------------------|
| `/`                 | Homepage — hero, latest picks, social strip, metrics |
| `/ai-daily`         | AI 日報 archive list (last 30 days)              |
| `/ai-daily/[date]`  | Individual day view, grouped by rating           |
| `/vla`              | VLA research archive + entity sidebar            |
| `/social`           | Social intel archive (AI + VLA merged)           |
| `/reports`          | Biweekly reports list with summaries             |
| `/dashboard`        | Pipeline metrics, drift chart, keyword heatmap   |

## Rating System

| Symbol | Meaning       | Description                          |
|--------|---------------|--------------------------------------|
| ⚡     | Breakthrough  | Significant advance, high relevance  |
| 🔧     | Practical     | Useful tool, technique, or analysis  |
| 📖     | Background    | Context, survey, or foundational work|
| ❌     | Low Relevance | Off-topic or low signal              |

## Setup

### Prerequisites

- Node.js 22+
- pnpm (`npm i -g pnpm`)
- Python 3.11 (for data sync)
- Access to the pipeline server (for real data)

### Install

```bash
cd pulsar-web
pnpm install
```

### Sync Pipeline Data

The site reads from `src/data/`. Populate it by running:

```bash
# On the server (requires access to /home/admin/clawd/memory/)
sudo python3.11 scripts/sync-data.py --verbose

# Or with symlinks (faster, no copy)
sudo python3.11 scripts/sync-data.py --symlink --verbose

# Dry run to preview
python3.11 scripts/sync-data.py --dry-run --verbose
```

The script copies:
- `ai-daily-pick.json`, `drift-metrics.json`, `drift-state.json`
- `entity-index.json`, `upstream-signals.json`
- Last 30 `_ai_social_*.md` and `_vla_social_*.md`
- Last 12 `_biweekly_*.md` and `_biweekly_reflection_*.md`

### Development

```bash
pnpm dev        # Start dev server at http://localhost:4321
pnpm build      # Type-check + build to dist/
pnpm preview    # Preview the built site
```

The site renders with mock data even before syncing, so you can develop without server access.

### Build

```bash
pnpm build
# Output: dist/  (static HTML + assets)
```

## Deployment

### GitHub Pages (automated)

1. Push to `main` — the workflow in `.github/workflows/deploy.yml` runs automatically.
2. Set these repository secrets (Settings → Secrets → Actions):
   - `DEPLOY_SSH_KEY` — private key for SSH to the pipeline server
   - `DEPLOY_SSH_HOST` — server hostname
   - `DEPLOY_SSH_USER` — SSH username (e.g. `admin`)
3. Enable GitHub Pages: Settings → Pages → Source: **GitHub Actions**.

### Manual deploy

```bash
pnpm build
# Then upload dist/ to any static host (Netlify, Cloudflare Pages, etc.)
```

## Design Tokens

Pulsar uses CSS custom properties for theming (see `src/styles/global.css`):

| Token             | Light           | Dark            |
|-------------------|-----------------|-----------------|
| `--color-bg`      | `#f9f6ef`       | `#0f0e0d`       |
| `--color-surface` | `#ffffff`       | `#1c1917`       |
| `--color-text`    | `#1c1917`       | `#f5f0e8`       |
| `--color-amber`   | `#d97706`       | `#fbbf24`       |
| `--color-cyan`    | `#0891b2`       | `#22d3ee`       |

Dark mode is toggled via the `.dark` class on `<html>`, stored in `localStorage`.

## Data Architecture

```
Pipeline server
  /home/admin/clawd/memory/
        │
        │  scripts/sync-data.py
        ▼
  src/data/          (local, git-ignored)
        │
        │  Astro build (SSG)
        ▼
  dist/              (static HTML)
        │
        │  GitHub Pages / CDN
        ▼
  https://pulsar.sou350121.github.io
```

All data loading happens at **build time** — no server-side runtime, no API calls from the browser. The site is fully static.

## Contributing

1. Add or modify components in `src/components/`.
2. New pages go in `src/pages/`.
3. Data helpers belong in `src/utils/data.ts`.
4. Run `pnpm build` before committing to catch type errors.
