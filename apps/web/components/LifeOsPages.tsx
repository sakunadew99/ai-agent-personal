"use client";
/* Web versions of the phone-only Life OS screens: My day (routines + food diary), Journal, Exam coach, AI team,
   Invest (CSE), News digest and About you. Same API as the phone; nothing here acts on its own. */
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Donut, Hero, LineChart, Meter, Ring, SERIES, Stat, WeekDots } from "./Charts";
import { HoldingsTable, PortfolioInsights, PortfolioTools } from "./LifeOsPages5";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : "");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const pretty = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const putJson = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });

/** Shared notice/error line for a page. */
function useNote() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ok = useCallback((text: string) => setNote({ ok: true, text }), []);
  const fail = useCallback((e: unknown) => setNote({ ok: false, text: errText(e) }), []);
  const view = note ? <p className={note.ok ? "success-note" : "warning-copy"} onClick={() => setNote(null)}>{note.text}</p> : null;
  return { ok, fail, view };
}

function Tabs<T extends string>({ value, options, onChange, labels }: { value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return <div className="d-chips">{options.map(o => <button key={o} className={`d-chip ${value === o ? "on" : ""}`} onClick={() => onChange(o)}>{labels?.[o] ?? o}</button>)}</div>;
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return <div className="d-chips">{DAYS.map((d, i) => { const on = value.includes(i + 1);
    return <button key={d} className={`d-chip ${on ? "on" : ""}`} onClick={() => onChange(on ? value.filter(x => x !== i + 1) : [...value, i + 1].sort())}>{d}</button>; })}</div>;
}

// =====================================================================================================================
// MY DAY: routines (day / week / month) and the food diary
// =====================================================================================================================

export function MyDayPage({ token }: { token: string }) {
  const [view, setView] = useState<"day" | "week" | "month">("day");
  return <div className="d-dash">
    <Tabs value={view} options={["day", "week", "month"] as const} onChange={setView} labels={{ day: "☀️ Day", week: "🗓 Week", month: "📅 Month" }}/>
    {view === "day" && <RoutinesDay token={token}/>}
    {view === "week" && <RoutinesWeek token={token}/>}
    {view === "month" && <RoutinesMonth token={token}/>}
  </div>;
}

function RoutinesDay({ token }: { token: string }) {
  const [d, setD] = useState<Row | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const n = useNote();
  const load = useCallback((which: string | null) => {
    call<Row>(`/routines/today${which ? `?day=${which}` : ""}`, token).then(x => { setD(x); setDay(String(x.date)); }).catch(n.fail);
  }, [token, n.fail]);
  useEffect(() => { load(null); }, [load]);
  if (!d) return <div className="d-empty">Loading your day…</div>;
  const items: Row[] = d.items || [];
  const replace = (next: Row) => setD(cur => cur && ({ ...cur, items: (cur.items as Row[]).map(i => (i.id === next.id ? { ...i, ...next } : i)) }));
  const act = (r: Row, path: string, body?: unknown) => call<Row>(`/routines/${r.id}/days/${day}/${path}`, token, postJson(body ?? {}))
    .then(next => { replace(next); if (next.status === "done" && r.status !== "done") n.ok(`${r.icon} ${r.name} done · +${next.mode === "short" ? 8 : 15} points`); }).catch(n.fail);
  const starter = () => call<Row>("/routines/starter", token, postJson({})).then(o => { n.ok(`Loaded ${o.added} routines`); load(day); }).catch(n.fail);

  if (!d.has_routines) return <Hero kicker="My day" title="Bring your" accent="routines to life" sub="Load the Morning, After gym, Office evening, Weekend, Sunday reset and Night routines plus the gym and office bag checklists. Edit everything later.">
    <div className="d-row" style={{ marginTop: 14 }}><button className="d-btn" onClick={() => void starter()}>📓 Load my notebook routines</button>
      <button className="d-btn ghost" onClick={() => setEditing("new")}>＋ Make my own</button></div>
    {n.view}{editing && <RoutineEditor token={token} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(day); }}/>}
  </Hero>;

  const isToday = day === iso(new Date());
  return <>
    <Hero kicker={`${d.day_type.icon} ${d.day_type.label}${isToday ? " · today" : ""}`} title={pretty(day!)} sub={`“${d.day_type.theme}”`}
      right={<Ring value={(d.score ?? 0) * 100} size={128} label={`${d.done}/${d.total}`} sub="routines"/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        <button className="d-btn ghost" onClick={() => load(shiftDay(day!, -1))}>‹ Previous</button>
        {!isToday && <button className="d-btn ghost" onClick={() => load(iso(new Date()))}>Today</button>}
        <button className="d-btn ghost" onClick={() => load(shiftDay(day!, 1))}>Next ›</button>
        <button className="d-btn ghost" onClick={() => setEditing("new")}>＋ New routine</button>
      </div>
    </Hero>
    {n.view}
    <div className="d-programs">{items.map(r => { const needed = new Set(r.needed_step_ids as string[]); const done = new Set(r.done_step_ids as string[]);
      const isOpen = open === r.id;
      return <article className="d-program" key={r.id} style={r.status === "done" ? { borderColor: "var(--d-green)" } : r.status === "skipped" ? { opacity: 0.6 } : undefined}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{r.icon} {r.name}</h4>
          <span className={`d-tag ${r.status === "done" ? "green" : r.status === "skipped" ? "" : "amber"}`}>{r.status === "done" ? "done ✓" : r.status === "skipped" ? "skipped" : r.mode === "short" ? "short" : `${Math.round(r.progress * 100)}%`}</span></div>
        <p>{r.kind === "checklist" ? "Checklist" : `${r.starts ? hhmm(r.starts) : "Any time"} · ${r.duration_minutes} min`} · {[...needed].filter(id => done.has(id)).length}/{needed.size} steps</p>
        <Meter value={r.progress * 100}/>
        {isOpen && <div style={{ display: "grid", gap: 6 }}>{(r.steps as Row[]).map(st => <label key={st.id} className="d-row" style={{ opacity: needed.has(st.id) ? 1 : 0.45, color: "var(--d-text)", cursor: "pointer" }}>
          <input type="checkbox" checked={done.has(st.id)} onChange={e => void act(r, `steps/${st.id}`, { done: e.target.checked })}/>
          <span style={{ textDecoration: done.has(st.id) ? "line-through" : "none" }}>{st.title}</span>{st.essential && <b style={{ color: "var(--d-amber)" }}>★</b>}</label>)}
          <p className="d-note">★ = essential: the short version for busy days.</p></div>}
        <div className="d-row">
          <button className="d-btn ghost" onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? "Hide steps" : "Tick steps"}</button>
          {r.kind === "routine" && r.status !== "done" && <button className="text-button" onClick={() => void act(r, "mode", { mode: r.mode === "short" ? "full" : "short" })}>{r.mode === "short" ? "↺ Full" : "⚡ Short"}</button>}
          {r.kind === "routine" && r.status === "pending" && <button className="text-button" onClick={() => void act(r, "skip")}>Skip today</button>}
          <button className="text-button" onClick={() => setEditing(r)}>Edit</button>
        </div>
      </article>; })}</div>
    <FoodDiary token={token} day={day!} meals={d.meals || []} rules={d.eating_rules} onChanged={() => load(day)}/>
    {editing && <RoutineEditor token={token} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(day); }}/>}
  </>;
}

const ICONS = ["☀️", "🌙", "🏋️", "💼", "🌿", "🔄", "🎒", "👜", "📚", "🇩🇪", "🇬🇧", "🧘", "💊", "🍽", "✨"];
function RoutineEditor({ token, initial, onClose, onSaved }: { token: string; initial: Row | null; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Row>(() => initial ? { ...initial, start_time: initial.start_time ?? initial.starts ?? null, steps: (initial.steps as Row[]).map(s => ({ ...s })) }
    : { name: "", icon: "✨", kind: "routine", start_time: "07:00", duration_minutes: 30, day_rule: "fixed", days: [1, 2, 3, 4, 5, 6, 7], steps: [{ title: "", essential: true }] });
  const [error, setError] = useState("");
  const patch = (p: Row) => setD(cur => ({ ...cur, ...p }));
  const setStep = (i: number, p: Row) => patch({ steps: (d.steps as Row[]).map((s, j) => (j === i ? { ...s, ...p } : s)) });
  async function save() {
    const steps = (d.steps as Row[]).filter(s => String(s.title || "").trim()).map(s => ({ id: s.id, title: String(s.title).trim(), essential: !!s.essential, detail: s.detail || null }));
    if (!String(d.name).trim()) { setError("Give it a name."); return; }
    if (!steps.length) { setError("Add at least one step."); return; }
    const body = { name: String(d.name).trim(), icon: d.icon, kind: d.kind, start_time: d.start_time ? hhmm(d.start_time) : null, duration_minutes: Number(d.duration_minutes), day_rule: d.day_rule, days: d.days, steps };
    try { await call(initial ? `/routines/${initial.id}` : "/routines", token, initial ? patchJson(body) : postJson(body)); onSaved(); } catch (e) { setError(errText(e)); }
  }
  async function remove() {
    if (!initial || !window.confirm(`Delete “${d.name}” and its history?`)) return;
    try { await call(`/routines/${initial.id}`, token, { method: "DELETE" }); onSaved(); } catch (e) { setError(errText(e)); }
  }
  return <Card kicker={initial ? "Edit routine" : "New routine"} title={d.name || "Untitled"} action={<button className="d-btn ghost" onClick={onClose}>Close</button>}>
    <div className="d-row"><input className="d-input" value={d.name} onChange={e => patch({ name: e.target.value })} placeholder="Name, e.g. Study German" maxLength={60}/></div>
    <div className="d-chips">{ICONS.map(ic => <button key={ic} className={`d-chip ${d.icon === ic ? "on" : ""}`} onClick={() => patch({ icon: ic })}>{ic}</button>)}</div>
    <Tabs value={d.kind} options={["routine", "checklist"] as const} onChange={kind => patch({ kind })} labels={{ routine: "Routine (timed)", checklist: "Checklist" }}/>
    {d.kind === "routine" && <div className="d-row">
      <label className="d-row" style={{ color: "var(--d-text)" }}>Starts <input className="d-input" style={{ minWidth: 120 }} type="time" value={hhmm(d.start_time)} onChange={e => patch({ start_time: e.target.value || null })}/></label>
      <label className="d-row" style={{ color: "var(--d-text)" }}>Minutes <input className="d-input" style={{ minWidth: 100 }} type="number" min={5} max={600} value={d.duration_minutes} onChange={e => patch({ duration_minutes: e.target.value })}/></label>
    </div>}
    <Tabs value={d.day_rule} options={["fixed", "gym", "work", "off"] as const} onChange={day_rule => patch({ day_rule })} labels={{ fixed: "Chosen days", gym: "Gym days", work: "Work days", off: "Days off" }}/>
    {d.day_rule === "fixed" && <DayPicker value={d.days} onChange={days => patch({ days })}/>}
    {(d.steps as Row[]).map((s, i) => <div className="d-row" key={s.id ?? `n${i}`}>
      <button className="text-button" title="Essential step" onClick={() => setStep(i, { essential: !s.essential })} style={{ color: s.essential ? "var(--d-amber)" : "var(--d-muted)", fontSize: 18 }}>★</button>
      <input className="d-input" value={s.title} onChange={e => setStep(i, { title: e.target.value })} placeholder={`Step ${i + 1}`} maxLength={120}/>
      <button className="danger-link" onClick={() => patch({ steps: (d.steps as Row[]).filter((_, j) => j !== i) })}>✕</button></div>)}
    <div className="d-row"><button className="d-btn ghost" onClick={() => patch({ steps: [...(d.steps as Row[]), { title: "", essential: false }] })}>＋ Add step</button>
      <button className="d-btn" onClick={() => void save()}>{initial ? "Save" : "Create routine"}</button>
      {initial && <button className="danger-link" onClick={() => void remove()}>Delete routine</button>}</div>
    {error && <p className="d-warn">{error}</p>}
  </Card>;
}

const FOODS: Record<string, string[]> = {
  breakfast: ["String hoppers", "Hoppers", "Pittu", "Bread", "Kiribath", "Oats", "Eggs", "Smoothie", "Tea", "Coffee", "Fruit"],
  lunch: ["Rice & curry", "Dhal", "Chicken curry", "Fish curry", "Vegetables", "Salad", "Fried rice", "Kottu", "Fruit"],
  dinner: ["Roti", "String hoppers", "Rice & curry", "Kottu", "Noodles", "Soup", "Dhal", "Eggs", "Salad"],
  snack: ["Fruit", "Nuts", "Biscuits", "Short eats", "Yoghurt", "Tea", "Coffee", "Chocolate"],
};
const CHECKS: [string, string][] = [["slow", "Ate slowly"], ["no_screen", "No screens"], ["upright", "Sat upright"], ["stopped_80", "Stopped at 80% full"], ["walked_after", "Short walk after"]];
function FoodDiary({ token, day, meals, rules, onChanged }: { token: string; day: string; meals: Row[]; rules?: Row; onChanged: () => void }) {
  const h = new Date().getHours();
  const blank = () => ({ meal: h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner", foods: "", eaten_time: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
    slow: false, no_screen: false, upright: false, stopped_80: false, walked_after: false } as Row);
  const [m, setM] = useState<Row>(blank);
  const n = useNote();
  const isToday = day === iso(new Date());
  const save = () => call("/meals", token, postJson({ ...m, foods: String(m.foods || "").trim() || null })).then(() => { setM(blank()); n.ok("Meal saved 🍽"); onChanged(); }).catch(n.fail);
  const remove = (id: string) => call(`/meals/${id}`, token, { method: "DELETE" }).then(onChanged).catch(n.fail);
  return <div className="d-grid-2">
    <Card kicker="Food diary" title={isToday ? "What did you eat?" : "Meals are logged for today"}>
      <Tabs value={m.meal} options={["breakfast", "lunch", "dinner", "snack"] as const} onChange={meal => setM({ ...m, meal })} labels={{ breakfast: "🌅 Breakfast", lunch: "☀️ Lunch", dinner: "🌙 Dinner", snack: "🍎 Snack / other" }}/>
      <div className="d-chips">{(FOODS[m.meal] || []).map(f => <button key={f} className="d-chip" onClick={() => setM({ ...m, foods: m.foods ? `${m.foods}, ${f}` : f })}>＋ {f}</button>)}</div>
      <textarea className="d-input" rows={2} value={m.foods} onChange={e => setM({ ...m, foods: e.target.value })} placeholder="e.g. rice, dhal, chicken curry" maxLength={1000}/>
      <div className="d-row"><label className="d-row" style={{ color: "var(--d-text)" }}>Eaten at <input className="d-input" style={{ minWidth: 120 }} type="time" value={m.eaten_time} onChange={e => setM({ ...m, eaten_time: e.target.value })}/></label></div>
      <div className="d-chips">{CHECKS.map(([k, label]) => <button key={k} className={`d-chip ${m[k] ? "on" : ""}`} onClick={() => setM({ ...m, [k]: !m[k] })}>{m[k] ? "✓ " : ""}{label}</button>)}</div>
      <div className="d-row"><button className="d-btn" onClick={() => void save()}>Save meal</button></div>
      {n.view}<p className="d-note">No calories, no judging. 4+ mindful checks earn a few points.</p>
    </Card>
    <Card kicker="Today's plate" title={`${meals.length} meal${meals.length === 1 ? "" : "s"}`}>
      {meals.length ? [...meals].sort((a, b) => String(a.eaten_time || "").localeCompare(String(b.eaten_time || ""))).map(x => <div className="d-biggest" key={x.id}>
        <i>{({ breakfast: "🌅", lunch: "☀️", dinner: "🌙", snack: "🍎" } as Row)[x.meal] || "🍽"}</i>
        <div><b>{x.meal}{x.eaten_time ? ` · ${hhmm(x.eaten_time)}` : ""}</b><small>{x.foods || "—"} · {x.mindful}/5 mindful</small></div>
        <button className="danger-link" onClick={() => void remove(x.id)}>✕</button></div>) : <div className="d-empty">Nothing logged yet.</div>}
      {rules && <details><summary className="d-note" style={{ cursor: "pointer" }}>Mindful eating guide</summary>
        <ul className="d-list">{[...(rules.while || []), ...(rules.after_0_10 || []), ...(rules.after_10_20 || [])].map((t: string) => <li key={t}>{t}</li>)}</ul></details>}
    </Card>
  </div>;
}

function RoutinesWeek({ token }: { token: string }) {
  const [w, setW] = useState<Row | null>(null);
  const n = useNote();
  const load = useCallback((start: string | null) => { call<Row>(`/routines/week${start ? `?start=${start}` : ""}`, token).then(setW).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(null); }, [load]);
  if (!w) return <div className="d-empty">Loading your week…</div>;
  const setDays = (key: "work_days" | "gym_days", days: number[]) => call("/profile", token, patchJson({ [key]: days })).then(() => { n.ok("Week shape updated"); load(w.start); }).catch(n.fail);
  const days: Row[] = w.days || [];
  return <>
    <Hero kicker="Week" title={`${new Date(`${w.start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })} – ${new Date(`${w.end}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}`}
      sub={w.message} right={<Ring value={(w.score ?? 0) * 100} size={128} sub="week score"/>}>
      <div className="d-row" style={{ marginTop: 12 }}><button className="d-btn ghost" onClick={() => load(shiftDay(w.start, -7))}>‹ Previous</button><button className="d-btn ghost" onClick={() => load(null)}>This week</button><button className="d-btn ghost" onClick={() => load(shiftDay(w.start, 7))}>Next ›</button></div>
    </Hero>
    {n.view}
    <div className="d-stats">
      <Stat label="Gym" icon="🏋️" value={`${w.gym.done}/${w.gym.target}`} tone="solid" hint="sessions this week"/>
      <Stat label="Perfect days" icon="🌟" value={(w.perfect_days || []).length} tone="green"/>
      <Stat label="Work days" icon="💼" value={(w.work_days || []).length} tone="blue"/>
      <Stat label="Gym days" icon="📅" value={(w.gym_days || []).length} tone="violet"/>
    </div>
    <div className="d-grid-3">
      <Card kicker="How each day went" title="Routine score by day">
        <Bars data={days.map(d => ({ label: `${d.day_type.icon} ${DAYS[(new Date(`${d.date}T12:00:00`).getDay() + 6) % 7]}`, value: Math.round((d.score ?? 0) * 100), highlight: d.date === w.today }))} height={150} format={x => `${x}%`}/>
      </Card>
      <Card kicker="Your week shape" title="Office and gym days">
        <p className="d-note">💼 Work (office) days</p><DayPicker value={w.work_days} onChange={v => void setDays("work_days", v)}/>
        <p className="d-note">🏋️ Gym days · {(w.gym_days || []).length} a week</p><DayPicker value={w.gym_days} onChange={v => void setDays("gym_days", v)}/>
        <p className="d-note">Tip: avoid 3 gym days in a row so muscles recover.</p>
      </Card>
    </div>
  </>;
}

function RoutinesMonth({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const n = useNote();
  const load = useCallback((m: string | null) => { call<Row>(`/routines/month${m ? `?month=${m}` : ""}`, token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(null); }, [load]);
  const cells = useMemo(() => v ? [...Array(Number(v.first_weekday) - 1).fill(null), ...(v.days as Row[])] : [], [v]);
  if (!v) return <div className="d-empty">Loading your month…</div>;
  const move = (k: number) => { const [y, m] = String(v.month).split("-").map(Number); const d = new Date(y, m - 1 + k, 1); load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const shade = (c: Row) => c.future || c.score == null ? "var(--d-card2)" : `color-mix(in srgb, var(--d-green) ${Math.round(15 + c.score * 85)}%, var(--d-card2))`;
  return <>
    <Hero kicker="Month" title={new Date(`${v.month}-15T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" })} sub="A day counts toward the streak when at least half its routines are done."
      right={<Ring value={(v.score ?? 0) * 100} size={128} sub="month score"/>}>
      <div className="d-row" style={{ marginTop: 12 }}><button className="d-btn ghost" onClick={() => move(-1)}>‹ Previous</button><button className="d-btn ghost" onClick={() => move(1)}>Next ›</button></div>
    </Hero>{n.view}
    <div className="d-stats">
      <Stat label="Gym sessions" icon="🏋️" value={v.gym_sessions} tone="solid"/>
      <Stat label="Streak" icon="🔥" value={v.current_streak} tone="amber" hint={`best ${v.best_streak}`}/>
      <Stat label="Routines" icon="✓" value={(v.routines || []).length} tone="green"/>
      <Stat label="Month score" icon="📈" value={v.score == null ? "—" : `${Math.round(v.score * 100)}%`} tone="blue"/>
    </div>
    <div className="d-grid-3">
      <Card kicker="Calendar" title="Completion by day">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
          {DAYS.map(d => <small key={d} style={{ textAlign: "center", color: "var(--d-muted)", fontWeight: 800 }}>{d}</small>)}
          {cells.map((c, i) => <div key={i} style={{ aspectRatio: "1", borderRadius: 10, display: "grid", placeItems: "center", background: c ? shade(c) : "transparent", color: "var(--d-text)", fontSize: 12, fontWeight: 700 }}>
            {c && <span>{Number(String(c.date).slice(8))}{c.gym_done ? " 🏋️" : ""}</span>}</div>)}
        </div>
      </Card>
      <Card kicker="This month" title="Routines">{(v.routines as Row[]).map((r, i) => <Meter key={r.id} label={`${r.icon} ${r.name}`} color={SERIES[i % SERIES.length]} value={r.due ? (r.done / r.due) * 100 : 0} right={`${r.done}/${r.due}`}/>)}</Card>
    </div>
  </>;
}

// =====================================================================================================================
// JOURNAL
// =====================================================================================================================

const MOODS: [number, string, string][] = [[1, "😞", "Rough"], [2, "🙁", "Low"], [3, "😐", "Okay"], [4, "🙂", "Good"], [5, "😄", "Great"]];
const EMPTY_PAGE: Row = { mood: null, did: "", positives: [], negatives: [], gratitude: [], lesson: "", notes: "", tags: [] };

function ListInput({ items, onChange, placeholder, max }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; max: number }) {
  const [text, setText] = useState("");
  const add = () => { if (text.trim() && items.length < max) { onChange([...items, text.trim()]); setText(""); } };
  return <div style={{ display: "grid", gap: 6 }}>
    {items.map((t, i) => <div className="d-row" key={i} style={{ background: "var(--d-card2)", borderRadius: 10, padding: "8px 10px", color: "var(--d-text)" }}>
      <span style={{ flex: 1 }}>• {t}</span><button className="danger-link" onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button></div>)}
    {items.length < max && <div className="d-row"><input className="d-input" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder={placeholder} maxLength={300}/>
      <button className="d-btn ghost" onClick={add}>＋</button></div>}
  </div>;
}

export function JournalPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [d, setD] = useState<Row>(EMPTY_PAGE);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const n = useNote();
  const load = useCallback((which: string | null) => {
    call<Row>(`/journal${which ? `?day=${which}` : ""}`, token).then(x => { setV(x); setDay(String(x.date)); setD({ ...EMPTY_PAGE, ...(x.entry || {}) }); setDirty(false); }).catch(n.fail);
  }, [token, n.fail]);
  useEffect(() => { load(null); }, [load]);
  if (!v) return <div className="d-empty">Opening your journal…</div>;
  const patch = (p: Row) => { setD(c => ({ ...c, ...p })); setDirty(true); };
  const go = (next: string) => { if (!dirty || window.confirm("Discard unsaved changes on this page?")) load(next); };
  async function save() {
    setBusy("save");
    try { const x = await call<Row>(`/journal/${day}`, token, putJson({ mood: d.mood, did: d.did || null, positives: d.positives, negatives: d.negatives, gratitude: d.gratitude, lesson: d.lesson || null, notes: d.notes || null, tags: d.tags }));
      setV(x); setD({ ...EMPTY_PAGE, ...(x.entry || {}) }); setDirty(false); n.ok("Journal saved ✍️"); } catch (e) { n.fail(e); } finally { setBusy(""); }
  }
  async function reflect() {
    if (dirty) await save();
    setBusy("reflect");
    try { const e = await call<Row>(`/journal/${day}/reflect`, token, postJson({})); setD(c => ({ ...c, ai_reflection: e.ai_reflection })); } catch (e) { n.fail(e); } finally { setBusy(""); }
  }
  async function remove() {
    if (!window.confirm("Delete this journal page?")) return;
    try { const x = await call<Row>(`/journal/${day}`, token, { method: "DELETE" }); setV(x); setD({ ...EMPTY_PAGE }); setDirty(false); n.ok("Page deleted"); } catch (e) { n.fail(e); }
  }
  const month = v.month;
  const cells = [...Array(Number(month.first_weekday) - 1).fill(null), ...Array.from({ length: Number(month.days) }, (_, i) => i + 1)];
  const isToday = day === v.today;
  const moodCounts = MOODS.map(([k, face, label]) => ({ label: `${face} ${label}`, value: Object.values(month.moods as Record<string, number>).filter(x => x === k).length }));
  return <div className="d-dash">
    <Hero kicker="✍️ Journal" title={isToday ? "Today's page" : pretty(day!)} sub="Private. Nothing goes to the AI unless you click Reflect, and it never goes into memory automatically."
      right={<Ring value={Math.min(100, (v.entries_30_days / 30) * 100)} size={128} label={`${v.streak}🔥`} sub="day streak"/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        <button className="d-btn ghost" onClick={() => go(shiftDay(day!, -1))}>‹ Previous</button>
        <input className="d-input" style={{ maxWidth: 180, flex: "none" }} type="date" value={day!} max={v.today} onChange={e => e.target.value && go(e.target.value)}/>
        <button className="d-btn ghost" disabled={isToday} onClick={() => go(shiftDay(day!, 1))}>Next ›</button>
      </div>
    </Hero>
    <div className="d-stats">
      <Stat label="Streak" icon="🔥" value={v.streak} tone="solid" hint="days in a row"/>
      <Stat label="Pages · 30 days" icon="📖" value={v.entries_30_days} tone="blue"/>
      <Stat label="Thanks · 30 days" icon="🙏" value={v.gratitude_30_days} tone="violet"/>
      <Stat label="This month" icon="📅" value={(month.written as string[]).length} tone="green" hint="pages written"/>
    </div>
    <div className="d-grid-3">
      <div className="d-dash" style={{ marginBottom: 0 }}>
        <Card kicker="How was the day?" title="Mood">
          <div className="d-chips">{MOODS.map(([k, face, label]) => <button key={k} className={`d-chip ${d.mood === k ? "on" : ""}`} style={{ fontSize: 15 }} onClick={() => patch({ mood: d.mood === k ? null : k })}>{face} {label}</button>)}</div>
        </Card>
        <Card kicker="📝 What I did" title=""><textarea className="d-input" rows={3} value={d.did || ""} onChange={e => patch({ did: e.target.value })} placeholder="Gym, office, 45 min IELTS, dinner with family…"/></Card>
        <div className="d-grid-2">
          <Card kicker="🌞 Good things" title=""><ListInput items={d.positives} onChange={positives => patch({ positives })} placeholder="Something that went well" max={10}/></Card>
          <Card kicker="🌧 Hard things" title=""><ListInput items={d.negatives} onChange={negatives => patch({ negatives })} placeholder="Something difficult" max={10}/></Card>
        </div>
        <div className="d-grid-2">
          <Card kicker="🙏 Grateful for" title=""><ListInput items={d.gratitude} onChange={gratitude => patch({ gratitude })} placeholder={`Thing ${d.gratitude.length + 1} of 3`} max={5}/></Card>
          <Card kicker="💡 Lesson for tomorrow" title=""><textarea className="d-input" rows={3} value={d.lesson || ""} onChange={e => patch({ lesson: e.target.value })} placeholder="One thing to keep or change"/></Card>
        </div>
        <Card kicker="🗒 Free notes" title="">
          <div className="d-chips">{(v.prompts as string[]).map(p => <button key={p} className="d-chip" onClick={() => patch({ notes: `${d.notes ? `${d.notes}\n\n` : ""}${p}\n` })}>＋ {p}</button>)}</div>
          <textarea className="d-input" rows={6} value={d.notes || ""} onChange={e => patch({ notes: e.target.value })} placeholder="Anything on your mind…"/>
        </Card>
        <div className="d-row">
          <button className="d-btn" disabled={!dirty || busy === "save"} onClick={() => void save()}>{busy === "save" ? "Saving…" : dirty ? "Save page" : "Saved ✓"}</button>
          <button className="d-btn ghost" disabled={busy === "reflect"} onClick={() => void reflect()}>{busy === "reflect" ? "Thinking…" : "✨ Reflect"}</button>
          {v.entry && <button className="danger-link" onClick={() => void remove()}>Delete this page</button>}
        </div>
        {n.view}
        {d.ai_reflection && <Card kicker="✨ Reflection" title=""><p className="d-plan" style={{ margin: 0 }}>{d.ai_reflection}</p></Card>}
      </div>
      <div className="d-dash" style={{ marginBottom: 0 }}>
        <Card kicker="Mood this month" title="">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>{DAYS.map(x => <small key={x} style={{ textAlign: "center", color: "var(--d-muted)", fontWeight: 800 }}>{x}</small>)}
            {cells.map((c, i) => { if (c == null) return <span key={`e${i}`}/>; const key = `${String(month.first).slice(0, 8)}${String(c).padStart(2, "0")}`; const mood = (month.moods as Row)[key];
              const written = (month.written as string[]).includes(key);
              return <button key={key} onClick={() => go(key)} title={key} style={{ aspectRatio: "1", borderRadius: 9, border: key === day ? "2px solid var(--d-green)" : "1px solid var(--d-line)", cursor: "pointer",
                background: mood ? `color-mix(in srgb, var(--d-green) ${mood * 18}%, var(--d-card2))` : written ? "var(--d-card2)" : "transparent", color: "var(--d-text)", fontSize: 12 }}>{mood ? MOODS[mood - 1][1] : c}</button>; })}</div>
        </Card>
        <Card kicker="Moods" title="This month"><Bars data={moodCounts.map((m, i) => ({ label: m.label.split(" ")[0], value: m.value, color: SERIES[[4, 2, 3, 0, 0][i]] }))} height={110} format={x => String(x)}/></Card>
        {(v.on_this_day as Row[]).length > 0 && <Card kicker="🕰 On this day" title="">{(v.on_this_day as Row[]).map(o => <button key={o.label} className="text-button" style={{ textAlign: "left" }} onClick={() => go(String(o.date))}><b>{o.label} {o.mood_icon || ""}</b> {o.line}</button>)}</Card>}
      </div>
    </div>
  </div>;
}

// =====================================================================================================================
// EXAM COACH
// =====================================================================================================================

const EXAM_STATUS: Record<string, [string, string]> = { on_track: ["green", "on track"], met: ["green", "target met"], behind: ["red", "behind"], no_data: ["", "no scores yet"], past: ["", "exam passed"] };
const fmtScore = (v: unknown, exam: string) => (v == null ? "—" : exam === "ielts" ? Number(v).toFixed(1) : String(Math.round(Number(v))));

export function ExamsPage({ token }: { token: string }) {
  const [plans, setPlans] = useState<Row[] | null>(null);
  const [exam, setExam] = useState<"ielts" | "goethe">("ielts");
  const [panel, setPanel] = useState<"" | "score" | "settings" | "writing" | "speaking">("");
  const n = useNote();
  const load = useCallback(() => { call<Row[]>("/exams", token).then(setPlans).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!plans) return <div className="d-empty">Loading your exam plans…</div>;
  const p = plans.find(x => x.exam === exam) || plans[0];
  if (!p) return <div className="d-empty">No exam plans.</div>;
  const r = p.readiness, t = p.today;
  const replace = (next: Row) => setPlans(ps => ps!.map(x => (x.id === next.id ? next : x)));
  const log = (skill: string, minutes: number, label: string) => call<Row>(`/exams/${p.id}/log`, token, postJson({ skill, minutes })).then(x => { replace(x); n.ok(`+${minutes} min ${label} ✓`); }).catch(n.fail);
  const [tone, label] = EXAM_STATUS[r.status] || EXAM_STATUS.no_data;
  const max = Number(p.score_max);
  return <div className="d-dash">
    <Tabs value={exam} options={plans.map(x => x.exam) as ("ielts" | "goethe")[]} onChange={setExam} labels={{ ielts: "🇬🇧 IELTS", goethe: "🇩🇪 Goethe German" }}/>
    <Hero kicker={`${p.name} · ${String(p.variant).toUpperCase()}`} title={`${r.days_left} days`} accent="to go"
      sub={<>{r.message}<br/>Exam {new Date(`${p.exam_date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}{p.date_is_estimate ? " (estimated: set your real date)" : ""} · {r.hours_left} study hours left</>}
      right={<Ring value={r.week.planned ? Math.min(100, (r.week.done / r.week.planned) * 100) : 0} size={132} label={`${r.week.done}`} sub={`of ${r.week.planned} min · week`}/>}>
      <div className="d-row" style={{ marginTop: 12 }}><span className={`d-tag ${tone}`}>{label}</span>
        <button className="d-btn ghost" onClick={() => setPanel(panel === "settings" ? "" : "settings")}>⚙ Plan settings</button>
        <button className="d-btn ghost" onClick={() => setPanel(panel === "score" ? "" : "score")}>＋ Add score</button></div>
    </Hero>
    {n.view}
    <div className="d-stats">
      <Stat label="Target" icon="🎯" value={fmtScore(p.target_score, p.exam)} tone="solid"/>
      <Stat label="Now" icon="📊" value={fmtScore(r.overall, p.exam)} tone="blue" hint={r.projected_overall != null ? `projected ${fmtScore(r.projected_overall, p.exam)}` : "add a mock score"}/>
      <Stat label="Streak" icon="🔥" value={r.streak} tone="amber" hint="study days"/>
      <Stat label="Today" icon="⏱" value={`${t.done_minutes ?? 0}/${t.minutes ?? 0}`} tone="green" hint="minutes"/>
    </div>
    {panel === "settings" && <ExamSettings token={token} p={p} onSaved={x => { replace(x); setPanel(""); n.ok("Plan updated"); }} onError={n.fail}/>}
    {panel === "score" && <ExamScore token={token} p={p} onSaved={x => { replace(x); setPanel(""); n.ok("Score saved"); }} onError={n.fail}/>}
    <div className="d-grid-3">
      <Card kicker="Today" title={t.study_day ? `${t.minutes} minutes` : "Rest day"}>
        {!t.study_day ? <p className="d-note">{t.message}</p> : <>
          {t.catch_up > 0 && <p className="d-warn">⏫ Includes {t.catch_up} catch-up minutes from this week</p>}
          {(t.blocks as Row[]).map(b => <div className="d-program" key={b.skill}>
            <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{b.icon} {b.label} · {b.minutes} min</h4>{b.why === "weakest vs target" && <span className="d-tag amber">weakest</span>}</div>
            <p>{b.activity}</p>{b.done_minutes > 0 && <p>{b.done_minutes} min done today</p>}
            <div className="d-row"><button className="d-btn" onClick={() => void log(b.skill, b.minutes, b.label)}>Done ✓ {b.minutes}m</button></div>
          </div>)}
          <p className="d-note">{t.message}</p></>}
      </Card>
      <Card kicker="Skills" title="Latest vs target">
        <Bars data={(p.skills as Row[]).map(sk => ({ label: `${sk.icon} ${sk.label}`, value: Number(sk.latest ?? 0), color: sk.status === "behind" ? "var(--d-red)" : "var(--d-green)" }))} goal={Number(p.target_score)} height={150} format={x => fmtScore(x, p.exam)}/>
        {(p.skills as Row[]).map(sk => <Meter key={sk.skill} label={`${sk.icon} ${sk.label}`} value={(Number(sk.latest ?? 0) / max) * 100}
          right={`${fmtScore(sk.latest, p.exam)}${sk.projected != null ? ` → ${fmtScore(sk.projected, p.exam)}` : ""}`} color={sk.status === "behind" ? "var(--d-red)" : "var(--d-green)"}/>)}
        <p className="d-note">Arrow = projection at the exam date (capped to stay realistic).</p>
      </Card>
    </div>
    <Card kicker="Practice with feedback" title="Writing and speaking" action={<div className="d-row"><button className="d-btn" onClick={() => setPanel("writing")}>✍️ Writing</button><button className="d-btn ghost" onClick={() => setPanel("speaking")}>🗣 Speaking</button></div>}>
      {(panel === "writing" || panel === "speaking") ? <ExamPractice token={token} p={p} mode={panel} onError={n.fail}/> : <p className="d-note">Rule checks always work. With AI on you also get corrections and an estimated score (marked as an estimate); top corrections go to your mistake notebook.</p>}
    </Card>
  </div>;
}

function ExamSettings({ token, p, onSaved, onError }: { token: string; p: Row; onSaved: (x: Row) => void; onError: (e: unknown) => void }) {
  const [d, setD] = useState<Row>({ variant: p.variant, target_score: String(p.target_score), exam_date: p.exam_date, daily_minutes: p.daily_minutes, study_days: p.study_days, study_time: hhmm(p.study_time) || "14:00", active: p.active });
  const save = () => call<Row>(`/exams/${p.id}`, token, patchJson({ ...d, target_score: Number(d.target_score), daily_minutes: Number(d.daily_minutes), exam_date: d.exam_date !== p.exam_date ? d.exam_date : undefined })).then(onSaved).catch(onError);
  return <Card kicker={`${p.name} plan`} title="Settings">
    <Tabs value={d.variant} options={p.variants as string[]} onChange={variant => setD({ ...d, variant })}/>
    <div className="d-row">
      <label className="d-row" style={{ color: "var(--d-text)" }}>Target <input className="d-input" style={{ minWidth: 90 }} value={d.target_score} onChange={e => setD({ ...d, target_score: e.target.value })}/></label>
      <label className="d-row" style={{ color: "var(--d-text)" }}>Exam date <input className="d-input" type="date" value={d.exam_date} onChange={e => setD({ ...d, exam_date: e.target.value })}/></label>
      <label className="d-row" style={{ color: "var(--d-text)" }}>Study time <input className="d-input" type="time" value={d.study_time} onChange={e => setD({ ...d, study_time: e.target.value })}/></label>
    </div>
    <Tabs value={String(d.daily_minutes)} options={["20", "30", "45", "60", "90", "120"]} onChange={v => setD({ ...d, daily_minutes: Number(v) })} labels={{ "20": "20 min", "30": "30 min", "45": "45 min", "60": "1 h", "90": "1.5 h", "120": "2 h" }}/>
    <DayPicker value={d.study_days} onChange={study_days => setD({ ...d, study_days })}/>
    <label className="d-row" style={{ color: "var(--d-text)" }}><input type="checkbox" checked={!!d.active} onChange={e => setD({ ...d, active: e.target.checked })}/> Preparing for this exam</label>
    <div className="d-row"><button className="d-btn" onClick={() => void save()}>Save plan</button></div>
  </Card>;
}

function ExamScore({ token, p, onSaved, onError }: { token: string; p: Row; onSaved: (x: Row) => void; onError: (e: unknown) => void }) {
  const skills = (p.skills as Row[]).map(x => x.skill as string);
  const [skill, setSkill] = useState(skills[0]);
  const [score, setScore] = useState("");
  const [source, setSource] = useState("mock");
  return <Card kicker="Add a score" title={p.exam === "ielts" ? "Band (rounded to 0.5)" : "Points 0-100 (60 = pass)"}>
    <Tabs value={skill} options={skills} onChange={setSkill} labels={Object.fromEntries((p.skills as Row[]).map(x => [x.skill, `${x.icon} ${x.label}`]))}/>
    <div className="d-row"><input className="d-input" value={score} onChange={e => setScore(e.target.value)} placeholder={p.exam === "ielts" ? "e.g. 6.5" : "e.g. 72"}/>
      <Tabs value={source} options={["mock", "practice", "real"]} onChange={setSource}/>
      <button className="d-btn" disabled={!score.trim()} onClick={() => void call<Row>(`/exams/${p.id}/scores`, token, postJson({ skill, score: Number(score), source })).then(onSaved).catch(onError)}>Save score</button></div>
  </Card>;
}

function ExamPractice({ token, p, mode, onError }: { token: string; p: Row; mode: "writing" | "speaking"; onError: (e: unknown) => void }) {
  const prompts: string[] = (mode === "writing" ? p.writing_prompts : p.speaking_questions) || [];
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [task, setTask] = useState("task2");
  const [res, setRes] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  async function submit() {
    setBusy(true);
    try { setRes(await call<Row>(`/exams/${p.id}/feedback`, token, postJson({ mode, prompt: prompts[i], answer, task, seconds: 0 }))); } catch (e) { onError(e); } finally { setBusy(false); }
  }
  const m: Row = res?.metrics || {}, ai: Row | null = res?.ai || null;
  return <div style={{ display: "grid", gap: 10 }}>
    <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--d-text)" }}>Task {i + 1}/{prompts.length}</b>
      <button className="text-button" onClick={() => { setI((i + 1) % Math.max(1, prompts.length)); setRes(null); setAnswer(""); }}>Next topic ›</button></div>
    <p className="d-plan" style={{ margin: 0 }}>{prompts[i]}</p>
    {mode === "writing" && p.exam === "ielts" && <Tabs value={task} options={["task1", "task2"]} onChange={setTask} labels={{ task1: "Task 1 (150+)", task2: "Task 2 (250+)" }}/>}
    <textarea className="d-input" rows={mode === "writing" ? 10 : 5} value={answer} onChange={e => setAnswer(e.target.value)} placeholder={mode === "writing" ? "Write your answer…" : "Type (or dictate) your spoken answer…"}/>
    <div className="d-row"><span className="d-note">{words} words</span><button className="d-btn" disabled={words < 3 || busy} onClick={() => void submit()}>{busy ? "Checking…" : "Get feedback"}</button></div>
    {res && <div className="d-grid-2">
      <Card kicker={ai?.estimated_score != null ? "Estimated score" : "Checks"} title={ai?.estimated_score != null ? fmtScore(ai.estimated_score, p.exam) : ""}>
        <p className="d-note">{m.words_per_minute != null ? `${m.words} words · ${m.words_per_minute} wpm · ${m.fillers} fillers` : `${m.words}/${m.min_words} words · ${m.paragraphs} paragraphs · linking: ${(m.linking_words || []).join(", ") || "none"}`}</p>
        {ai?.summary && <p style={{ color: "var(--d-text)", margin: 0 }}>{ai.summary}</p>}
        <ul className="d-list">{[...(m.tips || []), ...(ai?.tips || [])].map((x: string, k: number) => <li key={k}>{x}</li>)}</ul>
        <p className="d-note">{res.note}</p></Card>
      {ai && (ai.corrections as Row[] || []).length > 0 && <Card kicker="Corrections" title="">{(ai.corrections as Row[]).map((c, k) => <div key={k}>
        <p style={{ margin: 0, color: "var(--d-red)" }}>✗ {c.wrong}</p><p style={{ margin: 0, color: "var(--d-green)" }}>✓ {c.right}</p>{c.why && <p className="d-note">{c.why}</p>}</div>)}</Card>}
    </div>}
  </div>;
}

// =====================================================================================================================
// AI TEAM
// =====================================================================================================================

export function AiTeamPage({ token }: { token: string }) {
  const [today, setToday] = useState<Row | null>(null);
  const [workers, setWorkers] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState("");
  const n = useNote();
  const load = useCallback(() => {
    Promise.all([call<Row>("/workers/today", token), call<Row[]>("/workers", token)]).then(([t, w]) => { setToday(t); setWorkers(w); }).catch(n.fail);
  }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!today || !workers) return <div className="d-empty">Loading your AI team…</div>;
  const save = (w: Row, p: Row) => call<Row>(`/workers/${w.key}`, token, patchJson(p)).then(next => setWorkers(ws => ws!.map(x => (x.key === w.key ? next : x)))).catch(n.fail);
  const run = async (key: string) => { setBusy(key); try { await call(`/workers/${key}/run`, token, postJson({})); load(); } catch (e) { n.fail(e); } finally { setBusy(""); } };
  const act = (note: Row, a: Row) => call<Row>(`/workers/notes/${note.id}/act`, token, postJson({ action_id: a.id }))
    .then(out => { n.ok(out.open ? `Open “${out.open}” from the menu to continue.` : out.moved != null ? `Moved ${out.moved} task(s) to tomorrow` : out.task_id ? "Added to your tasks ✓" : "Done ✓"); load(); }).catch(n.fail);
  const rate = (note: Row, fb: "up" | "down") => call(`/workers/notes/${note.id}/feedback`, token, postJson({ feedback: note.feedback === fb ? null : fb })).then(load).catch(n.fail);
  const items: Row[] = today.items || [];
  const enabled = workers.filter(w => w.available && w.enabled).length;
  return <div className="d-dash">
    <Hero kicker="Your AI team" title="Today's" accent="notes" sub="Each helper has one job. Sakuna's code gathers the facts; with AI on, the helper writes the note in a coaching voice using only those facts. It never acts on its own: every button is yours to click."
      right={<Ring value={workers.length ? (enabled / workers.length) * 100 : 0} size={128} label={`${enabled}`} sub="helpers on"/>}/>
    {n.view}
    <div className="d-programs">{items.map(i => <article className="d-program" key={i.worker} style={i.note?.status === "new" ? { borderColor: "var(--d-green)" } : undefined}>
      <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{i.icon} {i.name}</h4>{i.note && <span className={`d-tag ${i.note.used_ai ? "green" : ""}`}>{i.note.used_ai ? "✨ AI" : "rules"}</span>}</div>
      {i.note ? <>
        <b style={{ color: "var(--d-text)" }}>{i.note.title}</b><p style={{ whiteSpace: "pre-wrap", color: "var(--d-text)" }}>{i.note.body}</p>
        <div className="d-chips">{(i.note.actions as Row[]).map(a => <button key={a.id} className={`d-chip ${a.action === "done" ? "" : "on"}`} onClick={() => void act(i.note, a)}>{a.label}</button>)}</div>
        <div className="d-row"><button className={`d-chip ${i.note.feedback === "up" ? "on" : ""}`} onClick={() => void rate(i.note, "up")}>👍</button><button className={`d-chip ${i.note.feedback === "down" ? "on" : ""}`} onClick={() => void rate(i.note, "down")}>👎</button>
          <button className="text-button" onClick={() => void run(i.worker)}>{busy === i.worker ? "Updating…" : "↻ Refresh"}</button></div>
      </> : <><p>{i.scheduled_today ? `Writes today's note at ${hhmm(i.run_time)}.` : "Not scheduled today."}</p>
        <div className="d-row"><button className="d-btn ghost" onClick={() => void run(i.worker)}>{busy === i.worker ? "Thinking…" : "Run now"}</button></div></>}
    </article>)}</div>
    <Card kicker="Settings" title="When each helper works">
      <div className="d-programs">{workers.map(w => <article className="d-program" key={w.key} style={!w.available ? { opacity: 0.55 } : undefined}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><h4>{w.icon} {w.name}</h4>
          {w.available ? <label className="d-row" style={{ color: "var(--d-text)" }}><input type="checkbox" checked={w.enabled} onChange={e => void save(w, { enabled: e.target.checked })}/> On</label> : <span className="d-tag">later phase</span>}</div>
        <p>{w.job}</p>
        {w.available && w.enabled && <>
          <label className="d-row" style={{ color: "var(--d-text)" }}>Writes at <input className="d-input" style={{ minWidth: 110, flex: "none" }} type="time" value={hhmm(w.run_time)} onChange={e => e.target.value && void save(w, { run_time: e.target.value })}/></label>
          <DayPicker value={w.days} onChange={days => void save(w, { days })}/>
          <label className="d-row" style={{ color: "var(--d-text)" }}><input type="checkbox" checked={w.use_ai} onChange={e => void save(w, { use_ai: e.target.checked })}/> ✨ Use AI for this note</label>
          {w.use_ai && <><Tabs value={String(w.daily_token_budget)} options={["1000", "3000", "6000"]} onChange={b => void save(w, { daily_token_budget: Number(b) })} labels={{ "1000": "1k tokens/day", "3000": "3k", "6000": "6k" }}/>
            <Meter value={(w.tokens_today / Math.max(1, w.daily_token_budget)) * 100} label="Used today" right={`${w.tokens_today.toLocaleString()} / ${w.daily_token_budget.toLocaleString()}`}/></>}
        </>}
      </article>)}</div>
      <p className="d-note">Notes are written by the server on schedule, so they arrive even when the apps are closed.</p>
    </Card>
  </div>;
}

// =====================================================================================================================
// INVEST (CSE)
// =====================================================================================================================

const lkr = (v: unknown) => (v == null ? "—" : `Rs ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const signed = (v: unknown, suffix = "") => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`);
const symLabel = (s: string) => { const [r, c] = String(s).split("."); return c && c[0] !== "N" ? `${r}.${c[0]}` : r; };
const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL || "";

/** Symbol box with a dropdown that tells share classes apart (COMB.N0000 voting vs COMB.X0000 non-voting). */
function SymbolPicker({ token, value, onChange }: { token: string; value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<Row[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { call<Row>(`/invest/symbols?q=${encodeURIComponent(value.trim())}`, token).then(r => { setItems(r.items || []); setHint(r.hint || null); }).catch(() => setItems([])); }, 250);
    return () => clearTimeout(t);
  }, [token, value, open]);
  const exact = items.some(i => i.symbol === value.trim().toUpperCase());
  return <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
    <input className="d-input" style={{ width: "100%", boxSizing: "border-box" }} value={value} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)}
      onChange={e => onChange(e.target.value.toUpperCase())} placeholder="Symbol or company, e.g. COMB"/>
    {open && !exact && (items.length > 0 || hint) && <div style={{ position: "absolute", zIndex: 20, left: 0, right: 0, top: "calc(100% + 4px)", background: "var(--d-card)", border: "1px solid var(--d-line)", borderRadius: 14, boxShadow: "var(--d-shadow)", overflow: "hidden" }}>
      {items.slice(0, 8).map(i => <button key={i.symbol} onMouseDown={() => { onChange(i.symbol); setOpen(false); }}
        style={{ all: "unset", boxSizing: "border-box", width: "100%", display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid var(--d-line)", color: "var(--d-text)" }}>
        <span><b>{i.symbol}</b><br/><small style={{ color: "var(--d-muted)" }}>{i.name || "—"}</small></span>
        <span className={`d-tag ${i.share_class === "N" ? "green" : "amber"}`}>{i.class_label || "share"}</span>
        <span>{i.close != null ? Number(i.close).toFixed(2) : ""}</span></button>)}
      {!items.length && hint && <p className="d-note" style={{ padding: 10 }}>{hint}</p>}
    </div>}
  </div>;
}

export function InvestPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [busy, setBusy] = useState("");
  const [symbol, setSymbol] = useState<string | null>(null);
  const [watchAdd, setWatchAdd] = useState("");
  const [trade, setTrade] = useState<Row>({ symbol: "", side: "buy", quantity: "", price: "", fees: "", trade_date: iso(new Date()) });
  const [paste, setPaste] = useState("");
  const [panel, setPanel] = useState<"" | "trade" | "paste" | "tools">("");
  const n = useNote();
  const load = useCallback(() => { call<Row>("/invest", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Loading your portfolio…</div>;
  const p = v.portfolio, idx = p.index;
  const held: Row[] = (p.items as Row[]).filter(i => Number(i.quantity) > 0);
  const alerts: Row[] = (v.alerts as Row[]).filter(a => a.status === "new");
  async function fetchCse() {
    setBusy("fetch");
    try { const out = await call<Row>("/invest/fetch", token, postJson({})); setV(out); n.ok(`CSE prices for ${out.trade_date}: ${out.saved} shares${out.new_alerts ? ` · ${out.new_alerts} rule alert(s)` : ""}`); } catch (e) { n.fail(e); } finally { setBusy(""); }
  }
  async function upload(file: File) {
    setBusy("upload");
    try {
      const form = new FormData(); form.append("file", file);
      const access = localStorage.getItem("sakuna-access") || token;
      const res = await fetch(`${API_ORIGIN}/api/v1/invest/upload`, { method: "POST", headers: { Authorization: `Bearer ${access}` }, body: form });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.detail || `Upload failed (${res.status})`);
      n.ok(`${out.kind === "trades" ? "Trades" : "Prices"}: ${out.saved} saved${out.skipped?.length ? `, ${out.skipped.length} skipped` : ""}`); load();
    } catch (e) { n.fail(e); } finally { setBusy(""); }
  }
  const saveTrade = () => call<Row>("/invest/trades", token, postJson({ ...trade, quantity: Number(trade.quantity), price: Number(trade.price), fees: Number(trade.fees || 0) }))
    .then(x => { setV(x); setPanel(""); setTrade({ ...trade, symbol: "", quantity: "", price: "", fees: "" }); n.ok("Trade recorded"); }).catch(n.fail);
  const tone = (x: unknown) => (x == null ? "plain" : Number(x) >= 0 ? "green" : "red") as "plain" | "green" | "red";
  return <div className="d-dash">
    <Hero kicker={`Portfolio · CSE${v.last_price_date ? ` · prices ${v.last_price_date}` : ""}`} title={lkr(p.value)}
      sub={<>Cost {lkr(p.cost)} · realised {signed(p.realised)} · dividends {lkr(p.dividends)}{idx && <><br/>ASPI {Number(idx.close).toLocaleString()} ({signed(idx.change_pct, "%")}) · {idx.date}</>}</>}
      right={<Donut size={140} format={lkr} center={<><b style={{ fontSize: 16 }}>{held.length}</b><small>holdings</small></>} parts={held.map(h => ({ label: symLabel(h.symbol), value: Number(h.value || 0) }))}/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        <button className="d-btn" disabled={busy === "fetch"} onClick={() => void fetchCse()}>{busy === "fetch" ? "Reading CSE…" : "↻ Fetch CSE prices"}</button>
        <label className="d-btn ghost" style={{ cursor: "pointer" }}>{busy === "upload" ? "Uploading…" : "⬆ CSV / Excel"}<input type="file" accept=".csv,.xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }}/></label>
        <button className="d-btn ghost" onClick={() => setPanel(panel === "paste" ? "" : "paste")}>📋 Paste</button>
        <button className="d-btn ghost" onClick={() => setPanel(panel === "trade" ? "" : "trade")}>＋ Add trade</button>
        <button className="d-btn ghost" onClick={() => setPanel(panel === "tools" ? "" : "tools")}>📊 Review · 📄 ATrad PDF · ＋ Share</button>
      </div>
    </Hero>
    {n.view}
    <div className="d-stats">
      <Stat label="Today" icon="📈" value={signed(p.day_change)} tone={tone(p.day_change)}/>
      <Stat label="Unrealised" icon="💹" value={signed(p.unrealised_pct, "%")} tone={tone(p.unrealised)} hint={signed(p.unrealised)}/>
      <Stat label="Total return" icon="🏆" value={signed(p.total_return)} tone={tone(p.total_return)}/>
      <Stat label="Rule alerts" icon="🔔" value={alerts.length} tone={alerts.length ? "amber" : "plain"}/>
    </div>
    {panel === "trade" && <Card kicker="Record a trade" title="What you did at your broker" action={<button className="d-btn ghost" onClick={() => setPanel("")}>Close</button>}>
      <Tabs value={trade.side} options={["buy", "sell", "dividend"]} onChange={side => setTrade({ ...trade, side })}/>
      <div className="d-row"><SymbolPicker token={token} value={trade.symbol} onChange={symbol => setTrade({ ...trade, symbol })}/>
        <input className="d-input" type="number" value={trade.quantity} onChange={e => setTrade({ ...trade, quantity: e.target.value })} placeholder={trade.side === "dividend" ? "Shares that received it" : "Quantity"}/>
        <input className="d-input" type="number" value={trade.price} onChange={e => setTrade({ ...trade, price: e.target.value })} placeholder={trade.side === "dividend" ? "Dividend per share" : "Price per share"}/>
        {trade.side !== "dividend" && <input className="d-input" type="number" value={trade.fees} onChange={e => setTrade({ ...trade, fees: e.target.value })} placeholder="Fees"/>}
        <input className="d-input" type="date" value={trade.trade_date} onChange={e => setTrade({ ...trade, trade_date: e.target.value })}/></div>
      <div className="d-row"><button className="d-btn" disabled={!trade.symbol || !trade.quantity || !trade.price} onClick={() => void saveTrade()}>Save trade</button><span className="d-note">Sakuna never places orders.</span></div>
    </Card>}
    {panel === "paste" && <Card kicker="Paste from Excel" title="Rows with a header row" action={<button className="d-btn ghost" onClick={() => setPanel("")}>Close</button>}>
      <textarea className="d-input" rows={8} value={paste} onChange={e => setPaste(e.target.value)} placeholder={"Symbol\tLTP\nJKH\t21.50"}/>
      <div className="d-row"><button className="d-btn" disabled={paste.trim().length < 5} onClick={() => void call<Row>("/invest/import-text", token, postJson({ text: paste }))
        .then(o => { n.ok(`${o.kind === "trades" ? "Trades" : "Prices"}: ${o.saved} saved`); setPaste(""); setPanel(""); load(); }).catch(n.fail)}>Import</button></div>
    </Card>}
    {panel === "tools" && <PortfolioTools token={token} onChanged={load}/>}
    {held.length > 0 && <Card kicker="Holdings · today and since you bought" title="Value, gain/loss and break-even after fees"><HoldingsTable items={held}/></Card>}
    {held.length > 0 && <PortfolioInsights token={token}/>}
    {alerts.length > 0 && <Card kicker="Rule alerts" title="From your own rules" action={<button className="text-button" onClick={() => void call("/invest/alerts/seen", token, postJson({})).then(load)}>Mark seen</button>}>
      {alerts.map(a => <button key={a.id} className="text-button" style={{ textAlign: "left" }} onClick={() => setSymbol(a.symbol)}>🔔 {a.message}</button>)}<p className="d-note">{v.disclaimer}</p></Card>}
    <div className="d-grid-2">
      <Card kicker={`Holdings · ${held.length}`} title="Your shares">
        {held.length ? held.map(h => <button key={h.symbol} className="d-biggest" style={{ all: "unset", display: "grid", gridTemplateColumns: "38px 1fr auto", gap: 12, alignItems: "center", cursor: "pointer" }} onClick={() => setSymbol(h.symbol)}>
          <i style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--d-card2)", fontStyle: "normal", fontSize: 11, fontWeight: 800, color: "var(--d-text)" }}>{symLabel(h.symbol).slice(0, 5)}</i>
          <div><b style={{ color: "var(--d-text)" }}>{lkr(h.value)}</b><small style={{ display: "block", color: "var(--d-muted)" }}>{Number(h.quantity).toLocaleString()} @ {h.avg_cost} · now {h.price ?? "—"} · {Math.round(h.weight_pct)}% of portfolio</small></div>
          <em style={{ fontStyle: "normal", fontWeight: 800, color: Number(h.unrealised) >= 0 ? "var(--d-green)" : "var(--d-red)" }}>{signed(h.unrealised_pct, "%")}</em></button>)
          : <div className="d-empty">No holdings yet. Add a trade or upload your broker's trade history.</div>}
      </Card>
      <Card kicker="Watchlist" title="Your rules">
        {(v.watchlist as Row[]).map(w => <button key={w.symbol} className="text-button" style={{ textAlign: "left", display: "grid", gap: 2 }} onClick={() => setSymbol(w.symbol)}>
          <span><b>{symLabel(w.symbol)}</b> {w.held && <span className="d-tag green">held</span>} {w.price ?? "—"} <span style={{ color: Number(w.change_pct) >= 0 ? "var(--d-green)" : "var(--d-red)" }}>{signed(w.change_pct, "%")}</span></span>
          <small style={{ color: "var(--d-muted)" }}>{[w.target_buy != null && `buy ≤ ${w.target_buy}`, w.stop_loss != null && `stop ${w.stop_loss}`, w.take_profit != null && `take ${w.take_profit}`, w.pe != null && `P/E ${w.pe}`, w.yield_pct != null && `yield ${w.yield_pct}%`].filter(Boolean).join(" · ") || "No rules yet: click to set"}</small>
          {(w.signals as Row[]).map(sg => <small key={sg.rule} style={{ color: "var(--d-amber)" }}>● {sg.text}</small>)}</button>)}
        <div className="d-row"><SymbolPicker token={token} value={watchAdd} onChange={setWatchAdd}/>
          <button className="d-btn" disabled={!watchAdd.trim()} onClick={() => void call(`/invest/watch/${encodeURIComponent(watchAdd.trim())}`, token, putJson({})).then(() => { setSymbol(watchAdd.includes(".") ? watchAdd.trim() : `${watchAdd.trim()}.N0000`); setWatchAdd(""); load(); }).catch(n.fail)}>Watch</button></div>
        <p className="d-note">{v.disclaimer}</p>
      </Card>
    </div>
    {symbol && <SymbolDetail token={token} symbol={symbol} watch={(v.watchlist as Row[]).find(w => w.symbol === symbol)} holding={held.find(h => h.symbol === symbol)} onClose={() => { setSymbol(null); load(); }} note={n}/>}
  </div>;
}

function SymbolDetail({ token, symbol, watch, holding, onClose, note }: { token: string; symbol: string; watch?: Row; holding?: Row; onClose: () => void; note: { ok: (t: string) => void; fail: (e: unknown) => void } }) {
  const [d, setD] = useState<Row | null>(null);
  const [rules, setRules] = useState<Row>(() => Object.fromEntries(["sector", "target_buy", "stop_loss", "take_profit", "max_pe", "min_yield", "eps", "dps"].map(k => [k, watch?.[k] != null ? String(watch[k]) : ""])));
  const load = useCallback((ai = false) => { call<Row>(`/invest/symbols/${encodeURIComponent(symbol)}${ai ? "?ai=true" : ""}`, token).then(setD).catch(note.fail); }, [token, symbol, note.fail]);
  useEffect(() => { load(); }, [load]);
  const hist: Row[] = d?.history || [];
  const save = () => { const body: Row = {}; for (const [k, val] of Object.entries(rules)) body[k] = k === "sector" ? (String(val).trim() || null) : (String(val).trim() === "" ? null : Number(val));
    void call(`/invest/watch/${encodeURIComponent(symbol)}`, token, putJson(body)).then(() => note.ok("Rules saved")).catch(note.fail); };
  const LABELS: [string, string][] = [["target_buy", "Buy at or below"], ["stop_loss", "Stop-loss"], ["take_profit", "Take profit"], ["sector", "Sector"], ["eps", "EPS (annual)"], ["max_pe", "Max P/E"], ["dps", "Dividend / share"], ["min_yield", "Min yield %"]];
  return <Card kicker={symbol} title={symLabel(symbol)} action={<button className="d-btn ghost" onClick={onClose}>Close</button>}>
    {holding && <p style={{ color: "var(--d-text)", margin: 0 }}>{Number(holding.quantity).toLocaleString()} shares · {lkr(holding.value)} · avg {holding.avg_cost} · unrealised {signed(holding.unrealised)} ({signed(holding.unrealised_pct, "%")})</p>}
    {hist.length > 1 && <LineChart series={[{ name: "Close", values: hist.map(h => Number(h.close)) }]} labels={hist.map(h => String(h.date).slice(5))} height={150} format={x => x.toFixed(2)}/>}
    <div className="d-grid-2">
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{LABELS.map(([k, label]) => <label key={k} style={{ display: "grid", gap: 4, color: "var(--d-muted)", fontSize: 12 }}>{label}
          <input className="d-input" value={rules[k]} onChange={e => setRules({ ...rules, [k]: e.target.value })} placeholder="—"/></label>)}</div>
        <div className="d-row"><button className="d-btn" onClick={save}>Save rules</button>
          {watch && <button className="danger-link" onClick={() => { if (window.confirm(`Remove ${symLabel(symbol)} from your watchlist?`)) void call(`/invest/watch/${encodeURIComponent(symbol)}`, token, { method: "DELETE" }).then(onClose).catch(note.fail); }}>Remove from watchlist</button>}</div>
      </div>
      <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--d-text)" }}>News and research</b><button className="text-button" onClick={() => load(true)}>✨ Summarise</button></div>
        {d?.research?.ai && <><p style={{ margin: 0, color: "var(--d-text)" }}>{d.research.ai.summary}</p>
          {(d.research.ai.positives as string[]).map(x => <small key={x} style={{ color: "var(--d-green)" }}>＋ {x}</small>)}{(d.research.ai.risks as string[]).map(x => <small key={x} style={{ color: "var(--d-red)" }}>− {x}</small>)}</>}
        {((d?.research?.news as Row[]) || []).map(nw => <a key={nw.url} href={/^https?:\/\//.test(nw.url) ? nw.url : undefined} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)" }}>• {nw.title}</a>)}
        {d && !(d.research.news as Row[]).length && <p className="d-note">No recent stories about this company in your news feeds.</p>}
        <p className="d-note">{d?.research?.disclaimer}</p>
      </div>
    </div>
  </Card>;
}

// =====================================================================================================================
// NEWS DIGEST
// =====================================================================================================================

const SECTIONS: [string, string][] = [["lanka", "🇱🇰 Sri Lanka and CSE markets"], ["tech", "🤖 AI and tech"], ["learn", "💡 Worth learning"]];
const TOPICS = ["ai", "tech", "sri_lanka", "markets", "learning", "other"];
const ago = (s: string) => { const h = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 3600000)); return h < 1 ? "just now" : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
const safeUrl = (u: string) => (/^https?:\/\//.test(u) ? u : undefined);

export function NewsPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState("");
  const [feed, setFeed] = useState({ name: "", url: "", topic: "tech" });
  const n = useNote();
  const load = useCallback(() => { call<Row>("/news", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Loading your news…</div>;
  const d = v.digest;
  async function refresh() {
    setBusy(true);
    try { const o = await call<Row>("/news/refresh", token, postJson({})); n.ok(`${o.added} new stor${o.added === 1 ? "y" : "ies"}${o.errors?.length ? ` · ${o.errors.length} feed(s) didn't answer` : ""}`); load(); } catch (e) { n.fail(e); } finally { setBusy(false); }
  }
  const act = (id: string, a: "save" | "task" | "dismiss") => call(`/news/items/${id}/${a}`, token, postJson({})).then(() => { n.ok(a === "save" ? "Saved to your second brain 🧠" : a === "task" ? "Added as a learning task 📚" : "Hidden"); load(); }).catch(n.fail);
  const setInterests = (list: string[]) => call("/news/interests", token, putJson({ interests: list })).then(load).catch(n.fail);
  const digestIds = new Set(((d?.items as Row[]) || []).map(e => e.id));
  const more: Row[] = (v.items as Row[]).filter(i => !digestIds.has(i.id)).slice(0, 20);
  const bySource = Object.entries((v.items as Row[]).reduce((acc: Record<string, number>, i) => { const k = i.source || "other"; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return <div className="d-dash">
    <Hero kicker={`Today's digest${d ? ` · ${new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "long" })}` : ""}${d?.used_ai ? " · ✨ AI" : ""}`} title="News that" accent="matters to you" sub={d?.intro || "No digest yet. Click Refresh."}
      right={<Donut size={130} format={x => String(x)} center={<><b style={{ fontSize: 18 }}>{(v.items as Row[]).length}</b><small>stories</small></>} parts={bySource.map(([label, value]) => ({ label, value }))}/>}>
      <div className="d-row" style={{ marginTop: 12 }}><button className="d-btn" disabled={busy} onClick={() => void refresh()}>{busy ? "Refreshing feeds…" : "↻ Refresh now"}</button>{v.refreshing && <span className="d-note">Fetching in the background…</span>}</div>
    </Hero>
    {n.view}
    <div className="d-programs">{d && SECTIONS.map(([key, title]) => { const part = (d.items as Row[]).filter(e => e.section === key); if (!part.length) return null;
      return <Card key={key} kicker={title} title="">{part.map(e => <div key={e.id} style={{ display: "grid", gap: 4, paddingBottom: 10, borderBottom: "1px solid var(--d-line)" }}>
        <a href={safeUrl(e.url)} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)", fontWeight: 700 }}>{e.title}</a>
        <small className="d-note">{e.source}</small>{e.why && <small style={{ color: "var(--d-green)" }}>→ {e.why}</small>}
        <div className="d-row"><button className="text-button" onClick={() => void act(e.id, "save")}>🧠 Save</button><button className="text-button" onClick={() => void act(e.id, "task")}>📚 Learn</button><button className="text-button" onClick={() => void act(e.id, "dismiss")}>Hide</button></div>
      </div>)}{key === "lanka" && <p className="d-note">Market stories are news, not buy or sell advice.</p>}</Card>; })}</div>
    <div className="d-grid-3">
      <Card kicker="More stories" title="Ranked for you">{more.length ? more.map(i => <div key={i.id} className="d-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <a href={safeUrl(i.url)} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)", flex: 1 }}>{i.title}<br/><small className="d-note">{i.source || ""} · {ago(i.published_at)}{i.status === "saved" ? " · saved" : ""}</small></a>
        <button className="text-button" onClick={() => void act(i.id, "save")}>🧠</button><button className="danger-link" onClick={() => void act(i.id, "dismiss")}>✕</button></div>) : <div className="d-empty">No stories yet. Click Refresh.</div>}</Card>
      <div className="d-dash" style={{ marginBottom: 0 }}>
        <Card kicker="Your interests" title="">
          <div className="d-chips">{(v.interests as string[]).map(t => <button key={t} className="d-chip on" onClick={() => void setInterests((v.interests as string[]).filter(x => x !== t))}>{t} ✕</button>)}</div>
          <div className="d-row"><input className="d-input" value={interest} onChange={e => setInterest(e.target.value)} placeholder="Add a topic, e.g. Flutter" maxLength={40}/>
            <button className="d-btn" onClick={() => { if (interest.trim().length >= 2) { void setInterests([...(v.interests as string[]), interest.trim()]); setInterest(""); } }}>Add</button></div>
        </Card>
        <Card kicker={`Feeds · ${(v.sources as Row[]).filter(x => x.active).length} on`} title="">
          {(v.sources as Row[]).map(s => <label key={s.id} className="d-row" style={{ color: "var(--d-text)", justifyContent: "space-between" }}>
            <span>{s.name}<br/><small className="d-note">{s.last_error ? `⚠ ${s.last_error}` : s.last_fetched_at ? `updated ${ago(s.last_fetched_at)}` : "not fetched yet"}</small></span>
            <input type="checkbox" checked={s.active} onChange={e => void call(`/news/sources/${s.id}`, token, patchJson({ active: e.target.checked })).then(load).catch(n.fail)}/></label>)}
          <input className="d-input" value={feed.name} onChange={e => setFeed({ ...feed, name: e.target.value })} placeholder="Feed name"/>
          <input className="d-input" value={feed.url} onChange={e => setFeed({ ...feed, url: e.target.value })} placeholder="https://…/feed (RSS or Atom)"/>
          <Tabs value={feed.topic} options={TOPICS} onChange={topic => setFeed({ ...feed, topic })}/>
          <div className="d-row"><button className="d-btn" onClick={() => void call("/news/sources", token, postJson(feed)).then(() => { setFeed({ name: "", url: "", topic: "tech" }); n.ok("Feed added"); load(); }).catch(n.fail)}>Add feed</button></div>
        </Card>
      </div>
    </div>
  </div>;
}

// =====================================================================================================================
// ABOUT YOU
// =====================================================================================================================

const EVIDENCE: Record<string, string> = { strong: "green", some: "amber", early: "" };
export function AboutYouPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [reports, setReports] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const n = useNote();
  const load = useCallback(() => { Promise.all([call<Row>("/you", token), call<Row[]>("/you/reports", token)]).then(([y, r]) => { setV(y); setReports(r); }).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <div className="d-empty">Reading your last four weeks…</div>;
  const p = v.profile, change = v.change, latest = v.latest_report;
  const write = async () => { setBusy(true); try { await call("/you/report", token, postJson({})); n.ok("This week's report is ready"); load(); } catch (e) { n.fail(e); } finally { setBusy(false); } };
  const keep = (r: Row) => call<Row>(`/you/reports/${r.id}/memory`, token, postJson({})).then(o => n.ok(`${o.saved} pattern(s) saved to memory${o.skipped?.length ? ` · ${o.skipped.length} sensitive skipped` : ""}`)).catch(n.fail);
  const focus = Object.entries(p.focus.by_weekday as Record<string, number>);
  const energy = Object.entries(p.energy_by_weekday as Record<string, number>);
  return <div className="d-dash">
    <Hero kicker="About you · last 28 days" title={p.data_days ? `${p.data_days} days` : "Just getting"} accent={p.data_days ? "of your own data" : "started"}
      sub="Sakuna learns from your routines, focus, sleep, check-ins, study and your 👍/👎. Patterns appear only with enough evidence. No AI is retrained on your life; it all stays in your account and you can read every bit."
      right={<Ring value={Math.min(100, (p.data_days / 28) * 100)} size={128} label={`${p.data_days}`} sub="of 28 days"/>}/>
    {n.view}
    {change && <Card kicker="One change for next week" title={change.title}><p style={{ margin: 0, color: "var(--d-text)" }}><b>Why:</b> {change.why}</p><p style={{ margin: 0, color: "var(--d-text)" }}><b>How:</b> {change.how}</p></Card>}
    <div className="d-grid-3">
      <Card kicker="Focus" title="Average minutes by weekday"><Bars data={focus.map(([day, m]) => ({ label: day.slice(0, 3), value: m }))} height={150} format={x => `${Math.round(x)}m`}/>
        {p.focus.best_hours && <p className="d-note">Best hours: {p.focus.best_hours.from}–{p.focus.best_hours.to}</p>}</Card>
      <Card kicker="Patterns" title="What the data says">{(v.findings as Row[]).length ? (v.findings as Row[]).map((f, i) => <div key={i} className="d-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", color: "var(--d-text)" }}>
        <span>{f.text}</span><span className={`d-tag ${EVIDENCE[f.evidence] || ""}`}>{f.evidence}</span></div>) : <div className="d-empty">Not enough data yet; patterns appear after about a week.</div>}</Card>
    </div>
    <div className="d-grid-2">
      {(p.routines as Row[]).length > 0 && <Card kicker="Routines" title="Done / due">{(p.routines as Row[]).map((r, i) => <Meter key={r.name} label={`${r.icon} ${r.name}`} color={SERIES[i % SERIES.length]} value={r.rate * 100} right={`${r.done}/${r.due}`}/>)}</Card>}
      <Card kicker="Sleep and energy" title="">
        {p.sleep.effect && <p style={{ margin: 0, color: "var(--d-text)" }}>After short nights (&lt;6.5 h): {p.sleep.effect.focus_after_short} min focus · after good sleep: {p.sleep.effect.focus_after_good} min</p>}
        {energy.length > 0 ? <Bars data={energy.map(([day, x]) => ({ label: day.slice(0, 3), value: x, color: "var(--d-violet)" }))} height={110} format={x => x.toFixed(1)}/> : <p className="d-note">Do the daily check-in to see energy by weekday.</p>}
        {(p.study as Row[]).filter(x => x.planned).map(x => <Meter key={x.exam} label={x.exam === "ielts" ? "🇬🇧 IELTS" : "🇩🇪 German"} value={Math.min(100, (x.ratio || 0) * 100)} right={`${x.done}/${x.planned} min`} color="var(--d-blue)"/>)}
        {(p.avoid as Row[]).map(a => <p key={a.name} className="d-note">{a.name}: slipped {a.slips} of {a.logged} logged days{a.worst_day ? ` (mostly ${a.worst_day}s)` : ""}</p>)}
      </Card>
    </div>
    <Card kicker={`Weekly report${latest?.used_ai ? " · ✨ AI" : latest ? " · rules" : ""}`} title={latest ? `Week of ${new Date(`${latest.week_start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}` : "Not written yet"}
      action={<div className="d-row"><button className="d-btn" disabled={busy} onClick={() => void write()}>{busy ? "Writing…" : "Write this week's report"}</button>{latest && <button className="d-btn ghost" onClick={() => void keep(latest)}>Save to memory</button>}</div>}>
      {latest ? <p className="d-plan" style={{ margin: 0 }}>{latest.body}</p> : <p className="d-note">The weekly reviewer writes it every Sunday at 18:00.</p>}
      {reports.length > 1 && <div className="d-chips">{reports.slice(1).map(r => <button key={r.id} className="d-chip" onClick={() => setV({ ...v, latest_report: r })}>Week of {new Date(`${r.week_start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}</button>)}</div>}
      <p className="d-note">{v.preferences ? `From your 👍/👎: ${v.preferences}.` : "Rate the AI team's notes with 👍/👎 so helpers adapt."} AI answers reused {v.cache.hits} times, saving about {Number(v.cache.tokens_saved).toLocaleString()} tokens.</p>
    </Card>
  </div>;
}

export type { ReactNode };
