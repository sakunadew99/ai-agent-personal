"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest, type JsonRecord as Row } from "@/lib/api";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const KIND_LABEL: Record<string, string> = { task: "Task", repeat: "Repeats", goal: "Goal deadline", milestone: "Milestone", event: "Google Calendar", deadline: "Study deadline" };

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Month calendar: tasks, projected repeats, goal deadlines and milestones (Phase 3). Times shown in the user's timezone. */
export function MonthView({ token }: { token: string }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Row>({});
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    apiRequest<Row>(`/planner/monthly?month=${month}`, token).then(setData).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load"));
  }, [month, token]);

  const days: Record<string, Row[]> = data.days || {};
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const list: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) list.push(`${month}-${String(d).padStart(2, "0")}`);
    while (list.length % 7) list.push(null);
    return list;
  }, [month]);
  const today = new Date().toLocaleDateString("en-CA", data.timezone ? { timeZone: data.timezone } : {});
  const title = new Date(`${month}-01T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(data.timezone ? { timeZone: data.timezone } : {}) });
  const detail = selected ? days[selected] || [] : [];

  return <div className="month-view">
    <div className="month-bar">
      <button className="outline" aria-label="Previous month" onClick={() => { setMonth(shift(month, -1)); setSelected(""); }}>‹</button>
      <b>{title}</b>
      <button className="outline" aria-label="Next month" onClick={() => { setMonth(shift(month, 1)); setSelected(""); }}>›</button>
      <button className="text-button" onClick={() => { setMonth(new Date().toISOString().slice(0, 7)); setSelected(""); }}>Today</button>
    </div>
    {error && <p className="warning-copy">{error}</p>}
    <div className="month-grid" role="grid">
      {WEEKDAYS.map(day => <div className="month-dow" key={day}>{day}</div>)}
      {cells.map((day, index) => day === null ? <div className="month-cell empty" key={`e${index}`}/> :
        <button key={day} className={`month-cell${day === today ? " today" : ""}${day === selected ? " selected" : ""}`} onClick={() => setSelected(day === selected ? "" : day)}>
          <span className="month-num">{Number(day.slice(8))}</span>
          {(days[day] || []).slice(0, 3).map((e, i) => <span key={i} className={`month-chip kind-${e.kind}${e.status === "done" ? " done" : ""}`}>{e.title}</span>)}
          {(days[day] || []).length > 3 && <small className="muted">+{(days[day] || []).length - 3} more</small>}
        </button>)}
    </div>
    {selected && <div className="month-detail">
      <b>{new Date(`${selected}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</b>
      {detail.length ? detail.map((e, i) => <div className="month-detail-row" key={i}>
        <span className={`month-dot kind-${e.kind}`}/><span>{e.title}</span>
        <small className="muted">{KIND_LABEL[e.kind] || e.kind}{e.at ? ` · ${time(e.at)}` : ""}{e.status === "done" ? " · done" : ""}</small>
      </div>) : <p className="muted">Nothing planned.</p>}
    </div>}
    <p className="muted small-copy">“Repeats” are upcoming copies of repeating tasks. Each one is created when you finish the previous one.
      {data.calendar === "connected" ? " Grey items come from your Google Calendar." : data.calendar === "expired" ? " Google Calendar needs reconnecting (Settings)." : " Connect Google Calendar in Settings to see your events here."}</p>
  </div>;
}
