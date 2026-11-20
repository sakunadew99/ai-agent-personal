"use client";
/* Web versions of the newest phone features: Speaking coach, My schedule (detected times), and the what-if share calculator. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Hero, Ring, Stat } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "";
const tone = (s: number) => (s >= 75 ? "var(--d-green)" : s >= 50 ? "var(--d-amber)" : "var(--d-red)");

/* ---------------------------------------------------------------- Speaking coach */
type Rec = { start: () => void; stop: () => void; abort: () => void; lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null; onend: (() => void) | null };

export function SpeakingPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [lang, setLang] = useState<"en" | "de">("en");
  const [topic, setTopic] = useState("");
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const recog = useRef<Rec | null>(null); const media = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]);
  const finals = useRef<string[]>([]); const started = useRef(0); const stopping = useRef(false);
  const load = useCallback(() => { call<Row>("/speaking", token).then(x => { setV(x); setTopic(t => t || x.prompts?.en?.[0] || ""); }).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 500); return () => clearInterval(t); }, [rec]);

  async function send(transcript: string, blob: Blob | null) {
    const seconds = Math.max(5, Math.round((Date.now() - started.current) / 1000));
    try {
      let out: Row;
      if (blob && v?.whisper_available) {
        const form = new FormData();
        form.append("file", blob, "talk.webm"); form.append("seconds", String(seconds)); form.append("lang", lang); form.append("topic", topic); form.append("fallback", transcript);
        const res = await fetch(`${API_ORIGIN}/api/v1/speaking/audio`, { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("sakuna-access") || token}` }, body: form });
        out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.detail || `Upload failed (${res.status})`);
      } else out = await call<Row>("/speaking/sessions", token, postJson({ transcript, seconds, lang, topic: topic || undefined }));
      setResult(out); load();
    } catch (e) { setNote(errText(e)); }
  }
  async function start() {
    setNote(""); setResult(null); setLive(""); finals.current = []; stopping.current = false; started.current = Date.now(); setSecs(0);
    const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR && !v?.whisper_available) { setNote("This browser has no speech recognition. Use Chrome or Edge, or type / paste your talk below."); return; }
    try {
      if (v?.whisper_available && navigator.mediaDevices) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks.current = [];
        media.current = new MediaRecorder(stream);
        media.current.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
        media.current.start();
      }
      if (SR) {
        const r = new SR(); r.lang = lang === "de" ? "de-DE" : "en-US"; r.continuous = true; r.interimResults = true;
        r.onresult = e => { let interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) finals.current.push(t.trim()); else interim += t; }
          setLive([...finals.current, interim].join(" ").slice(-500)); };
        r.onend = () => { if (!stopping.current) { try { r.start(); } catch { /* finished */ } } };
        recog.current = r; r.start();
      }
      setRec(true);
    } catch (e) { setNote(errText(e)); }
  }
  function stop() {
    stopping.current = true; setRec(false); recog.current?.stop();
    const m = media.current;
    if (m && m.state !== "inactive") {
      m.onstop = () => { m.stream.getTracks().forEach(t => t.stop()); void send(finals.current.join(" "), new Blob(chunks.current, { type: "audio/webm" })); };
      m.stop();
    } else setTimeout(() => void send(finals.current.join(" "), null), 600);
  }
  if (!v) return <div className="d-empty">Loading your speaking coach…</div>;
  const d: Row = result?.details || {};
  return <div className="d-dash">
    <Hero kicker="Speaking coach · English & Deutsch" title="Speak with" accent="confidence" sub={`${v.this_week} talks this week${v.best_score != null ? ` · best ${v.best_score}/100` : ""}${v.whisper_available ? " · Whisper on" : ""}`}
      right={<Ring value={result ? result.score : Number(v.best_score || 0)} size={120} color={tone(result ? result.score : Number(v.best_score || 0))} label={`${result ? result.score : v.best_score ?? "—"}`} sub={result ? "this talk" : "best"}/>}/>
    <div className="d-grid-2">
      <Card kicker="Pick a topic" title={lang === "de" ? "🇩🇪 Deutsch" : "🇬🇧 English"} action={<div className="d-chips">{(["en", "de"] as const).map(l => <button key={l} className={`d-chip ${lang === l ? "on" : ""}`} onClick={() => { setLang(l); setTopic(v.prompts?.[l]?.[0] || ""); }}>{l === "en" ? "English" : "Deutsch"}</button>)}</div>}>
        {(v.prompts?.[lang] as string[] || []).map(p => <button key={p} className={`d-chip ${topic === p ? "on" : ""}`} style={{ textAlign: "left", borderRadius: 12 }} onClick={() => setTopic(p)}>{p}</button>)}
      </Card>
      <Card kicker={rec ? "Recording…" : "Talk for 1–2 minutes"} title={rec ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : "Tap and talk"}>
        <button className="d-btn" style={{ fontSize: 18, padding: "16px 22px", background: rec ? "var(--d-red)" : undefined }} onClick={() => (rec ? stop() : void start())}>{rec ? "■ Stop and score" : "🎙 Start talking"}</button>
        {live && <p className="d-note">{live}</p>}
        <details><summary className="d-note">No microphone? Type or paste what you said</summary>
          <textarea className="d-input" rows={4} value={typed} onChange={e => setTyped(e.target.value)} placeholder="Your talk…"/>
          <button className="d-btn ghost" disabled={typed.trim().split(/\s+/).length < 3} onClick={() => { started.current = Date.now() - Math.max(5, Math.round(typed.split(/\s+/).length / 2.2)) * 1000; void send(typed, null); }}>Score this text</button></details>
        {note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{note}</p>}
      </Card>
    </div>
    {result && <Card kicker={`This talk · ${result.source === "whisper" ? "Whisper transcript" : "browser transcript"}`} title={`${result.score}/100`}>
      <div className="d-stats">
        <Stat label="Pace" icon="⏱" value={`${result.wpm} wpm`} tone={d.pace_range && result.wpm >= d.pace_range[0] && result.wpm <= d.pace_range[1] ? "green" : "amber"} hint={d.pace_range ? `aim ${d.pace_range[0]}–${d.pace_range[1]}` : ""}/>
        <Stat label="Fillers" icon="🙊" value={result.fillers} tone={result.fillers ? "amber" : "green"} hint="um, like, äh…"/>
        <Stat label="Variety" icon="🎨" value={`${d.variety_pct ?? 0}%`} tone={(d.variety_pct ?? 0) >= 45 ? "green" : "amber"} hint="different words"/>
        <Stat label="Length" icon="🕒" value={`${result.seconds}s`} tone="blue" hint={`${result.words} words`}/>
      </div>
      <ul className="d-list">{(d.tips as string[] || []).map((t, i) => <li key={i}>{t}</li>)}</ul>
      {result.feedback ? <pre className="d-plan">{result.feedback}</pre> : v.ai_available && <button className="d-btn ghost" onClick={() => void call<Row>(`/speaking/${result.id}/feedback`, token, postJson({})).then(setResult).catch(e => setNote(errText(e)))}>✨ AI coach feedback</button>}
      <p className="d-note">“{String(result.transcript).slice(0, 800)}”</p>
    </Card>}
    {(v.trend as Row[]).length > 1 && <Card kicker="Your progress" title="Score per talk"><Bars data={(v.trend as Row[]).map((t, i) => ({ label: String(i + 1), value: Number(t.score), color: tone(Number(t.score)) }))} height={120}/></Card>}
    <Card kicker="Recent talks" title={`${(v.sessions as Row[]).length} saved`}>
      {(v.sessions as Row[]).slice(0, 10).map(s => <div key={s.id} className="d-row" style={{ justifyContent: "space-between" }}>
        <button className="text-button" style={{ textAlign: "left" }} onClick={() => setResult(s)}><b style={{ color: tone(s.score) }}>{s.score}</b> {s.lang === "de" ? "🇩🇪" : "🇬🇧"} {s.topic || "Free talk"} · {s.wpm} wpm · {s.fillers} fillers</button>
        <button className="danger-link" onClick={() => { if (window.confirm("Delete this talk?")) void call(`/speaking/${s.id}`, token, { method: "DELETE" }).then(load); }}>✕</button></div>)}
    </Card>
  </div>;
}

/* ---------------------------------------------------------------- My schedule */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hm = (v: unknown) => (v ? String(v).slice(0, 5) : "");

function DayPick({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return <div className="d-chips">{DAYS.map((d, i) => <button key={d} className={`d-chip ${value.includes(i + 1) ? "on" : ""}`} onClick={() => onChange(value.includes(i + 1) ? value.filter(x => x !== i + 1) : [...value, i + 1].sort())}>{d}</button>)}</div>;
}

export function SchedulePage({ token }: { token: string }) {
  const [p, setP] = useState<Row | null>(null);
  const [routines, setRoutines] = useState<Row[]>([]);
  const [hint, setHint] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => {
    call<Row>("/me", token).then(me => { const x = me.profile || {};
      setP({ wake_time: hm(x.wake_time), sleep_time: hm(x.sleep_time), work_start: hm(x.work_start), work_end: hm(x.work_end), gym_time: hm(x.gym_time) || "18:00",
        work_days: x.work_days || [1, 2, 3, 4, 5], gym_days: x.gym_days || [1, 3, 5] }); }).catch(e => setNote(errText(e)));
    call<Row[]>("/routines", token).then(r => setRoutines(r.filter(x => x.kind === "routine"))).catch(() => undefined);
    call<Row>("/schedule/suggest", token).then(setHint).catch(() => undefined);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!p) return <div className="d-empty">Loading your schedule…</div>;
  const save = (body: Row) => call("/profile", token, patchJson(body)).then(() => { setNote("Saved. Today's plan uses it now."); load(); }).catch(e => setNote(errText(e)));
  const time = (k: string, label: string) => <label className="d-row" style={{ justifyContent: "space-between" }}><span>{label}</span>
    <input className="d-input" type="time" style={{ maxWidth: 140 }} value={p[k] || ""} onChange={e => setP({ ...p, [k]: e.target.value })}/></label>;
  const names: Record<string, string> = { work_start: "Office starts", work_end: "Office ends", gym_time: "Gym", wake_time: "Wake up", sleep_time: "Sleep", work_days: "Office days", gym_days: "Gym days" };
  const show = (v: unknown) => (Array.isArray(v) ? v.map(d => DAYS[Number(d) - 1]).join(" ") : String(v ?? "—"));
  return <div className="d-dash">
    <Hero kicker="My schedule" title="Your real" accent="times" sub="Office, gym and sleep times shape Today's plan. Set them by hand, or let Sakuna detect them from what you log."/>
    {note && <p className="d-note">{note}</p>}
    <Card kicker="✨ Detected from your logs" title={hint?.changes?.length ? `${hint.changes.length} suggested change${hint.changes.length > 1 ? "s" : ""}` : "Nothing to change"}>
      {hint?.changes?.length ? <>
        {(hint.changes as Row[]).map(c => <div key={c.field} className="d-row" style={{ justifyContent: "space-between" }}><span>{names[c.field] || c.field}</span>
          <span><s className="d-note">{show(c.from)}</s> → <b style={{ color: "var(--d-green)" }}>{show(c.to)}</b></span></div>)}
        <p className="d-note">{Object.values(hint.why || {}).join(" ")}</p>
        <button className="d-btn" onClick={() => void save(Object.fromEntries((hint.changes as Row[]).map(c => [c.field, c.to])))}>Use these times</button>
      </> : <p className="d-note">{hint?.enough_data ? "Your schedule already matches your logs. 👍" : hint?.tip || "Checking…"}</p>}
    </Card>
    <div className="d-grid-2">
      <Card kicker="💼 Office" title={`${p.work_start || "—"} – ${p.work_end || "—"}`}>{time("work_start", "Starts")}{time("work_end", "Ends")}<DayPick value={p.work_days} onChange={d => setP({ ...p, work_days: d })}/></Card>
      <Card kicker="🏋️ Gym" title={p.gym_time || "—"}>{time("gym_time", "Gym time")}<DayPick value={p.gym_days} onChange={d => setP({ ...p, gym_days: d })}/></Card>
      <Card kicker="😴 Sleep" title={`${p.wake_time || "—"} wake · ${p.sleep_time || "—"} sleep`}>{time("wake_time", "Wake up")}{time("sleep_time", "Sleep")}</Card>
      <Card kicker="Save" title="Apply to Today's plan"><button className="d-btn" onClick={() => void save(p)}>💾 Save my schedule</button></Card>
    </div>
    {routines.length > 0 && <Card kicker="🔁 Routines in your day" title="Saved instantly">
      {routines.map(r => <div key={r.id} className="d-row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--d-line)", paddingTop: 8 }}>
        <b style={{ color: "var(--d-text)", minWidth: 160 }}>{r.icon} {r.name}</b>
        <input className="d-input" type="time" style={{ maxWidth: 130 }} value={hm(r.start_time)} onChange={e => void call(`/routines/${r.id}`, token, patchJson({ start_time: e.target.value })).then(load)}/>
        <select className="d-input" style={{ maxWidth: 110 }} value={r.duration_minutes} onChange={e => void call(`/routines/${r.id}`, token, patchJson({ duration_minutes: Number(e.target.value) })).then(load)}>
          {[15, 30, 45, 60, 90, 120, 180, 240, 300, 360].map(m => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select>
        <button className={`d-chip ${r.active ? "on" : ""}`} onClick={() => void call(`/routines/${r.id}`, token, patchJson({ active: !r.active })).then(load)}>{r.active ? "On" : "Off"}</button>
      </div>)}
    </Card>}
  </div>;
}

/* ---------------------------------------------------------------- What-if (buy more / sell) */
const FEE = 0.0112;
export function WhatIfCard({ held }: { held: Row[] }) {
  const [sym, setSym] = useState(held[0]?.symbol || "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(""); const [price, setPrice] = useState("");
  const h = held.find(x => x.symbol === sym);
  useEffect(() => { if (h?.price) setPrice(String(h.price)); }, [sym]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = Number(qty) || 0, px = Number(price) || 0, haveQ = Number(h?.quantity || 0), cost = Number(h?.cost || 0), avg = haveQ ? cost / haveQ : 0;
  const rs = (n: number) => `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  let rows: [string, string, string?][] = [];
  if (q > 0 && px > 0) {
    if (side === "buy") { const pay = q * px * (1 + FEE), nq = haveQ + q, navg = (cost + pay) / nq;
      rows = [["You pay (with fees)", rs(pay)], ["New quantity", nq.toLocaleString()], ["New average cost", navg.toFixed(2), navg < avg ? "var(--d-green)" : "var(--d-amber)"],
        ["New break-even", (navg * (1 + FEE) / (1 - FEE)).toFixed(2)]]; }
    else { const sell = Math.min(q, haveQ), net = sell * px * (1 - FEE), profit = net - sell * avg;
      rows = [["You receive (after fees)", rs(net)], ["Profit / loss", `${profit >= 0 ? "+" : ""}${rs(profit)}`, profit >= 0 ? "var(--d-green)" : "var(--d-red)"],
        ["Return on these", avg ? `${((net / (sell * avg) - 1) * 100).toFixed(2)}%` : "—"], ["Shares left", (haveQ - sell).toLocaleString()]]; }
  }
  return <Card kicker="🧮 What-if" title={side === "buy" ? "If I buy more" : "If I sell"} action={<div className="d-chips">{(["buy", "sell"] as const).map(s => <button key={s} className={`d-chip ${side === s ? "on" : ""}`} onClick={() => setSide(s)}>{s === "buy" ? "Buy" : "Sell"}</button>)}</div>}>
    <div className="d-row"><select className="d-input" value={sym} onChange={e => setSym(e.target.value)}>{held.map(x => <option key={x.symbol} value={x.symbol}>{String(x.symbol).split(".")[0]}</option>)}</select>
      <input className="d-input" type="number" placeholder="Quantity" value={qty} onChange={e => setQty(e.target.value)}/><input className="d-input" type="number" placeholder="Price" value={price} onChange={e => setPrice(e.target.value)}/></div>
    {h && <p className="d-note">Now {haveQ.toLocaleString()} @ {avg.toFixed(2)} · last {h.price ?? "—"}</p>}
    {rows.map(([l, val, c]) => <div key={l} className="d-row" style={{ justifyContent: "space-between" }}><span className="d-note">{l}</span><b style={{ color: c || "var(--d-text)" }}>{val}</b></div>)}
    <p className="d-note">Includes ~1.12% broker charges each way. Just arithmetic: Sakuna never places orders.</p>
  </Card>;
}
