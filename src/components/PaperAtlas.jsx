import { useState, useMemo, useEffect, useRef } from "react";

// ─── Momentum status helpers ────────────────────────────────────────────────
function momentumStatus(m) {
  if (m == null) return { label: "—", arrow: "", cls: "text-zinc-600" };
  if (m >= 4) return { label: "SURGE", arrow: "↑↑", cls: "text-red-400" };
  if (m >= 2.5) return { label: "ACCEL", arrow: "↑", cls: "text-amber-400" };
  if (m >= 1.2) return { label: "STABLE", arrow: "→", cls: "text-zinc-400" };
  return { label: "COOL", arrow: "↓", cls: "text-blue-400" };
}

function momentumColor(m, opacity = 1) {
  if (m == null) return `rgba(113,113,122,${opacity})`;
  if (m > 4) return `rgba(239,68,68,${opacity})`;
  if (m > 2) return `rgba(234,179,8,${opacity})`;
  return `rgba(59,130,246,${opacity})`;
}

// ─── Segmented Momentum Gauge ───────────────────────────────────────────────
function MomentumGauge({ m, size = "sm" }) {
  if (m == null) return <span className="text-[8px] text-zinc-700 font-mono tracking-wider">—</span>;
  const segments = 6;
  const filled = Math.min(m, 6);
  const hue = m > 4 ? "0" : m > 2 ? "45" : "210";
  const col = `hsl(${hue}, 85%, 60%)`;
  const glow = `hsl(${hue}, 90%, 50%)`;
  const isSm = size === "sm";
  const segW = isSm ? 3 : 6;
  const segH = isSm ? 3 : 5;

  return (
    <div className="flex items-center gap-1.5" title={`Momentum ${m.toFixed(1)}/6.0`}>
      <div className="flex items-center" style={{ gap: "1px" }}>
        {Array.from({ length: segments }, (_, i) => {
          const isFilled = i < filled;
          const isLast = i === Math.floor(filled) - 1 || (filled >= 6 && i === 5);
          return (
            <div key={i}
              className={`rounded-[1px] transition-all duration-500 ${isLast && isFilled ? "animate-[segPulse_2.5s_ease-in-out_infinite]" : ""}`}
              style={{
                width: segW, height: segH,
                background: isFilled ? col : "rgba(255,255,255,0.04)",
                boxShadow: isFilled ? `0 0 ${isSm ? 3 : 6}px ${glow}50` : "none",
                opacity: isFilled ? (i < Math.floor(filled) ? 1 : 0.7) : 1,
              }} />
          );
        })}
      </div>
      <span className={`${isSm ? "text-[8px]" : "text-[10px]"} font-mono tabular-nums font-bold`}
        style={{ color: col }}>{m.toFixed(1)}</span>
    </div>
  );
}

// ─── Stat pill ──────────────────────────────────────────────────────────────
function StatPill({ label, value, color = "zinc" }) {
  const colors = {
    zinc: "text-zinc-300",
    amber: "text-amber-400",
    emerald: "text-emerald-400",
    red: "text-red-400",
  };
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-zinc-600 tracking-wide">{label}</span>
      <span className={`text-[11px] font-bold font-mono tabular-nums ${colors[color]}`}>{value}</span>
    </div>
  );
}

// ─── Paper row ──────────────────────────────────────────────────────────────
function Row({ p, idx }) {
  const isNew = p.isNew;
  const isFeatured = !!p.f;
  return (
    <tr className={`
      group/row border-b transition-colors duration-150 text-[11px]
      ${isFeatured
        ? "border-amber-900/15 hover:bg-amber-950/15"
        : idx % 2 === 0
          ? "border-zinc-800/25 hover:bg-white/[0.02]"
          : "border-zinc-800/25 bg-white/[0.008] hover:bg-white/[0.025]"
      }
      ${isNew ? "bg-sky-950/10" : ""}
    `}>
      {/* Star */}
      <td className="py-1.5 px-1 text-center align-middle">
        {isFeatured ? (
          <span className="text-amber-400/90 text-[10px] drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]">★</span>
        ) : (
          <span className="text-zinc-800 text-[8px]">·</span>
        )}
      </td>
      {/* Name */}
      <td className="py-1.5 px-1.5 align-middle">
        <div className="flex items-center gap-1.5 relative overflow-hidden">
          {isFeatured && (
            <div className="absolute -left-[7px] top-1 bottom-1 w-[2px] rounded-full bg-amber-500/60" />
          )}
          <span className={`font-bold font-mono overflow-hidden text-ellipsis whitespace-nowrap group-hover/row:text-red-300 transition-colors ${
            isFeatured ? "text-red-400" : "text-red-400/70"
          }`} title={p.n}>{p.n}</span>
          {isNew && (
            <span className="text-[7px] px-1 py-[1px] rounded-sm font-bold tracking-wider shrink-0
              bg-sky-500/12 text-sky-400 border border-sky-500/15 backdrop-blur-sm
              animate-[breathe_3s_ease-in-out_infinite]">
              NEW
            </span>
          )}
        </div>
      </td>
      {/* Description */}
      <td className="py-1.5 px-1.5 align-middle">
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-zinc-500 group-hover/row:text-zinc-400 transition-colors" title={p.t}>
          {p.o}
        </div>
      </td>
      {/* Venue */}
      <td className="py-1.5 px-1 whitespace-nowrap text-zinc-500 font-mono text-[10px] tracking-tight align-middle">
        {p.v}
      </td>
      {/* Links */}
      <td className="py-1.5 px-1 whitespace-nowrap text-right align-middle">
        <span className="inline-flex gap-[3px] opacity-60 group-hover/row:opacity-100 transition-opacity">
          {p.ax && (
            <a href={`https://arxiv.org/abs/${p.ax}`} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1 py-[1px] rounded-sm
                bg-red-500/8 text-red-400/70 border border-red-500/15
                no-underline hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/30
                transition-all font-mono tabular-nums tracking-tight
                focus-visible:ring-1 focus-visible:ring-red-500/40 outline-none">
              {p.ax}
            </a>
          )}
          {p.c && (
            <a href={p.c} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1.5 py-[1px] rounded-sm font-bold
                bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15
                no-underline hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30
                transition-all tabular-nums
                focus-visible:ring-1 focus-visible:ring-emerald-500/40 outline-none">
              C
            </a>
          )}
          {p.w && (
            <a href={p.w} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1.5 py-[1px] rounded-sm font-bold
                bg-blue-500/10 text-blue-400/70 border border-blue-500/15
                no-underline hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500/30
                transition-all tabular-nums
                focus-visible:ring-1 focus-visible:ring-blue-500/40 outline-none">
              W
            </a>
          )}
        </span>
      </td>
    </tr>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function PaperAtlas({ categories = [], stats: propStats, updated, baseUrl = "/" }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState(categories[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState({});
  const [mounted, setMounted] = useState(false);
  const [revealedCats, setRevealedCats] = useState(new Set());
  const searchRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Staggered category reveal on mount
  useEffect(() => {
    if (!mounted) return;
    categories.forEach((c, i) => {
      setTimeout(() => setRevealedCats(prev => new Set(prev).add(c.id)), i * 40);
    });
  }, [mounted, categories]);

  // Restore collapsed state
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("atlas-collapsed") || "{}");
      if (Object.keys(stored).length) setCollapsed(stored);
    } catch {}
  }, []);

  // Compute stats
  const S = useMemo(() => {
    if (propStats) return propStats;
    const flat = categories.flatMap(c => c.subs.flatMap(s => s.papers.concat(s.recentPapers || [])));
    return {
      total: flat.length,
      featured: flat.filter(p => p.f).length,
      code: flat.filter(p => p.c).length,
      cats: categories.length,
    };
  }, [categories, propStats]);

  // Persist collapsed
  useEffect(() => {
    try { localStorage.setItem("atlas-collapsed", JSON.stringify(collapsed)); } catch {}
  }, [collapsed]);

  // Scroll-spy
  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => { for (const e of entries) if (e.isIntersecting) { setActiveId(e.target.id); break; } },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    categories.forEach(c => { const el = document.getElementById(c.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [categories]);

  // Keyboard shortcut: / to focus search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Filter + search
  const data = useMemo(() => {
    return categories
      .map(cat => ({
        ...cat,
        subs: cat.subs
          .map(s => {
            const allPapers = [...s.papers, ...(s.recentPapers || [])];
            return {
              ...s,
              papers: allPapers.filter(p => {
                if (filter === "featured" && !p.f) return false;
                if (filter === "code" && !p.c) return false;
                if (q) {
                  const ql = q.toLowerCase();
                  return (
                    p.n.toLowerCase().includes(ql) ||
                    (p.o || "").toLowerCase().includes(ql) ||
                    (p.t || "").toLowerCase().includes(ql)
                  );
                }
                return true;
              }),
            };
          })
          .filter(s => s.papers.length > 0),
      }))
      .filter(c => c.subs.length > 0);
  }, [categories, filter, q]);

  const toggle = id => setCollapsed(p => ({ ...p, [id]: !p[id] }));
  const subCount = categories.reduce((a, c) => a + c.subs.length, 0);
  const dateStr = updated || new Date().toISOString().slice(0, 10);

  // Compute total momentum average + sorted list
  const avgMomentum = useMemo(() => {
    const vals = categories.map(c => c.momentum).filter(m => m != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
  }, [categories]);

  const sortedByMomentum = useMemo(() =>
    categories.filter(c => c.momentum != null).sort((a, b) => b.momentum - a.momentum),
    [categories]
  );

  return (
    <div className={`min-h-screen bg-zinc-950 text-zinc-200 transition-opacity duration-700 ${mounted ? "opacity-100" : "opacity-0"}`}
      style={{ fontFamily: "'JetBrains Mono','Noto Sans TC',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700;800&family=Noto+Sans+TC:wght@300;400;500;700;900&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#27272a;border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:#3f3f46}
        html{scroll-behavior:smooth}table{border-collapse:collapse;width:100%}td,th{vertical-align:middle}
        @keyframes fadeSlideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes segPulse{0%,100%{opacity:0.7}50%{opacity:1}}
        @keyframes breathe{0%,100%{opacity:0.7;box-shadow:0 0 3px rgba(56,189,248,0.15)}50%{opacity:1;box-shadow:0 0 8px rgba(56,189,248,0.3)}}
        @keyframes catReveal{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .atlas-section-enter{animation:fadeSlideIn 0.3s ease-out both}
        .cat-reveal{animation:catReveal 0.35s ease-out both}
        .section-expand{overflow:hidden;transition:max-height 0.3s ease-out,opacity 0.2s ease-out}
        @media(prefers-reduced-motion:reduce){
          .cat-reveal,.atlas-section-enter{animation:none!important}
          .section-expand{transition:none!important}
          *{animation-duration:0.01ms!important;transition-duration:0.01ms!important}
        }
      `}</style>

      {/* ── Organic noise overlay ── */}
      <svg className="fixed inset-0 pointer-events-none z-[60] w-full h-full" style={{ opacity: 0.012 }}>
        <filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/></filter>
        <rect width="100%" height="100%" filter="url(#noise)"/>
      </svg>

      {/* ══════════ HEADER ══════════ */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/97 backdrop-blur-xl sticky top-0 z-50"
        style={{
          backgroundImage: "linear-gradient(180deg, rgba(239,68,68,0.02) 0%, transparent 100%)",
          borderImage: "linear-gradient(90deg, transparent, rgba(239,68,68,0.1) 50%, transparent) 1",
          boxShadow: "inset 0 -1px 0 rgba(239,68,68,0.06), 0 1px 3px rgba(0,0,0,0.3)",
        }}>
        <div className="max-w-[1440px] mx-auto px-4 py-2 flex items-center gap-3">
          <a href={baseUrl} className="text-zinc-600 hover:text-red-400 no-underline text-[10px] shrink-0 transition-colors">
            ‹ PULSAR
          </a>
          <div className="w-px h-4 bg-zinc-800/60" />
          <h1 className="text-[13px] font-black shrink-0 flex items-baseline gap-1"
            style={{ letterSpacing: "0.05em" }}>
            <span className="text-red-500" style={{ textShadow: "0 0 20px rgba(239,68,68,0.3), 0 0 40px rgba(239,68,68,0.1)" }}>PAPER</span>
            <span className="text-zinc-400 font-light">ATLAS</span>
          </h1>
          <span className="text-zinc-700 hidden sm:inline text-[10px] tracking-wide">
            VLA 前沿論文全景
          </span>

          {/* Stats strip */}
          <div className="hidden md:flex items-center gap-3 ml-auto mr-3">
            <StatPill label="收錄" value={S.total} color="zinc" />
            <div className="w-px h-3 bg-zinc-800/40" />
            <StatPill label="精選" value={S.featured} color="amber" />
            <div className="w-px h-3 bg-zinc-800/40" />
            <StatPill label="有碼" value={S.code} color="emerald" />
            <div className="w-px h-3 bg-zinc-800/40" />
            <StatPill label="動能" value={avgMomentum} color="red" />
          </div>

          {/* Filter + Search */}
          <div className="flex items-center gap-1 ml-auto md:ml-0">
            {[["all", "ALL"], ["featured", "★ FEATURED"], ["code", "</> CODE"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`relative px-2 py-[3px] rounded text-[9px] border cursor-pointer transition-all tracking-wide ${
                  filter === k
                    ? "bg-red-500/10 border-red-500/25 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.1)]"
                    : "bg-transparent border-zinc-800/40 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700/60"
                }`}>
                {l}
                {filter === k && (
                  <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 w-3 h-[2px] rounded-full bg-red-500/60" />
                )}
              </button>
            ))}
            <div className="relative ml-1">
              <input ref={searchRef} type="text" placeholder="搜尋 /" value={q} onChange={e => setQ(e.target.value)}
                className="w-24 bg-zinc-900/60 border border-zinc-800/40 rounded-md px-2 py-[3px] text-[10px]
                  text-zinc-400 placeholder-zinc-700 outline-none
                  focus:border-red-500/20 focus:ring-1 focus:ring-red-500/20
                  focus:w-44 focus:bg-zinc-900/80 focus:shadow-[0_0_12px_rgba(239,68,68,0.06)]
                  transition-all duration-300" />
            </div>
          </div>

          {/* Date */}
          <div className="hidden md:flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono shrink-0 ml-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 inline-block animate-[segPulse_3s_ease-in-out_infinite]"
              style={{ boxShadow: "0 0 6px rgba(16,185,129,0.4)" }} />
            <span className="tracking-wider tabular-nums">{dateStr}</span>
          </div>
        </div>

        {/* Mobile stats */}
        <div className="md:hidden max-w-[1440px] mx-auto px-4 pb-1.5 flex gap-3 overflow-x-auto">
          <StatPill label="收錄" value={S.total} color="zinc" />
          <StatPill label="精選" value={S.featured} color="amber" />
          <StatPill label="有碼" value={S.code} color="emerald" />
          <StatPill label="主題" value={S.cats} color="zinc" />
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto flex">
        {/* ══════════ SIDE NAV ══════════ */}
        <nav className="hidden lg:flex flex-col sticky top-[52px] self-start w-48 shrink-0 pt-4 pl-3 pb-8 gap-[2px]"
          style={{ maxHeight: "calc(100vh - 52px)", overflowY: "auto" }}>
          <div className="text-[8px] text-zinc-700 tracking-[0.2em] uppercase mb-2 pl-2">
            CATEGORIES
          </div>
          {categories.map(c => {
            const isActive = activeId === c.id;
            const cnt = c.subs.reduce((a, s) => a + s.papers.length + (s.recentPapers?.length || 0), 0);
            return (
              <a key={c.id} href={`#${c.id}`}
                className={`relative flex items-center gap-1.5 pl-2 pr-1.5 py-[5px] rounded-md text-[9px] no-underline transition-all duration-200 leading-tight border-l-2 ${
                  isActive
                    ? "bg-red-500/5 text-red-300 border-red-500"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02] border-transparent"
                }`}>
                <span className={`text-[10px] ${isActive ? "grayscale-0" : "grayscale opacity-60"} transition-all`}>{c.icon}</span>
                <span className="truncate flex-1 font-medium">{c.label}</span>
                <span className="text-[8px] font-mono tabular-nums text-zinc-700">{cnt}</span>
              </a>
            );
          })}

          {/* ── MOMENTUM PANEL (expanded) ── */}
          <div className="mt-3 pt-3 border-t border-zinc-800/30">
            <div className="bg-zinc-900/30 rounded-lg p-2.5">
              {/* Header with avg */}
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-[8px] text-zinc-700 tracking-[0.2em] uppercase">MOMENTUM</div>
                <span className="text-[9px] font-mono tabular-nums font-bold text-zinc-400" title="Average momentum">
                  avg {avgMomentum}
                </span>
              </div>

              {/* All categories sorted by momentum */}
              <div className="flex flex-col gap-[3px]">
                {sortedByMomentum.map((c, i) => {
                  const st = momentumStatus(c.momentum);
                  const cnt = c.subs.reduce((a, s) => a + s.papers.length + (s.recentPapers?.length || 0), 0);
                  return (
                    <a key={c.id} href={`#${c.id}`}
                      className="flex items-center gap-1 py-[3px] px-1 rounded no-underline hover:bg-white/[0.03] transition-colors group/m">
                      {/* Rank */}
                      <span className="text-[7px] text-zinc-700 font-mono tabular-nums w-3 shrink-0">{i + 1}</span>
                      {/* Icon */}
                      <span className="text-[8px] shrink-0 grayscale-[0.3] group-hover/m:grayscale-0 transition-all">{c.icon}</span>
                      {/* Label - full name */}
                      <span className="text-[8px] text-zinc-500 group-hover/m:text-zinc-300 truncate flex-1 transition-colors">
                        {c.label}
                      </span>
                      {/* Gauge */}
                      <MomentumGauge m={c.momentum} size="sm" />
                      {/* Status arrow */}
                      <span className={`text-[7px] font-mono font-bold w-3 text-right shrink-0 ${st.cls}`}>
                        {st.arrow}
                      </span>
                    </a>
                  );
                })}
              </div>

              {/* Momentum legend */}
              <div className="mt-2.5 pt-2 border-t border-zinc-800/20 flex items-center gap-2 text-[7px] text-zinc-700">
                <span className="text-red-400/60">↑↑SURGE</span>
                <span className="text-amber-400/60">↑ACCEL</span>
                <span className="text-zinc-500/60">→STABLE</span>
                <span className="text-blue-400/60">↓COOL</span>
              </div>
            </div>
          </div>
        </nav>

        {/* ══════════ CONTENT ══════════ */}
        <main className="flex-1 min-w-0 px-4 py-4 pb-16">
          {data.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <span className="text-2xl opacity-20">⌕</span>
              <span className="text-zinc-600 text-xs tracking-wide">沒有匹配的論文</span>
              <button onClick={() => { setQ(""); setFilter("all"); }}
                className="text-[10px] text-red-400/60 hover:text-red-400 cursor-pointer bg-transparent border border-red-500/15 rounded px-2 py-1 transition-colors">
                清除篩選
              </button>
            </div>
          ) : (
            data.map((cat) => {
              const total = cat.subs.reduce((a, s) => a + s.papers.length, 0);
              const feat = cat.subs.reduce((a, s) => a + s.papers.filter(p => p.f).length, 0);
              const isOpen = !collapsed[cat.id];
              const isRevealed = revealedCats.has(cat.id);
              const mCol = momentumColor(cat.momentum);

              return (
                <section key={cat.id} id={cat.id}
                  className={`mb-5 ${isRevealed ? "cat-reveal" : "opacity-0"}`}>
                  {/* ── Category header ── */}
                  <button onClick={() => toggle(cat.id)}
                    className="w-full text-left flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-lg cursor-pointer
                      bg-transparent border-none group/h hover:bg-white/[0.015] transition-all duration-200
                      backdrop-blur-sm"
                    style={{
                      background: "rgba(24,24,27,0.4)",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.02)",
                    }}>
                    <span className="text-base w-7 h-7 flex items-center justify-center rounded-md"
                      style={{ background: momentumColor(cat.momentum, 0.06) }}>
                      {cat.icon}
                    </span>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-bold text-zinc-200 transition-colors tracking-tight"
                          onMouseEnter={e => e.target.style.color = mCol}
                          onMouseLeave={e => e.target.style.color = ""}>
                          {cat.label}
                        </span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline">{cat.labelZh}</span>
                      </div>
                      <span className="text-[9px] text-zinc-700 hidden md:block truncate">
                        {cat.desc}
                      </span>
                    </div>

                    <span className="ml-auto flex items-center gap-3 shrink-0">
                      <MomentumGauge m={cat.momentum} size="md" />
                      <div className="flex items-center gap-1.5 text-[9px] font-mono">
                        <span className="text-zinc-600 tabular-nums">{total}</span>
                        <span className="text-amber-500/60 tabular-nums">★{feat}</span>
                      </div>
                      <svg className={`w-3 h-3 text-zinc-600 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                        viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M3 4.5L6 7.5L9 4.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </button>

                  {/* Gradient separator */}
                  <div className="h-px mx-2" style={{ background: `linear-gradient(90deg, transparent, ${momentumColor(cat.momentum, 0.12)}, transparent)` }} />

                  {/* ── Category body ── */}
                  <div className={`section-expand ${isOpen ? "max-h-[9999px] opacity-100" : "max-h-0 opacity-0"}`}>
                    <div className="relative ml-1 pl-3">
                      <div className="absolute left-0 top-0 bottom-0 w-px"
                        style={{ background: `linear-gradient(to bottom, ${momentumColor(cat.momentum, 0.2)}, transparent)` }} />

                      {cat.subs.map((sub) => (
                        <div key={sub.id} className="mb-3">
                          {/* Subcategory header */}
                          <div className="flex items-center gap-2 py-1.5 mt-1">
                            <div className="w-[2px] h-2 rounded-full" style={{ background: momentumColor(cat.momentum, 0.5) }} />
                            <span className="text-[10px] font-semibold text-zinc-300 uppercase tracking-[0.12em]">
                              {sub.label}
                            </span>
                            <div className="flex-1 h-px border-t border-dashed border-zinc-800/30" />
                            <span className="text-[8px] text-zinc-700 font-mono tabular-nums">{sub.papers.length}</span>
                          </div>

                          {/* Paper table — fixed columns + thead + mobile scroll */}
                          <div className="overflow-x-auto rounded" style={{ background: "rgba(9,9,11,0.5)" }}>
                            <table className="table-fixed min-w-[600px]">
                              <colgroup>
                                <col style={{ width: "28px" }} />
                                <col style={{ width: "22%" }} />
                                <col style={{ width: "40%" }} />
                                <col style={{ width: "10%" }} />
                                <col style={{ width: "28%" }} />
                              </colgroup>
                              <thead>
                                <tr className="text-[8px] text-zinc-700 uppercase tracking-[0.15em] border-b border-zinc-800/20">
                                  <th className="py-1 px-1 font-normal text-center">★</th>
                                  <th className="py-1 px-1.5 font-normal text-left">Name</th>
                                  <th className="py-1 px-1.5 font-normal text-left">Description</th>
                                  <th className="py-1 px-1 font-normal text-left">Venue</th>
                                  <th className="py-1 px-1 font-normal text-right">Links</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sub.papers.map((p, i) => <Row key={p.ax || p.n} p={p} idx={i} />)}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })
          )}

          {/* ── Footer ── */}
          <footer className="mt-10 pt-4"
            style={{ boxShadow: "0 -1px 3px rgba(0,0,0,0.2)" }}>
            <div className="h-px mb-4" style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.12) 30%, rgba(239,68,68,0.12) 70%, transparent)" }} />
            <div className="flex items-center justify-between text-[9px] text-zinc-600 font-mono">
              <div className="flex items-center gap-2">
                <span className="text-red-500/60 font-bold tracking-wider" style={{ letterSpacing: "0.05em" }}>PAPER ATLAS</span>
                <span className="text-zinc-800">·</span>
                <span>PULSAR 照見</span>
                <span className="text-zinc-800">·</span>
                <span className="tabular-nums">{S.total} papers</span>
              </div>
              <div className="flex items-center gap-2">
                <a href={baseUrl} className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Home</a>
                <span className="text-zinc-800">·</span>
                <a href="https://github.com/sou350121/VLA-Handbook" className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Handbook</a>
                <span className="text-zinc-800">·</span>
                <a href="https://sota.evomind-tech.com" className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Evo-SOTA</a>
              </div>
            </div>
            <div className="mt-4 mb-2 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.1) 20%, rgba(239,68,68,0.1) 80%, transparent)" }} />
            <div className="text-center text-[8px] text-zinc-700 tracking-[0.3em] uppercase pb-2 tabular-nums">
              {dateStr} · {S.cats} categories · {subCount} subcategories
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
