# Pulsar · 照見

**AI Research Intelligence Website**

Pulsar is the web front-end for the 照見 (Zhàojiàn) pipeline — an automated research monitoring system tracking VLA robotics and AI application trends. It generates daily picks, biweekly reports, quality drift alerts, and cross-domain intelligence from arxiv + social sources.

Live: **https://sou350121.github.io/pulsar-web/**

## Stack

| Layer       | Technology                              |
|-------------|----------------------------------------|
| Framework   | Astro 5 (static SSG)                   |
| Styling     | Tailwind CSS 4 (`@tailwindcss/vite`)   |
| Language    | TypeScript (strict)                    |
| Fonts       | System only — PingFang SC / Menlo / Microsoft YaHei (no Google Fonts; GFW-safe) |
| Deployment  | GitHub Pages via Actions               |
| Data sync   | Python 3.11 script                     |

## Project Structure

```
pulsar-web/
├── src/
│   ├── components/
│   │   ├── DigestFeed.astro      # Homepage daily digest component
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   └── ThemeToggle.astro
│   ├── layouts/
│   │   └── BaseLayout.astro      # Full HTML shell
│   ├── pages/
│   │   ├── index.astro           # Homepage — hero, digest, metrics
│   │   ├── daily/index.astro     # 全部 archive (AI + VLA combined)
│   │   ├── ai-daily/
│   │   │   ├── index.astro       # AI App 線 archive list
│   │   │   └── [date].astro      # Individual day view
│   │   ├── vla/
│   │   │   ├── index.astro       # VLA 線 archive list
│   │   │   └── [date].astro      # Individual day view
│   │   ├── social/index.astro    # Social intel (AI + VLA feed)
│   │   ├── reports/
│   │   │   ├── index.astro       # Biweekly reports list
│   │   │   └── [date].astro      # Individual report view + pagination
│   │   ├── ai-deepdive/index.astro   # AI Agent deep-dive archive
│   │   ├── vla-deepdive/index.astro  # VLA theory deep-dive + SOTA
│   │   └── dashboard/index.astro     # Pipeline mission control
│   ├── styles/
│   │   └── global.css            # CSS custom properties + base styles
│   ├── utils/
│   │   └── data.ts               # Build-time data loaders
│   └── data/                     # Synced pipeline data (git-ignored)
├── scripts/
│   └── sync-data.py              # Copies data from pipeline memory dir
├── .github/workflows/
│   └── deploy.yml                # GitHub Pages CI/CD
└── astro.config.mjs              # base: '/pulsar-web' required
```

## Pages

| Route                 | Description                                                |
|-----------------------|------------------------------------------------------------|
| `/`                   | Homepage — DEEP DIVE digest, top signals, metrics strip    |
| `/daily`              | 全部 archive — 7-day summary card + combined AI+VLA list   |
| `/ai-daily`           | AI App 線 archive list (last 60 days, month-grouped)       |
| `/ai-daily/[date]`    | Individual day view, grouped by rating ⚡🔧📖❌            |
| `/vla`                | VLA 線 archive list (last 60 days, month-grouped)          |
| `/vla/[date]`         | Individual VLA day view + AI crosslink                     |
| `/social`             | Social intel — 72h window, AI + VLA domain split           |
| `/reports`            | Biweekly reports list with summaries                       |
| `/reports/[date]`     | Full report view with prev/next navigation                 |
| `/ai-deepdive`        | AI Agent deep-dive article archive (Agent-Playbook)        |
| `/vla-deepdive`       | VLA theory deep-dive + SOTA leaderboard (VLA-Handbook)     |
| `/dashboard`          | Pipeline mission control — drift, entities, upstream signals |

## Rating System

| Symbol | Label     | Description                           |
|--------|-----------|---------------------------------------|
| ⚡     | 突破      | Significant advance, high relevance   |
| 🔧     | 技術      | Useful tool, technique, or analysis   |
| 📖     | 觀點      | Context, survey, or foundational work |
| ❌     | 低相關    | Off-topic or low signal               |

**Important**: Emoji ratings are UTF-16 surrogate pairs. Always use `[...str][0]` (not `charAt(0)`) to extract the first character.

## Setup

### Prerequisites

- Node.js 22+
- pnpm (`npm i -g pnpm`)
- Python 3.11 (for data sync)
- Access to the pipeline server (for real data)

### Install

```bash
pnpm install
```

### Sync Pipeline Data

```bash
# On the server (requires access to /home/admin/clawd/memory/)
sudo python3.11 scripts/sync-data.py --verbose

# Dry run to preview
python3.11 scripts/sync-data.py --dry-run --verbose
```

Synced files include: `ai-daily-pick.json`, `drift-metrics.json`, `drift-state.json`, `entity-index.json`, `upstream-signals.json`, recent `_ai_social_*.md`, `_vla_social_*.md`, `_biweekly_*.md`.

### Development

```bash
pnpm dev      # Dev server at http://localhost:4321
pnpm build    # Build to dist/ (29 pages)
pnpm preview  # Preview built site
```

The site renders with mock/empty-state data before syncing.

## Deployment

### GitHub Pages (automated)

Push to `main` — `.github/workflows/deploy.yml` triggers automatically.

Required repository secrets:
- `DEPLOY_SSH_KEY` — private key for pipeline server SSH
- `DEPLOY_SSH_HOST` — server hostname
- `DEPLOY_SSH_USER` — SSH user (e.g. `admin`)

Enable Pages: Settings → Pages → Source: **GitHub Actions**.

## Design System

CSS custom properties defined in `src/styles/global.css`:

| Token              | Light       | Dark        | Purpose              |
|--------------------|-------------|-------------|----------------------|
| `--bg`             | `#FAFAF7`   | `#070B14`   | Page background      |
| `--surface`        | `#FFFFFF`   | `#0D1424`   | Card surface         |
| `--surface-2`      | `#F7F5F0`   | `#111827`   | Secondary surface    |
| `--surface-hover`  | `#EDEAE4`   | `#0A1020`   | Hover state surface  |
| `--accent-amber`   | `#D4910A`   | `#F5B731`   | AI App 線 accent     |
| `--accent-cyan`    | `#0F8FA0`   | `#3ECFCF`   | VLA 線 accent        |
| `--text-primary`   | `#1A1F2E`   | `#E8EEFF`   | Body text            |

Dark mode: toggle `.dark` class on `<html>`, stored in `localStorage`.

## Data Architecture

```
Pipeline server: /home/admin/clawd/memory/
        │
        │  scripts/sync-data.py  (SSH + copy)
        ▼
  src/data/          (local, git-ignored)
        │
        │  Astro build (SSG, build-time only)
        ▼
  dist/              (static HTML + assets)
        │
        │  GitHub Actions deploy
        ▼
  https://sou350121.github.io/pulsar-web/
```

All data loading happens at **build time** — no runtime server, no browser API calls. Fully static.

## Key Engineering Notes

- `base: '/pulsar-web'` in `astro.config.mjs` is **required** — all internal links must use `import.meta.env.BASE_URL` prefix
- `DriftMetricsFile` is a **flat array** `DriftMetricsEntry[]` with fields `date`, `vla_papers_scanned`, `aiapp_items_scanned`
- Navigation pattern: domain tabs (`/daily`↔`/ai-daily`↔`/vla`) + breadcrumbs on all other sections
