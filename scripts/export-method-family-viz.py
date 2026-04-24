#!/usr/bin/env python3
"""
export-method-family-viz.py
─────────────────────────────
Generate an aesthetic SVG + MD snapshot of VLA method-family trends
from pulsar-web's field-state JSON snapshots.

Aesthetic: dark financial-terminal (Bloomberg-inspired) matching pulsar-web
palette — amber/cyan accents, mono type, clean grid.

Output:
  VLA-Handbook/assets/method-family-trends.svg
  VLA-Handbook/assets/method-family-trends.md

Run daily after data sync.
"""
import json
import os
import glob
from datetime import datetime
from pathlib import Path

DATA_DIR = Path('/home/claudeuser/pulsar-web/src/data')
OUT_DIR_SVG = Path(os.environ.get('MFV_OUT_DIR', '/tmp/mfv-out')) / 'method-family-trends.svg'
OUT_DIR_MD = Path(os.environ.get('MFV_OUT_DIR', '/tmp/mfv-out')) / 'method-family-trends.md'

# ─────── palette (matches pulsar-web CSS tokens) ───────
BG = '#1a1f2e'
PANEL = '#232833'
GRID = '#2a3142'
TEXT = '#e5e2d9'
TEXT_DIM = '#8a90a0'
TEXT_SUBTLE = '#5c6478'
AMBER = '#d4910a'
AMBER_DIM = '#a87208'
CYAN = '#0f8fa0'
GREEN = '#3d8b5e'
RED = '#c8484d'
NEUTRAL = '#5c6478'

# ─────── load snapshots ───────
def load_snapshots():
    """Load all field-state-*.json sorted by date, return list of (date, trends)."""
    files = sorted(glob.glob(str(DATA_DIR / 'field-state-*.json')))
    out = []
    for f in files:
        try:
            with open(f) as fh:
                d = json.load(fh)
            date = d.get('date') or os.path.basename(f).replace('field-state-', '').replace('.json', '')
            trends = d.get('method_trends', [])
            if trends:
                out.append({'date': date, 'trends': trends, 'total': d.get('total_papers_scanned', 0)})
        except Exception as e:
            continue
    return out


def build_family_timeseries(snapshots, window=30):
    """Build {family: {dates, counts[], accels[], latest}} across last N snapshots."""
    last = snapshots[-window:] if len(snapshots) > window else snapshots
    all_families = set()
    for s in last:
        for t in s['trends']:
            all_families.add(t['family'])

    series = {}
    for fam in all_families:
        counts, accels = [], []
        for s in last:
            m = next((t for t in s['trends'] if t['family'] == fam), None)
            counts.append(m.get('count_7d', 0) if m else 0)
            accels.append(m.get('acceleration', 1.0) if m else 1.0)
        # Pull latest snapshot's metrics
        latest_m = next((t for t in last[-1]['trends'] if t['family'] == fam), None)
        if not latest_m:
            continue
        series[fam] = {
            'counts': counts,
            'accels': accels,
            'count_7d': latest_m.get('count_7d', 0),
            'count_14d': latest_m.get('count_14d', 0),
            'count_30d': latest_m.get('count_30d', 0),
            'accel_7d': latest_m.get('acceleration', 1.0),
            'accel_14d': latest_m.get('acceleration_14d', 1.0),
            'accel_30d': latest_m.get('acceleration_30d', 1.0),
            'status': latest_m.get('status', 'stable'),
        }
    return series, last[-1]['date'], last[-1].get('total', 0), len(last)


# ─────── aesthetic helpers ───────
def status_color(accel):
    if accel >= 1.25:
        return GREEN
    if accel <= 0.80:
        return RED
    return NEUTRAL


def status_glyph(accel):
    if accel >= 1.25:
        return '▲'
    if accel <= 0.80:
        return '▼'
    return '◆'


def spark_unicode(counts):
    """Unicode block sparkline (for MD)."""
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


def format_accel(a):
    """Display accel relative to 1.0 baseline as +X% / -Y%."""
    pct = (a - 1.0) * 100
    sign = '+' if pct > 0 else ''
    return f'{sign}{pct:.0f}%'


# ─────── SVG generation ───────
def build_svg(series, last_date, total, days):
    # Sort by count_7d desc
    fams = sorted(series.items(), key=lambda x: -x[1]['count_7d'])
    n = len(fams)

    # Dimensions
    W = 960
    row_h = 34
    header_h = 88
    footer_h = 62
    H = header_h + n * row_h + footer_h

    # Column positions (left-aligned x)
    col_name_x = 24
    col_bar_x = 180
    col_bar_w = 200
    col_7d_x = 410
    col_14d_x = 456
    col_30d_x = 502
    col_a7_x = 560
    col_a14_x = 620
    col_a30_x = 680
    col_spark_x = 740
    col_spark_w = 150
    col_status_x = 912

    # Bar scaling: width by count_7d proportion to max
    max_7d = max((f[1]['count_7d'] for f in fams), default=1) or 1

    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" '
           f'style="background:{BG}">']

    # Background + subtle gradient sheen
    svg.append(f'<defs>'
               f'<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
               f'<stop offset="0%" stop-color="{BG}"/>'
               f'<stop offset="100%" stop-color="#141822"/>'
               f'</linearGradient>'
               f'<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">'
               f'<stop offset="0%" stop-color="{AMBER}" stop-opacity="0.8"/>'
               f'<stop offset="100%" stop-color="{AMBER_DIM}" stop-opacity="0.4"/>'
               f'</linearGradient>'
               f'</defs>')
    svg.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="url(#bg)"/>')

    # Header
    svg.append(f'<g>')
    # Title
    svg.append(f'<text x="{col_name_x}" y="36" fill="{AMBER}" font-size="18" font-weight="700" '
               f'letter-spacing="0.12em">METHOD FAMILY TRENDS</text>')
    # Subtitle
    svg.append(f'<text x="{col_name_x}" y="58" fill="{TEXT_DIM}" font-size="11" '
               f'letter-spacing="0.05em">VLA RESEARCH MOMENTUM · PULSAR 照見</text>')

    # Right side stats chip
    chip_x = W - 24
    svg.append(f'<text x="{chip_x}" y="30" fill="{CYAN}" font-size="11" text-anchor="end" '
               f'letter-spacing="0.08em">DATA · {last_date}</text>')
    svg.append(f'<text x="{chip_x}" y="46" fill="{TEXT_DIM}" font-size="10" text-anchor="end">'
               f'{total} papers · {days}d window · {n} families</text>')
    svg.append(f'<text x="{chip_x}" y="62" fill="{TEXT_SUBTLE}" font-size="9" text-anchor="end">'
               f'sou350121.github.io/pulsar-web</text>')

    # Divider
    svg.append(f'<line x1="{col_name_x}" y1="74" x2="{W-24}" y2="74" stroke="{GRID}" stroke-width="1"/>')

    # Column headers — numeric cols right-aligned to same x as numbers below
    hy = header_h - 6
    header_labels = [
        (col_name_x, 'FAMILY', 'start'),
        (col_bar_x, '7d VOLUME', 'start'),
        (col_7d_x + 36, '7d', 'end'),
        (col_14d_x + 36, '14d', 'end'),
        (col_30d_x + 36, '30d', 'end'),
        (col_a7_x + 25, 'Δ7d', 'middle'),
        (col_a14_x + 25, 'Δ14d', 'middle'),
        (col_a30_x + 25, 'Δ30d', 'middle'),
        (col_spark_x + col_spark_w // 2, 'TREND', 'middle'),
        (col_status_x, 'ST', 'middle'),
    ]
    for x, t, anchor in header_labels:
        svg.append(f'<text x="{x}" y="{hy}" fill="{TEXT_SUBTLE}" font-size="9" '
                   f'letter-spacing="0.1em" text-anchor="{anchor}">{t}</text>')
    svg.append(f'</g>')

    # Rows
    for i, (fam_name, fam) in enumerate(fams):
        y = header_h + i * row_h
        row_center_y = y + row_h // 2 + 4

        # Subtle row highlight for accelerating / declining
        if fam['accel_7d'] >= 1.25:
            # Faint green tint for accelerating rows
            svg.append(f'<rect x="{col_name_x - 8}" y="{y}" width="{W - 40}" height="{row_h}" '
                       f'fill="{GREEN}" opacity="0.06"/>')
            svg.append(f'<rect x="{col_name_x - 8}" y="{y}" width="3" height="{row_h}" '
                       f'fill="{GREEN}" opacity="0.6"/>')
        elif fam['accel_7d'] <= 0.80:
            svg.append(f'<rect x="{col_name_x - 8}" y="{y}" width="{W - 40}" height="{row_h}" '
                       f'fill="{RED}" opacity="0.04"/>')
            svg.append(f'<rect x="{col_name_x - 8}" y="{y}" width="3" height="{row_h}" '
                       f'fill="{RED}" opacity="0.5"/>')

        # Row separator (subtle)
        if i > 0:
            svg.append(f'<line x1="{col_name_x}" y1="{y}" x2="{W-24}" y2="{y}" '
                       f'stroke="{GRID}" stroke-width="0.5"/>')

        # Family name
        display_name = fam_name.replace('_', ' ')
        svg.append(f'<text x="{col_name_x}" y="{row_center_y}" fill="{TEXT}" font-size="12">'
                   f'{display_name}</text>')

        # Volume bar
        bar_w = (fam['count_7d'] / max_7d) * col_bar_w
        svg.append(f'<rect x="{col_bar_x}" y="{y + row_h//2 - 8}" width="{bar_w:.1f}" height="16" '
                   f'fill="url(#bar)" rx="2"/>')
        # Bar frame
        svg.append(f'<rect x="{col_bar_x}" y="{y + row_h//2 - 8}" width="{col_bar_w}" height="16" '
                   f'fill="none" stroke="{GRID}" stroke-width="0.5" rx="2"/>')

        # Numbers (right-aligned within their columns)
        for x, val in [(col_7d_x + 36, fam['count_7d']),
                       (col_14d_x + 36, fam['count_14d']),
                       (col_30d_x + 36, fam['count_30d'])]:
            svg.append(f'<text x="{x}" y="{row_center_y}" fill="{TEXT}" font-size="12" '
                       f'text-anchor="end">{val}</text>')

        # Accel pills
        for x, accel_v in [(col_a7_x + 25, fam['accel_7d']),
                           (col_a14_x + 25, fam['accel_14d']),
                           (col_a30_x + 25, fam['accel_30d'])]:
            col = status_color(accel_v)
            txt = format_accel(accel_v)
            svg.append(f'<text x="{x}" y="{row_center_y}" fill="{col}" font-size="11" '
                       f'text-anchor="middle" font-weight="600">{txt}</text>')

        # Sparkline chart area
        if fam['counts']:
            counts = fam['counts']
            max_c = max(counts) or 1
            bar_w_inner = col_spark_w / max(len(counts), 1)
            for j, c in enumerate(counts):
                bx = col_spark_x + j * bar_w_inner
                bh = (c / max_c) * 20 if max_c > 0 else 0
                by = y + row_h // 2 + 10 - bh
                # Latest bar is amber, others cyan fade
                is_latest = (j == len(counts) - 1)
                fill = AMBER if is_latest else CYAN
                op = 0.85 if is_latest else 0.4 + 0.35 * (j / len(counts))
                svg.append(f'<rect x="{bx:.1f}" y="{by:.1f}" width="{max(bar_w_inner-1,1):.1f}" '
                           f'height="{max(bh, 1):.1f}" fill="{fill}" opacity="{op:.2f}"/>')

        # Status glyph
        gc = status_color(fam['accel_7d'])
        svg.append(f'<text x="{col_status_x}" y="{row_center_y}" fill="{gc}" font-size="14" '
                   f'text-anchor="middle" font-weight="700">{status_glyph(fam["accel_7d"])}</text>')

    # Footer
    fy = H - footer_h + 18
    svg.append(f'<line x1="{col_name_x}" y1="{H - footer_h + 6}" x2="{W-24}" y2="{H - footer_h + 6}" '
               f'stroke="{GRID}" stroke-width="1"/>')
    # Legend
    legend_items = [
        (GREEN, '▲', '加速（≥1.25x）'),
        (NEUTRAL, '◆', '稳定（0.80-1.25x）'),
        (RED, '▼', '减速（≤0.80x）'),
    ]
    lx = col_name_x
    for col, glyph, text in legend_items:
        svg.append(f'<text x="{lx}" y="{fy}" fill="{col}" font-size="12" font-weight="700">{glyph}</text>')
        svg.append(f'<text x="{lx + 18}" y="{fy}" fill="{TEXT_DIM}" font-size="10">{text}</text>')
        lx += 170
    # Build credit
    svg.append(f'<text x="{W-24}" y="{fy}" fill="{TEXT_SUBTLE}" font-size="9" text-anchor="end">'
               f'Generated {datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")} · '
               f'CC BY 4.0</text>')
    # Source note
    svg.append(f'<text x="{col_name_x}" y="{fy + 20}" fill="{TEXT_SUBTLE}" font-size="9">'
               f'Δ = ratio of recent-window daily-avg / prior-window daily-avg '
               f'(&gt;1 = acceleration, &lt;1 = deceleration)</text>')

    svg.append('</svg>')
    return '\n'.join(svg)


# ─────── MD generation ───────
def build_md(series, last_date, total, days):
    fams = sorted(series.items(), key=lambda x: -x[1]['count_7d'])

    lines = []
    lines.append('# Method Family Trends · VLA 方法族趋势')
    lines.append('')
    lines.append(f'> 🖼️ **数据日期**: `{last_date}` · **窗口**: 最近 `{days}` 天 · **累计论文**: `{total}` 篇 · **家族数**: `{len(fams)}`')
    lines.append('>')
    lines.append('> 每日自动生成 · 数据源 [pulsar-web vla-deepdive](https://sou350121.github.io/pulsar-web/vla-deepdive/)')
    lines.append('')
    lines.append('![Method Family Trends](method-family-trends.svg)')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 📊 数据明细')
    lines.append('')
    lines.append('| Family | 7d | 14d | 30d | Δ7d | Δ14d | Δ30d | Trend | Status |')
    lines.append('|--------|:--:|:---:|:---:|:---:|:----:|:----:|:------|:------:|')

    for fam_name, fam in fams:
        display = fam_name.replace('_', ' ')
        spark = spark_unicode(fam['counts'][-14:] if len(fam['counts']) >= 14 else fam['counts'])
        a7 = fam['accel_7d']
        a14 = fam['accel_14d']
        a30 = fam['accel_30d']

        def acc_md(a):
            pct = format_accel(a)
            if a >= 1.25:
                return f'🟢 **{pct}**'
            if a <= 0.80:
                return f'🔴 **{pct}**'
            return f'·  {pct}'

        status_emoji = '🟢 ▲' if a7 >= 1.25 else ('🔴 ▼' if a7 <= 0.80 else '· ◆')
        lines.append(f'| `{display}` | {fam["count_7d"]} | {fam["count_14d"]} | {fam["count_30d"]} | '
                     f'{acc_md(a7)} | {acc_md(a14)} | {acc_md(a30)} | `{spark}` | {status_emoji} |')

    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 📖 图例说明')
    lines.append('')
    lines.append('- **7d / 14d / 30d**：该家族近 7 / 14 / 30 天内出现的论文篇数')
    lines.append('- **Δ7d / Δ14d / Δ30d**：近窗口与前一窗口每日平均的比值（>1.25 加速 / <0.80 减速）')
    lines.append('- **Trend**：过去 14 天每天的 7 日滚动计数 sparkline')
    lines.append('- **Status**：🟢 ▲ 加速 · · ◆ 稳定 · 🔴 ▼ 减速')
    lines.append('')
    lines.append('## 🔗 相关资源')
    lines.append('')
    lines.append('- 🌐 [Pulsar 照見 · VLA 深挖实时看板](https://sou350121.github.io/pulsar-web/vla-deepdive/)')
    lines.append('- 📡 [RSS 订阅](https://sou350121.github.io/pulsar-web/subscribe/)')
    lines.append('- 📊 [VLA 数据工程指南](../theory/foundation/vla_data_engineering_guide.md)')
    lines.append('')
    lines.append(f'> 本快照由 `scripts/export-method-family-viz.py` 每日自动生成 · 'f'最后更新 `{datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")}` · CC BY 4.0')
    lines.append('')
    return '\n'.join(lines)


# ─────── main ───────
if __name__ == '__main__':
    snapshots = load_snapshots()
    if not snapshots:
        print('No snapshots found!')
        exit(1)
    series, last_date, total, days = build_family_timeseries(snapshots, window=30)
    print(f'Loaded {len(snapshots)} snapshots · latest {last_date} · {len(series)} families')

    OUT_DIR_SVG.parent.mkdir(parents=True, exist_ok=True)
    OUT_DIR_SVG.write_text(build_svg(series, last_date, total, days))
    OUT_DIR_MD.write_text(build_md(series, last_date, total, days))
    print(f'Wrote {OUT_DIR_SVG} ({OUT_DIR_SVG.stat().st_size} B)')
    print(f'Wrote {OUT_DIR_MD} ({OUT_DIR_MD.stat().st_size} B)')
