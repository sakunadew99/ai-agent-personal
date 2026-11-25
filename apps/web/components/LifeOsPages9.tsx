"use client";
/* Today ring, sleep, water, mindset studio and life board for the web. */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Card, Hero, Ring } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function GapFill({ token, onSaved }: { token: string; onSaved?: () => void }) {
  const [g, setG] = useState<Row | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const day = isoDay(new Date());
  const load = useCallback(() => { call<Row>(`/day/gaps?day=${day}`, token).then(r => { setG(r); setPick(Object.fromEntries((r.gaps as Row[]).filter(x => x.suggestion).map(x => [x.hour, x.suggestion]))); }).catch(() => undefined); }, [token, day]);
  useEffect(() => { load(); }, [load]);
  if (!g || !(g.gaps as Row[]).length) return null;
  const save = () => { const answers = Object.entries(pick).map(([h, c]) => ({ hour: Number(h), category: c })); if (answers.length) void call("/day/gaps/fill", token, postJson({ day, answers })).then(() => { load(); onSaved?.(); }); };
  return <Card kicker="Fill your day" title={String(g.message)}>
    {(g.gaps as Row[]).map(x => <div key={x.hour} style={{ borderTop: "1px solid var(--d-line)", padding: "6px 0" }}>
      <b>{x.label}</b> <span className="d-note">{(x.apps as Row[]).length ? `📱 ${x.phone_minutes} min: ${(x.apps as Row[]).map(a => `${a.label} ${a.minutes}m`).join(", ")}` : x.why}</span>
      <div className="d-chips">{(g.choices as Row[]).map(c => <button key={c.key} className={`d-chip ${pick[x.hour] === c.key ? "on" : ""}`} onClick={() => setPick({ ...pick, [x.hour]: String(c.key) })}>{c.label}</button>)}</div></div>)}
    <button className="d-btn" onClick={save}>✓ Save {Object.keys(pick).length} answers</button></Card>;
}

export function TodayPage({ token }: { token: string }) {
  const [t, setT] = useState<Row | null>(null);
  const [rv, setRv] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/today", token).then(setT).catch(e => setNote(errText(e))); call<Row>("/review/week", token).then(setRv).catch(() => undefined); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!t) return <div className="d-empty">Building your day…</div>;
  let acc = 0;
  const stops = (t.ring as Row[]).map(s => { const a = acc / 14.4; acc += Number(s.minutes); return `${s.color} ${a}% ${acc / 14.4}%`; }).join(", ");
  const habit = (h: Row) => { if (!h.done_today) void call(`/habits/${h.id}/logs`, token, postJson({})).then(load); };
  return <div className="d-dash">
    {note && <p className="d-note">{note}</p>}
    <div className="d-grid-2">
      <Card kicker="Today" title="Your 24 hours">
        <div style={{ width: 260, height: 260, margin: "0 auto", borderRadius: "50%", background: `conic-gradient(${stops})`, display: "grid", placeItems: "center" }}>
          <div style={{ width: 200, height: 200, borderRadius: "50%", background: "var(--d-card)", display: "grid", placeItems: "center", textAlign: "center" }}>
            <div><div style={{ fontSize: 26, fontWeight: 900, color: "var(--d-green)" }}>{hm(Number(t.productive_minutes))}</div><small className="d-note">productive</small>
              <div style={{ fontWeight: 800, color: "var(--d-red)", marginTop: 6 }}>{hm(Number(t.wasted_minutes))}</div><small className="d-note">time waste</small></div></div></div>
        <div className="d-chips" style={{ justifyContent: "center", marginTop: 10 }}>{Object.entries(t.totals as Record<string, number>).filter(([k, v]) => v > 0 && k !== "future").map(([k, v]) =>
          <span key={k} className="d-chip"><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: (t.colors as Row)[k] || "#455a64", marginRight: 4 }}/>{k.replace("_", " ")} {hm(v)}</span>)}</div>
      </Card>
      <div>
        <Card kicker="Sleep · water" title={t.sleep ? `${t.sleep.hours} h sleep (${t.sleep.bed} → ${t.sleep.wake})` : "No sleep data yet"}>
          <p>💧 {t.water.percent}% of water ({t.water.left_ml} ml to go) <button className="text-button" onClick={() => void call("/water", token, postJson({ ml: 250 })).then(load)}>+250 ml</button></p>
          {t.affirmation && <p style={{ background: "#7c4dff", color: "#fff", padding: 12, borderRadius: 14, fontWeight: 800 }}>✨ {t.affirmation.text}</p>}
          <p><b>🎯 Most important:</b> {t.top_task ? t.top_task.title : "No open tasks"}</p></Card>
        <Card kicker="Habits today" title="Tap to complete"><div className="d-chips">{(t.habits as Row[]).map(h => <button key={h.id} className={`d-chip ${h.done_today ? "on" : ""}`} onClick={() => habit(h)}
          title={h.status === "must" ? `Never miss twice · tiny: ${h.tiny}` : `strength ${h.strength}`}>{h.done_today ? "✅" : h.status === "must" || h.status === "restart" ? "⚠️" : h.icon} {h.name}</button>)}</div></Card>
      </div>
    </div>
    <GapFill token={token} onSaved={load}/>
    {rv && <Card kicker={`This week · score ${rv.score}`} title={`One change: ${rv.one_change}`}>
      <p className="d-note">Productive {hm(Number(rv.productive_minutes))} · waste {hm(Number(rv.wasted_minutes))} · sleep {rv.sleep_avg_minutes ? `${(Number(rv.sleep_avg_minutes) / 60).toFixed(1)} h` : "—"} · water {rv.water_days_met}/7 · {rv.tasks_done} tasks</p>
      {(rv.wins as string[]).map(w => <p key={w} style={{ color: "var(--d-green)" }}>✓ {w}</p>)}{(rv.fixes as string[]).map(w => <p key={w} style={{ color: "var(--d-amber)" }}>→ {w}</p>)}</Card>}
  </div>;
}

export function SleepPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  useEffect(() => { call<Row>("/sleep/insights", token).then(setV).catch(() => undefined); }, [token]);
  if (!v) return <div className="d-empty">Loading…</div>;
  const n = v.nights as Row[]; const last = n[0];
  return <div className="d-dash">
    <Hero kicker="Sleep" title={last ? `${last.hours}` : "—"} accent={last ? "hours last night" : "no data yet"} sub={last ? `${last.bed} → ${last.wake} · ${last.source}` : "Sleep comes from the phone app (screen off) or your Mi Band."}
      right={<Ring value={last ? Math.min(100, Number(last.minutes) / Number(v.target_minutes) * 100) : 0} size={120} label={v.avg_bed_week || "—"} sub="usual bedtime"/>}/>
    {(v.insights as string[]).map(t => <p key={t} className="d-note">💡 {t}</p>)}
    <Card kicker={`Last ${n.length} nights`} title={`Debt this week ${hm(Number(v.debt_minutes_week))}`}>{n.map(x => <p key={String(x.night)}>{String(x.night).slice(5)} · <b>{x.bed} → {x.wake}</b> · {x.hours} h <span className="d-note">({x.source}{x.interruptions ? `, ${x.interruptions} checks` : ""})</span></p>)}
      <p className="d-note">{v.how}</p></Card>
  </div>;
}

export function WaterPage({ token }: { token: string }) {
  const [w, setW] = useState<Row | null>(null);
  const load = useCallback(() => { call<Row>("/water", token).then(setW).catch(() => undefined); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!w) return <div className="d-empty">Loading…</div>;
  return <div className="d-dash">
    <Hero kicker="Water" title={`${w.percent}%`} accent={`${(Number(w.today_ml) / 1000).toFixed(2)} L`} sub={`${w.left_ml} ml to go · target ${(Number(w.target_ml) / 1000).toFixed(1)} L${w.streak ? ` · 🔥 ${w.streak} days` : ""}`}
      right={<Ring value={Number(w.percent)} size={120} label="💧" sub="today"/>}>
      <div className="d-chips" style={{ marginTop: 10 }}>{[150, 250, 500, 750].map(ml => <button key={ml} className="d-chip" onClick={() => void call<Row>("/water", token, postJson({ ml })).then(setW)}>+{ml} ml</button>)}</div></Hero>
    <Card kicker="This week" title="Litres per day">{(w.week as Row[]).map(d => <p key={String(d.date)}>{String(d.date).slice(5)}: {(Number(d.ml) / 1000).toFixed(1)} L</p>)}<p className="d-note">{w.how}</p></Card>
  </div>;
}

export function MindsetPage({ token }: { token: string }) {
  const [m, setM] = useState<Row | null>(null);
  const [tab, setTab] = useState("affirm");
  const [text, setText] = useState("");
  const [woop, setWoop] = useState<Record<string, string>>({ wish: "", outcome: "", obstacle: "", plan: "" });
  const [items, setItems] = useState(["", "", ""]);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/mindset", token).then(setM).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const entry = (body: Row) => void call("/mindset/entries", token, postJson(body)).then(() => { setNote("Saved"); load(); }).catch(e => setNote(errText(e)));
  if (!m) return <div className="d-empty">Loading…</div>;
  return <div className="d-dash">
    {m.affirmation_of_the_day && <div style={{ background: "#7c4dff", color: "#fff", padding: 22, borderRadius: 22 }}><small>TODAY&apos;S AFFIRMATION · 🔥 {m.read_streak}</small>
      <h2 style={{ margin: "6px 0" }}>{m.affirmation_of_the_day.text}</h2>
      <button className="d-btn" disabled={!!m.read_today} onClick={() => entry({ kind: "affirm_read" })}>{m.read_today ? "✓ Read today" : "✨ I read my affirmations"}</button></div>}
    {note && <p className="d-note">{note}</p>}
    <div className="d-chips">{[["affirm", "✨ Affirmations"], ["script", "✍️ Scripting"], ["woop", "🎯 WOOP"], ["thanks", "🙏 Gratitude"]].map(([k, l]) => <button key={k} className={`d-chip ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "affirm" && <Card kicker="Your cards" title="Read slowly, then act">{(m.affirmations as Row[]).map(a => <p key={a.id}>
      <button className="text-button" onClick={() => void call(`/affirmations/${a.id}`, token, patchJson({ favorite: !a.favorite })).then(load)}>{a.favorite ? "⭐" : "☆"}</button> {a.text} <small className="d-note">{(m.categories as Row)[a.category]}</small></p>)}
      <div className="d-row"><input className="d-input" value={text} onChange={e => setText(e.target.value)} placeholder="Write your own"/><button className="d-btn" disabled={text.trim().length < 3}
        onClick={() => void call("/affirmations", token, postJson({ text })).then(() => { setText(""); load(); })}>Add</button></div></Card>}
    {tab === "script" && <Card kicker={`Scripting · 🔥 ${m.scripting_streak}`} title="Write your future in the present tense">
      {(m.scripting_prompts as string[]).map(p => <p key={p} className="d-note">💡 {p}</p>)}
      <textarea className="d-input" rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="I am…"/>
      <button className="d-btn" disabled={!text.trim()} onClick={() => { entry({ kind: "scripting", body: text }); setText(""); }}>Save</button></Card>}
    {tab === "woop" && <Card kicker="WOOP" title="Wish → Outcome → Obstacle → Plan">
      {Object.entries(m.woop_steps as Record<string, string>).map(([k, l]) => <label key={k} className="d-note" style={{ display: "block" }}>{l}<input className="d-input" value={woop[k]} onChange={e => setWoop({ ...woop, [k]: e.target.value })}/></label>)}
      <button className="d-btn" disabled={Object.values(woop).some(v => !v.trim())} onClick={() => { entry({ kind: "woop", data: woop }); setWoop({ wish: "", outcome: "", obstacle: "", plan: "" }); }}>Save plan</button>
      {(m.woop as Row[]).map(w => <p key={w.id}>🎯 <b>{w.wish}</b> <span className="d-note">→ {w.plan}</span></p>)}</Card>}
    {tab === "thanks" && <Card kicker={`Gratitude · ${m.gratitude_week} this week`} title="Three good things">
      {items.map((v, i) => <input key={i} className="d-input" value={v} onChange={e => setItems(items.map((y, k) => (k === i ? e.target.value : y)))} placeholder={`${i + 1}. I'm grateful for…`}/>)}
      <button className="d-btn" disabled={!items.some(x => x.trim())} onClick={() => { entry({ kind: "gratitude", data: { items } }); setItems(["", "", ""]); }}>Save</button></Card>}
    <Card kicker="Videos" title="Affirmations, meditation, motivation">{(m.videos as Row[]).map(v => <p key={v.url}><a href={v.url} target="_blank" rel="noreferrer">▶ {v.title}</a></p>)}<p className="d-note">{m.honest}</p></Card>
  </div>;
}

export function BoardPage({ token }: { token: string }) {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [cons, setCons] = useState<Row | null>(null);
  const load = useCallback(() => {
    call<Row[]>("/tasks", token).then(r => setTasks((r as Row[]).filter(x => ["inbox", "todo", "in_progress"].includes(String(x.status))))).catch(() => undefined);
    call<Row>("/consistency", token).then(setCons).catch(() => undefined);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const end = new Date(); end.setHours(23, 59, 59); const week = new Date(end.getTime() + 6 * 86400000);
  const col = (x: Row) => { const d = x.due_at ? new Date(String(x.due_at)) : null; return x.status === "in_progress" || (d && d <= end) ? "now" : (d && d <= week) || x.priority === "high" ? "next" : "later"; };
  return <div className="d-dash">
    <div className="d-grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>{[["now", "🔥 Now"], ["next", "⏭ Next"], ["later", "🗂 Later"]].map(([k, l]) =>
      <Card key={k} kicker={l} title={`${tasks.filter(x => col(x) === k).length} tasks`}>{tasks.filter(x => col(x) === k).map(x => <p key={String(x.id)}>
        <button className="text-button" onClick={() => void call(`/tasks/${x.id}/complete`, token, { method: "PATCH" }).then(load)}>○</button> {x.title} <small className="d-note">{x.priority}</small></p>)}</Card>)}</div>
    {cons && <Card kicker={`Habit strength · average ${cons.average_strength ?? "—"}`} title="Never miss twice">{(cons.habits as Row[]).map(h => <div key={h.id} style={{ padding: "4px 0" }}>
      <b>{h.icon} {h.name}</b> <span className="d-note">{h.strength}/100 · 🔥 {h.streak} · day {h.journey_day}/66</span>
      <div style={{ height: 8, borderRadius: 4, background: "var(--d-card2)" }}><div style={{ width: `${h.strength}%`, height: 8, borderRadius: 4, background: Number(h.strength) >= 60 ? "var(--d-green)" : "var(--d-amber)" }}/></div>
      <small className="d-note">{h.nudge}</small></div>)}
      {(cons.stacking as Row[]).map(s => <p key={s.text} className="d-note">🔗 {s.text}</p>)}</Card>}
  </div>;
}
