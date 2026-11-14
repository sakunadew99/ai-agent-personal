"use client";

import { useMemo, useState } from "react";
import type { JsonRecord as Row } from "@/lib/api";
import { formatClock, useFocus } from "./FocusContext";
import { Icon } from "./Icon";

const PRESETS = [
  { label: "25 / 5", minutes: 25, breakMinutes: 5, hint: "Classic pomodoro" },
  { label: "30 / 5", minutes: 30, breakMinutes: 5, hint: "Half-hour block" },
  { label: "50 / 10", minutes: 50, breakMinutes: 10, hint: "Deep work" },
  { label: "60 / 10", minutes: 60, breakMinutes: 10, hint: "Full hour" },
];

function outcomeOf(row: Row): string {
  if (!row.ended_at) return "active";
  const match = /outcome:\s*(\w+)/.exec(String(row.notes || ""));
  return match ? match[1] : "done";
}
function minutesOf(row: Row): number {
  const start = new Date(String(row.started_at)).getTime();
  const end = row.ended_at ? new Date(String(row.ended_at)).getTime() : Date.now();
  return Math.max(0, Math.round((end - start) / 60000));
}
function dayKey(date: Date) { return date.toLocaleDateString("en-CA"); }

export function FocusPage({ sessions, tasks }: { sessions: Row[]; tasks: Row[] }) {
  const { state, remaining, busy, error, start, finish, extend, skipBreak } = useFocus();
  const [preset, setPreset] = useState(PRESETS[1]);
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const openTasks = tasks.filter(task => task.status !== "done" && task.status !== "cancelled");

  const total = state ? (state.phase === "break" ? state.breakMinutes * 60 : Math.max(1, Math.round((state.endsAt - state.startedAt) / 1000))) : preset.minutes * 60;
  const shown = state && state.phase !== "ended" ? remaining : state ? 0 : preset.minutes * 60;
  const progress = state ? 1 - shown / total : 0;
  const R = 108, C = 2 * Math.PI * R;

  const stats = useMemo(() => {
    const finished = sessions.filter(row => row.ended_at && outcomeOf(row) !== "abandoned");
    const today = dayKey(new Date());
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    const perDay = days.map(d => ({ label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d), key: dayKey(d),
      minutes: finished.filter(row => dayKey(new Date(String(row.started_at))) === dayKey(d)).reduce((s, row) => s + minutesOf(row), 0) }));
    const todayMinutes = perDay[6].minutes;
    const weekMinutes = perDay.reduce((s, d) => s + d.minutes, 0);
    const todaySessions = finished.filter(row => dayKey(new Date(String(row.started_at))) === today).length;
    const drifted = finished.filter(row => outcomeOf(row) === "drifted").length;
    let streak = 0; for (let i = 6; i >= 0 && perDay[i].minutes > 0; i--) streak++;
    return { perDay, todayMinutes, weekMinutes, todaySessions, drifted, streak, max: Math.max(30, ...perDay.map(d => d.minutes)) };
  }, [sessions]);

  const selectedTask = openTasks.find(task => task.id === taskId);
  const phaseLabel = !state ? "Ready" : state.phase === "focus" ? "Focusing" : state.phase === "break" ? "Break" : "Time's up";

  return <div className="focus-layout">
    <section className="panel focus-stage">
      <div className={`focus-ring-wrap phase-${state?.phase || "idle"}`}>
        <svg viewBox="0 0 240 240" className="focus-ring" aria-hidden="true">
          <circle cx="120" cy="120" r={R} className="ring-track"/>
          <circle cx="120" cy="120" r={R} className="ring-fill" strokeDasharray={C} strokeDashoffset={C * (1 - progress)}/>
        </svg>
        <div className="focus-ring-center" aria-live="polite">
          <span className="eyebrow">{phaseLabel}</span>
          <strong>{formatClock(shown)}</strong>
          <small>{state?.taskTitle || selectedTask?.title || "Pick one thing to work on"}</small>
        </div>
      </div>

      {!state && <>
        <div className="preset-row" role="radiogroup" aria-label="Session length">
          {PRESETS.map(item => <button key={item.label} role="radio" aria-checked={preset.label === item.label}
            className={`preset ${preset.label === item.label ? "selected" : ""}`} onClick={() => setPreset(item)}>
            <b>{item.label}</b><small>{item.hint}</small></button>)}
        </div>
        <label className="focus-task-field"><span>Working on</span>
          <select value={taskId} onChange={event => setTaskId(event.target.value)}>
            <option value="">General focus (no task)</option>
            {openTasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
        <button className="primary focus-go" disabled={busy}
          onClick={() => void start({ minutes: preset.minutes, breakMinutes: preset.breakMinutes, taskId: taskId || undefined, taskTitle: selectedTask?.title })}>
          <Icon name="play" size={16}/> {busy ? "Starting…" : `Start ${preset.minutes}-minute focus`}
        </button>
      </>}

      {state?.phase === "focus" && <div className="focus-controls">
        <button className="outline" onClick={() => extend(5)}>+5 min</button>
        <button className="outline" disabled={busy} onClick={() => void finish("done")}><Icon name="check" size={15}/> Finish early</button>
        <button className="outline danger-button" disabled={busy} onClick={() => { if (window.confirm("Stop this session? It is logged as abandoned, with no penalty.")) void finish("abandoned"); }}><Icon name="stop" size={14}/> Stop</button>
      </div>}

      {state?.phase === "ended" && <div className="focus-outcome">
        <h3>How did it go?</h3>
        <input value={note} onChange={event => setNote(event.target.value)} placeholder="Optional: what did you get done?" aria-label="Session note"/>
        <div className="focus-controls">
          <button className="primary" disabled={busy} onClick={() => void finish("done", note)}><Icon name="check" size={15}/> Done</button>
          <button className="outline" disabled={busy} onClick={() => void finish("drifted", note)}>Drifted</button>
          <button className="outline" onClick={() => extend(10)}>Need 10 more min</button>
        </div>
      </div>}

      {state?.phase === "break" && <div className="focus-controls">
        <p className="muted">Stand up, drink water, look away from the screen.</p>
        <button className="outline" onClick={skipBreak}>Skip break</button>
      </div>}

      {error && <p className="inline-error">{error}</p>}
      <p className="privacy-note">The timer runs in this browser and keeps going if you reload. Allow notifications to get an alert when a block ends.
        Website and app blocking needs the Android app (planned) — Sakuna does not change device settings.</p>
    </section>

    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">YOUR PRACTICE</p><h2>Focus this week</h2></div></div>
      <div className="stat-tiles">
        <div className="stat-tile"><span>Today</span><b>{stats.todayMinutes}<small> min</small></b><em>{stats.todaySessions} session{stats.todaySessions === 1 ? "" : "s"}</em></div>
        <div className="stat-tile"><span>Last 7 days</span><b>{(stats.weekMinutes / 60).toFixed(1)}<small> h</small></b><em>{stats.drifted} drifted</em></div>
        <div className="stat-tile"><span>Day streak</span><b>{stats.streak}<small> d</small></b><em>days in a row</em></div>
      </div>
      <div className="bar-chart" role="img" aria-label="Focus minutes per day, last 7 days">
        {stats.perDay.map(day => <div className="bar-col" key={day.key} title={`${day.label}: ${day.minutes} min`}>
          <span className="bar-value">{day.minutes || ""}</span>
          <div className="bar" style={{ height: `${Math.max(3, day.minutes / stats.max * 100)}%` }}/>
          <span className="bar-label">{day.label}</span>
        </div>)}
      </div>
      <h3 className="list-title">Recent sessions</h3>
      {sessions.length ? <div className="record-list">{sessions.slice(0, 8).map(row => {
        const outcome = outcomeOf(row);
        return <div className="record-row" key={String(row.id)}>
          <span className="record-icon"><Icon name="timer" size={15}/></span>
          <div className="record-copy"><b>{minutesOf(row)} of {row.minutes_planned} min</b>
            <small>{new Date(String(row.started_at)).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{row.notes && String(row.notes).includes("·") ? ` · ${String(row.notes).split("·").slice(1).join("·").trim()}` : ""}</small></div>
          <span className={`badge outcome-${outcome}`}>{outcome}</span>
        </div>;
      })}</div> : <div className="empty-state">Your finished sessions will appear here.</div>}
    </section>
  </div>;
}
