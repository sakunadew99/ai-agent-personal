"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";

const KIND_LABEL: Record<string, string> = {
  low_sleep: "Rest", overdue_pileup: "Overdue tasks", overloaded: "Busy day", focus_drop: "Focus", no_exercise: "Movement",
  habit_slipping: "Habits", goal_behind: "Goals", envelope_over: "Money",
};
const FACES = ["😞", "🙁", "😐", "🙂", "😄"];

/** Coach moments on Home (guide 26): check-in, brief / wrap-up, and pattern suggestions with evidence and options. */
export function CoachCard({ token, onNavigate, onChanged }: { token: string; onNavigate: (page: string) => void; onChanged?: () => void }) {
  const [c, setC] = useState<Row | null>(null);
  const [energy, setEnergy] = useState(0); const [mood, setMood] = useState(0);
  const [win, setWin] = useState(""); const [note, setNote] = useState("");
  const [msg, setMsg] = useState(""); const [showSettings, setShowSettings] = useState(false);
  const load = useCallback(() => { apiRequest<Row>("/coach", token).then(setC).catch(() => setC(null)); }, [token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<Row>, after?: (r: Row) => void) {
    try { const r = await work; after?.(r); load(); onChanged?.(); } catch (reason) { setMsg(reason instanceof Error ? reason.message : "Something went wrong"); }
  }
  if (!c) return null;
  const brief = c.brief;
  const care = c.care;

  return <section className="panel coach-card">
    <div className="panel-head"><div><p className="eyebrow">COACH · {c.moment === "morning" ? "MORNING BRIEF" : c.moment === "evening" ? "EVENING WRAP-UP" : "TODAY"}</p>
      <h2>{care ? "Taking care of you first" : c.moment === "evening" ? "How did today go?" : "Your day, simply"}</h2></div>
      <button className="text-button" onClick={() => setShowSettings(!showSettings)}>{showSettings ? "Close" : "Coach settings"}</button></div>

    {care && <div className="care-box"><p>{care.message}</p>
      <ul>{(care.help as Row[]).map(h => <li key={h.label}><b>{h.phone}</b> · {h.label}</li>)}</ul><small className="muted">{care.note}</small></div>}

    {!c.checkin ? <div className="checkin">
      <small className="muted">Quick check-in (10 seconds)</small>
      <div className="checkin-row"><span>Energy</span>{[1, 2, 3, 4, 5].map(n => <button key={n} className={`dot-btn${energy === n ? " on" : ""}`} onClick={() => setEnergy(n)} aria-label={`Energy ${n}`}>{n}</button>)}</div>
      <div className="checkin-row"><span>Mood</span>{[1, 2, 3, 4, 5].map(n => <button key={n} className={`dot-btn${mood === n ? " on" : ""}`} onClick={() => setMood(n)} aria-label={`Mood ${n}`}>{FACES[n - 1]}</button>)}</div>
      <input value={win} onChange={e => setWin(e.target.value)} placeholder="One win today (optional)" maxLength={300}/>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Anything on your mind? (optional, private)" maxLength={2000}/>
      <button className="primary" disabled={!energy || !mood} onClick={() => void run(apiRequest<Row>("/coach/checkin", token, postJson({ energy, mood, win, note })), r => setMsg(r.care ? "" : "Thanks for checking in."))}>Save check-in</button>
    </div> : <small className="muted">Checked in: energy {c.checkin.energy}/5 · mood {FACES[c.checkin.mood - 1]}{c.checkin.win ? ` · win: ${c.checkin.win}` : ""}</small>}

    {brief && c.moment !== "evening" && <div className="brief">
      {brief.top3.length > 0 && <><b>Top 3 today</b><ol className="top3">{(brief.top3 as Row[]).map(t => <li key={t.id}>{t.title} <small className="muted">~{t.adjusted_minutes} min</small></li>)}</ol></>}
      <small className="muted">{[brief.focus_window ? `Best focus: ${brief.focus_window.start}–${brief.focus_window.end}` : null, brief.balance_note,
        brief.today_capacity ? `${Math.floor(brief.today_capacity.free_minutes / 60)} h free after plans` : null].filter(Boolean).join(" · ")}</small>
    </div>}

    {c.moment === "evening" && (c.wrap_up as Row[]).length > 0 && <div className="brief"><b>Still open from today</b>
      {(c.wrap_up as Row[]).map(t => <div className="money-row" key={t.id}><span>{t.title}</span>
        <div className="row-actions">
          <button className="text-button" onClick={() => void run(apiRequest<Row>(`/tasks/${t.id}/complete`, token, { method: "PATCH" }))}>Done</button>
          <button className="text-button" onClick={() => void run(apiRequest<Row>(`/tasks/${t.id}`, token, patchJson({ due_at: new Date(new Date(t.due_at).getTime() + 86400000).toISOString() })))}>Tomorrow</button>
          <button className="danger-link" onClick={() => void run(apiRequest<Row>(`/tasks/${t.id}`, token, patchJson({ status: "cancelled" })))}>Drop</button>
        </div></div>)}
      <small className="muted">Nothing should roll over forever: finish, move, or drop.</small></div>}

    {(c.suggestions as Row[]).map(s => <div className="coach-suggestion" key={s.id}>
      <small className="eyebrow">{KIND_LABEL[s.kind] || s.kind}</small>
      <p>{s.message}</p>
      <small className="muted">Based on: {Object.entries(s.evidence as Row).map(([k, v]) => `${k.replaceAll("_", " ")} ${v}`).join(" · ")}</small>
      <div className="row-actions" style={{ justifyContent: "flex-start" }}>{(s.options as Row[]).map(o => <button key={o.id} className={o.action === "none" ? "outline" : "primary"}
        onClick={() => void run(apiRequest<Row>(`/coach/suggestions/${s.id}/decide`, token, postJson({ option_id: o.id })), r => {
          if (r.open) onNavigate(r.open); setMsg(r.moved != null ? `Moved ${r.moved} task(s) to next Monday.` : r.task_id ? "Added to your tasks." : "");
        })}>{o.label}</button>)}</div>
    </div>)}
    {!care && !(c.suggestions as Row[]).length && c.checkin && <small className="muted">No patterns worth flagging today. 👍</small>}
    {msg && <p className="success-note">{msg}</p>}

    {showSettings && <div className="coach-settings">
      <label>Tone <select value={c.tone} onChange={e => void run(apiRequest<Row>("/coach/settings", token, patchJson({ tone: e.target.value })))}><option value="gentle">gentle</option><option value="direct">direct</option></select></label>
      <label>Suggestions per day <input type="number" min={0} max={8} defaultValue={c.daily_cap} onBlur={e => void run(apiRequest<Row>("/coach/settings", token, patchJson({ daily_cap: Number(e.target.value) })))}/></label>
      <div className="ai-features">{Object.entries(KIND_LABEL).map(([k, label]) => <label key={k} className="inline-check">
        <input type="checkbox" checked={!(c.muted_kinds as string[]).includes(k)} onChange={e => void run(apiRequest<Row>("/coach/settings", token, patchJson({
          muted_kinds: e.target.checked ? (c.muted_kinds as string[]).filter(x => x !== k) : [...c.muted_kinds, k] })))}/> {label}</label>)}</div>
      <small className="muted">{c.about}</small>
    </div>}
  </section>;
}
