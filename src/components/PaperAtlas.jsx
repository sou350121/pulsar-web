import { useState, useMemo, useEffect } from "react";

// ─── Momentum bar ───────────────────────────────────────────────────────────
function Mx({ m }) {
  if (m == null) return <span className="text-[8px] text-zinc-800 font-mono">—</span>;
  const w = Math.min((m / 6) * 100, 100);
  const col = m > 4 ? "#ef4444" : m > 2 ? "#eab308" : "#3b82f6";
  return (
    <div className="flex items-center gap-1" title={`Momentum ${m}`}>
      <div className="w-12 h-[3px] bg-zinc-800 rounded-full overflow-hidden">
        <div style={{ width: `${w}%`, background: col }} className="h-full rounded-full" />
      </div>
      <span className="text-[8px] font-mono" style={{ color: col }}>{m.toFixed(1)}</span>
    </div>
  );
}

// ─── Paper row ──────────────────────────────────────────────────────────────
function Row({ p }) {
  const isNew = p.isNew;
  return (
    <tr className={`border-b border-zinc-800/40 hover:bg-red-950/10 transition-colors text-[11px] ${isNew ? "bg-amber-950/10" : ""}`}>
      <td className="py-[3px] px-1 w-3 text-center">
        {p.f ? <span className="text-amber-500 text-[9px]">★</span> : <span className="text-zinc-800">·</span>}
      </td>
      <td className="py-[3px] px-1 font-bold text-red-400 font-mono whitespace-nowrap">
        {p.n}
        {isNew && (
          <span className="ml-1 text-[7px] px-1 py-[0.5px] rounded bg-blue-950/50 text-blue-400/80 border border-blue-900/30 align-middle">NEW</span>
        )}
      </td>
      <td className="py-[3px] px-1 text-zinc-500 max-w-xs truncate" title={p.t}>{p.o}</td>
      <td className="py-[3px] px-1 whitespace-nowrap text-zinc-700 font-mono text-[10px]">{p.v}</td>
      <td className="py-[3px] px-1 whitespace-nowrap text-right">
        {p.ax && (
          <a href={`https://arxiv.org/abs/${p.ax}`} target="_blank" rel="noopener noreferrer"
            className="text-[8px] px-1 py-[1px] rounded bg-red-950/50 text-red-400/80 border border-red-900/30 no-underline hover:brightness-150 font-mono mr-0.5">
            {p.ax}
          </a>
        )}
        {p.c && (
          <a href={p.c} target="_blank" rel="noopener noreferrer"
            className="text-[8px] px-1 py-[1px] rounded bg-emerald-950/50 text-emerald-400/80 border border-emerald-900/30 no-underline hover:brightness-150 mr-0.5">
            C
          </a>
        )}
        {p.w && (
          <a href={p.w} target="_blank" rel="noopener noreferrer"
            className="text-[8px] px-1 py-[1px] rounded bg-blue-950/50 text-blue-400/80 border border-blue-900/30 no-underline hover:brightness-150">
            W
          </a>
        )}
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

  // Restore collapsed state from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("atlas-collapsed") || "{}");
      if (Object.keys(stored).length) setCollapsed(stored);
    } catch {}
  }, []);

  // Compute stats from categories if not provided via props
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

  // Persist collapsed state
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

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200" style={{ fontFamily: "'JetBrains Mono','Noto Sans TC',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;700;800&family=Noto+Sans+TC:wght@300;400;700;900&display=swap');
        *{box-sizing:border-box;margin:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:2px}
        html{scroll-behavior:smooth}table{border-collapse:collapse;width:100%}td{vertical-align:middle}
      `}</style>

      {/* Header Bar */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-3 py-1.5 flex items-center gap-3 text-[10px]">
          <a href={baseUrl} className="text-zinc-700 hover:text-red-400 no-underline shrink-0">
            &lsaquo; PULSAR
          </a>
          <h1 className="text-xs font-black shrink-0">
            <span className="text-red-500">PAPER</span>
            <span className="text-zinc-400"> ATLAS</span>
          </h1>
          <span className="text-zinc-800">|</span>
          <span className="text-zinc-600 hidden sm:inline">VLA 前沿論文全景</span>
          <div className="flex items-center gap-1 ml-auto">
            {[["all", "ALL"], ["featured", "★"], ["code", "</>"]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`px-1.5 py-[1px] rounded text-[9px] border cursor-pointer transition-all ${
                  filter === k
                    ? "bg-red-950/60 border-red-800/40 text-red-300"
                    : "bg-transparent border-zinc-800/60 text-zinc-700 hover:text-zinc-400"
                }`}>
                {l}
              </button>
            ))}
            <input type="text" placeholder="&#x2315;" value={q} onChange={e => setQ(e.target.value)}
              className="w-24 bg-zinc-900/80 border border-zinc-800/60 rounded px-1.5 py-[1px] text-[10px] text-zinc-400 placeholder-zinc-700 outline-none focus:border-red-800/60 focus:w-40 transition-all ml-1" />
          </div>
          <div className="hidden md:flex items-center gap-1 text-[8px] text-zinc-700 font-mono shrink-0">
            <span className="w-1 h-1 rounded-full bg-emerald-500 inline-block" />
            {dateStr}
          </div>
        </div>
        {/* Stats ticker */}
        <div className="max-w-[1440px] mx-auto px-3 pb-1 flex gap-4 text-[9px] font-mono text-zinc-700">
          <span>收錄 <b className="text-zinc-400">{S.total}</b></span>
          <span>精選 <b className="text-amber-500">{S.featured}</b></span>
          <span>有碼 <b className="text-emerald-500">{S.code}</b></span>
          <span>主題 <b className="text-zinc-400">{S.cats}</b></span>
          <span className="hidden sm:inline">Sub <b className="text-zinc-400">{subCount}</b></span>
        </div>
      </header>

      <div className="max-w-[1440px] mx-auto flex">
        {/* Side Nav */}
        <nav className="hidden lg:block sticky top-16 self-start w-40 shrink-0 pt-3 pl-2 pb-8"
          style={{ maxHeight: "calc(100vh - 4rem)", overflowY: "auto" }}>
          {categories.map(c => {
            const cnt = c.subs.reduce((a, s) => a + s.papers.length + (s.recentPapers?.length || 0), 0);
            return (
              <a key={c.id} href={`#${c.id}`}
                className={`flex items-center gap-1 px-1.5 py-[3px] rounded text-[9px] no-underline transition-all leading-tight ${
                  activeId === c.id ? "bg-red-950/30 text-red-300" : "text-zinc-600 hover:text-zinc-400"
                }`}>
                <span className="text-[9px]">{c.icon}</span>
                <span className="truncate flex-1">{c.label}</span>
                <Mx m={c.momentum} />
              </a>
            );
          })}
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 px-3 py-3 pb-16">
          {data.length === 0 ? (
            <div className="text-center py-20 text-zinc-700 text-xs">&#x1F50D; 沒有匹配</div>
          ) : (
            data.map(cat => {
              const total = cat.subs.reduce((a, s) => a + s.papers.length, 0);
              const feat = cat.subs.reduce((a, s) => a + s.papers.filter(p => p.f).length, 0);
              const isOpen = !collapsed[cat.id];

              return (
                <section key={cat.id} id={cat.id} className="mb-4">
                  <button onClick={() => toggle(cat.id)}
                    className="w-full text-left flex items-center gap-2 py-1.5 cursor-pointer bg-transparent border-none group/h">
                    <span className="text-sm">{cat.icon}</span>
                    <span className="text-[11px] font-bold text-zinc-300 group-hover/h:text-red-400 transition-colors">{cat.label}</span>
                    <span className="text-[9px] text-zinc-700">{cat.labelZh}</span>
                    <span className="text-[8px] text-zinc-800 italic ml-0.5 hidden md:inline">— {cat.desc}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <Mx m={cat.momentum} />
                      <span className="text-[9px] text-zinc-700 font-mono w-6 text-right">{total}</span>
                      <span className="text-[9px] text-amber-700 font-mono w-5">★{feat}</span>
                      <span className={`text-zinc-700 text-[9px] transition-transform ${isOpen ? "" : "rotate-[-90deg]"}`}>&#x25BE;</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="border-l border-zinc-800/60 ml-2 pl-2">
                      {cat.subs.map(sub => (
                        <div key={sub.id} className="mb-2">
                          <div className="flex items-center gap-1 py-0.5">
                            <span className="text-[8px] text-zinc-700">&#x25CF;</span>
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">{sub.label}</span>
                            <span className="text-[8px] text-zinc-800 font-mono">{sub.papers.length}</span>
                          </div>
                          <table>
                            <tbody>
                              {sub.papers.map(p => <Row key={p.n} p={p} />)}
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

          <footer className="mt-8 pt-3 border-t border-zinc-800/50 text-center text-[9px] text-zinc-800 font-mono pb-4">
            <span className="text-red-700">PAPER ATLAS</span> · PULSAR 照見 · {S.total} papers ·{" "}
            <a href={baseUrl} className="text-zinc-700 hover:text-red-400 no-underline">Home</a> ·{" "}
            <a href="https://github.com/sou350121/VLA-Handbook" className="text-zinc-700 hover:text-red-400 no-underline">Handbook</a> ·{" "}
            <a href="https://sota.evomind-tech.com" className="text-zinc-700 hover:text-red-400 no-underline">Evo-SOTA</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
