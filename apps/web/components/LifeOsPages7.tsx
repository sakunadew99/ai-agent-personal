"use client";
/* Medicines, Skills & trainers (pitch + pose in an iframe), and health advice: web versions of the phone screens. */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Hero, Meter, Ring } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HealthAdvicePanel({ token }: { token: string }) {
  const [a, setA] = useState<Row | null>(null);
  const load = useCallback((ai = false) => { call<Row>(`/health/advice${ai ? "?ai=true" : ""}`, token).then(setA).catch(() => undefined); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!a) return null;
  return <Card kicker="💡 Advice from your last 2 weeks" title={`${(a.tips as Row[]).length} tips`} action={!a.ai_text && <button className="d-btn ghost" onClick={() => load(true)}>✨ AI coach advice</button>}>
    {(a.tips as Row[]).map(t => <div key={t.title} className="d-row" style={{ alignItems: "flex-start" }}><span style={{ fontSize: 20 }}>{t.icon}</span><div><b style={{ color: "var(--d-text)" }}>{t.title}</b><p className="d-note" style={{ margin: 0 }}>{t.text}</p></div></div>)}
    {a.ai_text && <pre className="d-plan">{a.ai_text}</pre>}{a.ai_note && <p className="d-note">{a.ai_note}</p>}<p className="d-note">{a.disclaimer}</p>
  </Card>;
}

export function MedicinesPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [f, setF] = useState<Row>({ name: "", dose: "", times: "08:00", days: [] as number[], with_food: false, stock: "", per_dose: "1" });
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/medicines", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Loading medicines…</div>;
  const mark = (d: Row, status: string | null) => void call<Row>(`/medicines/${d.medicine_id}/log`, token, postJson({ slot: d.slot, status })).then(setV).catch(e => setNote(errText(e)));
  const save = () => {
    const body = { name: f.name.trim(), dose: f.dose.trim() || null, times: String(f.times).split(/[,\s]+/).filter(Boolean), days: f.days.length ? f.days : null,
      with_food: f.with_food, stock: f.stock === "" ? null : Number(f.stock), per_dose: Number(f.per_dose) || 1 };
    void call(editing ? `/medicines/${editing}` : "/medicines", token, editing ? patchJson(body) : postJson(body))
      .then(() => { setEditing(null); setF({ name: "", dose: "", times: "08:00", days: [], with_food: false, stock: "", per_dose: "1" }); load(); }).catch(e => setNote(errText(e)));
  };
  const doses: Row[] = v.doses;
  return <div className="d-dash">
    <Hero kicker="Medicines & supplements" title={`${doses.filter(d => d.status === "taken").length} of ${doses.length}`} accent="taken today"
      sub={v.next ? `Next: ${v.next.name} at ${v.next.slot}` : "All done for today"} right={<Ring value={v.adherence_7d ?? 0} size={120} label={v.adherence_7d != null ? `${v.adherence_7d}%` : "—"} sub="7 days"/>}/>
    {note && <p className="d-note">{note}</p>}
    {(v.refill as Row[]).map(m => <p key={m.id} className="d-note" style={{ color: "var(--d-amber)" }}>⚠ {m.name}: {m.stock} left (about {m.days_left} days). Time to refill.</p>)}
    <div className="d-grid-2">
      <Card kicker="Today" title="Doses">{doses.map(d => <div key={`${d.medicine_id}-${d.slot}`} className="d-row" style={{ justifyContent: "space-between" }}>
        <span><b>{d.slot}</b> {d.icon} {d.name} <small className="d-note">{d.dose}{d.with_food ? " · with food" : ""}</small></span>
        {d.status === "taken" || d.status === "skipped" ? <button className="text-button" onClick={() => mark(d, null)}>{d.status === "taken" ? "✓ taken" : "skipped"} · undo</button>
          : <span className="d-row"><button className="d-btn" onClick={() => mark(d, "taken")}>✓ Take</button><button className="d-btn ghost" onClick={() => mark(d, "skipped")}>Skip</button></span>}</div>)}
        {!doses.length && <p className="d-note">No doses today.</p>}</Card>
      <Card kicker={editing ? "Edit medicine" : "Add medicine"} title={editing ? f.name : "New"}>
        <input className="d-input" placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })}/>
        <input className="d-input" placeholder="Dose as on the label" value={f.dose} onChange={e => setF({ ...f, dose: e.target.value })}/>
        <input className="d-input" placeholder="Times, e.g. 08:00, 20:00" value={f.times} onChange={e => setF({ ...f, times: e.target.value })}/>
        <div className="d-chips">{DAYS.map((d, i) => <button key={d} className={`d-chip ${f.days.includes(i + 1) ? "on" : ""}`} onClick={() => setF({ ...f, days: f.days.includes(i + 1) ? f.days.filter((x: number) => x !== i + 1) : [...f.days, i + 1].sort() })}>{d}</button>)}</div>
        <div className="d-row"><input className="d-input" type="number" placeholder="Pills left" value={f.stock} onChange={e => setF({ ...f, stock: e.target.value })}/>
          <input className="d-input" type="number" placeholder="Per dose" value={f.per_dose} onChange={e => setF({ ...f, per_dose: e.target.value })}/>
          <label className="d-row"><input type="checkbox" checked={f.with_food} onChange={e => setF({ ...f, with_food: e.target.checked })}/> with food</label></div>
        <div className="d-row"><button className="d-btn" disabled={!f.name.trim()} onClick={save}>💾 Save</button>{editing && <button className="d-btn ghost" onClick={() => setEditing(null)}>Cancel</button>}</div>
        <p className="d-note">Leave days empty for every day. Sakuna only reminds you of what you enter; it never suggests doses.</p></Card>
    </div>
    <Card kicker="My medicines" title={`${(v.medicines as Row[]).length}`}>{(v.medicines as Row[]).map(m => <div key={m.id} className="d-row" style={{ justifyContent: "space-between" }}>
      <span>{m.icon} <b>{m.name}</b> {m.dose} <small className="d-note">{(m.times as string[]).join(", ")}{m.stock != null ? ` · ${m.stock} left` : ""}</small></span>
      <span className="d-row"><button className="text-button" onClick={() => { setEditing(m.id); setF({ name: m.name, dose: m.dose || "", times: (m.times as string[]).join(", "), days: m.days || [], with_food: m.with_food, stock: m.stock ?? "", per_dose: String(m.per_dose) }); }}>✎</button>
        <button className="danger-link" onClick={() => { if (window.confirm(`Delete ${m.name}?`)) void call(`/medicines/${m.id}`, token, { method: "DELETE" }).then(load); }}>✕</button></span></div>)}</Card>
  </div>;
}

function TrainerFrame({ kind, onResult, onClose }: { kind: "pitch" | "pose"; onResult: (r: Row) => void; onClose: () => void }) {
  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.origin !== window.location.origin) return; try { const r = JSON.parse(String(e.data)); if (r?.kind === kind) onResult(r); } catch { /* ignore */ } };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h);
  }, [kind, onResult]);
  return <div role="dialog" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.85)", display: "grid", placeItems: "center", padding: 12 }}>
    <div style={{ width: "min(680px,100%)", height: "min(92vh,900px)", display: "grid", gridTemplateRows: "auto 1fr", gap: 8 }}>
      <div className="d-row" style={{ justifyContent: "flex-end" }}><button className="d-btn" onClick={onClose}>✕ Close</button></div>
      <iframe title={kind} src={`/trainers/${kind}.html`} allow="microphone; camera" style={{ width: "100%", height: "100%", border: 0, borderRadius: 16, background: "#070b09" }}/>
    </div></div>;
}

export function SkillsPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [trainer, setTrainer] = useState<{ kind: "pitch" | "pose"; id: string } | null>(null);
  const [plan, setPlan] = useState<Row | null>(null);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/skills", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const onResult = useCallback((r: Row) => {
    if (!trainer) return;
    const id = trainer.id; setTrainer(null);
    void call<Row>(`/skills/${id}/sessions`, token, postJson({ minutes: Math.max(1, Math.round(Number(r.minutes) || 1)), source: r.kind, metrics: r })).then(setV).catch(e => setNote(errText(e)));
  }, [trainer, token]);
  if (!v) return <div className="d-empty">Loading skills…</div>;
  const add = (t: Row) => void call<Row>("/skills", token, postJson({ name: t.name, icon: t.icon || "🎯", category: t.category || "other", trainer: t.trainer || null, goal: t.goal || null })).then(setV).catch(e => setNote(errText(e)));
  const logMin = (s: Row) => { const m = window.prompt(`Minutes of ${s.name}?`, "20"); if (m) void call<Row>(`/skills/${s.id}/sessions`, token, postJson({ minutes: Number(m) || 10 })).then(setV).catch(e => setNote(errText(e))); };
  return <div className="d-dash">
    <Hero kicker="Skills & trainers" title={`${Math.round(v.week_minutes / 6) / 10} h`} accent="this week" sub="Yoga, singing, guitar, kickboxing, swimming, leadership… log practice, use the pitch trainer and pose coach."/>
    {note && <p className="d-note">{note}</p>}
    {(v.week as Row[]).some(d => d.minutes) && <Card kicker="Minutes per day" title="This week"><Bars data={(v.week as Row[]).map(d => ({ label: d.label, value: d.minutes }))} height={110}/></Card>}
    <div className="d-grid-2">{(v.skills as Row[]).map(s => <Card key={s.id} kicker={`Level ${s.level} · ${s.total_hours} h${s.streak ? ` · 🔥 ${s.streak}` : ""}`} title={`${s.icon} ${s.name}`}
      action={<button className="danger-link" onClick={() => { if (window.confirm(`Remove ${s.name}?`)) void call(`/skills/${s.id}`, token, { method: "DELETE" }).then(load); }}>✕</button>}>
      <Meter value={Math.min(100, s.week_pct || 0)}/><p className="d-note">{s.week_minutes}/{s.weekly_minutes} min this week{s.goal ? ` · 🎯 ${s.goal}` : ""}</p>
      <div className="d-row"><button className="d-btn" onClick={() => logMin(s)}>＋ Log</button>
        {s.trainer && <button className="d-btn ghost" onClick={() => setTrainer({ kind: s.trainer, id: s.id })}>{s.trainer === "pitch" ? "🎤 Pitch trainer" : "🧘 Pose coach"}</button>}
        <button className="d-btn ghost" onClick={() => void call<Row>(`/skills/${s.id}/plan?ai=true`, token, postJson({})).then(setPlan)}>📋 Plan</button>
        <button className="text-button" onClick={() => void call<Row>(`/skills/${s.id}`, token, patchJson({ level: Math.min(10, s.level + 1) })).then(setV)}>Level +1</button></div>
      {(s.recent as Row[]).slice(0, 4).map(r => <small key={r.id} className="d-note" style={{ display: "block" }}>{r.date} · {r.minutes} min{r.metrics ? ` · ${r.metrics.kind === "pitch" ? `${r.metrics.in_tune_pct}% in tune` : `${r.metrics.reps ?? r.metrics.hold_seconds + "s"} · ${r.metrics.good_pct}% form`}` : ""}</small>)}
    </Card>)}</div>
    {plan && <Card kicker={`Today's plan · ${plan.skill}`} title={plan.source === "ai" ? "AI coach" : "Built-in"} action={<button className="text-button" onClick={() => setPlan(null)}>Close</button>}>
      {plan.text ? <pre className="d-plan">{plan.text}</pre> : <ol>{(plan.steps as string[]).map((x, i) => <li key={i}>{x}</li>)}</ol>}</Card>}
    <Card kicker="Add a skill" title="Pick or type your own">
      <div className="d-chips">{(v.templates as Row[]).map(t => <button key={t.name} className="d-chip" onClick={() => add(t)}>{t.icon} {t.name}{t.trainer ? (t.trainer === "pitch" ? " 🎤" : " 📷") : ""}</button>)}</div>
      <div className="d-row"><input className="d-input" placeholder="e.g. Chess, Drawing, Negotiation" value={custom} onChange={e => setCustom(e.target.value)}/><button className="d-btn" disabled={!custom.trim()} onClick={() => { add({ name: custom.trim() }); setCustom(""); }}>Add</button></div>
    </Card>
    {trainer && <TrainerFrame kind={trainer.kind} onResult={onResult} onClose={() => setTrainer(null)}/>}
  </div>;
}
