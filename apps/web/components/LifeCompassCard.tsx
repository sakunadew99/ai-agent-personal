"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, postJson, type JsonRecord as Row } from "@/lib/api";

const STATUS: Record<string, string> = { done: "target met", on_track: "on track", behind: "behind", no_data: "not tracked" };
// API screen names -> pages that exist on the web (Exam coach is phone-only for now).
const PAGE: Record<string, string> = { Plan: "Planner", Focus: "Focus", Money: "Finance", Life: "My life" };
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** Home: the seven life areas this week (from every feature), today in numbers, and the next best actions. */
export function LifeCompassCard({ token, onNavigate }: { token: string; onNavigate: (page: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { apiRequest<Row>("/compass", token).then(setV).catch(() => setV(null)); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!v) return null;
  const d = v.day as Row;
  const log = (key: string) => apiRequest<Row>(`/compass/${key}/log`, token, postJson({})).then(setV).catch(e => setError(e instanceof Error ? e.message : "Could not log"));
  const selected = (v.areas as Row[]).find(a => a.key === open);

  return <section className="panel compass">
    <div className="compass-head">
      <div className="compass-ring" style={{ background: `conic-gradient(var(--green) ${(v.overall ?? 0) * 3.6}deg, var(--line) 0)` }}><span>{v.overall ?? "–"}<small>%</small></span></div>
      <div><p className="eyebrow">🧭 LIFE COMPASS · THIS WEEK</p><h2>{v.message}</h2></div>
    </div>
    <div className="compass-grid">{(v.areas as Row[]).map(a => <button key={a.key} type="button" className={`compass-tile ${a.status}${open === a.key ? " on" : ""}`} onClick={() => setOpen(open === a.key ? null : a.key)}>
      <span className="compass-icon">{a.icon}</span><b>{a.name}</b>
      <span className="compass-track"><span style={{ width: `${a.percent ?? 0}%` }}/></span>
      <span className="compass-pct">{a.percent == null ? "–" : `${a.percent}%`} · {STATUS[a.status]}</span>
    </button>)}</div>
    {selected && <div className="compass-detail">
      <b>{selected.icon} {selected.name}</b>
      {(selected.signals as Row[]).map(sg => <p key={sg.label}><span>{sg.label}</span><span>{sg.actual == null ? "—" : `${sg.actual} / ${sg.target} ${sg.unit}`}</span>{sg.note && <small>{sg.note}</small>}</p>)}
      <p className="compass-tip">→ {selected.suggestion}</p>
      <div className="compass-buttons">
        {selected.can_log && <button type="button" className="primary" onClick={() => void log(selected.key)}>✓ {selected.log_label}</button>}
        {selected.open && PAGE[selected.open] && <button type="button" className="outline" onClick={() => onNavigate(PAGE[selected.open])}>Open {PAGE[selected.open]}</button>}
      </div>
    </div>}
    <div className="compass-numbers">
      <span><b>{d.sleep_hours == null ? "—" : `${d.sleep_hours}h`}</b>sleep</span><span><b>{d.routines_done}/{d.routines_total}</b>routines</span>
      <span><b>{hm(d.focus_minutes)}</b>focus</span><span><b>{hm(d.study_minutes)}</b>study</span><span><b>{d.tasks_done}</b>tasks done</span>
      <span><b>{hm(d.awake_minutes_left)}</b>left today</span>
    </div>
    {(v.actions as Row[]).length > 0 && <div className="compass-actions"><p className="eyebrow">NEXT BEST ACTIONS</p>
      {(v.actions as Row[]).map((a, i) => <div key={i} className="compass-action"><span className="compass-icon">{a.icon}</span>
        <div><b>{a.title}</b><small>{a.detail}</small></div>
        {a.log ? <button type="button" className="outline" onClick={() => void log(a.log)}>Done ✓</button>
          : a.open && PAGE[a.open] ? <button type="button" className="outline" onClick={() => onNavigate(PAGE[a.open])}>Go ›</button> : null}
      </div>)}</div>}
    {error && <p className="inline-error">{error}</p>}
    <p className="muted small-copy">{v.note} Tell the assistant “called my mother” or “met friends” and it logs the right area.</p>
  </section>;
}
