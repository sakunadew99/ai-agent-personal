"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";

const ICON: Record<string, string> = { work: "💼", money: "💰", health: "💪", learning: "📚", relationships: "🤝", rest: "🌿", home: "🏠" };
const HOW: Record<string, string> = {
  focus_hours_work: "Focus hours on work tasks", money_days: "Days you recorded money", active_days: "Workout or steps-target days",
  learning_days: "Days with reviews, learning tasks or study focus", tasks_done_personal: "Home & personal tasks finished", manual: "Logged by you",
};
const shiftWeek = (iso: string, by: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + by * 7); return d.toISOString().slice(0, 10); };
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" });

/** Whole-life balance (guide 20): target vs actual per area this week, never a single "life score". */
export function BalancePage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [error, setError] = useState(""); const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [custom, setCustom] = useState({ name: "", unit: "sessions", weekly_target: "2" });
  const load = useCallback(() => {
    apiRequest<Row>(`/balance${week ? `?week=${week}` : ""}`, token).then(setV).catch(r => setError(r instanceof Error ? r.message : "Could not load"));
  }, [token, week]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) {
    setError("");
    try { await work; setMsg(note); load(); } catch (r) { setError(r instanceof Error ? r.message : "Something went wrong"); }
  }
  function addArea(e: FormEvent) {
    e.preventDefault();
    void run(apiRequest("/balance/areas", token, postJson(custom)).then(() => setCustom({ ...custom, name: "" })), "Area added.");
  }
  if (!v) return error ? <p className="warning-copy">{error}</p> : <p className="muted">Loading…</p>;
  const areas = v.areas as Row[];

  return <>
    <section className="panel balance-hero">
      <div className="balance-week">
        <button className="outline" aria-label="Previous week" onClick={() => setWeek(shiftWeek(v.week_start, -1))}>‹</button>
        <div><p className="eyebrow">{v.is_current_week ? "THIS WEEK" : "WEEK OF"}</p><h2>{fmtDay(v.week_start)} – {fmtDay(v.week_end)}</h2></div>
        <button className="outline" aria-label="Next week" disabled={v.is_current_week} onClick={() => setWeek(shiftWeek(v.week_start, 1))}>›</button>
        {!v.is_current_week && <button className="text-button" onClick={() => setWeek(null)}>This week</button>}
      </div>
      <div className="balance-score"><b>{v.met}</b><span>of {v.total} areas on target</span></div>
      <div className="balance-mini">{areas.map(a => <span key={a.id} title={`${a.name}: ${a.percent ?? 0}%`} className={`mini status-${a.status}`} style={{ ["--p" as string]: `${Math.min(100, a.percent ?? 0)}%` }}/>)}</div>
    </section>
    {(v.warnings as string[]).map(w => <div className="notice-card balance-warn" key={w}>⚠ {w}</div>)}
    {msg && <p className="success-note">{msg}</p>}{error && <p className="warning-copy">{error}</p>}

    <div className="area-grid">{areas.map(a => {
      const pct = Math.min(100, a.percent ?? 0);
      const max = Math.max(Number(a.target) || 1, ...a.last_weeks.map(Number), Number(a.actual));
      return <section className={`panel area-card status-${a.status}`} key={a.id}>
        <div className="area-top"><span className="area-icon">{ICON[a.key] || "⭐"}</span><b>{a.name}</b>
          <span className={`area-chip status-${a.status}`}>{a.status === "met" ? "on target" : a.status === "zero" ? "nothing yet" : `${a.percent}%`}</span></div>
        <div className="area-ring" style={{ ["--p" as string]: `${pct}%` }}><div><b>{Number(a.actual).toLocaleString()}</b><small>/ {Number(a.target).toLocaleString()} {a.unit}</small></div></div>
        <div className="area-spark" aria-label="Last 3 weeks and this week">{[...a.last_weeks, Number(a.actual)].map((n: number, i: number) =>
          <span key={i} className={i === 3 ? "now" : ""} style={{ height: `${Math.max(6, n / max * 100)}%` }} title={`${n} ${a.unit}`}/>)}</div>
        <small className="muted area-how">{HOW[a.metric] || a.metric}{a.metric !== "manual" ? " · plus anything you log" : ""}</small>
        {v.is_current_week && <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <button className="outline" onClick={() => void run(apiRequest(`/balance/areas/${a.id}/log`, token, postJson({ amount: 1 })), `+1 ${a.unit} for ${a.name}.`)}>+1 {a.unit}</button>
          {editing === a.id
            ? <form className="target-edit" onSubmit={e => { e.preventDefault(); void run(apiRequest(`/balance/areas/${a.id}`, token, patchJson({ weekly_target: target })), "Target updated.").then(() => setEditing(null)); }}>
                <input value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" aria-label="Weekly target" autoFocus/><button className="primary">Save</button></form>
            : <button className="text-button" onClick={() => { setEditing(a.id); setTarget(String(a.target)); }}>Target</button>}
          <button className="danger-link" title="Hide this area" onClick={() => { if (window.confirm(`Hide ${a.name}? You can add it back later.`)) void run(apiRequest(`/balance/areas/${a.id}`, token, patchJson({ active: false })), "Area hidden."); }}>Hide</button>
        </div>}
      </section>;
    })}</div>

    <div className="grid main-grid">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">ADD AN AREA</p><h2>Something else that matters</h2></div></div>
        <form className="inline-form" onSubmit={addArea}>
          <input value={custom.name} onChange={e => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Music, Faith, Volunteering" required maxLength={60}/>
          <input value={custom.unit} onChange={e => setCustom({ ...custom, unit: e.target.value })} placeholder="unit" maxLength={20} className="qty-input"/>
          <input value={custom.weekly_target} onChange={e => setCustom({ ...custom, weekly_target: e.target.value })} inputMode="decimal" className="qty-input" aria-label="Weekly target"/>
          <button className="primary" disabled={!custom.name.trim()}>Add</button>
        </form></section>
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">SIGNALS</p><h2>Rest check</h2></div></div>
        <p className="muted">{v.signals.avg_sleep_hours != null ? `Sleep averaged ${v.signals.avg_sleep_hours} h over ${v.signals.sleep_nights_logged} logged nights.` : "No sleep logged this week. Sync your band or add sleep in Health."}</p>
        <small className="muted">{v.note}</small></section>
    </div>
  </>;
}
