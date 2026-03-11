import { useState, useMemo, useEffect, useRef } from "react";

// ─── Momentum gauge ──────────────────────────────────────────────────────────
function MomentumGauge({ m, size = "sm" }) {
  if (m == null) return <span className="text-[8px] text-zinc-700 font-mono tracking-wider">—</span>;
  const pct = Math.min((m / 6) * 100, 100);
  const hue = m > 4 ? "0" : m > 2 ? "45" : "210";
  const col = `hsl(${hue}, 85%, 60%)`;
  const glow = `hsl(${hue}, 90%, 50%)`;
  const isSm = size === "sm";
  return (
    <div className="flex items-center gap-1.5" title={`Momentum ${m.toFixed(1)}/6.0`}>
      <div className={`${isSm ? "w-10 h-[3px]" : "w-16 h-[4px]"} rounded-full overflow-hidden`}
        style={{ background: "rgba(255,255,255,0.04)" }}>
        <div className="h-full rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${col}44, ${col})`,
            boxShadow: `0 0 ${isSm ? 4 : 8}px ${glow}40`,
          }} />
      </div>
      <span className={`${isSm ? "text-[8px]" : "text-[10px]"} font-mono tabular-nums font-bold`}
        style={{ color: col }}>{m.toFixed(1)}</span>
    </div>
  );
}

// ─── Stat pill ───────────────────────────────────────────────────────────────
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

// ─── Paper row ───────────────────────────────────────────────────────────────
function Row({ p, idx }) {
  const isNew = p.isNew;
  const isFeatured = !!p.f;
  return (
    <tr className={`
      group/row border-b transition-all duration-150 text-[11px]
      ${isFeatured
        ? "border-amber-900/15 hover:bg-amber-950/15"
        : "border-zinc-800/25 hover:bg-white/[0.02]"
      }
      ${isNew ? "bg-sky-950/10" : ""}
    `}
      style={{ animationDelay: `${idx * 12}ms` }}
    >
      {/* Star */}
      <td className="py-[4px] px-1 w-4 text-center">
        {isFeatured ? (
          <span className="text-amber-400/90 text-[10px] drop-shadow-[0_0_3px_rgba(251,191,36,0.4)]">★</span>
        ) : (
          <span className="text-zinc-800 text-[8px]">·</span>
        )}
      </td>
      {/* Name */}
      <td className={`py-[4px] px-1.5 font-bold font-mono whitespace-nowrap ${
        isFeatured ? "text-red-400" : "text-red-400/70"
      }`}>
        <span className="group-hover/row:text-red-300 transition-colors">{p.n}</span>
        {isNew && (
          <span className="ml-1.5 text-[7px] px-1 py-[1px] rounded-sm font-bold tracking-wider
            bg-sky-500/15 text-sky-400 border border-sky-500/20 align-middle
            animate-[pulse_3s_ease-in-out_infinite]">
            NEW
          </span>
        )}
      </td>
      {/* Description */}
      <td className="py-[4px] px-1.5 text-zinc-500 max-w-xs truncate group-hover/row:text-zinc-400 transition-colors" title={p.t}>
        {p.o}
      </td>
      {/* Venue */}
      <td className="py-[4px] px-1 whitespace-nowrap text-zinc-600 font-mono text-[10px] tracking-tight">
        {p.v}
      </td>
      {/* Links */}
      <td className="py-[4px] px-1 whitespace-nowrap text-right">
        <span className="inline-flex gap-[3px] opacity-60 group-hover/row:opacity-100 transition-opacity">
          {p.ax && (
            <a href={`https://arxiv.org/abs/${p.ax}`} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1 py-[1px] rounded-sm
                bg-red-500/8 text-red-400/70 border border-red-500/15
                no-underline hover:bg-red-500/15 hover:text-red-300 hover:border-red-500/30
                transition-all font-mono tracking-tight">
              {p.ax}
            </a>
          )}
          {p.c && (
            <a href={p.c} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1.5 py-[1px] rounded-sm font-bold
                bg-emerald-500/10 text-emerald-400/70 border border-emerald-500/15
                no-underline hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/30
                transition-all">
              C
            </a>
          )}
          {p.w && (
            <a href={p.w} target="_blank" rel="noopener noreferrer"
              className="text-[8px] px-1.5 py-[1px] rounded-sm font-bold
                bg-blue-500/10 text-blue-400/70 border border-blue-500/15
                no-underline hover:bg-blue-500/20 hover:text-blue-300 hover:border-blue-500/30
                transition-all">
              W
            </a>
          )}
        </span>
      </td>
    </tr>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export default function PaperAtlas({ categories = [], stats: propStats, updated, baseUrl = "/" }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState(categories[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState({});
  const [mounted, setMounted] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

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

  // Compute total momentum average
  const avgMomentum = useMemo(() => {
    const vals = categories.map(c => c.momentum).filter(m => m != null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
  }, [categories]);

  return (
    <div className={`min-h-screen bg-zinc-950 text-zinc-200 transition-opacity duration-500 ${mounted ? "opacity-100" : "opacity-0"}`}
      style={{ fontFamily: "'JetBrains Mono','Noto Sans TC',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700;800&family=Noto+Sans+TC:wght@300;400;500;700;900&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#27272a;border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:#3f3f46}
        html{scroll-behavior:smooth}table{border-collapse:collapse;width:100%}td{vertical-align:middle}
        @keyframes scanline{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        @keyframes fadeSlideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes glowPulse{0%,100%{opacity:0.5}50%{opacity:1}}
        .atlas-section-enter{animation:fadeSlideIn 0.25s ease-out both}
        .nav-glow{box-shadow:inset 2px 0 0 hsl(0,85%,60%),0 0 12px hsl(0,85%,60%,0.08)}
      `}</style>

      {/* ── Scanline overlay (atmospheric) ── */}
      <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden opacity-[0.015]"
        style={{ background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)" }} />

      {/* ══════════ HEADER ══════════ */}
      <header className="border-b border-zinc-800/60 bg-zinc-950/97 backdrop-blur-xl sticky top-0 z-50"
        style={{ backgroundImage: "linear-gradient(180deg, rgba(239,68,68,0.02) 0%, transparent 100%)" }}>
        <div className="max-w-[1440px] mx-auto px-4 py-2 flex items-center gap-3">
          {/* Logo cluster */}
          <a href={baseUrl} className="text-zinc-600 hover:text-red-400 no-underline text-[10px] shrink-0 transition-colors">
            ‹ PULSAR
          </a>
          <div className="w-px h-4 bg-zinc-800/60" />
          <h1 className="text-[13px] font-black tracking-tight shrink-0 flex items-baseline gap-1">
            <span className="text-red-500" style={{ textShadow: "0 0 20px rgba(239,68,68,0.3)" }}>PAPER</span>
            <span className="text-zinc-400 font-light">ATLAS</span>
          </h1>
          <span className="text-zinc-700 hidden sm:inline text-[10px] tracking-wide">
            VLA 前沿論文全景
          </span>

          {/* Stats strip — integrated into header */}
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
                className={`px-2 py-[3px] rounded text-[9px] border cursor-pointer transition-all tracking-wide ${
                  filter === k
                    ? "bg-red-500/10 border-red-500/25 text-red-300 shadow-[0_0_8px_rgba(239,68,68,0.1)]"
                    : "bg-transparent border-zinc-800/40 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700/60"
                }`}>
                {l}
              </button>
            ))}
            <div className="relative ml-1">
              <input ref={searchRef} type="text" placeholder="搜尋 /" value={q} onChange={e => setQ(e.target.value)}
                className="w-24 bg-zinc-900/60 border border-zinc-800/40 rounded-md px-2 py-[3px] text-[10px]
                  text-zinc-400 placeholder-zinc-700 outline-none
                  focus:border-red-500/30 focus:w-44 focus:bg-zinc-900/80 focus:shadow-[0_0_12px_rgba(239,68,68,0.06)]
                  transition-all duration-300" />
            </div>
          </div>

          {/* Date */}
          <div className="hidden md:flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono shrink-0 ml-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/80 inline-block animate-[glowPulse_3s_ease-in-out_infinite]"
              style={{ boxShadow: "0 0 6px rgba(16,185,129,0.4)" }} />
            <span className="tracking-wider">{dateStr}</span>
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
        <nav className="hidden lg:flex flex-col sticky top-[52px] self-start w-44 shrink-0 pt-4 pl-3 pb-8 gap-[2px]"
          style={{ maxHeight: "calc(100vh - 52px)", overflowY: "auto" }}>
          <div className="text-[8px] text-zinc-700 tracking-[0.2em] uppercase mb-2 pl-2">
            CATEGORIES
          </div>
          {categories.map(c => {
            const isActive = activeId === c.id;
            const cnt = c.subs.reduce((a, s) => a + s.papers.length + (s.recentPapers?.length || 0), 0);
            return (
              <a key={c.id} href={`#${c.id}`}
                className={`relative flex items-center gap-1.5 pl-2 pr-1.5 py-[5px] rounded-md text-[9px] no-underline transition-all duration-200 leading-tight ${
                  isActive
                    ? "bg-red-500/8 text-red-300 nav-glow"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]"
                }`}>
                <span className={`text-[10px] ${isActive ? "grayscale-0" : "grayscale opacity-60"} transition-all`}>{c.icon}</span>
                <span className="truncate flex-1 font-medium">{c.label}</span>
                <span className="text-[8px] font-mono tabular-nums text-zinc-700">{cnt}</span>
              </a>
            );
          })}

          {/* Nav momentum overview */}
          <div className="mt-3 pt-3 border-t border-zinc-800/30 pl-2">
            <div className="text-[8px] text-zinc-700 tracking-[0.2em] uppercase mb-2">MOMENTUM</div>
            {categories.filter(c => c.momentum != null).sort((a, b) => b.momentum - a.momentum).slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center gap-1.5 py-[2px]">
                <span className="text-[8px] text-zinc-600 w-12 truncate">{c.label.split(" ")[0]}</span>
                <MomentumGauge m={c.momentum} size="sm" />
              </div>
            ))}
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
            data.map((cat, catIdx) => {
              const total = cat.subs.reduce((a, s) => a + s.papers.length, 0);
              const feat = cat.subs.reduce((a, s) => a + s.papers.filter(p => p.f).length, 0);
              const isOpen = !collapsed[cat.id];

              return (
                <section key={cat.id} id={cat.id} className="mb-5">
                  {/* ── Category header ── */}
                  <button onClick={() => toggle(cat.id)}
                    className="w-full text-left flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-lg cursor-pointer
                      bg-transparent border-none group/h hover:bg-white/[0.015] transition-all duration-200"
                    style={{ animationDelay: `${catIdx * 40}ms` }}>
                    {/* Icon with glow */}
                    <span className="text-base w-7 h-7 flex items-center justify-center rounded-md"
                      style={{ background: "rgba(255,255,255,0.03)" }}>
                      {cat.icon}
                    </span>

                    {/* Title cluster */}
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-bold text-zinc-200 group-hover/h:text-red-400 transition-colors tracking-tight">
                          {cat.label}
                        </span>
                        <span className="text-[9px] text-zinc-600 hidden sm:inline">{cat.labelZh}</span>
                      </div>
                      <span className="text-[9px] text-zinc-700 hidden md:block truncate">
                        {cat.desc}
                      </span>
                    </div>

                    {/* Right: momentum + counts + chevron */}
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

                  {/* ── Category body ── */}
                  {isOpen && (
                    <div className="atlas-section-enter ml-1 pl-3 border-l border-zinc-800/30"
                      style={{ borderImage: `linear-gradient(to bottom, ${cat.momentum > 4 ? "rgba(239,68,68,0.2)" : cat.momentum > 2 ? "rgba(234,179,8,0.15)" : "rgba(59,130,246,0.1)"}, transparent) 1` }}>
                      {cat.subs.map((sub, subIdx) => (
                        <div key={sub.id} className="mb-3" style={{ animationDelay: `${subIdx * 30}ms` }}>
                          {/* Subcategory header */}
                          <div className="flex items-center gap-2 py-1.5 mt-1">
                            <div className="w-1 h-1 rounded-full bg-zinc-700" />
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.12em]">
                              {sub.label}
                            </span>
                            <div className="flex-1 h-px bg-zinc-800/30" />
                            <span className="text-[8px] text-zinc-700 font-mono tabular-nums">{sub.papers.length}</span>
                          </div>

                          {/* Paper table */}
                          <table>
                            <tbody>
                              {sub.papers.map((p, i) => <Row key={p.n} p={p} idx={i} />)}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })
          )}

          {/* ── Footer ── */}
          <footer className="mt-10 pt-4 border-t border-zinc-800/30">
            <div className="flex items-center justify-between text-[9px] text-zinc-700 font-mono">
              <div className="flex items-center gap-2">
                <span className="text-red-500/60 font-bold tracking-wider">PAPER ATLAS</span>
                <span className="text-zinc-800">·</span>
                <span>PULSAR 照見</span>
                <span className="text-zinc-800">·</span>
                <span>{S.total} papers</span>
              </div>
              <div className="flex items-center gap-2">
                <a href={baseUrl} className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Home</a>
                <span className="text-zinc-800">·</span>
                <a href="https://github.com/sou350121/VLA-Handbook" className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Handbook</a>
                <span className="text-zinc-800">·</span>
                <a href="https://sota.evomind-tech.com" className="text-zinc-600 hover:text-red-400 no-underline transition-colors">Evo-SOTA</a>
              </div>
            </div>
            {/* Decorative line */}
            <div className="mt-4 mb-2 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(239,68,68,0.1) 20%, rgba(239,68,68,0.1) 80%, transparent)" }} />
            <div className="text-center text-[8px] text-zinc-800 tracking-[0.3em] uppercase pb-2">
              {dateStr} · {S.cats} categories · {subCount} subcategories
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
}
