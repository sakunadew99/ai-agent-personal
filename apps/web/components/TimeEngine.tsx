"use client";

import { useEffect, useState } from "react";
import { apiRequest, type JsonRecord as Row } from "@/lib/api";

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;

/** Time engine (guide 37): capacity vs. load, planning multiplier, deep-work window, suggested top 3. Informational only. */
export function TimeEngine({ token }: { token: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiRequest<Row>("/time/insights", token).then(setData).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load")); }, [token]);
  if (error) return <p className="warning-copy">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const m = data.multiplier;
  const days: Row[] = data.days || [];
  const max = Math.max(1, ...days.map(d => Math.max(d.planned_minutes, d.capacity_minutes)));

  return <div className="time-engine">
    <div className="time-stats">
      <div><small className="muted">Planning multiplier</small><b>×{m.multiplier}</b>
        <small className="muted">{m.enough_data ? `from ${m.sample_size} finished tasks` : `needs 3 finished tasks with focus sessions (${m.sample_size} so far)`}</small></div>
      <div><small className="muted">Plannable per day</small><b>{hours(data.capacity.plannable_minutes)}</b>
        <small className="muted">after meals/breaks and a {hours(data.capacity.buffer_minutes)} buffer</small></div>
      <div><small className="muted">Best focus hours</small><b>{data.deep_work_window ? `${data.deep_work_window.start}–${data.deep_work_window.end}` : "—"}</b>
        <small className="muted">{data.deep_work_window ? "protect these for important work" : "finish a few focus sessions to learn this"}</small></div>
    </div>
    <div className="load-chart" role="img" aria-label="Planned load versus capacity for the next 7 days">
      {days.map(d => <div className="load-day" key={d.date} title={`${hours(d.planned_minutes)} planned of ${hours(d.capacity_minutes)}`}>
        <div className="load-track"><span className="cap" style={{ height: `${d.capacity_minutes / max * 100}%` }}/>
          <span className={`plan${d.overbooked ? " over" : ""}`} style={{ height: `${Math.min(d.planned_minutes, max) / max * 100}%` }}/></div>
        <small>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</small>
        <small className="muted">{hours(d.planned_minutes)}</small>
      </div>)}
    </div>
    {data.warnings.length > 0 && <div className="notice-card">{(data.warnings as Row[]).map((w, i) => <p key={i}>⚠ {w.message}</p>)}</div>}
    <h3>Suggested top 3 today</h3>
    {data.top3.length ? <ol className="top3">{(data.top3 as Row[]).map(t => <li key={t.id}><b>{t.title}</b>
      <small className="muted">{t.priority} · estimate {hours(t.estimate_minutes)}{m.multiplier !== 1 ? ` → likely ${hours(t.adjusted_minutes)}` : ""}</small></li>)}</ol>
      : <p className="muted">No open tasks.</p>}
    <p className="muted small-copy">{data.how} Everything else can wait.</p>
  </div>;
}
