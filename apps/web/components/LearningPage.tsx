"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Icon } from "./Icon";

type Tab = "Review" | "Cards" | "Mistakes";
const SUBJECTS = ["german", "english", "coding", "work", "money", "health", "life", "other"];
const GRADES: { grade: string; label: string; hint: string; key: string }[] = [
  { grade: "again", label: "Again", hint: "10 min", key: "1" },
  { grade: "hard", label: "Hard", hint: "shorter", key: "2" },
  { grade: "good", label: "Good", hint: "normal", key: "3" },
  { grade: "easy", label: "Easy", hint: "longer", key: "4" },
];
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";

/** Phase 4: flashcards with spaced repetition, plus the mistake notebook. All scheduling is plain code on the server. */
export function LearningPage({ token }: { token: string }) {
  const [tab, setTab] = useState<Tab>("Review");
  const [stats, setStats] = useState<Row>({});
  const loadStats = useCallback(() => { apiRequest<Row>("/learning/stats", token).then(setStats).catch(() => undefined); }, [token]);
  useEffect(() => { loadStats(); }, [loadStats]);
  const decks: Row[] = stats.decks || [];

  return <>
    <div className="grid metrics">
      <section className="panel metric"><p className="muted">Due today</p><h2>{stats.due_today ?? "—"}</h2><span className="trend">cards to review</span></section>
      <section className="panel metric"><p className="muted">Reviewed today</p><h2>{stats.reviewed_today ?? 0}</h2><span className="trend">answers</span></section>
      <section className="panel metric"><p className="muted">Streak</p><h2>{stats.streak_days ?? 0} 🔥</h2><span className="trend">days in a row</span></section>
      <section className="panel metric"><p className="muted">Decks</p><h2>{decks.length}</h2><span className="trend">{decks.reduce((n, d) => n + Number(d.total || 0), 0)} cards</span></section>
    </div>
    <div className="tab-bar" role="tablist">{(["Review", "Cards", "Mistakes"] as Tab[]).map(item =>
      <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === "Review" && <ReviewPane token={token} decks={decks} onChanged={loadStats}/>}
    {tab === "Cards" && <CardsPane token={token} decks={decks} onChanged={loadStats}/>}
    {tab === "Mistakes" && <MistakesPane token={token} onChanged={loadStats}/>}
  </>;
}

function ReviewPane({ token, decks, onChanged }: { token: string; decks: Row[]; onChanged: () => void }) {
  const [deck, setDeck] = useState("");
  const [queue, setQueue] = useState<Row[]>([]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<Row[]>(`/learning/review?limit=50${deck ? `&deck=${encodeURIComponent(deck)}` : ""}`, token)
      .then(rows => { setQueue(rows); setShown(false); }).catch(reason => setError(errorText(reason)));
  }, [deck, token]);
  useEffect(() => { load(); }, [load]);
  const card = queue[0];

  const grade = useCallback(async (value: string) => {
    if (!card) return;
    setError("");
    try {
      await apiRequest(`/learning/cards/${card.id}/review`, token, postJson({ grade: value }));
      setDone(n => n + 1); setShown(false);
      // "Again" comes back in 10 minutes; keep it at the end of this session's queue so it can be practised now.
      setQueue(rows => value === "again" ? [...rows.slice(1), card] : rows.slice(1));
      onChanged();
    } catch (reason) { setError(errorText(reason)); }
  }, [card, token, onChanged]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (event.key === " " && card && !shown) { event.preventDefault(); setShown(true); }
      const match = GRADES.find(g => g.key === event.key);
      if (match && shown) void grade(match.grade);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, shown, grade]);

  return <section className="panel review-panel">
    <div className="panel-head"><div><p className="eyebrow">SPACED REPETITION</p><h2>{card ? `${queue.length} to go` : "All caught up"}</h2></div>
      <select value={deck} onChange={e => setDeck(e.target.value)} aria-label="Deck"><option value="">All decks</option>{decks.map(d => <option key={d.deck} value={d.deck}>{d.deck} ({d.due_now})</option>)}</select></div>
    {error && <p className="warning-copy">{error}</p>}
    {card ? <>
      <div className={`flashcard${shown ? " flipped" : ""}`} onClick={() => setShown(true)} role="button" tabIndex={0} aria-label="Show answer">
        <small className="muted">{card.deck}{card.lapses ? ` · missed ${card.lapses}×` : ""}</small>
        <p className="flash-front">{card.front}</p>
        {shown ? <><hr/><p className="flash-back">{card.back}</p>{card.example && <p className="muted flash-example">“{card.example}”</p>}</>
          : <p className="muted">Tap or press Space to show the answer</p>}
      </div>
      {shown && <div className="grade-row">{GRADES.map(g => <button key={g.grade} className={`grade grade-${g.grade}`} onClick={() => void grade(g.grade)}>
        <b>{g.label}</b><small>{g.hint} · {g.key}</small></button>)}</div>}
    </> : <div className="empty-state">{done ? `Nice work: ${done} review${done === 1 ? "" : "s"} done. ` : ""}Nothing is due right now. Add cards, or come back later.</div>}
  </section>;
}

function CardsPane({ token, decks, onChanged }: { token: string; decks: Row[]; onChanged: () => void }) {
  const [deck, setDeck] = useState("german");
  const [front, setFront] = useState(""); const [back, setBack] = useState(""); const [example, setExample] = useState("");
  const [bulk, setBulk] = useState("");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Row[]>([]);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<Row[]>(`/learning/cards?limit=300${query ? `&q=${encodeURIComponent(query)}` : ""}`, token).then(setCards).catch(reason => setError(errorText(reason)));
  }, [query, token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) {
    setError(""); setMessage("");
    try { await work; setMessage(note); load(); onChanged(); } catch (reason) { setError(errorText(reason)); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/learning/cards", token, postJson({ deck, front, back, ...(example.trim() ? { example } : {}) }))
      .then(() => { setFront(""); setBack(""); setExample(""); }), "Card added. It's due for review now.");
  }
  async function importBulk() {
    setError(""); setMessage("");
    try {
      const r = await apiRequest<Row>("/learning/cards/import", token, postJson({ deck, text: bulk }));
      setMessage(`Imported ${r.added} card${r.added === 1 ? "" : "s"}${r.skipped_duplicates ? `, skipped ${r.skipped_duplicates} already in the deck` : ""}.`);
      setBulk(""); load(); onChanged();
    } catch (reason) { setError(errorText(reason)); }
  }

  return <div className="grid main-grid">
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">NEW CARD</p><h2>Add vocabulary or a fact</h2></div><Icon name="plus"/></div>
      <form className="data-form" onSubmit={add}><div className="form-fields">
        <label>Deck<input list="deck-names" value={deck} onChange={e => setDeck(e.target.value)} required maxLength={64}/>
          <datalist id="deck-names">{["german", "english", ...decks.map(d => String(d.deck))].filter((v, i, a) => a.indexOf(v) === i).map(name => <option key={name} value={name}/>)}</datalist></label>
        <label>Front<input value={front} onChange={e => setFront(e.target.value)} required maxLength={500} placeholder="der Bahnhof"/></label>
        <label>Back<input value={back} onChange={e => setBack(e.target.value)} required maxLength={1000} placeholder="the train station"/></label>
        <label className="wide-field">Example (optional)<input value={example} onChange={e => setExample(e.target.value)} maxLength={1000} placeholder="Wo ist der Bahnhof?"/></label>
      </div><button className="primary" disabled={!front.trim() || !back.trim()}>Add card</button></form>
      <div className="form-section"><h3>Import many</h3>
        <p className="muted small-copy">One card per line: <code>front ; back ; example</code>. Tabs or “ - ” work too. Lines starting with # are skipped. Duplicates are skipped.</p>
        <textarea rows={5} value={bulk} onChange={e => setBulk(e.target.value)} placeholder={"die Katze ; the cat\nlaufen ; to run ; Ich laufe jeden Morgen."}/>
        <button className="outline" disabled={!bulk.trim()} onClick={() => void importBulk()}>Import into “{deck}”</button></div>
      {message && <p className="success-note">{message}</p>}{error && <p className="warning-copy">{error}</p>}
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">YOUR DECKS</p><h2>{cards.length} cards</h2></div></div>
      <input className="search-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cards…" aria-label="Search cards"/>
      <div className="card-list">{cards.map(card => <div className={`card-row${card.suspended ? " suspended" : ""}`} key={card.id}>
        <div><b>{card.front}</b><span className="muted"> — {card.back}</span>
          <small className="muted">{card.deck} · {card.repetitions >= 3 ? "learned" : card.repetitions ? "learning" : "new"} · next {new Date(card.due_at).toLocaleDateString([], { month: "short", day: "numeric" })}{card.suspended ? " · paused" : ""}</small></div>
        <div className="row-actions">
          <button className="text-button" onClick={() => void run(apiRequest(`/learning/cards/${card.id}`, token, patchJson({ suspended: !card.suspended })), card.suspended ? "Card resumed." : "Card paused.")}>{card.suspended ? "Resume" : "Pause"}</button>
          <button className="danger-link" onClick={() => { if (window.confirm(`Delete “${card.front}”?`)) void run(apiRequest(`/learning/cards/${card.id}`, token, { method: "DELETE" }), "Card deleted."); }}>Delete</button>
        </div></div>)}
        {!cards.length && <div className="empty-state">No cards yet. Add one, or import a list.</div>}</div>
    </section>
  </div>;
}

function MistakesPane({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [subject, setSubject] = useState("german");
  const [what, setWhat] = useState(""); const [fix, setFix] = useState(""); const [lesson, setLesson] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<Row[]>(`/mistakes${showResolved ? "?include_resolved=true" : ""}`, token).then(setRows).catch(reason => setError(errorText(reason)));
  }, [showResolved, token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) {
    setError(""); setMessage("");
    try { await work; setMessage(note); load(); onChanged(); } catch (reason) { setError(errorText(reason)); }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/mistakes", token, postJson({ subject, what_happened: what, correction: fix, ...(lesson.trim() ? { lesson } : {}) }))
      .then(() => { setWhat(""); setFix(""); setLesson(""); }), "Saved to your mistake notebook.");
  }

  return <div className="grid main-grid">
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">MISTAKE NOTEBOOK</p><h2>Write it down once, fix it for good</h2></div><Icon name="book"/></div>
      <form className="data-form" onSubmit={add}><div className="form-fields">
        <label>Subject<select value={subject} onChange={e => setSubject(e.target.value)}>{SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="wide-field">What I did / said<input value={what} onChange={e => setWhat(e.target.value)} required maxLength={1000} placeholder="Ich bin 25 Jahre"/></label>
        <label className="wide-field">The right way<input value={fix} onChange={e => setFix(e.target.value)} required maxLength={1000} placeholder="Ich bin 25 Jahre alt"/></label>
        <label className="wide-field">Why / the rule (optional)<textarea rows={2} value={lesson} onChange={e => setLesson(e.target.value)} maxLength={2000} placeholder="Age always needs “alt”."/></label>
      </div><button className="primary" disabled={!what.trim() || !fix.trim()}>Save mistake</button></form>
      {message && <p className="success-note">{message}</p>}{error && <p className="warning-copy">{error}</p>}
      <p className="muted small-copy">Tip: “Make a card” turns a mistake into a flashcard, so spaced repetition keeps it fixed. “Made it again” brings that card back for review today.</p>
    </section>
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">MOST REPEATED FIRST</p><h2>{rows.length} {showResolved ? "mistakes" : "open mistakes"}</h2></div>
        <label className="inline-check"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)}/> Show fixed</label></div>
      <div className="card-list">{rows.map(row => <div className={`mistake-row${row.resolved_at ? " suspended" : ""}`} key={row.id}>
        <div className="mistake-copy">
          <small className="muted">{row.subject}{row.occurrences > 1 ? ` · made ${row.occurrences}×` : ""}{row.resolved_at ? " · fixed" : ""}</small>
          <p><s>{row.what_happened}</s></p><p className="mistake-fix">✓ {row.correction}</p>{row.lesson && <small className="muted">{row.lesson}</small>}
        </div>
        <div className="row-actions">
          <button className="text-button" onClick={() => void run(apiRequest(`/mistakes/${row.id}/again`, token, { method: "POST" }), "Counted. Its card is due again today.")}>Made it again</button>
          {!row.card_id && <button className="text-button" onClick={() => void run(apiRequest(`/mistakes/${row.id}/card`, token, postJson({})), "Flashcard created.")}>Make a card</button>}
          <button className="text-button" onClick={() => void run(apiRequest(`/mistakes/${row.id}`, token, patchJson({ resolved: !row.resolved_at })), row.resolved_at ? "Reopened." : "Marked as fixed.")}>{row.resolved_at ? "Reopen" : "Fixed"}</button>
          <button className="danger-link" onClick={() => { if (window.confirm("Delete this mistake?")) void run(apiRequest(`/mistakes/${row.id}`, token, { method: "DELETE" }), "Deleted."); }}>Delete</button>
        </div></div>)}
        {!rows.length && <div className="empty-state">No mistakes logged. That's either great, or time to write one down.</div>}</div>
    </section>
  </div>;
}
