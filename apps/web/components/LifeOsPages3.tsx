"use client";
/* Brain gym (BrainGymmer games, linked), Watch (YouTube channel feeds) and LinkedIn quick searches. */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, postJson, type JsonRecord as Row } from "@/lib/api";
import { Card, Hero, Ring, SERIES, WeekDots } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const SKILL_COLOR: Record<string, string> = { Memory: "var(--d-amber)", Concentration: "var(--d-blue)", Logic: "var(--d-red)", Speed: "var(--d-green)", Perception: "var(--d-violet)" };

export function BrainGymPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/brain", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Warming up…</div>;
  const played = () => call<Row>("/brain/played", token, postJson({})).then(x => { setV(x); setNote("🧠 Workout logged: streak and points updated."); }).catch(e => setNote(errText(e)));
  return <div className="d-dash">
    <section className="d-hero" style={{ background: "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--d-blue) 30%, transparent), transparent 55%), radial-gradient(90% 120% at 0% 100%, color-mix(in srgb, var(--d-violet) 24%, transparent), transparent 60%), var(--d-card)" }}>
      <div className="d-hero-main">
        <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 260 }}>
          <p className="d-kicker" style={{ color: "var(--d-blue)" }}>Brain gym</p>
          <h2 style={{ margin: 0 }}>Train your <span style={{ color: "var(--d-blue)" }}>brain</span></h2>
          <p className="d-sub">10 minutes a day: one game for each skill (memory, concentration, logic, speed, perception). Games open on BrainGymmer.</p>
          <WeekDots today={(new Date().getDay() + 6) % 7} rows={[{ label: "Played", done: v.week }]}/>
          <div className="d-row">{v.played_today ? <span className="d-tag green">✓ workout done today</span> : <button className="d-btn" onClick={() => void played()}>✓ I played today</button>}{note && <span className="d-note">{note}</span>}</div>
        </div>
        <div className="d-row" style={{ gap: 18 }}>
          <Ring value={Math.min(100, (v.streak / 14) * 100)} size={120} color="var(--d-blue)" label={`${v.streak}🔥`} sub="day streak"/>
          <Ring value={Math.min(100, (v.days_30 / 30) * 100)} size={120} color="var(--d-violet)" label={`${v.days_30}`} sub="days / 30"/>
        </div>
      </div>
    </section>
    <Card kicker="Today's workout" title="One game per skill">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>{(v.workout as Row[]).map((g, i) => <a key={g.slug} href={g.url} target="_blank" rel="noreferrer"
        style={{ textDecoration: "none", borderRadius: 18, padding: 16, border: `1px solid ${SKILL_COLOR[g.skill]}`, background: `color-mix(in srgb, ${SKILL_COLOR[g.skill]} 12%, var(--d-card2))`, display: "grid", gap: 6 }}>
        <span style={{ fontSize: 30 }}>{g.icon}</span><b style={{ color: "var(--d-text)", fontSize: 16 }}>{i + 1}. {g.name}</b><small style={{ color: "var(--d-muted)" }}>{g.skill}</small>
        <span style={{ color: SKILL_COLOR[g.skill], fontWeight: 800 }}>Play ▶</span></a>)}</div>
    </Card>
    <div className="d-programs">{(v.skills as Row[]).map(sk => <Card key={sk.skill} kicker={`${sk.icon} ${sk.skill} · ${(sk.games as Row[]).length} games`} title={sk.why}>
      <div className="d-chips">{(sk.games as Row[]).map(g => <a key={g.slug} className="d-chip" href={g.url} target="_blank" rel="noreferrer" style={{ borderColor: SKILL_COLOR[sk.skill], color: "var(--d-text)" }}>{g.name} ▶</a>)}</div>
    </Card>)}</div>
    <p className="d-note">{v.source}</p>
  </div>;
}

const CH_KEY = "sakuna.watchChannels";
export function WatchPage({ token }: { token: string }) {
  const [res, setRes] = useState<Row | null>(null);
  const [mine, setMine] = useState<Row[]>(() => { try { return JSON.parse(localStorage.getItem(CH_KEY) || "[]"); } catch { return []; } });
  const [shelf, setShelf] = useState("all");
  const [add, setAdd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (list: Row[]) => {
    setBusy(true);
    try { setRes(await call<Row>(`/watch?channels=${encodeURIComponent(list.map(c => c.channel_id).join(","))}`, token)); } catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  }, [token]);
  useEffect(() => { void load(mine); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (next: Row[]) => { setMine(next); try { localStorage.setItem(CH_KEY, JSON.stringify(next)); } catch { /* private window */ } void load(next); };
  async function addChannel() {
    try { const c = await call<Row>(`/watch/channel?q=${encodeURIComponent(add.trim())}`, token); keep([...mine.filter(x => x.channel_id !== c.channel_id), c].slice(0, 15)); setAdd(""); setNote(`Added ${c.name}`); }
    catch (e) { setNote(errText(e)); }
  }
  const later = (v: Row) => call("/tasks", token, postJson({ title: `Watch: ${v.title}`.slice(0, 200), category: "learning", priority: "low", duration_minutes: 20, notes: v.url })).then(() => setNote("Added to your tasks ✓")).catch(e => setNote(errText(e)));
  const shelves: Row[] = res?.shelves || [];
  return <div className="d-dash">
    <Hero kicker="Watch · worth your time" title="Learn, grow," accent="get inspired" sub="New videos from technology, AI and motivation channels, plus your own. Shorts are hidden; the must-watch picks are this week's most-viewed.">
      <div className="d-row" style={{ marginTop: 12 }}><input className="d-input" value={add} onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void addChannel(); }} placeholder="Add a channel: @handle or YouTube link"/>
        <button className="d-btn ghost" disabled={add.trim().length < 2} onClick={() => void addChannel()}>Add channel</button><button className="d-btn" disabled={busy} onClick={() => void load(mine)}>{busy ? "Loading…" : "↻ Refresh"}</button></div>
      {note && <p className="d-note" style={{ marginTop: 8 }}>{note}</p>}
    </Hero>
    {(res?.must_watch || []).length > 0 && <Card kicker="🔥 Must watch this week" title="">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>{(res!.must_watch as Row[]).map(v => <article key={v.id} style={{ display: "grid", gap: 6 }}>
        <a href={v.url} target="_blank" rel="noreferrer"><img src={v.thumb} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 16, background: "var(--d-card2)" }}/></a>
        <b style={{ color: "var(--d-text)" }}>{v.title}</b><small className="d-note">{v.channel} · {Number(v.views).toLocaleString()} views · {v.published}</small>
        <div className="d-row"><a className="d-btn" href={v.url} target="_blank" rel="noreferrer">▶ Watch</a><button className="text-button" onClick={() => void later(v)}>⏰ Later</button></div></article>)}</div>
    </Card>}
    <div className="d-chips">{[{ key: "all", title: "All" }, ...shelves].map(s => <button key={s.key} className={`d-chip ${shelf === s.key ? "on" : ""}`} onClick={() => setShelf(s.key)}>{s.title}</button>)}</div>
    {(res?.errors || []).length > 0 && <p className="d-note">{(res!.errors as string[]).join(" ")}</p>}
    {shelves.filter(s => shelf === "all" || s.key === shelf).map((s, k) => <Card key={s.key} kicker={s.title} title="" action={<div className="d-chips">{(s.channels as Row[]).map(c => <a key={c.channel_id} className="d-chip" href={c.url} target="_blank" rel="noreferrer" style={{ borderColor: SERIES[k % SERIES.length], color: "var(--d-text)" }}>▶ {c.name}</a>)}</div>}>
      {(s.videos as Row[]).length ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>{(s.videos as Row[]).slice(0, 12).map(v => <article key={v.id} style={{ display: "grid", gap: 4 }}>
        <a href={v.url} target="_blank" rel="noreferrer"><img src={v.thumb} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 12, background: "var(--d-card2)" }}/></a>
        <b style={{ color: "var(--d-text)", fontSize: 13.5 }}>{v.title}</b><small className="d-note">{v.channel} · {v.published}</small>
        <button className="text-button" style={{ justifySelf: "start" }} onClick={() => void later(v)}>⏰ Watch later</button></article>)}</div>
        : <p className="d-note">No new videos loaded right now. Open the channels above.</p>}
    </Card>)}
    {mine.length > 0 && <Card kicker="Your channels" title=""><div className="d-chips">{mine.map(c => <button key={c.channel_id} className="d-chip on" onClick={() => keep(mine.filter(x => x.channel_id !== c.channel_id))}>{c.name} ✕</button>)}</div></Card>}
    <p className="d-note">{res?.source}</p>
  </div>;
}

export function LinkedInLinks({ token, q }: { token: string; q: string }) {
  const [links, setLinks] = useState<Row[]>([]);
  useEffect(() => { if (q.trim().length >= 2) call<Row>(`/career/linkedin?q=${encodeURIComponent(q)}`, token).then(r => setLinks(r.links || [])).catch(() => setLinks([])); }, [token, q]);
  if (!links.length) return null;
  return <Card kicker="LinkedIn · newest first" title="New posts, hiring posts and today's jobs">
    <div className="d-chips">{links.map(l => <a key={l.name} className="d-chip" href={l.url} target="_blank" rel="noreferrer" style={{ borderColor: "#0a66c2", color: "var(--d-text)" }}>in · {l.name} ↗</a>)}</div>
    <p className="d-note">Opens LinkedIn already filtered to the newest posts and jobs for your keywords. LinkedIn doesn't allow other apps to read it, so Sakuna links instead of scraping.</p>
  </Card>;
}

export function NewsAndWatch({ token, news }: { token: string; news: React.ReactNode }) {
  const [tab, setTab] = useState<"news" | "watch">("news");
  return <div className="d-dash">
    <div className="d-chips"><button className={`d-chip ${tab === "news" ? "on" : ""}`} onClick={() => setTab("news")}>📰 News</button><button className={`d-chip ${tab === "watch" ? "on" : ""}`} onClick={() => setTab("watch")}>▶ Watch</button></div>
    {tab === "news" ? news : <WatchPage token={token}/>}
  </div>;
}

