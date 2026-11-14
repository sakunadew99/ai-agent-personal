"use client";

import { useMemo, useState } from "react";
import type { JsonRecord as Row } from "@/lib/api";
import { Icon } from "./Icon";

/**
 * Weekly review (guide §20.4): plan vs actual per life area from data you already logged,
 * a few code-computed patterns (no AI), and at most three changes for next week.
 * Decisions are saved as a "decision" memory so the assistant can use them later.
 */
const DAY = 86400000;
const AREAS: { key: string; label: string; icon: string; categories: string[] }[] = [
  { key: "work", label: "Work & business", icon: "briefcase", categories: ["work", "business"] },
  { key: "learning", label: "Learning", icon: "brain", categories: ["learning"] },
  { key: "health", label: "Health", icon: "heart", categories: ["health"] },
  { key: "home", label: "Home & personal", icon: "home", categories: ["personal"] },
];

function inWeek(value: unknown, from: number) {
  if (!value) return false;
  const t = new Date(String(value)).getTime();
  return t >= from && t <= Date.now();
}

export function WeeklyReview({ tasks, sessions, dashboard, reviews, save }: {
  tasks: Row[]; sessions: Row[]; dashboard: Row; reviews: Row[];
  save: (content: string) => Promise<void>;
}) {
  const [changes, setChanges] = useState(["", "", ""]);
  const [saving, setSaving] = useState(false);
  const weekStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - 6 * DAY; }, []);

  const data = useMemo(() => {
    const done = tasks.filter(t => t.status === "done" && inWeek(t.completed_at, weekStart));
    const open = tasks.filter(t => t.status !== "done" && t.status !== "cancelled");
    const overdue = open.filter(t => t.due_at && new Date(String(t.due_at)).getTime() < Date.now());
    const focus = sessions.filter(s => s.ended_at && inWeek(s.started_at, weekStart) && !/outcome:\s*abandoned/.test(String(s.notes || "")));
    const focusMinutes = focus.reduce((sum, s) => sum + Math.max(0, Math.round((new Date(String(s.ended_at)).getTime() - new Date(String(s.started_at)).getTime()) / 60000)), 0);
    const focusDays = new Set(focus.map(s => new Date(String(s.started_at)).toLocaleDateString("en-CA"))).size;
    const drifted = focus.filter(s => /outcome:\s*drifted/.test(String(s.notes || ""))).length;
    const habits = (dashboard.habits || []) as Row[];
    const logs = ((dashboard.habit_logs || []) as Row[]).filter(l => habits.some(h => h.id === l.habit_id));
    const habitRate = habits.length ? Math.round(logs.length / (habits.length * 7) * 100) : null;
    const sleep = ((dashboard.sleep || []) as Row[]).filter(s => inWeek(s.start_at, weekStart));
    const sleepAvg = sleep.length ? sleep.reduce((s, r) => s + Number(r.duration_minutes || 0), 0) / sleep.length / 60 : null;
    const workouts = ((dashboard.workouts || []) as Row[]).filter(w => inWeek(w.started_at, weekStart));

    const areas = AREAS.map(area => {
      const count = done.filter(t => area.categories.includes(String(t.category))).length;
      const extra = area.key === "health" ? workouts.length + logs.length : 0;
      return { ...area, value: count + extra, detail: area.key === "health" ? `${count} tasks · ${workouts.length} workouts · ${logs.length} habit check-ins` : `${count} task${count === 1 ? "" : "s"} done` };
    });
    const maxArea = Math.max(1, ...areas.map(a => a.value));

    // Plain-code patterns (guide §26.2: diagnose in code, never by the model).
    const patterns: { tone: "good" | "warn"; text: string }[] = [];
    if (focusDays >= 5) patterns.push({ tone: "good", text: `You focused on ${focusDays} of 7 days. Keep the rhythm.` });
    else patterns.push({ tone: "warn", text: `Focus happened on ${focusDays} of 7 days. One 30-minute block a day is a good floor.` });
    if (focus.length && drifted / focus.length >= 0.4) patterns.push({ tone: "warn", text: `${drifted} of ${focus.length} focus blocks drifted. Try shorter blocks (25 min).` });
    if (sleepAvg !== null) patterns.push(sleepAvg < 7 ? { tone: "warn", text: `Average sleep was ${sleepAvg.toFixed(1)} h, under a 7 h target. Protect your sleep window before adding work.` } : { tone: "good", text: `Average sleep ${sleepAvg.toFixed(1)} h. Well rested.` });
    else patterns.push({ tone: "warn", text: "No sleep logged this week. Log it in Health or sync from your band." });
    if (!workouts.length) patterns.push({ tone: "warn", text: "No workouts logged in 7 days." });
    if (overdue.length) patterns.push({ tone: "warn", text: `${overdue.length} task${overdue.length === 1 ? " is" : "s are"} overdue. Move, split or drop them.` });
    const empty = areas.filter(a => a.value === 0).map(a => a.label);
    if (empty.length && empty.length < areas.length) patterns.push({ tone: "warn", text: `Nothing logged for ${empty.join(", ")} this week.` });

    return { done, open, overdue, focusMinutes, focusDays, habitRate, sleepAvg, workouts, areas, maxArea, patterns };
  }, [tasks, sessions, dashboard, weekStart]);

  const weekLabel = `${new Date(weekStart).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`;
  const filled = changes.map(c => c.trim()).filter(Boolean);

  async function submit() {
    if (!filled.length) return;
    setSaving(true);
    try {
      await save(`Weekly review (${weekLabel}). Changes for next week: ${filled.map((c, i) => `${i + 1}) ${c}`).join(" ")}`);
      setChanges(["", "", ""]);
    } finally { setSaving(false); }
  }

  return <div className="review">
    <section className="panel review-hero">
      <div><p className="eyebrow">WEEKLY REVIEW · {weekLabel.toUpperCase()}</p>
        <h2>{data.done.length} done, {Math.round(data.focusMinutes / 6) / 10} h focused, {data.open.length} still open</h2>
        <p className="muted">Ten minutes on Sunday: see what happened, notice one pattern, choose at most three changes. Numbers come only from what you logged.</p></div>
    </section>

    <div className="stat-tiles review-tiles">
      <div className="stat-tile"><span>Tasks done</span><b>{data.done.length}</b><em>{data.overdue.length} overdue</em></div>
      <div className="stat-tile"><span>Focus</span><b>{(data.focusMinutes / 60).toFixed(1)}<small> h</small></b><em>{data.focusDays}/7 days</em></div>
      <div className="stat-tile"><span>Habits</span><b>{data.habitRate === null ? "—" : `${data.habitRate}%`}</b><em>of planned check-ins</em></div>
      <div className="stat-tile"><span>Sleep avg</span><b>{data.sleepAvg === null ? "—" : data.sleepAvg.toFixed(1)}<small>{data.sleepAvg === null ? "" : " h"}</small></b><em>{data.workouts.length} workouts</em></div>
    </div>

    <div className="grid main-grid">
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">LIFE BALANCE</p><h2>Where your week went</h2></div></div>
        <div className="area-bars">{data.areas.map(area => <div className="area-bar" key={area.key}>
          <div className="area-bar-head"><span><Icon name={area.icon} size={15}/> {area.label}</span><b>{area.value}</b></div>
          <div className="progress"><span style={{ width: `${area.value / data.maxArea * 100}%` }} className={area.value ? "" : "zero"}/></div>
          <small>{area.detail}</small>
        </div>)}</div>
        <p className="muted small-copy">Shown side by side, never as one score. An area at zero is a signal, not a failure.</p>

        <h3 className="list-title">Wins</h3>
        {data.done.length ? <div className="record-list">{data.done.slice(0, 6).map(task => <div className="record-row" key={String(task.id)}>
          <span className="record-icon"><Icon name="check" size={15}/></span>
          <div className="record-copy"><b>{String(task.title)}</b><small>{String(task.category)} · {new Date(String(task.completed_at)).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</small></div>
        </div>)}</div> : <div className="empty-state">No tasks completed this week yet.</div>}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">PATTERNS</p><h2>What the numbers say</h2></div></div>
        <ul className="pattern-list">{data.patterns.map((p, i) => <li key={i} className={p.tone}><Icon name={p.tone === "good" ? "check" : "bolt"} size={15}/>{p.text}</li>)}</ul>

        <div className="review-changes">
          <h3>Pick up to three changes for next week</h3>
          {changes.map((value, i) => <input key={i} value={value} maxLength={200}
            placeholder={["e.g. Shorter focus blocks (25 min) before lunch", "e.g. In bed by 22:30 on weeknights", "e.g. Two workouts: Tue and Sat"][i]}
            onChange={event => setChanges(changes.map((c, j) => j === i ? event.target.value : c))} aria-label={`Change ${i + 1}`}/>)}
          <button className="primary" disabled={!filled.length || saving} onClick={() => void submit()}>{saving ? "Saving…" : "Save my review"}</button>
          <p className="muted small-copy">Saved to your Memory as a decision, so the assistant can remind you next week. Nothing else changes automatically.</p>
        </div>

        {reviews.length > 0 && <><h3 className="list-title">Previous reviews</h3>
          <div className="record-list">{reviews.slice(0, 3).map(row => <div className="memory-card" key={String(row.id)}>
            <p>{String(row.content)}</p><small className="muted">{new Date(String(row.created_at || row.updated_at)).toLocaleDateString([], { dateStyle: "medium" })}</small>
          </div>)}</div></>}
      </section>
    </div>
  </div>;
}
