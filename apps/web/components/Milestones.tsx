"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";

/** Checklist of milestones for one goal (Phase 3). */
export function Milestones({ token, goalId }: { token: string; goalId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<Row[]>(`/goals/${goalId}/milestones`, token).then(setRows).catch(() => setRows([]));
  }, [goalId, token]);
  useEffect(() => { load(); }, [load]);

  async function run(work: Promise<unknown>) {
    setError("");
    try { await work; load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update"); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    void run(apiRequest(`/goals/${goalId}/milestones`, token, postJson({ title: title.trim(), position: rows.length, ...(due ? { due_date: due } : {}) }))
      .then(() => { setTitle(""); setDue(""); }));
  }
  function remove(row: Row) {
    if (!window.confirm(`Delete milestone “${row.title}”?`)) return;
    void run(apiRequest(`/milestones/${row.id}`, token, { method: "DELETE" }));
  }

  const done = rows.filter(row => row.done_at).length;
  return <div className="milestones">
    <div className="milestones-head"><small className="muted">Milestones{rows.length ? ` · ${done}/${rows.length} done` : ""}</small></div>
    {rows.map(row => <div className={`milestone${row.done_at ? " done" : ""}`} key={row.id}>
      <input type="checkbox" checked={!!row.done_at} aria-label={`Mark ${row.title} ${row.done_at ? "not done" : "done"}`}
        onChange={() => void run(apiRequest(`/milestones/${row.id}`, token, patchJson({ done: !row.done_at })))}/>
      <span>{row.title}</span>
      {row.due_date && <small className="muted">{new Date(`${row.due_date}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</small>}
      <button className="danger-link" aria-label={`Delete ${row.title}`} onClick={() => remove(row)}>×</button>
    </div>)}
    <form className="milestone-add" onSubmit={add}>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Add a milestone…" maxLength={200}/>
      <input type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Milestone date"/>
      <button className="outline" disabled={!title.trim()}>Add</button>
    </form>
    {error && <p className="warning-copy">{error}</p>}
  </div>;
}
