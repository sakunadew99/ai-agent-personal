"use client";
/* Gym, Day tracker (hour by hour + report), Languages (today's German/English plan + daily cards) and Progress
   (courses + LeetCode/HackerRank/GitHub/Codeforces). */
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Donut, Hero, LineChart, Meter, Ring, SERIES, Stat } from "./Charts";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const putJson = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });

function useNote() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ok = useCallback((text: string) => setNote({ ok: true, text }), []);
  const fail = useCallback((e: unknown) => setNote({ ok: false, text: errText(e) }), []);
  return { ok, fail, view: note ? <p className={note.ok ? "success-note" : "warning-copy"} onClick={() => setNote(null)}>{note.text}</p> : null };
}

// ---------------------------------------------------------------- GYM

type SetRow = { exercise: string; weight: string; reps: string };
export function GymPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [group, setGroup] = useState("Chest");
  const [sets, setSets] = useState<SetRow[]>([]);
  const [title, setTitle] = useState("Gym");
  const [minutes, setMinutes] = useState("60");
  const n = useNote();
  const load = useCallback(() => { call<Row>("/gym", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Loading your gym log…</div>;
  const add = (ex: string) => { const l = v.last?.[ex]; setSets(s => [...s, { exercise: ex, weight: l?.weight_kg != null ? String(l.weight_kg) : "", reps: l?.reps != null ? String(l.reps) : "" }]); };
  const template = (name: string) => { setTitle(name); setSets([]); (v.templates[name] as string[]).forEach(ex => { add(ex); add(ex); add(ex); }); };
  async function save() {
    const clean = sets.filter(s => s.reps || s.weight);
    try { const out = await call<Row>("/gym/workouts", token, postJson({ title, duration_minutes: Number(minutes) || 45, sets: clean.map(s => ({ exercise: s.exercise, weight_kg: s.weight ? Number(s.weight) : null, reps: s.reps ? Number(s.reps) : null })) }));
      setV(out); setSets([]); n.ok(`💪 ${title} saved`); } catch (e) { n.fail(e); }
  }
  const tw: Row = v.this_week || {};
  return <div className="d-dash">
    <Hero kicker="Gym" title="Lift," accent="log, progress" sub={`This week: ${tw.sessions ?? 0} sessions · ${tw.minutes ?? 0} min · ${(tw.volume_kg ?? 0).toLocaleString()} kg lifted · ${v.month_minutes} min in 30 days`}
      right={<Ring value={Math.min(100, ((tw.sessions ?? 0) / 4) * 100)} size={128} label={`${tw.sessions ?? 0}/4`} sub="sessions this week"/>}>
      <div className="d-chips" style={{ marginTop: 12 }}>{Object.keys(v.templates).map(t => <button key={t} className={`d-chip ${title === t ? "on" : ""}`} onClick={() => template(t)}>{t}</button>)}</div>
    </Hero>
    {n.view}
    <div className="d-grid-3">
      <Card kicker="Today's workout" title={`${sets.length} sets`} action={<div className="d-row"><input className="d-input" style={{ maxWidth: 160 }} value={title} onChange={e => setTitle(e.target.value)}/>
        <input className="d-input" style={{ maxWidth: 90 }} type="number" value={minutes} onChange={e => setMinutes(e.target.value)} title="Minutes"/><button className="d-btn" disabled={!sets.length} onClick={() => void save()}>Save</button></div>}>
        <div className="d-chips">{Object.keys(v.exercises).map(g => <button key={g} className={`d-chip ${group === g ? "on" : ""}`} onClick={() => setGroup(g)}>{g}</button>)}</div>
        <div className="d-chips">{(v.exercises[group] as string[]).map(ex => <button key={ex} className="d-chip" onClick={() => add(ex)} title={v.last?.[ex] ? `last ${v.last[ex].weight_kg}kg × ${v.last[ex].reps}` : ""}>＋ {ex}</button>)}</div>
        {sets.map((s, i) => <div key={i} className="d-row" style={{ flexWrap: "nowrap" }}>
          <span style={{ color: "var(--d-text)", flex: 1 }}>{i + 1}. {s.exercise}</span>
          <input className="d-input" style={{ maxWidth: 90, minWidth: 70 }} placeholder="kg" value={s.weight} onChange={e => setSets(x => x.map((y, j) => j === i ? { ...y, weight: e.target.value } : y))}/>
          <span className="d-note">×</span>
          <input className="d-input" style={{ maxWidth: 80, minWidth: 60 }} placeholder="reps" value={s.reps} onChange={e => setSets(x => x.map((y, j) => j === i ? { ...y, reps: e.target.value } : y))}/>
          <button className="text-button" onClick={() => setSets(x => [...x.slice(0, i + 1), { ...x[i] }, ...x.slice(i + 1)])}>⧉</button>
          <button className="danger-link" onClick={() => setSets(x => x.filter((_, j) => j !== i))}>✕</button></div>)}
        {!sets.length && <div className="d-empty">Pick a template or add exercises. Your last weight and reps are filled in.</div>}
      </Card>
      <Card kicker="🏆 Personal records" title="">{(v.prs as Row[]).length ? (v.prs as Row[]).map(p => <div key={p.exercise} className="d-row" style={{ justifyContent: "space-between", color: "var(--d-text)" }}>
        <span>{p.exercise}</span><b style={{ color: "var(--d-amber)" }}>{p.weight_kg} kg × {p.reps ?? "-"}{p.e1rm ? ` · 1RM≈${p.e1rm}` : ""}</b></div>) : <p className="d-note">Log a workout to see records.</p>}</Card>
    </div>
    <div className="d-grid-2">
      <Card kicker="Minutes per week" title=""><Bars data={(v.weeks as Row[]).map((w, i, a) => ({ label: w.label, value: w.minutes, highlight: i === a.length - 1 }))} height={130} format={x => `${x}m`}/></Card>
      <Card kicker="Volume per week (kg)" title=""><LineChart series={[{ name: "kg", values: (v.weeks as Row[]).map(w => w.volume_kg), color: "var(--d-amber)" }]} labels={(v.weeks as Row[]).map(w => w.label)} height={130}/></Card>
    </div>
    <Card kicker="Recent workouts" title="">{(v.recent as Row[]).map(w => <div key={w.id} className="d-program">
      <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{w.title} · {w.date}</h4><span className="d-row"><span className="d-tag">{w.minutes} min</span><span className="d-tag amber">{w.volume_kg} kg</span>
        <button className="danger-link" onClick={() => { if (window.confirm("Delete this workout?")) void call(`/gym/workouts/${w.id}`, token, { method: "DELETE" }).then(load).catch(n.fail); }}>✕</button></span></div>
      <p>{(w.exercises as Row[]).map(e => `${e.exercise}: ${(e.sets as Row[]).map(s => s.reps != null ? `${s.weight_kg ?? 0}×${s.reps}` : `${s.seconds}s`).join(", ")}`).join(" · ")}</p></div>)}
      {!(v.recent as Row[]).length && <p className="d-note">No workouts yet.</p>}</Card>
  </div>;
}

// ---------------------------------------------------------------- DAY TRACKER

const CATS: [string, string, string][] = [["work", "💼 Work", "var(--d-blue)"], ["deep_work", "🎯 Deep work", "var(--d-green)"], ["meeting", "👥 Meeting", "var(--d-teal)"],
  ["study", "📚 Study", "var(--d-violet)"], ["exercise", "🏋️ Exercise", "var(--d-yellow)"], ["commute", "🚌 Commute", "var(--d-muted)"], ["chores", "🧹 Chores", "var(--d-muted)"],
  ["family", "🏠 Family", "var(--d-orange)"], ["social", "🤝 Social", "var(--d-orange)"], ["rest", "😌 Rest", "var(--d-muted)"], ["entertainment", "🎬 Fun", "var(--d-amber)"],
  ["wasted", "📱 Wasted", "var(--d-red)"], ["sleep", "😴 Sleep", "var(--d-line)"], ["other", "• Other", "var(--d-muted)"]];
const COLOR = Object.fromEntries(CATS.map(c => [c[0], c[2]]));
const LABEL = Object.fromEntries(CATS.map(c => [c[0], c[1]]));

export function DayPage({ token }: { token: string }) {
  const [day, setDay] = useState(iso(new Date()));
  const [r, setR] = useState<Row | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [len, setLen] = useState(60);
  const [note, setNote] = useState("");
  const [story, setStory] = useState("");
  const n = useNote();
  const load = useCallback((d: string) => { call<Row>(`/day/report?day=${d}`, token).then(setR).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(day); }, [load, day]);
  const shift = (k: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + k); setDay(iso(d)); setStory(""); };
  async function log(cat: string) {
    if (hour == null) return;
    const end = Math.min(1439, hour * 60 + len);
    try { await call("/day/entries", token, postJson({ local_date: day, start_time: `${String(hour).padStart(2, "0")}:00`, end_time: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, category: cat, note: note || null }));
      setNote(""); setHour(h => (h == null ? h : Math.min(23, h + Math.ceil(len / 60)))); load(day); } catch (e) { n.fail(e); }
  }
  if (!r) return <div className="d-empty">Loading your day…</div>;
  const t: Row = r.totals;
  return <div className="d-dash">
    <Hero kicker={`Day tracker · ${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}`} title={`${Math.floor(t.productive / 60)}h ${t.productive % 60}m`} accent="productive"
      sub={`${t.waste_total} min wasted (logged + distracting apps) · ${t.focus} min focus · ${t.tasks_done} tasks · ${t.habits} habits · gym ${t.gym_minutes} min`}
      right={<Ring value={r.score} size={130} sub="day score"/>}>
      <div className="d-row" style={{ marginTop: 12 }}><button className="d-btn ghost" onClick={() => shift(-1)}>‹</button><button className="d-btn ghost" onClick={() => { setDay(iso(new Date())); setStory(""); }}>Today</button><button className="d-btn ghost" onClick={() => shift(1)}>›</button>
        <span className="d-note">Phone screen time comes from the Sakuna APK (Usage Access). Turn on hourly check-ins in the app.</span></div>
    </Hero>
    {n.view}
    <div className="d-grid-3">
      <Card kicker="Hour by hour" title="Click an hour to log it">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>{(r.hours as Row[]).filter(h => h.hour >= 5).map(h => <button key={h.hour} onClick={() => setHour(h.hour)}
          style={{ borderRadius: 12, padding: 8, cursor: "pointer", border: h.hour === hour ? "2px solid var(--d-green)" : "1px solid var(--d-line)", color: "var(--d-text)", textAlign: "left",
            background: h.category ? `color-mix(in srgb, ${COLOR[h.category]} 30%, var(--d-card2))` : "var(--d-card2)" }}>
          <b>{h.label}</b><br/><small>{h.category ? LABEL[h.category] : "—"}</small>{h.phone_minutes > 0 && <><br/><small style={{ color: h.phone_minutes > 20 ? "var(--d-red)" : "var(--d-muted)" }}>📱 {h.phone_minutes}m</small></>}</button>)}</div>
        {hour != null && <div className="d-program">
          <b style={{ color: "var(--d-text)" }}>What did you do from {String(hour).padStart(2, "0")}:00?</b>
          <div className="d-chips">{[30, 60, 90, 120].map(m => <button key={m} className={`d-chip ${len === m ? "on" : ""}`} onClick={() => setLen(m)}>{m < 60 ? `${m}m` : `${m / 60}h`}</button>)}</div>
          <input className="d-input" placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)}/>
          <div className="d-chips">{CATS.map(([k, label, col]) => <button key={k} className="d-chip" style={{ borderColor: col }} onClick={() => void log(k)}>{label}</button>)}</div>
        </div>}
      </Card>
      <Card kicker="Where the time went" title=""><Donut size={140} format={x => `${Math.floor(x / 60)}h ${x % 60}m`} parts={(r.by_category as Row[]).map(c => ({ label: c.label, value: c.minutes, color: COLOR[c.category] }))}/></Card>
    </div>
    {r.usage && <div className="d-grid-2">
      <Card kicker={`Phone · ${r.usage.total} min · ${r.usage.pickups} pickups`} title=""><Bars data={(r.usage.hourly as number[]).map((m, h) => ({ label: h % 3 === 0 ? String(h) : "", value: m, color: m > 20 ? "var(--d-red)" : "var(--d-blue)" }))} height={110} format={x => `${x}m`}/></Card>
      <Card kicker="Top apps" title="">{(r.usage.apps as Row[]).slice(0, 8).map(a => <Meter key={a.package} label={a.label} value={(a.minutes / Math.max(1, r.usage.total)) * 100} right={`${a.minutes} min`}
        color={a.mark === "distracting" ? "var(--d-red)" : a.mark === "productive" ? "var(--d-green)" : "var(--d-blue)"}/>)}</Card>
    </div>}
    <Card kicker="📋 End-of-day report" title="" action={<button className="d-btn ghost" onClick={() => void call<Row>(`/day/report/explain?day=${day}`, token, postJson({})).then(x => setStory(String(x.text || ""))).catch(n.fail)}>{story ? "Refresh coaching" : "✨ Coach me on this day"}</button>}>
      <p className="d-plan" style={{ margin: 0 }}>{story || r.summary}</p>
      <b style={{ color: "var(--d-green)" }}>Tomorrow</b><ul className="d-list">{(r.tomorrow as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul>
      {r.block_suggestion && <p className="d-warn">🛡 {(r.block_suggestion.labels as string[]).join(", ")} took {r.block_suggestion.minutes_today} min. Open the Sakuna app's Day tracker to block them tomorrow ({r.block_suggestion.start}–{r.block_suggestion.end}).</p>}
    </Card>
    {(r.entries as Row[]).length > 0 && <Card kicker="Entries" title="">{(r.entries as Row[]).map(e => <div key={e.id} className="d-row" style={{ justifyContent: "space-between", color: "var(--d-text)" }}>
      <span><b>{e.start}–{e.end}</b> {LABEL[e.category]}{e.note ? ` · ${e.note}` : ""}</span><button className="danger-link" onClick={() => void call(`/day/entries/${e.id}`, token, { method: "DELETE" }).then(() => load(day)).catch(n.fail)}>✕</button></div>)}</Card>}
  </div>;
}

// ---------------------------------------------------------------- LANGUAGES + PROGRESS

export function LanguagesPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [fresh, setFresh] = useState<Row[]>([]);
  const n = useNote();
  const load = useCallback(() => { call<Row>("/language/today", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { void call<Row>("/language/daily-cards", token, postJson({})).then(r => { setFresh(r.decks || []); load(); }).catch(() => load()); }, [token, load]);
  if (!v) return <div className="d-empty">Preparing today's lessons…</div>;
  return <div className="d-dash">
    <Hero kicker="German & English · today" title={`${v.total_minutes} min`} accent="of practice" sub="New words every day, one video each, and your exam-coach blocks. Review cards in Learning."
      right={<Ring value={Math.min(100, v.total_minutes)} size={128} label={`${(v.languages as Row[]).reduce((k, l) => k + Number(l.cards_due), 0)}`} sub="cards due"/>}/>
    {n.view}
    {fresh.some(d => (d.words as Row[]).length) && <Card kicker={`✨ New words today`} title=""><div className="d-programs">{fresh.flatMap(d => (d.words as Row[]).map(w => <article key={`${d.lang}${w.front}`} className="d-program">
      <h4>{d.lang === "german" ? "🇩🇪" : "🇬🇧"} {w.front}</h4><p><b>{w.back}</b></p><p>{w.example}</p></article>))}</div></Card>}
    <div className="d-grid-2">{(v.languages as Row[]).map((l, k) => <Card key={l.lang} kicker={l.title} title={`${l.minutes} min today`}>
      {l.exam && <p className="d-note">{l.exam.name}: {l.exam.days_left} days to the exam</p>}
      <ol className="d-list">{(l.steps as Row[]).map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)" }}>{s.what} ↗</a> : s.what} <span className="d-tag">{s.minutes}m</span></li>)}</ol>
      <div className="d-chips">{(l.channels as Row[]).map(c => <a key={c.name} className="d-chip" href={c.url} target="_blank" rel="noreferrer" style={{ borderColor: SERIES[k + 1], color: "var(--d-text)" }}>▶ {c.name}</a>)}</div>
      <p className="d-note">{l.cards_total} words in your {l.lang} deck.</p></Card>)}</div>
  </div>;
}

const PLATFORMS = ["leetcode", "hackerrank", "github", "codeforces"];
export function ProgressPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [plat, setPlat] = useState("leetcode");
  const [uname, setUname] = useState("");
  const [course, setCourse] = useState<Row | null>(null);
  const n = useNote();
  const load = useCallback(() => { call<Row>("/learning/tracker", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Loading…</div>;
  const solved = (v.profiles as Row[]).reduce((k, p) => k + (p.platform === "github" ? 0 : Number(p.stats.solved || 0)), 0);
  const saveCourse = () => course?.title?.trim() && void call(course.id ? `/learning/courses/${course.id}` : "/learning/courses", token,
    (course.id ? patchJson : postJson)({ platform: course.platform, title: course.title.trim(), url: course.url || null, progress_pct: Number(course.progress_pct || 0) })).then(() => { setCourse(null); load(); }).catch(n.fail);
  return <div className="d-dash">
    <Hero kicker="Learning progress" title={`${solved}`} accent="problems solved" sub={`${v.active} active courses · ${v.done} finished · ${v.hours_total} h logged`}
      right={<Ring value={(v.courses as Row[]).length ? (v.done / (v.courses as Row[]).length) * 100 : 0} size={128} label={`${v.done}/${(v.courses as Row[]).length}`} sub="courses done"/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        <select className="d-input" style={{ maxWidth: 160 }} value={plat} onChange={e => setPlat(e.target.value)}>{PLATFORMS.map(p => <option key={p}>{p}</option>)}</select>
        <input className="d-input" value={uname} onChange={e => setUname(e.target.value)} placeholder="Public username"/>
        <button className="d-btn" disabled={!uname.trim()} onClick={() => void call("/learning/profiles", token, putJson({ platform: plat, username: uname.trim() })).then(() => { setUname(""); load(); }).catch(n.fail)}>Link</button>
        <button className="d-btn ghost" onClick={() => void call<Row>("/learning/profiles/refresh", token, postJson({})).then(load).catch(n.fail)}>↻ Refresh</button></div>
    </Hero>
    {n.view}
    <div className="d-programs">{(v.profiles as Row[]).map((p, k) => <Card key={p.id} kicker={p.platform} title={p.username} action={<button className="danger-link" onClick={() => void call(`/learning/profiles/${p.id}`, token, { method: "DELETE" }).then(load).catch(n.fail)}>Unlink</button>}>
      <div className="d-stats" style={{ gridTemplateColumns: "1fr 1fr" }}><Stat label={p.platform === "github" ? "Commits 7d" : "Solved"} value={p.platform === "github" ? p.stats.commits_7d : p.stats.solved} tone="solid"/>
        <Stat label="This week" value={`+${p.gain_7d}`} tone="green"/></div>
      {p.platform === "leetcode" && <Bars data={[{ label: "Easy", value: p.stats.easy, color: "var(--d-green)" }, { label: "Medium", value: p.stats.medium, color: "var(--d-amber)" }, { label: "Hard", value: p.stats.hard, color: "var(--d-red)" }]} height={90} format={x => String(x)}/>}
      {(p.history as Row[]).length > 1 && <LineChart series={[{ name: "solved", values: (p.history as Row[]).map(h => h.solved), color: SERIES[k % SERIES.length] }]} labels={(p.history as Row[]).map(h => String(h.date).slice(5))} height={80}/>}
      {p.stats.url && <a className="text-button" href={p.stats.url} target="_blank" rel="noreferrer">Open profile ↗</a>}</Card>)}</div>
    <Card kicker="Courses" title="Coursera, Udemy, edX, YouTube…" action={<button className="d-btn" onClick={() => setCourse({ platform: "Coursera", title: "", url: "", progress_pct: 0 })}>＋ Add course</button>}>
      {course && <div className="d-row"><select className="d-input" style={{ maxWidth: 150 }} value={course.platform} onChange={e => setCourse({ ...course, platform: e.target.value })}>{["Coursera", "Udemy", "edX", "freeCodeCamp", "YouTube", "Google", "AWS", "University", "Other"].map(x => <option key={x}>{x}</option>)}</select>
        <input className="d-input" placeholder="Course name" value={course.title} onChange={e => setCourse({ ...course, title: e.target.value })}/><input className="d-input" placeholder="Link" value={course.url || ""} onChange={e => setCourse({ ...course, url: e.target.value })}/>
        <input className="d-input" style={{ maxWidth: 90 }} type="number" min={0} max={100} value={course.progress_pct} onChange={e => setCourse({ ...course, progress_pct: e.target.value })}/><button className="d-btn" onClick={() => saveCourse()}>Save</button></div>}
      {(v.courses as Row[]).map((c, k) => <div key={c.id} className="d-program">
        <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{c.title}</h4><span className={`d-tag ${c.status === "done" ? "green" : "amber"}`}>{c.platform} · {c.status}</span></div>
        <Meter value={c.progress_pct} right={`${c.progress_pct}% · ${c.hours_spent} h`} color={SERIES[k % SERIES.length]}/>
        <div className="d-row">{c.url && <a className="text-button" href={c.url} target="_blank" rel="noreferrer">▶ Continue</a>}
          <button className="text-button" onClick={() => void call(`/learning/courses/${c.id}`, token, patchJson({ add_hours: 0.5 })).then(load).catch(n.fail)}>+30 min</button>
          <button className="text-button" onClick={() => void call(`/learning/courses/${c.id}`, token, patchJson({ progress_pct: Math.min(100, c.progress_pct + 10) })).then(load).catch(n.fail)}>+10%</button>
          <button className="text-button" onClick={() => setCourse({ ...c })}>Edit</button>
          <button className="danger-link" onClick={() => void call(`/learning/courses/${c.id}`, token, { method: "DELETE" }).then(load).catch(n.fail)}>Delete</button></div></div>)}
      {!(v.courses as Row[]).length && !course && <p className="d-note">Add the courses you're doing to track progress and hours.</p>}
    </Card>
  </div>;
}
