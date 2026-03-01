# PULSAR · 照見 — Design System Documentation

> AI Research Intelligence Platform · Prototype v1.0 · 2026-03-01

---

## Overview

Pulsar is a daily intelligence platform that aggregates AI research papers,
industry news, VLA (Vision-Language-Action) robotics research, and social
signals from key researchers. This document covers the design system used
in the HTML prototype at `index.html`.

---

## Design Philosophy

**"Editorial magazine meets scientific precision"**

The aesthetic draws from MIT Technology Review's authoritative weight,
combined with the data-density of a financial terminal and the warmth of
a well-typeset academic journal. Every design decision prioritises:

1. **Legibility** — Chinese and Latin text at every size must be readable
2. **Information hierarchy** — rating signals surface at a glance
3. **Calm authority** — no gimmicks; restraint in motion and color
4. **Thematic coherence** — dark mode feels like deep space; light mode
   feels like warm paper

---

## Color Palettes

### Dark Mode (default)

| Token               | Hex Value   | Usage                          |
|---------------------|-------------|--------------------------------|
| `--bg`              | `#070B14`   | Page background (deep space)   |
| `--bg-alt`          | `#0A0F1C`   | Alternating section background |
| `--surface`         | `#0D1526`   | Card / panel background        |
| `--surface-2`       | `#111D32`   | Hover state surfaces           |
| `--border`          | `#1E2D4A`   | Default borders                |
| `--border-subtle`   | `#172038`   | Dividers, hr, card separators  |
| `--text-primary`    | `#E8EEFF`   | Headlines, primary body text   |
| `--text-secondary`  | `#7B8FAB`   | Captions, summaries            |
| `--text-tertiary`   | `#4A5C78`   | Timestamps, meta labels        |
| `--accent-amber`    | `#F5B731`   | Primary accent, CTAs           |
| `--accent-cyan`     | `#3ECFCF`   | Secondary accent, links        |

### Light Mode

| Token               | Hex Value   | Usage                          |
|---------------------|-------------|--------------------------------|
| `--bg`              | `#FAFAF7`   | Page background (warm paper)   |
| `--bg-alt`          | `#F3F1EB`   | Alternating section background |
| `--surface`         | `#FFFFFF`   | Card / panel background        |
| `--border`          | `#E5E2D9`   | Default borders                |
| `--text-primary`    | `#1A1F2E`   | Headlines, primary body text   |
| `--text-secondary`  | `#5C6478`   | Captions, summaries            |
| `--accent-amber`    | `#D4910A`   | Primary accent, CTAs           |
| `--accent-cyan`     | `#0F8FA0`   | Secondary accent, links        |

### Rating System Colors

| Rating | Emoji | Dark Hex    | Light Hex   | Semantic Meaning         |
|--------|-------|-------------|-------------|--------------------------|
| Flash  | ⚡    | `#FFD60A`   | `#C4960A`   | Breakthrough / Major     |
| Wrench | 🔧    | `#4FC3F7`   | `#2B8EC7`   | Technical / Methodical   |
| Book   | 📖    | `#81C784`   | `#3D8B5E`   | Perspective / Survey     |
| X      | ❌    | `#EF5350`   | `#C94040`   | Retraction / Negative    |

---

## Typography

### Font Stack

Three typefaces, each with a distinct semantic role:

```css
/* Headlines — editorial weight, authoritative */
font-family: 'Lora', 'Georgia', serif;

/* Data labels, tags, timestamps, code, mono UI */
font-family: 'IBM Plex Mono', 'Courier New', monospace;

/* Chinese body text, section headers in Chinese */
font-family: 'Noto Serif SC', 'STSong', serif;
```

### Type Scale

| Role                | Size      | Weight | Family          |
|---------------------|-----------|--------|-----------------|
| Hero headline (h1)  | clamp 2–3.2rem | 600 | Lora       |
| Section heading (h2)| 1.55rem   | 600    | Lora            |
| Card title          | 0.92–1.2rem | 500–600 | Noto Serif SC |
| Body text           | 0.88rem   | 400    | Noto Serif SC   |
| Mono label          | 0.62–0.72rem | 500–600 | IBM Plex Mono |
| Caption / meta      | 0.6–0.65rem | 400  | IBM Plex Mono   |

### Utility Classes

```css
.font-mono   /* IBM Plex Mono */
.font-serif  /* Lora */
.font-zh     /* Noto Serif SC */
```

---

## Component Patterns

### Rating Badge

Small pill badge used inline with content items. Color-coded by rating.

```html
<span class="rating-badge rating-flash">⚡ 突破</span>
<span class="rating-badge rating-wrench">🔧 技術</span>
<span class="rating-badge rating-book">📖 觀點</span>
<span class="rating-badge rating-x">❌ 撤稿</span>
```

CSS: `.rating-badge` sets base pill styles; `.rating-flash/.rating-wrench/
.rating-book/.rating-x` apply color tokens with semi-transparent background
and 20% opacity border.

---

### Hero Card

Used for the two featured items at top of page. Variants:
- `.hero-card-ai` — amber top border, flash glow
- `.hero-card-vla` — cyan/wrench top border

```html
<article class="hero-card hero-card-ai">
  <div class="hero-card-label">今日 AI 精選</div>
  <span class="rating-badge rating-flash">⚡ 突破</span>
  <h2 class="hero-card-title">…</h2>
  <p class="hero-card-summary">…</p>
  <div class="hero-card-footer">
    <span class="source-tag">SOURCE</span>
    <a class="btn btn-amber">閱讀全文 →</a>
  </div>
</article>
```

Hover effect: `translateY(-4px)` + deeper box-shadow.

---

### Pick Card (Grid)

Used in the 3-column picks grid. Displays rating badge, source logo,
title, summary, date, and domain tag.

```html
<article class="pick-card">
  <div class="pick-card-top">
    <div>
      <span class="rating-badge rating-flash">⚡ 突破</span>
      <h3 class="pick-title">…</h3>
    </div>
    <div class="pick-source-logo">🤖</div>
  </div>
  <p class="pick-summary">…</p>
  <div class="pick-footer">
    <span class="pick-date">2026-03-01</span>
    <span class="domain-tag">AI App</span>
    <!-- or: <span class="domain-tag vla">VLA</span> -->
  </div>
</article>
```

---

### Social Card (Horizontal Scroll)

Used in the social intel strip. Fixed width (320px), horizontal overflow.

```html
<article class="social-card">
  <div class="social-card-meta">
    <span class="social-platform">𝕏</span>
    <span class="social-entity">Researcher Name</span>
    <span class="social-time">03-01 · 06:42</span>
  </div>
  <p class="social-content">What happened…</p>
  <span class="social-tag">CATEGORY</span>
</article>
```

The wrapper `.social-scroll-wrapper` adds a right-edge fade gradient
via `::after` pseudo-element to indicate scrollability.

---

### Dashboard Cards

Three types, all using `.dash-card` base:

**1. Sparkline (Quality Drift)**
Seven `.spark-bar` elements, heights set via inline `style="height: X%"`.
Active bar uses `.active` class (amber); peak uses `.high` class (cyan).
All pure CSS — no canvas, no SVG.

```html
<div class="sparkline">
  <div class="spark-bar active" style="height: 68%;" data-val="W-6"></div>
  <!-- × 7 -->
</div>
```

**2. Entity Bars**
`.entity-bar-fill` width set inline; gradient fills from cyan to amber.

```html
<div class="entity-bar-track">
  <div class="entity-bar-fill" style="width: 75%;"></div>
</div>
```

**3. Pipeline Health Checklist**
`.health-item` with `.health-ok` (green ✓) or `.health-warn` (amber ⚠).

---

### Biweekly Report Teaser

Full-width dark card with gradient background, decorative oversized
quotation mark via `::after`, and radial glow `::before`.

```html
<div class="report-teaser">
  <div>
    <span class="report-label">Period · Issue #</span>
    <h2 class="report-title">…</h2>
    <p class="report-excerpt">…</p>
  </div>
  <a href="#" class="report-cta">
    <span class="report-cta-arrow">→</span>
    <span>查看完整報告</span>
  </a>
</div>
```

---

## Layout System

### Breakpoints

| Name    | Width  | Grid behavior                    |
|---------|--------|----------------------------------|
| Mobile  | < 640px  | Single column everywhere       |
| Tablet  | 641–1023px | 2-col picks, 1-col dashboard |
| Desktop | 1024px+  | 3-col picks, 3-col dashboard   |

### Grid Patterns

```css
/* Picks grid */
.picks-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

/* Dashboard */
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

/* Hero */
.hero-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
```

All grids collapse to 1 column on mobile via media queries.

---

## Motion & Animation

All animations are pure CSS — no JavaScript animation libraries.

| Animation     | Duration | Trigger        | Usage                      |
|---------------|----------|----------------|----------------------------|
| `fadeInUp`    | 0.6s     | Page load      | Hero, sections (staggered) |
| `fadeIn`      | 0.4s     | Page load      | Body initial paint         |
| `pulseGlow`   | 2s loop  | Always         | Live indicator green dot   |
| Card hover    | 0.25s    | `:hover`       | `translateY(-3px)` + shadow|
| Theme change  | 0.35s    | Class toggle   | All bg/color properties    |

Stagger classes `.fade-in-1` through `.fade-in-5` add delays from 0.05s
to 0.45s in 0.1s increments.

---

## Theme Toggle

Implemented in ~20 lines of vanilla JS, no framework dependency.

- Adds/removes class `dark` on `<html>` element
- Persists preference in `localStorage` under key `pulsar-theme`
- Icon switches between `☀` (dark mode, click to go light) and
  `◑` (light mode, click to go dark)
- All color transitions driven by CSS custom properties with
  `transition: background-color 0.35s ease, color 0.35s ease`

---

## Ticker Bar

The top announcement bar uses a fixed layout (not CSS `marquee` animation)
to avoid accessibility issues. Content is static placeholder. For
production, replace with a CSS `@keyframes` scroll or JS-driven rotation.

---

## Accessibility Notes

- All interactive elements have `:focus` states (inherits browser default;
  enhance with explicit `:focus-visible` outline in production)
- ARIA labels on nav, card articles, sparkline chart (role="img")
- Social strip uses `role="list"` + `role="listitem"`
- Theme toggle button has `aria-label`
- `.sr-only` utility class available for screen-reader-only text
- Color is never the sole differentiator — rating badges include both
  emoji and text

---

## File Structure

```
prototype/
  index.html    — Complete single-file prototype (HTML + CSS + minimal JS)
  README.md     — This design system documentation
```

No build step required. Open `index.html` directly in any modern browser.

---

## Production Checklist

When moving from prototype to production:

- [ ] Replace Google Fonts CDN link with self-hosted WOFF2 files
- [ ] Add `<meta name="theme-color">` for mobile browser chrome
- [ ] Implement CSS `@keyframes` ticker scroll
- [ ] Add `:focus-visible` outlines for keyboard navigation
- [ ] Replace static dashboard data with live API calls
- [ ] Add `prefers-color-scheme` media query to initialise theme
      without flash of wrong theme
- [ ] Compress and minify CSS
- [ ] Add OpenGraph / Twitter Card meta tags

---

*PULSAR · 照見 · AI Pipeline Auto-Generated Intelligence Platform*
