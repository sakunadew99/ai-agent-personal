"use client";
/* CSE portfolio tools (ATrad import, add a share you own, daily review) and your video library (Drive / YouTube). */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, postJson, type JsonRecord as Row } from "@/lib/api";
import { Card, Hero, LineChart, Ring, Stat } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const rs = (v: unknown) => (v == null ? "—" : `Rs ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const sg = (v: unknown, s = "") => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${s}`);
const col = (v: unknown) => (v == null ? "var(--d-muted)" : Number(v) >= 0 ? "var(--d-green)" : "var(--d-red)");
const root = (s: string) => { const [r, c] = String(s).split("."); return c && c[0] !== "N" ? `${r}.${c[0]}` : r; };
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "";
const ACTION: Record<string, string> = { "Add on dips": "var(--d-green)", "Accumulate slowly": "var(--d-green)", Hold: "var(--d-blue)", "Watch closely": "var(--d-amber)",
  "Trim / take some profit": "var(--d-amber)", "Review / consider stop-loss": "var(--d-red)" };

export function HoldingsTable({ items }: { items: Row[] }) {
  if (!items.length) return null;
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", color: "var(--d-text)", fontSize: 13 }}>
    <thead><tr style={{ color: "var(--d-muted)", textAlign: "right" }}>{["Share", "Qty", "Avg", "Price", "Today", "Value", "Unrealised", "%", "After fees", "B.E.S", "Weight"].map((h, i) =>
      <th key={h} style={{ padding: "6px 8px", textAlign: i ? "right" : "left", borderBottom: "1px solid var(--d-line)" }}>{h}</th>)}</tr></thead>
    <tbody>{items.map(h => <tr key={h.symbol} style={{ textAlign: "right" }}>
      <td style={{ textAlign: "left", padding: "6px 8px", fontWeight: 800 }}>{root(h.symbol)}</td><td>{Number(h.quantity).toLocaleString()}</td><td>{Number(h.avg_cost).toFixed(2)}</td>
      <td>{h.price ?? "—"}</td><td style={{ color: col(h.day_change) }}>{sg(h.day_change)} <small>({sg(h.change_pct, "%")})</small></td><td>{rs(h.value)}</td>
      <td style={{ color: col(h.unrealised), fontWeight: 800 }}>{sg(h.unrealised)}</td><td style={{ color: col(h.unrealised_pct), fontWeight: 800 }}>{sg(h.unrealised_pct, "%")}</td>
      <td style={{ color: col(h.net_gain_after_fees) }}>{sg(h.net_gain_after_fees)}</td><td>{h.break_even_price ?? "—"}</td><td>{h.weight_pct}%</td></tr>)}</tbody></table></div>;
}

export function PortfolioTools({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [one, setOne] = useState({ symbol: "", quantity: "", avg_price: "" });
  const [review, setReview] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  async function preview(file: File) {
    setBusy("preview"); setNote("");
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`${API_ORIGIN}/api/v1/invest/portfolio/preview`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("sakuna-access") || token}` }, body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.detail || `Upload failed (${res.status})`);
      setRows(out.rows);
    } catch (e) { setNote(errText(e)); } finally { setBusy(""); }
  }
  async function save() {
    try { const out = await call<Row>("/invest/portfolio/import", token, postJson({ rows: (rows || []).filter(r => r.avg_price).map(r => ({ symbol: r.symbol, quantity: r.quantity, avg_price: r.avg_price })), replace: true }));
      setRows(null); setNote(`Imported ${out.saved} holdings.`); onChanged(); } catch (e) { setNote(errText(e)); }
  }
  const loadReview = (ai = false) => { setBusy("review"); call<Row>(`/invest/review${ai ? "?ai=true" : ""}`, token).then(setReview).catch(e => setNote(errText(e))).finally(() => setBusy("")); };
  const m: Row = review?.market || {};
  return <div className="d-dash">
    <div className="d-grid-2">
      <Card kicker="Import from ATrad" title="Portfolio PDF or CSV">
        <p className="d-note">In ATrad: Portfolio → Print → Save as PDF. You'll see the holdings before anything is saved.</p>
        <label className="d-btn ghost" style={{ cursor: "pointer", justifySelf: "start" }}>{busy === "preview" ? "Reading…" : "📄 Choose file"}<input type="file" accept=".pdf,.csv,.txt" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void preview(f); e.target.value = ""; }}/></label>
        {rows && <>
          {rows.map((r, i) => <div key={r.symbol} className="d-row"><b style={{ color: "var(--d-text)", width: 90 }}>{root(r.symbol)}</b>
            <input className="d-input" style={{ maxWidth: 110 }} value={r.quantity} onChange={e => setRows(x => x!.map((y, j) => j === i ? { ...y, quantity: Number(e.target.value) } : y))}/>
            <span className="d-note">@</span><input className="d-input" style={{ maxWidth: 110 }} value={r.avg_price ?? ""} onChange={e => setRows(x => x!.map((y, j) => j === i ? { ...y, avg_price: Number(e.target.value) } : y))}/>
            <button className="danger-link" onClick={() => setRows(x => x!.filter((_, j) => j !== i))}>✕</button></div>)}
          <div className="d-row"><button className="d-btn" onClick={() => void save()}>✓ Save {rows.length} holdings</button><span className="d-note">Replaces the previous import; your own trades stay.</span></div></>}
      </Card>
      <Card kicker="Add a share I own" title="No trade history needed">
        <div className="d-row"><input className="d-input" placeholder="Symbol, e.g. COMB or COMB.X0000" value={one.symbol} onChange={e => setOne({ ...one, symbol: e.target.value.toUpperCase() })}/>
          <input className="d-input" style={{ maxWidth: 120 }} placeholder="Qty" value={one.quantity} onChange={e => setOne({ ...one, quantity: e.target.value })}/>
          <input className="d-input" style={{ maxWidth: 130 }} placeholder="Avg cost" value={one.avg_price} onChange={e => setOne({ ...one, avg_price: e.target.value })}/>
          <button className="d-btn" disabled={!one.symbol || !one.quantity || !one.avg_price} onClick={() => void call("/invest/holdings", token, postJson({ symbol: one.symbol, quantity: Number(one.quantity), avg_price: Number(one.avg_price) }))
            .then(() => { setOne({ symbol: "", quantity: "", avg_price: "" }); setNote("Share added."); onChanged(); }).catch(e => setNote(errText(e)))}>Add</button></div>
        <p className="d-note">Values, today's change and gain/loss update every day after the market closes.</p>
      </Card>
    </div>
    {note && <p className="d-note">{note}</p>}
    <Card kicker="📊 Portfolio review" title={review ? `${rs(review.value)} · ${sg(review.unrealised_pct, "%")} unrealised` : "Signals, forecast and market context for every share"}
      action={<div className="d-row"><button className="d-btn" disabled={busy === "review"} onClick={() => loadReview()}>{busy === "review" ? "Analysing…" : review ? "↻ Refresh" : "Run review"}</button>
        {review && <button className="d-btn ghost" onClick={() => loadReview(true)}>✨ AI summary</button>}</div>}>
      {!review ? <p className="d-note">Reads a year of CSE prices per share, the ASPI, Brent oil, USD/LKR and gold, plus your news, then explains a suggestion for each holding. First run takes ~20 s.</p> : <>
        <div className="d-stats">
          <Stat label="ASPI" icon={m.aspi_trend === "up" ? "▲" : "▼"} value={m.aspi ? Number(m.aspi).toLocaleString() : "—"} tone={m.aspi_trend === "up" ? "green" : "red"} hint={`${sg(m.aspi_1m_pct, "%")} 1 month`}/>
          <Stat label="Brent oil" icon="🛢" value={m.brent ? `$${m.brent}` : "—"} tone="amber" hint={`${sg(m.brent_1m_pct, "%")} 1 month`}/>
          <Stat label="USD / LKR" icon="💱" value={m.usd_lkr ?? "—"} tone="blue" hint={`${sg(m.usd_lkr_1m_pct, "%")} 1 month`}/>
          <Stat label="Today" icon="📈" value={sg(review.day_change)} tone={review.day_change >= 0 ? "green" : "red"} hint="portfolio change"/>
        </div>
        <ul className="d-list">{(m.notes as string[] || []).map((x, i) => <li key={i}>{x}</li>)}{(review.portfolio_notes as string[]).map((x, i) => <li key={`p${i}`} style={{ color: "var(--d-amber)" }}>{x}</li>)}</ul>
        <pre className="d-plan">{String(review.summary).replace(/\*\*/g, "")}</pre>
        <div className="d-programs">{(review.holdings as Row[]).map(h => { const s: Row = h.suggestion, ind: Row = h.indicators || {}, f: Row | null = ind.forecast;
          return <article key={h.symbol} className="d-program" style={{ borderLeft: `4px solid ${ACTION[s.action] || "var(--d-line)"}` }}>
            <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{root(h.symbol)}</h4><span className="d-tag" style={{ color: ACTION[s.action] }}>{s.action}</span></div>
            <p>{Number(h.quantity).toLocaleString()} sh · {sg(h.unrealised_pct, "%")} · RSI {ind.rsi14 ?? "—"} · 1M {sg(ind.ret_1m, "%")}</p>
            {(ind.spark as number[] || []).length > 5 && <LineChart series={[{ name: "price", values: ind.spark as number[] }]} labels={(ind.spark as number[]).map(() => "")} height={70}/>}
            {f && <p style={{ color: col(f.expected_change_pct) }}>Model, 2 weeks: {sg(f.expected_change_pct, "%")} (range {f.low}–{f.high})</p>}
            <ul className="d-list">{(s.reasons as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
            {(h.news as Row[]).map(n => <a key={n.url} href={n.url} target="_blank" rel="noreferrer" style={{ color: n.tone === "negative" ? "var(--d-red)" : n.tone === "positive" ? "var(--d-green)" : "var(--d-text)", fontSize: 12.5 }}>📰 {n.title}</a>)}
          </article>; })}</div>
        <p className="d-note">{review.disclaimer}</p>
      </>}
    </Card>
  </div>;
}

export function VideosPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [form, setForm] = useState({ url: "", title: "", folder: "My videos" });
  const [shown, setShown] = useState("All");
  const [playing, setPlaying] = useState<Row | null>(null);
  const [opened, setOpened] = useState(0);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/media", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  function close() {
    if (playing) { const mins = Math.round((Date.now() - opened) / 60000); if (mins >= 1) void call(`/media/${playing.id}`, token, { method: "PATCH", body: JSON.stringify({ add_minutes: mins }) }).then(load); }
    setPlaying(null);
  }
  if (!v) return <div className="d-empty">Loading your videos…</div>;
  const items = (v.items as Row[]).filter(i => shown === "All" || i.folder === shown);
  return <div className="d-dash">
    {playing && <div role="dialog" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.85)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(1100px, 100%)", display: "grid", gap: 10 }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "#fff" }}>{playing.title}</b><button className="d-btn" onClick={close}>✕ Close</button></div>
        <iframe title={playing.title} src={playing.play_url} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 16, background: "#000" }}/>
      </div></div>}
    <Hero kicker="My videos · Google Drive & YouTube" title="Your own" accent="library" sub={v.tip} right={<Ring value={Math.min(100, (v.minutes_total / 600) * 100)} size={120} label={`${v.minutes_total}`} sub="min watched"/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        <input className="d-input" placeholder="https://drive.google.com/file/d/…/view" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}/>
        <input className="d-input" style={{ maxWidth: 220 }} placeholder="Title (optional)" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/>
        <input className="d-input" style={{ maxWidth: 160 }} placeholder="Folder" value={form.folder} onChange={e => setForm({ ...form, folder: e.target.value })}/>
        <button className="d-btn" disabled={form.url.trim().length < 8} onClick={() => void call("/media", token, postJson({ url: form.url.trim(), title: form.title || undefined, folder: form.folder || "My videos" }))
          .then(() => { setForm({ ...form, url: "", title: "" }); load(); }).catch(e => setNote(errText(e)))}>＋ Add</button></div>
      {note && <p className="d-note">{note}</p>}
    </Hero>
    <div className="d-chips">{["All", ...(v.folders as string[])].map(f => <button key={f} className={`d-chip ${shown === f ? "on" : ""}`} onClick={() => setShown(f)}>📁 {f}</button>)}</div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>{items.map(m => <article key={m.id} className="d-card" style={{ padding: 12, gap: 8 }}>
      <button onClick={() => { if (m.is_folder) window.open(m.url, "_blank"); else { setPlaying(m); setOpened(Date.now()); } }} style={{ all: "unset", cursor: "pointer", display: "grid", gap: 6 }}>
        {m.thumb ? <img src={m.thumb} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 12, background: "var(--d-card2)" }}/>
          : <div style={{ aspectRatio: "16/9", borderRadius: 12, background: "var(--d-card2)", display: "grid", placeItems: "center", fontSize: 32 }}>{m.is_folder ? "📁" : "▶"}</div>}
        <b style={{ color: "var(--d-text)" }}>{m.title}</b></button>
      <div className="d-row" style={{ justifyContent: "space-between" }}><small className="d-note">{m.provider === "drive" ? "Drive" : m.provider === "youtube" ? "YouTube" : "Web"} · {m.folder}{m.minutes_watched ? ` · ${m.minutes_watched} min` : ""}</small>
        <button className="danger-link" onClick={() => { if (window.confirm("Remove from library?")) void call(`/media/${m.id}`, token, { method: "DELETE" }).then(load); }}>✕</button></div>
    </article>)}</div>
    {!items.length && <div className="d-empty">No videos yet. In Google Drive: Share → “Anyone with the link” → Copy link, then paste it above.</div>}
  </div>;
}
