#!/usr/bin/env python3
"""
export-ai-pulse.py
─────────────────────────────
Generate Agent-Playbook Daily Pulse: AI Agent ecosystem method trends
+ unique COMPETITION PAIRS visualization (single-vs-swarm, act-vs-think,
open-vs-closed, etc.)

Output:
  $MFV_OUT_DIR/ai-method-trends.svg
  $MFV_OUT_DIR/ai-method-trends.md
"""
import json, os, glob
from datetime import datetime
from pathlib import Path

DATA_DIR = Path('/home/claudeuser/pulsar-web/src/data')
OUT_SVG = Path(os.environ.get('MFV_OUT_DIR', '/tmp/mfv-out')) / 'ai-method-trends.svg'
OUT_MD = Path(os.environ.get('MFV_OUT_DIR', '/tmp/mfv-out')) / 'ai-method-trends.md'

# Palette (same as VLA Pulse)
BG = '#1a1f2e'
PANEL = '#232833'
GRID = '#2a3142'
TEXT = '#e5e2d9'
TEXT_DIM = '#8a90a0'
TEXT_SUBTLE = '#5c6478'
AMBER = '#d4910a'
AMBER_DIM = '#a87208'
CYAN = '#0f8fa0'
CYAN_DIM = '#0a6772'
GREEN = '#3d8b5e'
RED = '#c8484d'
NEUTRAL = '#5c6478'
PURPLE = '#8b5cf6'  # for AI / "agentic" accent


# ─────── load snapshots ───────
def load_snapshots():
    files = sorted(glob.glob(str(DATA_DIR / 'ai-field-state-*.json')))
    out = []
    for f in files:
        try:
            with open(f) as fh:
                d = json.load(fh)
            date = d.get('date') or os.path.basename(f).replace('ai-field-state-', '').replace('.json', '')
            mt = d.get('method_trends', [])
            if mt:
                out.append({
                    'date': date,
                    'trends': mt,
                    'total': d.get('total_mentions_7d', 0),
                    'pairs': d.get('competition_pairs', []),
                })
        except Exception:
            continue
    return out


def build_series(snapshots, window=30):
    last = snapshots[-window:] if len(snapshots) > window else snapshots
    all_fams = set()
    for s in last:
        for t in s['trends']:
            all_fams.add(t['family'])

    series = {}
    for fam in all_fams:
        counts = []
        for s in last:
            m = next((t for t in s['trends'] if t['family'] == fam), None)
            counts.append(m.get('count_7d', 0) if m else 0)
        latest_m = next((t for t in last[-1]['trends'] if t['family'] == fam), None)
        if not latest_m:
            continue
        series[fam] = {
            'counts': counts,
            'label': latest_m.get('label') or fam.replace('_', ' ').title(),
            'count_7d': latest_m.get('count_7d', 0),
            'count_prior_7d': latest_m.get('count_prior_7d', 0),
            'count_14d': latest_m.get('count_14d', 0),
            'accel': latest_m.get('acceleration', 1.0),
            'status': latest_m.get('status', 'stable'),
        }
    return series, last[-1]['date'], last[-1].get('total', 0), len(last), last[-1].get('pairs', [])


def status_color(accel, status=''):
    if status == 'surging' or accel >= 2.0:
        return GREEN
    if status == 'accelerating' or accel >= 1.25:
        return GREEN
    if accel <= 0.80:
        return RED
    return NEUTRAL


def status_glyph(accel, status=''):
    if status == 'surging' or accel >= 2.0:
        return '▲▲'
    if accel >= 1.25:
        return '▲'
    if accel <= 0.80:
        return '▼'
    return '◆'


def fmt_accel(a):
    if a >= 9.99:
        return '∞x'
    if a == 0:
        return '—'
    return f'{a:.2f}x' if a < 10 else f'{a:.1f}x'


def spark_unicode(counts):
    if not counts or max(counts) == 0:
        return '·' * len(counts) if counts else '─'
    chars = '▁▂▃▄▅▆▇█'
    m = max(counts)
    out = []
    for c in counts:
        if c == 0:
            out.append('·')
        else:
            i = min(int((c / m) * (len(chars) - 1)), len(chars) - 1)
            out.append(chars[i])
    return ''.join(out)


# ─────── SVG ───────
def build_svg(series, last_date, total, days, pairs):
    fams = sorted(series.items(), key=lambda x: -x[1]['count_7d'])
    n = len(fams)

    n_surging = sum(1 for _, f in fams if f['status'] == 'surging')
    n_accel = sum(1 for _, f in fams if f['accel'] >= 1.25 and f['status'] != 'surging')
    n_decl = sum(1 for _, f in fams if f['accel'] <= 0.80)
    n_stable = n - n_surging - n_accel - n_decl

    # Geometry
    W = 980
    title_h = 66
    summary_h = 56
    pairs_h = 110 if pairs else 0
    col_h = 28
    row_h = 36
    header_h = title_h + summary_h + pairs_h + col_h
    footer_h = 76
    H = header_h + n * row_h + footer_h

    # Columns
    col_rank_x = 28
    col_name_x = 70
    col_bar_x = 280
    col_bar_w = 168
    col_7d_x = 478
    col_prior_x = 526
    col_14d_x = 574
    col_accel_x = 640
    col_spark_x = 700
    col_spark_w = 230
    col_status_x = 952

    max_7d = max((f[1]['count_7d'] for f in fams), default=1) or 1

    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
         f'style="background:{BG}">']

    # Defs
    s.append(f'<defs>'
             f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
             f'<stop offset="0%" stop-color="{BG}"/>'
             f'<stop offset="100%" stop-color="#101521"/>'
             f'</linearGradient>'
             f'<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">'
             f'<stop offset="0%" stop-color="{PURPLE}" stop-opacity="0.9"/>'
             f'<stop offset="100%" stop-color="{CYAN_DIM}" stop-opacity="0.35"/>'
             f'</linearGradient>'
             f'<linearGradient id="title-glow" x1="0" y1="0" x2="0" y2="1">'
             f'<stop offset="0%" stop-color="{PURPLE}" stop-opacity="0"/>'
             f'<stop offset="100%" stop-color="{PURPLE}" stop-opacity="0.05"/>'
             f'</linearGradient>'
             f'</defs>')
    s.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="url(#bg)"/>')
    s.append(f'<rect x="0" y="0" width="{W}" height="{title_h}" fill="url(#title-glow)"/>')

    # === HEADER ===
    s.append(f'<rect x="0" y="14" width="4" height="40" fill="{PURPLE}"/>')
    s.append(f'<text x="{col_rank_x}" y="36" fill="{PURPLE}" font-size="20" font-weight="700" '
             f'letter-spacing="0.14em">AI AGENT METHOD TRENDS</text>')
    s.append(f'<text x="{col_rank_x}" y="55" fill="{TEXT_DIM}" font-size="11" '
             f'letter-spacing="0.06em">AGENT ECOSYSTEM MOMENTUM · PULSAR 照見 · 每日自動更新</text>')
    chip_x = W - 28
    s.append(f'<text x="{chip_x}" y="28" fill="{CYAN}" font-size="11" text-anchor="end" '
             f'letter-spacing="0.1em" font-weight="600">DATA · {last_date}</text>')
    s.append(f'<text x="{chip_x}" y="46" fill="{TEXT_DIM}" font-size="10" text-anchor="end">'
             f'{total} mentions · {days}d window · {n} families</text>')
    s.append(f'<line x1="0" y1="{title_h}" x2="{W}" y2="{title_h}" stroke="{GRID}" stroke-width="1"/>')

    # === EXECUTIVE SUMMARY ===
    sy_top = title_h
    sy_mid = title_h + summary_h // 2 + 4

    chips = [
        ('▲▲', n_surging, GREEN, 'SURGING'),
        ('▲', n_accel, GREEN, 'ACCEL'),
        ('◆', n_stable, NEUTRAL, 'STABLE'),
        ('▼', n_decl, RED, 'DECLINING'),
    ]
    chip_w = 162
    chip_pad = 14
    cx = col_rank_x
    for glyph, count, col, label in chips:
        s.append(f'<rect x="{cx}" y="{sy_top + 10}" width="{chip_w}" height="{summary_h - 18}" '
                 f'fill="{col}" opacity="0.08" rx="3"/>')
        s.append(f'<text x="{cx + 14}" y="{sy_mid + 4}" fill="{col}" font-size="20" '
                 f'font-weight="700">{glyph}</text>')
        s.append(f'<text x="{cx + 50}" y="{sy_mid + 5}" fill="{col}" font-size="22" '
                 f'font-weight="700">{count}</text>')
        s.append(f'<text x="{cx + 84}" y="{sy_mid + 5}" fill="{TEXT_DIM}" font-size="9" '
                 f'letter-spacing="0.1em">{label}</text>')
        cx += chip_w + chip_pad

    # Right: total mentions
    s.append(f'<text x="{chip_x}" y="{sy_mid - 4}" fill="{TEXT}" font-size="22" '
             f'text-anchor="end" font-weight="700">{total}</text>')
    s.append(f'<text x="{chip_x}" y="{sy_mid + 14}" fill="{TEXT_SUBTLE}" font-size="9" '
             f'text-anchor="end" letter-spacing="0.1em">MENTIONS / 7D</text>')
    s.append(f'<line x1="0" y1="{title_h + summary_h}" x2="{W}" y2="{title_h + summary_h}" '
             f'stroke="{GRID}" stroke-width="1"/>')

    # === COMPETITION PAIRS BAND === (unique to AI Pulse)
    if pairs:
        py = title_h + summary_h
        s.append(f'<text x="{col_rank_x}" y="{py + 22}" fill="{AMBER}" font-size="11" '
                 f'letter-spacing="0.14em" font-weight="700">⚔  COMPETITION PAIRS</text>')
        s.append(f'<text x="{chip_x}" y="{py + 22}" fill="{TEXT_SUBTLE}" font-size="9" '
                 f'text-anchor="end" letter-spacing="0.06em">narrative tensions in the agent ecosystem</text>')

        # Show up to 3 pairs side by side
        pair_w = (W - 56) // 3
        pair_y = py + 36
        for i, p in enumerate(pairs[:3]):
            px = col_rank_x + i * pair_w
            fa = next((f[1] for f in fams if f[0] == p['familyA']), None)
            fb = next((f[1] for f in fams if f[0] == p['familyB']), None)
            if not fa or not fb:
                continue
            label_a = (fa.get('label') or p['familyA']).replace('_', ' ')
            label_b = (fb.get('label') or p['familyB']).replace('_', ' ')
            ca, cb = fa['count_7d'], fb['count_7d']
            total_pair = ca + cb
            ratio_a = (ca / total_pair) if total_pair else 0.5
            ratio_b = 1 - ratio_a

            # Title
            s.append(f'<text x="{px}" y="{pair_y}" fill="{TEXT}" font-size="11" '
                     f'font-weight="600" letter-spacing="0.08em">{p.get("label", "")}</text>')

            # Bar
            bar_w = pair_w - 30
            bar_h = 14
            bar_y = pair_y + 12
            # A side (left, purple)
            s.append(f'<rect x="{px}" y="{bar_y}" width="{bar_w * ratio_a:.1f}" height="{bar_h}" '
                     f'fill="{PURPLE}" opacity="0.85" rx="2"/>')
            # B side (right, cyan)
            s.append(f'<rect x="{px + bar_w * ratio_a:.1f}" y="{bar_y}" '
                     f'width="{bar_w * ratio_b:.1f}" height="{bar_h}" fill="{CYAN}" '
                     f'opacity="0.85"/>')

            # Counts on bar
            if ratio_a > 0.15:
                s.append(f'<text x="{px + 6}" y="{bar_y + 11}" fill="#fff" font-size="10" '
                         f'font-weight="700">{ca}</text>')
            if ratio_b > 0.15:
                s.append(f'<text x="{px + bar_w - 6}" y="{bar_y + 11}" fill="#fff" font-size="10" '
                         f'font-weight="700" text-anchor="end">{cb}</text>')

            # Labels under bar
            ly = bar_y + bar_h + 14
            s.append(f'<text x="{px}" y="{ly}" fill="{PURPLE}" font-size="10" '
                     f'font-weight="600">{label_a[:18]}</text>')
            s.append(f'<text x="{px + bar_w}" y="{ly}" fill="{CYAN}" font-size="10" '
                     f'font-weight="600" text-anchor="end">{label_b[:18]}</text>')

            # Description
            desc = p.get('desc', '')[:60]
            s.append(f'<text x="{px}" y="{ly + 14}" fill="{TEXT_SUBTLE}" font-size="9">'
                     f'{desc}</text>')

        s.append(f'<line x1="0" y1="{py + pairs_h}" x2="{W}" y2="{py + pairs_h}" '
                 f'stroke="{GRID}" stroke-width="1"/>')

    # === COLUMN HEADERS ===
    hy = header_h - 8
    headers = [
        (col_rank_x - 4, '#', 'start'),
        (col_name_x, 'FAMILY', 'start'),
        (col_bar_x, '7d VOLUME', 'start'),
        (col_7d_x + 36, '7d', 'end'),
        (col_prior_x + 36, 'PRIOR', 'end'),
        (col_14d_x + 36, '14d', 'end'),
        (col_accel_x + 25, 'Δ ACCEL', 'middle'),
        (col_spark_x + col_spark_w // 2, 'TREND · 30D', 'middle'),
        (col_status_x, 'ST', 'middle'),
    ]
    for x, t, anchor in headers:
        s.append(f'<text x="{x}" y="{hy}" fill="{TEXT_SUBTLE}" font-size="9" '
                 f'letter-spacing="0.12em" font-weight="600" text-anchor="{anchor}">{t}</text>')
    s.append(f'<line x1="0" y1="{header_h - 1}" x2="{W}" y2="{header_h - 1}" '
             f'stroke="{GRID}" stroke-width="1"/>')

    # === ROWS ===
    spark_h = 22
    for i, (fam_name, fam) in enumerate(fams):
        y = header_h + i * row_h
        rcy = y + row_h // 2 + 4

        # Status tint
        is_surging = fam['status'] == 'surging'
        if is_surging:
            s.append(f'<rect x="0" y="{y}" width="{W}" height="{row_h}" '
                     f'fill="{GREEN}" opacity="0.10"/>')
            s.append(f'<rect x="0" y="{y}" width="3" height="{row_h}" fill="{GREEN}" opacity="0.85"/>')
        elif fam['accel'] >= 1.25:
            s.append(f'<rect x="0" y="{y}" width="{W}" height="{row_h}" '
                     f'fill="{GREEN}" opacity="0.05"/>')
            s.append(f'<rect x="0" y="{y}" width="3" height="{row_h}" fill="{GREEN}" opacity="0.6"/>')
        elif fam['accel'] <= 0.80:
            s.append(f'<rect x="0" y="{y}" width="{W}" height="{row_h}" '
                     f'fill="{RED}" opacity="0.04"/>')
            s.append(f'<rect x="0" y="{y}" width="3" height="{row_h}" fill="{RED}" opacity="0.55"/>')
        elif i % 2 == 1:
            s.append(f'<rect x="0" y="{y}" width="{W}" height="{row_h}" '
                     f'fill="{TEXT_SUBTLE}" opacity="0.025"/>')

        if i > 0:
            s.append(f'<line x1="{col_rank_x - 4}" y1="{y}" x2="{W-24}" y2="{y}" '
                     f'stroke="{GRID}" stroke-width="0.4" opacity="0.4"/>')

        # Rank
        s.append(f'<text x="{col_rank_x}" y="{rcy}" fill="{TEXT_SUBTLE}" font-size="11" '
                 f'font-weight="600" letter-spacing="0.05em">{i+1:02d}</text>')

        # Name
        s.append(f'<text x="{col_name_x}" y="{rcy}" fill="{TEXT}" font-size="13" '
                 f'font-weight="500">{fam["label"]}</text>')

        # Bar
        bw = (fam['count_7d'] / max_7d) * col_bar_w
        by = y + row_h // 2 - 7
        s.append(f'<rect x="{col_bar_x}" y="{by}" width="{col_bar_w}" height="14" '
                 f'fill="{PANEL}" stroke="{GRID}" stroke-width="0.5" rx="2"/>')
        s.append(f'<rect x="{col_bar_x}" y="{by}" width="{bw:.1f}" height="14" '
                 f'fill="url(#bar)" rx="2"/>')

        # Numbers
        s.append(f'<text x="{col_7d_x + 36}" y="{rcy}" fill="{TEXT}" font-size="13" '
                 f'text-anchor="end" font-weight="600">{fam["count_7d"]}</text>')
        s.append(f'<text x="{col_prior_x + 36}" y="{rcy}" fill="{TEXT_DIM}" font-size="11" '
                 f'text-anchor="end">{fam["count_prior_7d"]}</text>')
        s.append(f'<text x="{col_14d_x + 36}" y="{rcy}" fill="{TEXT_DIM}" font-size="11" '
                 f'text-anchor="end">{fam["count_14d"]}</text>')

        # Accel
        col = status_color(fam['accel'], fam['status'])
        s.append(f'<text x="{col_accel_x + 25}" y="{rcy}" fill="{col}" font-size="12" '
                 f'text-anchor="middle" font-weight="700">{fmt_accel(fam["accel"])}</text>')

        # Sparkline
        if fam['counts']:
            counts = fam['counts']
            mc = max(counts) or 1
            sy_base = y + row_h // 2 + spark_h // 2
            s.append(f'<line x1="{col_spark_x}" y1="{sy_base + 0.5}" '
                     f'x2="{col_spark_x + col_spark_w}" y2="{sy_base + 0.5}" '
                     f'stroke="{GRID}" stroke-width="0.5"/>')
            bw_inner = col_spark_w / max(len(counts), 1)
            for j, c in enumerate(counts):
                bx = col_spark_x + j * bw_inner
                bh = (c / mc) * spark_h if mc > 0 else 0
                bey = sy_base - bh
                is_latest = (j == len(counts) - 1)
                fill = PURPLE if is_latest else CYAN
                op = 0.95 if is_latest else 0.30 + 0.40 * (j / len(counts))
                s.append(f'<rect x="{bx:.1f}" y="{bey:.1f}" '
                         f'width="{max(bw_inner-1,1):.1f}" '
                         f'height="{max(bh, 0.5):.1f}" fill="{fill}" '
                         f'opacity="{op:.2f}" rx="0.5"/>')

        # Status glyph
        gc = status_color(fam['accel'], fam['status'])
        s.append(f'<text x="{col_status_x}" y="{rcy + 1}" fill="{gc}" font-size="14" '
                 f'text-anchor="middle" font-weight="700">{status_glyph(fam["accel"], fam["status"])}</text>')

    # === FOOTER ===
    fy_top = H - footer_h
    s.append(f'<line x1="0" y1="{fy_top}" x2="{W}" y2="{fy_top}" stroke="{GRID}" stroke-width="1"/>')
    fy = fy_top + 24
    legend = [
        (GREEN, '▲▲', 'SURGING ≥ 2.0×'),
        (GREEN, '▲', '加速 ≥ 1.25×'),
        (NEUTRAL, '◆', '稳定 0.80-1.25×'),
        (RED, '▼', '减速 ≤ 0.80×'),
    ]
    lx = col_rank_x
    for col, glyph, text in legend:
        s.append(f'<text x="{lx}" y="{fy}" fill="{col}" font-size="13" font-weight="700">{glyph}</text>')
        offset = 22 if glyph == '▲▲' else 18
        s.append(f'<text x="{lx + offset}" y="{fy}" fill="{TEXT_DIM}" font-size="10">{text}</text>')
        lx += 130

    s.append(f'<text x="{W-28}" y="{fy}" fill="{TEXT_SUBTLE}" font-size="9" '
             f'text-anchor="end" letter-spacing="0.05em">'
             f'Generated {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")} · CC BY 4.0</text>')

    fy2 = fy_top + 46
    s.append(f'<text x="{col_rank_x}" y="{fy2}" fill="{TEXT_SUBTLE}" font-size="9" '
             f'letter-spacing="0.04em">'
             f'Δ ACCEL = recent 7d daily-avg / prior 7d daily-avg · TREND chart shows '
             f'rolling 7d count over 30d · sparkline latest = purple</text>')
    s.append(f'<text x="{W-28}" y="{fy2}" fill="{CYAN}" font-size="9" '
             f'text-anchor="end" letter-spacing="0.06em" font-weight="600">'
             f'sou350121.github.io/pulsar-web/ai-deepdive</text>')

    s.append('</svg>')
    return '\n'.join(s)


# ─────── MD ───────
def build_md(series, last_date, total, days, pairs):
    fams = sorted(series.items(), key=lambda x: -x[1]['count_7d'])
    L = []
    L.append('# AI Agent Method Trends · 每日趋势')
    L.append('')
    L.append(f'> 🛰️ **数据日期**: `{last_date}` · **窗口**: 最近 `{days}` 天 · '
             f'**累计 mentions**: `{total}` · **家族数**: `{len(fams)}`')
    L.append('>')
    L.append('> 每日自动生成 · 数据源 [pulsar-web ai-deepdive](https://sou350121.github.io/pulsar-web/ai-deepdive/)')
    L.append('')
    L.append('![AI Method Trends](ai-method-trends.svg)')
    L.append('')

    if pairs:
        L.append('---')
        L.append('')
        L.append('## ⚔ 竞争对（COMPETITION PAIRS）')
        L.append('')
        L.append('AI Agent 生态的核心叙事张力 —— 每对代表一种正在进行的"路线之争"。')
        L.append('')
        L.append('| 对决 | 描述 | A side | B side | 7d 比例 |')
        L.append('|------|------|--------|--------|---------|')
        for p in pairs[:5]:
            fa = next((f[1] for f in fams if f[0] == p['familyA']), None)
            fb = next((f[1] for f in fams if f[0] == p['familyB']), None)
            if not fa or not fb:
                continue
            ca, cb = fa['count_7d'], fb['count_7d']
            ratio = f'{ca}:{cb}'
            la = fa['label']
            lb = fb['label']
            L.append(f'| **{p.get("label","")}** | {p.get("desc","")[:50]} | {la}（**{ca}**） | {lb}（**{cb}**） | `{ratio}` |')
        L.append('')

    L.append('---')
    L.append('')
    L.append('## 📊 数据明细')
    L.append('')
    L.append('| Family | 7d | Prior | 14d | Δ Accel | Trend (30d) | Status |')
    L.append('|--------|:--:|:-----:|:---:|:-------:|:------------|:------:|')
    for fam_name, fam in fams:
        spark = spark_unicode(fam['counts'][-14:] if len(fam['counts']) >= 14 else fam['counts'])
        a = fam['accel']
        accel_str = fmt_accel(a)
        if fam['status'] == 'surging':
            accel_md = f'🟢 ▲▲ **{accel_str}**'
        elif a >= 1.25:
            accel_md = f'🟢 ▲ **{accel_str}**'
        elif a <= 0.80:
            accel_md = f'🔴 ▼ **{accel_str}**'
        else:
            accel_md = f'·  {accel_str}'
        status_emoji = ('🟢 ▲▲' if fam['status'] == 'surging' else
                        ('🟢 ▲' if a >= 1.25 else ('🔴 ▼' if a <= 0.80 else '· ◆')))
        L.append(f'| `{fam["label"]}` | {fam["count_7d"]} | {fam["count_prior_7d"]} | '
                 f'{fam["count_14d"]} | {accel_md} | `{spark}` | {status_emoji} |')

    L.append('')
    L.append('---')
    L.append('')
    L.append('## 📖 图例说明')
    L.append('')
    L.append('- **7d / Prior / 14d**：该家族近 7 天 / 前 7 天 / 近 14 天的论文/工具提及次数')
    L.append('- **Δ Accel**：近 7 天日均 ÷ 前 7 天日均（≥2.0× = surging · ≥1.25× = 加速 · ≤0.80× = 减速）')
    L.append('- **Trend**：过去 14 天每天的 7 日滚动计数 sparkline')
    L.append('- **Status**：🟢 ▲▲ surging · 🟢 ▲ accel · · ◆ stable · 🔴 ▼ decl')
    L.append('')
    L.append('## 🔗 配套资源')
    L.append('')
    L.append('- 🌐 [Pulsar 照見 · AI 深挖看板](https://sou350121.github.io/pulsar-web/ai-deepdive/)')
    L.append('- 📡 [RSS 订阅](https://sou350121.github.io/pulsar-web/subscribe/) · 含 AI 每日 feed')
    L.append('- 📊 [Agent-Playbook 双周报告](https://sou350121.github.io/pulsar-web/reports/)')
    L.append('- 🎯 [VLA 配套：方法族趋势](https://github.com/sou350121/VLA-Handbook/blob/main/PULSE.md)')
    L.append('')
    L.append(f'> 由 `scripts/export-ai-pulse.py` 每日自动生成 · '
             f'最后更新 `{datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}` · CC BY 4.0')
    L.append('')
    return '\n'.join(L)


if __name__ == '__main__':
    snapshots = load_snapshots()
    if not snapshots:
        print('No AI snapshots found!')
        exit(1)
    series, last_date, total, days, pairs = build_series(snapshots, window=30)
    print(f'Loaded {len(snapshots)} snapshots · latest {last_date} · '
          f'{len(series)} families · {len(pairs)} competition pairs')
    OUT_SVG.parent.mkdir(parents=True, exist_ok=True)
    OUT_SVG.write_text(build_svg(series, last_date, total, days, pairs))
    OUT_MD.write_text(build_md(series, last_date, total, days, pairs))
    print(f'Wrote {OUT_SVG} ({OUT_SVG.stat().st_size} B)')
    print(f'Wrote {OUT_MD} ({OUT_MD.stat().st_size} B)')
