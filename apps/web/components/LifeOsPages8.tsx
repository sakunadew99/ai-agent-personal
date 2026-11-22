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
