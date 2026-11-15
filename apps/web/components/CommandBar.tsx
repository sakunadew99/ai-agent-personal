"use client";

import { FormEvent, useState } from "react";
import { apiRequest, postJson, type JsonRecord as Row } from "@/lib/api";
import { appendSpeech, VoiceButton } from "./VoiceButton";

/** "Say it once" (guide 34): type or speak a command; clear ones are done with Undo, unclear ones get ONE question. */
export function CommandBar({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<Row[]>([]);
  const [freeAnswer, setFreeAnswer] = useState("");
  const [error, setError] = useState("");

  const replace = (row: Row) => setCards(list => [row, ...list.filter(c => c.id !== row.id)].slice(0, 3));
  async function run(work: Promise<Row>) {
    setBusy(true); setError("");
    try { const row = await work; replace(row); if (row.status === "created" || row.status === "undone") onChanged?.(); return row; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong"); return null; }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const row = await run(apiRequest<Row>("/commands", token, { method: "POST", body: JSON.stringify({ text: text.trim(), source }), headers: { "Idempotency-Key": key } }));
    if (row) { setText(""); setSource("text"); }
  }
  const answer = (id: string, value: string) => { setFreeAnswer(""); void run(apiRequest<Row>(`/commands/${id}/answer`, token, postJson({ answer: value }))); };

  return <section className="panel command-bar">
    <form className="command-form" onSubmit={submit}>
      <span className="with-mic">
        <input value={text} onChange={e => { setText(e.target.value); if (!e.target.value) setSource("text"); }} maxLength={500}
          placeholder="Say it once: “dentist next Tuesday at 3”, “add milk and eggs to my buy list”, “AirPods to my wish list for 25000”…" aria-label="Command"/>
        <VoiceButton onText={spoken => { setText(v => appendSpeech(v, spoken)); setSource("voice"); }}/>
      </span>
      <button className="primary" disabled={busy || !text.trim()}>{busy ? "…" : "Do it"}</button>
    </form>
    {error && <p className="warning-copy">{error}</p>}
    {cards.map(c => <div className={`command-card status-${c.status}`} key={c.id}>
      {c.status === "created" && <>
        <div className="command-line"><span className="cmd-icon">✓</span><b>{c.summary || c.understood?.title}</b>
          <button className="text-button" disabled={busy} onClick={() => void run(apiRequest<Row>(`/commands/${c.id}/undo`, token, { method: "POST" }))}>Undo</button></div>
        {(c.defaults as string[] || []).length > 0 && <small className="muted">Assumed: {(c.defaults as string[]).join(" · ")}</small>}
      </>}
      {c.status === "needs_answer" && <>
        <div className="command-line"><span className="cmd-icon">?</span><b>{c.question}</b></div>
        <small className="muted">“{c.raw_text}”</small>
        <div className="row-actions" style={{ justifyContent: "flex-start" }}>
          {(c.options as Row[]).map(o => <button key={o.value} className={o.value === "no" ? "outline" : "primary"} disabled={busy} onClick={() => answer(c.id, o.value)}>{o.label}</button>)}
        </div>
        <form className="inline-form" onSubmit={e => { e.preventDefault(); if (freeAnswer.trim()) answer(c.id, freeAnswer.trim()); }}>
          <input value={freeAnswer} onChange={e => setFreeAnswer(e.target.value)} placeholder="…or type an answer" maxLength={200}/>
          <button className="outline" disabled={busy || !freeAnswer.trim()}>Answer</button>
        </form>
      </>}
      {c.status === "cancelled" && <div className="command-line"><span className="cmd-icon">×</span><span className="muted">Cancelled. Nothing was added.</span></div>}
      {c.status === "undone" && <div className="command-line"><span className="cmd-icon">↺</span><span className="muted">Undone: {c.summary || c.understood?.title} was removed.</span></div>}
    </div>)}
    {!cards.length && <small className="muted">Clear commands are added straight away with Undo. Sakuna asks one question if something is unclear, and never sends messages or pays for anything.</small>}
  </section>;
}
