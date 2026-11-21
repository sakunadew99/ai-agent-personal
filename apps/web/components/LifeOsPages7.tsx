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

function TrainerFrame({ kind, onResult, onClose }: { kind: "pitch" | "pose" | "skin" | "karaoke"; onResult: (r: Row) => void; onClose: () => void }) {
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
  const [trainer, setTrainer] = useState<{ kind: "pitch" | "pose" | "karaoke"; id: string } | null>(null);
  const [plan, setPlan] = useState<Row | null>(null);
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/skills", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const onResult = useCallback((r: Row) => {
    if (!trainer) return;
    const id = trainer.id; setTrainer(null);
    void call<Row>(`/skills/${id}/sessions`, token, postJson({ minutes: Math.max(1, Math.round(Number(r.minutes) || 1)), source: r.kind, metrics: r })).then(x => {
      setV(x);
      const latest = (x.skills as Row[]).find(k => k.id === id)?.recent?.[0];
      if (latest && r.kind === "karaoke") void call<Row>(`/skills/sessions/${latest.id}/advice?ai=true`, token, postJson({})).then(a => setPlan({ skill: `${r.song}: ${r.score}/100`, source: a.ai_text ? "ai" : "plan",
        text: [a.progress?.text, ...(a.tips || []), a.ai_text].filter(Boolean).join("\n\n"), steps: [] }));
    }).catch(e => setNote(errText(e)));
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
        {s.trainer && s.trainer !== "karaoke" && <button className="d-btn ghost" onClick={() => setTrainer({ kind: s.trainer, id: s.id })}>{s.trainer === "pitch" ? "🎤 Tuner" : "🧘 Pose coach"}</button>}
        {(s.category === "music" || s.trainer === "pitch") && <button className="d-btn ghost" onClick={() => setTrainer({ kind: "karaoke", id: s.id })}>🎶 Sing-along</button>}
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

export function SkinPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [scan, setScan] = useState(false);
  const load = useCallback(() => { call<Row>("/skin", token).then(setV).catch(() => undefined); }, [token]);
  useEffect(() => { load(); }, [load]);
  const onResult = useCallback((r: Row) => { setScan(false); void call<Row>("/skin", token, postJson({ metrics: r })).then(setV); }, [token]);
  if (!v) return <div className="d-empty">Loading…</div>;
  const last: Row | null = v.latest, m: Row = last?.metrics || {};
  return <div className="d-dash">
    <Hero kicker="Skin & glow · daily check" title={last ? `${last.score}` : "Scan"} accent={last ? "glow score" : "your face"} sub={v.how}
      right={<Ring value={last?.score ?? 0} size={120} label={last ? `${last.score}` : "—"} sub="glow"/>}>
      <button className="d-btn" style={{ marginTop: 12 }} onClick={() => setScan(true)}>📷 Scan my face</button></Hero>
    {last && <Card kicker="Latest numbers" title={new Date(last.created_at).toLocaleString()}>
      <p className="d-note">Brightness {Math.round(m.brightness ?? 0)} · redness {m.redness} · evenness {m.evenness}% · shine {m.shine_pct}% · spots {m.spot_density}{m.lighting_note ? ` · 💡 ${m.lighting_note}` : ""}</p></Card>}
    {(v.trend as Row[]).length > 1 && <Card kicker="Glow score" title="Over time"><Bars data={(v.trend as Row[]).map(t => ({ label: String(new Date(t.date).getDate()), value: Number(t.score) }))} height={110}/></Card>}
    <Card kicker="Tips" title="From your numbers"><ul className="d-list">{(v.tips as string[]).map((t, i) => <li key={i}>{t}</li>)}</ul>
      {v.sleep_link && <p className="d-note">😴 {v.sleep_link.text} ({v.sleep_link.pairs} checks)</p>}<p className="d-note">{v.disclaimer}</p></Card>
    <Card kicker="History" title={`${(v.checks as Row[]).length} checks`}>{(v.checks as Row[]).slice(0, 15).map(c => <div key={c.id} className="d-row" style={{ justifyContent: "space-between" }}>
      <span><b>{c.score}</b> · {new Date(c.created_at).toLocaleDateString()} {c.note ? `· ${c.note}` : ""}</span>
      <span><button className="text-button" onClick={() => { const n = window.prompt("Note", c.note || ""); if (n !== null) void call<Row>(`/skin/${c.id}`, token, patchJson({ note: n })).then(setV); }}>✎</button>
        <button className="danger-link" onClick={() => { if (window.confirm("Delete this check?")) void call(`/skin/${c.id}`, token, { method: "DELETE" }).then(load); }}>✕</button></span></div>)}</Card>
    {scan && <TrainerFrame kind="skin" onResult={onResult} onClose={() => setScan(false)}/>}
  </div>;
}

export function RitualsPage({ token }: { token: string }) {
  const [m, setM] = useState<Row | null>(null);
  const [e, setE] = useState<Row | null>(null);
  const [mf, setMf] = useState({ energy: 3, mood: 3, focus: "" });
  const [ef, setEf] = useState({ mood: 3, wins: "", lesson: "", tomorrow: "" });
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    call<Row>("/ritual/morning", token).then(x => { setM(x); setMf(f => ({ ...f, focus: x.saved?.focus || x.suggested_focus || "" })); }).catch(() => undefined);
    call<Row>("/ritual/evening", token).then(setE).catch(() => undefined);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const scale = (v: number, set: (n: number) => void, icons: string[]) => <div className="d-chips">{icons.map((ic, i) => <button key={i} className={`d-chip ${v === i + 1 ? "on" : ""}`} onClick={() => set(i + 1)}>{ic}</button>)}</div>;
  const FACES = ["😫", "😕", "😐", "🙂", "😄"];
  return <div className="d-dash">
    <Hero kicker="2-minute rituals" title="Start and close" accent="your day" sub="Morning: energy, mood, one focus. Evening: wins, a lesson and tomorrow's top 3 (they become tasks)."/>
    {note && <p className="d-note">{note}</p>}
    <div className="d-grid-2">
      <Card kicker={m?.done ? "☀️ Done today" : "☀️ Morning"} title={m?.greeting || "Good morning"}>
        {m?.sleep_hours != null && <p className="d-note">😴 You slept {m.sleep_hours} h</p>}
        {(m?.blocks as Row[] || []).map((b, i) => <small key={i} className="d-note" style={{ display: "block" }}>{b.start} · {b.title}</small>)}
        <p className="d-note">Energy</p>{scale(mf.energy, n => setMf({ ...mf, energy: n }), ["🪫", "😴", "⚡", "⚡⚡", "🚀"])}
        <p className="d-note">Mood</p>{scale(mf.mood, n => setMf({ ...mf, mood: n }), FACES)}
        <input className="d-input" placeholder="One focus for today" value={mf.focus} onChange={x => setMf({ ...mf, focus: x.target.value })}/>
        <button className="d-btn" onClick={() => void call("/ritual/morning", token, postJson(mf)).then(() => { setNote("Morning saved ☀️"); load(); })}>✓ Start my day</button>
      </Card>
      <Card kicker={e?.done ? "🌙 Done today" : "🌙 Evening"} title="Close your day">
        {e && <p className="d-note">✅ {(e.tasks_done as string[]).length} done · 🎯 {e.focus_minutes} min focus · 👟 {Number(e.steps).toLocaleString()} steps · 🎵 {e.practice_minutes} min practice · 💊 {e.doses_taken}/{e.doses_total}</p>}
        {e?.morning_focus && <p className="d-note" style={{ color: "var(--d-amber)" }}>Focus this morning: {e.morning_focus}</p>}
        {scale(ef.mood, n => setEf({ ...ef, mood: n }), FACES)}
        <input className="d-input" placeholder="Wins, separated by commas" value={ef.wins} onChange={x => setEf({ ...ef, wins: x.target.value })}/>
        <input className="d-input" placeholder="One lesson" value={ef.lesson} onChange={x => setEf({ ...ef, lesson: x.target.value })}/>
        <input className="d-input" placeholder="Tomorrow's top 3, separated by commas" value={ef.tomorrow} onChange={x => setEf({ ...ef, tomorrow: x.target.value })}/>
        <button className="d-btn" onClick={() => void call<Row>("/ritual/evening", token, postJson({ mood: ef.mood, wins: ef.wins.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5),
          lesson: ef.lesson || null, tomorrow: ef.tomorrow.split(",").map(s => s.trim()).filter(Boolean).slice(0, 3) })).then(r => { setNote(`Day closed 🌙 · ${(r.tasks_created as string[]).length} tasks for tomorrow`); load(); })}>✓ Close my day</button>
      </Card>
    </div>
  </div>;
}
