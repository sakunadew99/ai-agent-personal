"use client";
/* Today's plan, weekly insights, phone nudge and all-in net worth for the web app (same data as the phone). */
import { useEffect, useState } from "react";
import { apiRequest as call, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Donut } from "./Charts";

const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();

export function TodayPlanCard({ token, onOpen }: { token: string; onOpen?: (page: string) => void }) {
  const [p, setP] = useState<Row | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { call<Row>("/today/plan", token).then(setP).catch(() => setP(null)); }, [token]);
  if (!p || !(p.blocks as Row[]).length) return null;
  const blocks = (p.blocks as Row[]).filter(b => all || b.start_min + b.minutes >= nowMin());
  const next = blocks.find(b => b.kind !== "work" && b.start_min >= nowMin());
  return <Card kicker="Today's plan · built from your data" title={next ? `Next: ${next.start} ${next.title}` : "Your day"}
    action={<div className="d-row"><button className="text-button" onClick={() => setAll(a => !a)}>{all ? "What's left" : "Whole day"}</button>{onOpen && <button className="text-button" onClick={() => onOpen("Planner")}>Board ›</button>}</div>}>
    <div style={{ display: "grid", gap: 6 }}>{blocks.map((b, i) => <div key={i} className="d-row" style={{ flexWrap: "nowrap", borderLeft: `4px solid ${b.color}`, paddingLeft: 10, color: "var(--d-text)" }}>
      <span style={{ color: "var(--d-muted)", width: 100, flex: "none" }}>{b.start}–{b.end}</span><span style={{ flex: 1 }}>{b.title}</span>{b.note && <small className="d-note">{b.note}</small>}</div>)}</div>
    {(p.clashes as string[]).length > 0 && <p className="d-warn">⚠ {(p.clashes as string[]).join(" · ")}</p>}
    <p className="d-note">{p.best_focus ? `🎯 Your best focus hours are ${p.best_focus.from}–${p.best_focus.to}; deep work goes there. ` : ""}{(p.gaps as Row[]).length ? `Free: ${(p.gaps as Row[]).map(g => `${g.start}–${g.end}`).join(", ")}.` : ""}</p>
  </Card>;
}

export function NudgeBanner({ token }: { token: string }) {
  const [n, setN] = useState<Row | null>(null);
  useEffect(() => { call<Row>("/nudge", token).then(r => setN(r.nudge)).catch(() => setN(null)); }, [token]);
  if (!n) return null;
  return <div className="d-card" style={{ borderColor: n.level === "high" ? "var(--d-red)" : "var(--d-amber)" }}>
    <b style={{ color: "var(--d-text)" }}>📱 Phone check</b><p style={{ margin: 0, color: "var(--d-text)" }}>{n.text}</p></div>;
}

export function WeekInsightsCard({ token }: { token: string }) {
  const [w, setW] = useState<Row | null>(null);
  useEffect(() => { call<Row>("/insights/week", token).then(setW).catch(() => setW(null)); }, [token]);
  if (!w) return null;
  return <div className="d-grid-3">
    <Card kicker="This week" title={`${Math.round(w.totals.productive / 60)} h productive · ${Math.round(w.totals.wasted / 60)} h wasted`}>
      <Bars data={(w.days as Row[]).map((d, i, a) => ({ label: d.label, value: d.productive, highlight: i === a.length - 1, color: d.gym ? "var(--d-amber)" : "var(--d-green)" }))} height={120} format={x => `${(x / 60).toFixed(1)}h`}/>
      <ul className="d-list">{(w.insights as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
      <p className="d-note">Amber bars = gym days.</p></Card>
    <Card kicker="Time lost by hour" title="Logged waste + distracting apps">
      <Bars data={(w.waste_by_hour as Row[]).filter(h => h.hour >= 6).map(h => ({ label: h.hour % 3 === 0 ? String(h.hour) : "", value: h.minutes, color: "var(--d-red)" }))} height={100} format={x => `${x}m`}/>
      {(w.top_apps as Row[]).length > 0 && <p className="d-note">Top: {(w.top_apps as Row[]).map(a => `${a.label} ${a.minutes}m`).join(", ")}</p>}</Card>
  </div>;
}

export function NetWorthCard({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  useEffect(() => { call<Row>("/finance/all", token).then(setV).catch(() => setV(null)); }, [token]);
  if (!v || !(v.currencies as Row[]).length) return null;
  return <div className="d-programs">{(v.currencies as Row[]).map(c => <Card key={c.currency} kicker={`All-in net worth · ${c.currency}`} title={`${c.currency} ${Number(c.total).toLocaleString()}`}>
    <Donut size={130} format={x => `${c.currency} ${Math.round(x).toLocaleString()}`} parts={(c.parts as Row[]).filter(x => Number(x.amount) > 0).map(x => ({ label: x.label, value: Number(x.amount) }))}/>
    <p className="d-note">{(c.parts as Row[]).some(x => Number(x.amount) < 0) ? `Debts: ${(c.parts as Row[]).filter(x => Number(x.amount) < 0).map(x => Math.abs(Number(x.amount)).toLocaleString()).join(", ")}. ` : ""}
      {Number(c.monthly_subscriptions) > 0 ? `Subscriptions: ${Number(c.monthly_subscriptions).toLocaleString()}/month. ` : ""}{v.note}</p></Card>)}</div>;
}

/** Settings: privacy switches for AI and a full data export. */
export function PrivacyPanel({ token }: { token: string }) {
  const [s, setS] = useState<Row | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { call<Row>("/ai/usage", token).then(d => setS(d.settings)).catch(() => setS(null)); }, [token]);
  const save = (body: Row) => call<Row>("/ai/settings", token, { method: "PATCH", body: JSON.stringify(body) }).then(d => setS(d.settings)).catch(e => setMsg(e instanceof Error ? e.message : "Could not save"));
  async function exportAll() {
    try {
      const data = await call<Row>("/me/export", token);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = `sakuna-export-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
      setMsg(`Exported ${Object.values(data.counts as Record<string, number>).reduce((n, x) => n + x, 0)} records.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Export failed"); }
  }
  if (!s) return null;
  const keep = s.keep_activity_days ?? 0;
  return <div className="form-section"><h3>Privacy</h3>
    <label className="inline-check"><input type="checkbox" checked={!!s.share_journal} onChange={e => void save({ share_journal: e.target.checked })}/> Journal may go to the AI (only when you click Reflect)</label>
    <label className="inline-check"><input type="checkbox" checked={!!s.share_activity} onChange={e => void save({ share_activity: e.target.checked })}/> Day tracker may go to the AI (only when you click Coach me)</label>
    <label className="inline-check">Keep hour-by-hour entries and phone usage for{" "}
      <select value={keep} onChange={e => void save({ keep_activity_days: Number(e.target.value) })}><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option><option value={0}>forever</option></select></label>
    <div className="d-row"><button className="outline" onClick={() => void exportAll()}>⬇ Export all my data (JSON)</button>{msg && <span className="muted small-copy">{msg}</span>}</div>
    <p className="muted small-copy">The export has everything you've stored, without passwords, tokens or encrypted document numbers. The phone app also has a fingerprint / PIN lock (AI usage › Privacy).</p>
  </div>;
}
