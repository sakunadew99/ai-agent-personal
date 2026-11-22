"use client";
/* Role-play coach (soft-skills academy) and the next vision pages for the web. */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, postJson, type JsonRecord as Row } from "@/lib/api";
import { Card, Hero, Ring } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const tone = (s: number) => (s >= 75 ? "var(--d-green)" : s >= 50 ? "var(--d-amber)" : "var(--d-red)");

export function RolePlayPage({ token }: { token: string }) {
  const [cat, setCat] = useState<Row | null>(null);
  const [s, setS] = useState<Row | null>(null);
  const [text, setText] = useState("");
  const [res, setRes] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/roleplay", token).then(setCat).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const start = (id: string) => { setRes(null); void call<Row>("/roleplay", token, postJson({ scenario: id })).then(setS).catch(e => setNote(errText(e))); };
  const send = () => { if (!s || !text.trim()) return; void call<Row>(`/roleplay/${s.id}/reply`, token, postJson({ text })).then(r => { setS({ ...s, messages: r.messages }); setText(""); }).catch(e => setNote(errText(e))); };
  const finish = (ai = false) => void call<Row>(`/roleplay/${s!.id}/finish${ai ? "?ai=true" : ""}`, token, postJson({})).then(r => { setRes(r); load(); }).catch(e => setNote(errText(e)));
  if (!cat) return <div className="d-empty">Loading the academy…</div>;
  return <div className="d-dash">
    <Hero kicker="Soft-skills academy · role-play" title="Practise the" accent="real conversation" sub={cat.ai_partner ? "AI plays the other person." : "Scripted partner; turn on AI for a live one. Scoring is the same plain rubric."}/>
    {note && <p className="d-note">{note}</p>}
    {s ? <div className="d-grid-2">
      <Card kicker={s.scenario.skill} title={`${s.scenario.icon} ${s.scenario.title}`} action={<button className="text-button" onClick={() => setS(null)}>‹ All</button>}>
        <p className="d-note">{s.scenario.setup}</p>
        {(s.messages as Row[]).map((m, i) => <p key={i} style={{ textAlign: m.role === "user" ? "right" : "left", background: m.role === "user" ? "var(--d-card2)" : "transparent", borderRadius: 12, padding: 8 }}>{m.text}</p>)}
        {!res && <><textarea className="d-input" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Your reply"/>
          <div className="d-row"><button className="d-btn" disabled={!text.trim()} onClick={send}>Send</button><button className="d-btn ghost" onClick={() => finish()}>🏁 Finish & score</button></div></>}
      </Card>
      {res && <Card kicker="Your score" title={`${res.score}/100`} action={<Ring value={res.score} size={80} color={tone(res.score)} label={`${res.score}`}/>}>
        {(res.criteria as Row[]).map(c => <p key={c.label} className="d-note">{c.ok ? "✓" : "✗"} {c.label} ({c.ok ? c.points : 0}/{c.points})</p>)}
        <ul className="d-list">{(res.tips as string[]).map((t, i) => <li key={i}>{t}</li>)}</ul>
        {res.ai ? <pre className="d-plan">{res.ai}</pre> : cat.ai_partner && <button className="d-btn ghost" onClick={() => finish(true)}>✨ AI coach feedback</button>}
        <button className="d-btn" onClick={() => start(s.scenario.id)}>↻ Try again</button>
      </Card>}
    </div> : <div className="d-grid-2">{(cat.skills as Row[]).map(k => <Card key={k.skill} kicker={`${k.level}${k.avg_best != null ? ` · avg best ${k.avg_best}` : ""}`} title={k.name}>
      {(cat.scenarios as Row[]).filter(x => x.skill === k.skill).map(x => <button key={x.id} className="text-button" style={{ display: "block", textAlign: "left", width: "100%" }} onClick={() => start(x.id)}>
        {x.icon} <b>{x.title}</b> {x.best != null && <span style={{ color: tone(x.best) }}>· best {x.best}</span>}<br/><small className="d-note">{x.setup}</small></button>)}
    </Card>)}</div>}
  </div>;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function WealthPage({ token }: { token: string }) {
  const [m, setM] = useState<Row | null>(null);
  const [o, setO] = useState<Row | null>(null);
  const [saving, setSaving] = useState(""); const [rate, setRate] = useState("");
  const [hours, setHours] = useState("8"); const [budget, setBudget] = useState("10000");
  const [note, setNote] = useState("");
  const loadM = useCallback(() => {
    const q = [saving && `monthly_saving_lkr=${Number(saving)}`, rate && `usd_lkr=${Number(rate)}`].filter(Boolean).join("&");
    call<Row>(`/money/million${q ? `?${q}` : ""}`, token).then(x => { setM(x); setRate(r => r || String(x.usd_lkr)); setSaving(s => s || String(x.monthly_saving_lkr)); }).catch(e => setNote(errText(e)));
  }, [token, saving, rate]);
  const loadO = useCallback(() => { call<Row>(`/opportunities?hours=${Number(hours) || 8}&budget_lkr=${Number(budget) || 0}`, token).then(setO).catch(e => setNote(errText(e))); }, [token, hours, budget]);
  useEffect(() => { loadM(); loadO(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const goal = (x: Row) => void call<Row>("/dreams/propose", token, postJson({ dream: `Start ${x.title}`, horizon: "month", ai: false })).then(plan => {
    if (window.confirm(`Create a 1-month goal "Start ${x.title}" with first step: ${x.first}?`)) void call("/dreams/accept", token, postJson({ ...plan, next_action: x.first })).then(() => { setNote("Goal created."); loadO(); });
  });
  return <div className="d-dash">
    <Hero kicker="$1M financial freedom journey" title={m ? usd(m.current_usd) : "…"} accent="today" sub={m ? `≈ Rs ${Number(m.current_lkr).toLocaleString()} at ${m.usd_lkr} (${m.rate_source}). ${m.disclaimer}` : ""}
      right={m && <Ring value={Math.max(1, m.progress_pct)} size={120} label={`${m.progress_pct < 1 ? m.progress_pct.toFixed(2) : Math.round(m.progress_pct)}%`} sub="of $1M"/>}>
      <div className="d-row" style={{ marginTop: 10 }}><label className="d-note">Monthly saving (LKR)<input className="d-input" value={saving} onChange={e => setSaving(e.target.value)}/></label>
        <label className="d-note">LKR per USD<input className="d-input" value={rate} onChange={e => setRate(e.target.value)}/></label><button className="d-btn" onClick={loadM}>↻ Recalculate</button></div>
    </Hero>
    {note && <p className="d-note">{note}</p>}
    {m && <div className="d-grid-2">
      <Card kicker="Scenarios" title="Years to $1M">{(m.scenarios as Row[]).map(s => <p key={s.key}><b>{s.label}</b>: {s.years_to_target != null ? `${s.years_to_target} years` : "not within 50 years"}
        <br/><small className="d-note">{s.return_pct}% return · savings +{s.saving_growth_pct}%/year · need {usd(s.needed_monthly_usd["15"])}/month to get there in 15 years</small></p>)}</Card>
      <Card kicker="Actions" title="Daily · weekly · monthly · yearly">{Object.entries(m.actions as Record<string, string[]>).map(([k, v]) => <p key={k} className="d-note"><b style={{ textTransform: "capitalize" }}>{k}:</b> {v.join(" · ")}</p>)}</Card>
    </div>}
    <Card kicker="Income ideas" title="Ranked for your skills, time and budget" action={<div className="d-row"><input className="d-input" style={{ width: 80 }} value={hours} onChange={e => setHours(e.target.value)} title="hours/week"/>
      <input className="d-input" style={{ width: 110 }} value={budget} onChange={e => setBudget(e.target.value)} title="budget LKR"/><button className="d-btn ghost" onClick={loadO}>Rank</button></div>}>
      {o?.focus_warning && <p className="d-note" style={{ color: "var(--d-amber)" }}>⚠ {o.focus_warning}</p>}
      {(o?.items as Row[] || []).map(x => <div key={x.id} style={{ borderTop: "1px solid var(--d-line)", padding: "8px 0" }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--d-text)" }}>{x.title}</b><span style={{ color: x.fit >= 70 ? "var(--d-green)" : "var(--d-amber)", fontWeight: 800 }}>{x.fit}% fit</span></div>
        <small className="d-note">{x.what} · Rs {Number(x.cost_lkr).toLocaleString()} · {x.hours} h/week · {x.income}</small><br/>
        <small className="d-note">✓ {(x.why as string[]).join(" · ")} · Risks: {(x.risks as string[]).join(", ")}</small><br/>
        <button className="text-button" onClick={() => goal(x)}>🎯 Make it a goal (first: {x.first})</button></div>)}
    </Card>
  </div>;
}
