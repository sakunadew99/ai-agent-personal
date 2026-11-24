"use client";
/* Role-play coach (soft-skills academy) and the next vision pages for the web. */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
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
  const [saving, setSaving] = useState(""); const [rate, setRate] = useState(""); const [goalYears, setGoalYears] = useState(15);
  const [hours, setHours] = useState("8"); const [budget, setBudget] = useState("10000");
  const [note, setNote] = useState("");
  const loadM = useCallback((yrs: number = goalYears) => {
    const q = [saving && `monthly_saving_lkr=${Number(saving)}`, rate && `usd_lkr=${Number(rate)}`, `target_years=${yrs}`].filter(Boolean).join("&");
    call<Row>(`/money/million${q ? `?${q}` : ""}`, token).then(x => { setM(x); setRate(r => r || String(x.usd_lkr)); setSaving(s => s || String(x.monthly_saving_lkr)); }).catch(e => setNote(errText(e)));
  }, [token, saving, rate, goalYears]);
  const loadO = useCallback(() => { call<Row>(`/opportunities?hours=${Number(hours) || 8}&budget_lkr=${Number(budget) || 0}`, token).then(setO).catch(e => setNote(errText(e))); }, [token, hours, budget]);
  useEffect(() => { loadM(); loadO(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const goal = (x: Row) => void call<Row>("/dreams/propose", token, postJson({ dream: `Start ${x.title}`, horizon: "month", ai: false })).then(plan => {
    if (window.confirm(`Create a 1-month goal "Start ${x.title}" with first step: ${x.first}?`)) void call("/dreams/accept", token, postJson({ ...plan, next_action: x.first })).then(() => { setNote("Goal created."); loadO(); });
  });
  return <div className="d-dash">
    <Hero kicker="$1M financial freedom journey" title={m ? usd(m.current_usd) : "…"} accent="today" sub={m ? `≈ Rs ${Number(m.current_lkr).toLocaleString()} at ${m.usd_lkr} (${m.rate_source}). ${m.disclaimer}` : ""}
      right={m && <Ring value={Math.max(1, m.progress_pct)} size={120} label={`${m.progress_pct < 1 ? m.progress_pct.toFixed(2) : Math.round(m.progress_pct)}%`} sub="of $1M"/>}>
      <div className="d-row" style={{ marginTop: 10 }}><label className="d-note">Monthly saving (LKR)<input className="d-input" value={saving} onChange={e => setSaving(e.target.value)}/></label>
        <label className="d-note">LKR per USD<input className="d-input" value={rate} onChange={e => setRate(e.target.value)}/></label><button className="d-btn" onClick={() => loadM()}>↻ Recalculate</button></div>
    </Hero>
    {note && <p className="d-note">{note}</p>}
    {m && <div className="d-grid-2">
      <Card kicker="Scenarios" title="Years to $1M">{(m.scenarios as Row[]).map(s => <p key={s.key}><b>{s.label}</b>: {s.years_to_target != null ? `${s.years_to_target} years` : "not within 50 years"}
        <br/><small className="d-note">{s.return_pct}% return · savings +{s.saving_growth_pct}%/year · need {usd(s.needed_monthly_usd["15"])}/month to get there in 15 years</small></p>)}</Card>
      {m.roadmap && <Card kicker={`Roadmap · ${m.roadmap.scenario}`} title={`$1M in ${m.roadmap.target_years} years`}
        action={<div className="d-chips">{[10, 15, 20, 25].map(y => <button key={y} className={`d-chip ${goalYears === y ? "on" : ""}`} onClick={() => { setGoalYears(y); loadM(y); }}>{y}y</button>)}</div>}>
        <p className="d-note">On-track saving now: {usd(m.roadmap.needed_monthly_usd)}/month (Rs {Number(m.roadmap.needed_monthly_lkr).toLocaleString()}); you: {usd(m.roadmap.your_monthly_usd)}/month.</p>
        {(m.roadmap.steps as Row[]).map(st => <div key={st.year} style={{ borderTop: "1px solid var(--d-line)", padding: "6px 0" }}>
          <b>Year {st.year}</b> <span style={{ color: st.status === "on track" ? "var(--d-green)" : "var(--d-amber)", fontWeight: 800 }}>{st.status}</span>
          <br/><small className="d-note">On track {usd(st.on_track_usd)} (Rs {Number(st.on_track_lkr).toLocaleString()}) · your path {usd(st.your_path_usd)} · save {usd(st.save_per_month_usd)}/month · income ≈ {usd(st.income_per_month_usd_at_30pct)}/month at 30% saved</small>
          <br/><small className="d-note">{(st.focus as string[]).join(" · ")}</small></div>)}
        <p className="d-note">{m.roadmap.how}</p></Card>}
      <Card kicker="Actions" title="Daily · weekly · monthly · yearly">{Object.entries(m.actions as Record<string, string[]>).map(([k, v]) => <p key={k} className="d-note"><b style={{ textTransform: "capitalize" }}>{k}:</b> {v.join(" · ")}</p>)}</Card>
    </div>}
    <Card kicker="Income ideas" title="Ranked for your skills, time and budget" action={<div className="d-row"><input className="d-input" style={{ width: 80 }} value={hours} onChange={e => setHours(e.target.value)} title="hours/week"/>
      <input className="d-input" style={{ width: 110 }} value={budget} onChange={e => setBudget(e.target.value)} title="budget LKR"/><button className="d-btn ghost" onClick={loadO}>Rank</button></div>}>
      {o?.focus_warning && <p className="d-note" style={{ color: "var(--d-amber)" }}>⚠ {o.focus_warning}</p>}
      {(o?.items as Row[] || []).map(x => <div key={x.id} style={{ borderTop: "1px solid var(--d-line)", padding: "8px 0" }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--d-text)" }}>{x.title}</b><span style={{ color: x.fit >= 70 ? "var(--d-green)" : "var(--d-amber)", fontWeight: 800 }}>{x.fit}% fit</span></div>
        <small className="d-note">{x.what} · Rs {Number(x.cost_lkr).toLocaleString()} · {x.hours} h/week · {x.income}</small><br/>
        <small className="d-note">✓ {(x.why as string[]).join(" · ")} · Risks: {(x.risks as string[]).join(", ")}</small><br/>
        <small style={{ color: x.risk === "high_risk" ? "var(--d-amber)" : "var(--d-green)", fontWeight: 700 }}>{x.risk === "high_risk" ? "⚠ Higher risk" : "🌱 Beginner-friendly"}</small>
        <small className="d-note"> · competition {x.competition} · learn ≈ {x.learn_weeks} weeks · first income ≈ {x.first_income_weeks} weeks</small><br/>
        <button className="text-button" onClick={() => goal(x)}>🎯 Make it a goal (first: {x.first})</button></div>)}
    </Card>
  </div>;
}

export function FitnessGuidePage({ token }: { token: string }) {
  const [tab, setTab] = useState<"today" | "library" | "meals">("today");
  const [plans, setPlans] = useState<Row[]>([]);
  const [plan, setPlan] = useState("full_body");
  const [today, setToday] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [muscle, setMuscle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Row>({ weight_kg: "75", goal: "lose", budget_lkr_day: "", diet: [] as string[], allergies: [] as string[], have: "" });
  const [meal, setMeal] = useState<Row | null>(null);
  const [day, setDay] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => { call<Row>("/exercises", token).then(x => { setPlans(x.plans); setItems(x.items); }).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { call<Row>(`/exercises/today?plan=${plan}`, token).then(setToday).catch(() => undefined); }, [token, plan]);
  useEffect(() => { if (tab === "library") call<Row>(`/exercises${muscle ? `?muscle=${muscle}` : ""}`, token).then(x => setItems(x.items)).catch(() => undefined); }, [token, tab, muscle]);
  const card = (e: Row) => <div key={e.name} style={{ borderTop: "1px solid var(--d-line)", padding: "8px 0" }}>
    <button className="text-button" style={{ width: "100%", textAlign: "left" }} onClick={() => setOpen(open === e.name ? null : e.name)}><b style={{ color: "var(--d-text)" }}>{e.name}</b> · {e.sets} × {e.reps} <small className="d-note">({(e.muscles as string[]).join(", ")})</small></button>
    {open === e.name && <div className="d-note"><ol>{(e.technique as string[]).map((t, i) => <li key={i}>{t}</li>)}</ol>
      <p style={{ color: "var(--d-amber)" }}>Mistakes: {(e.mistakes as string[]).join(" · ")}</p><p>Easier: {e.easier} · rest {e.rest_s}s · <a href={e.video_search} target="_blank" rel="noreferrer">▶ Watch how (YouTube search)</a></p></div>}</div>;
  const make = () => {
    const body: Row = { weight_kg: Number(f.weight_kg), goal: f.goal, diet: f.diet, allergies: f.allergies,
      have: String(f.have || "").split(",").map((x: string) => x.trim()).filter(Boolean) };
    if (Number(f.budget_lkr_day) > 0) body.budget_lkr_day = Number(f.budget_lkr_day);
    void call<Row>("/nutrition/plan", token, postJson(body)).then(setMeal).catch(e => setNote(errText(e)));
  };
  return <div className="d-dash">
    <Hero kicker="Fitness guide" title="Stronger," accent="leaner, safer" sub="Workout plans with technique and a Sri Lankan meal planner that fits your budget. Not medical advice."/>
    <div className="d-chips">{(["today", "library", "meals"] as const).map(t => <button key={t} className={`d-chip ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>{{ today: "🏋️ Today", library: "📖 Exercises", meals: "🥗 Meals" }[t]}</button>)}</div>
    {note && <p className="d-note">{note}</p>}
    {tab === "today" && <Card kicker={today?.plan || "Plan"} title={today?.rest_day ? "😌 Rest day" : `Workout ${today?.workout || ""}`}
      action={<select className="d-input" value={plan} onChange={e => setPlan(e.target.value)}>{plans.map(p => <option key={p.key} value={p.key}>{p.title}</option>)}</select>}>
      {today?.rest_day ? <p className="d-note">{today.tip} Next workout: {today.next_day}.</p> : <>{(today?.exercises as Row[] || []).map(card)}<p className="d-note">{today?.tip}</p></>}</Card>}
    {tab === "library" && <Card kicker="Exercise library" title={`${items.length} exercises`} action={<select className="d-input" value={muscle} onChange={e => setMuscle(e.target.value)}>
      {["", "chest", "back", "shoulders", "quads", "glutes", "hamstrings", "biceps", "triceps", "core", "cardio"].map(m => <option key={m} value={m}>{m || "All muscles"}</option>)}</select>}>{items.map(card)}</Card>}
    {tab === "meals" && <>
      <Card kicker="Your details" title="7-day Sri Lankan meal plan">
        <div className="d-row"><label className="d-note">Weight kg<input className="d-input" value={f.weight_kg} onChange={e => setF({ ...f, weight_kg: e.target.value })}/></label>
          <label className="d-note">Budget/day LKR<input className="d-input" value={f.budget_lkr_day} onChange={e => setF({ ...f, budget_lkr_day: e.target.value })} placeholder="optional"/></label>
          <select className="d-input" value={f.goal} onChange={e => setF({ ...f, goal: e.target.value })}><option value="lose">Lose fat</option><option value="maintain">Maintain</option><option value="gain">Build muscle</option></select></div>
        <div className="d-chips">{["vegetarian", "pescatarian", "no_egg", "no_dairy"].map(x => <button key={x} className={`d-chip ${(f.diet as string[]).includes(x) ? "on" : ""}`}
          onClick={() => setF({ ...f, diet: (f.diet as string[]).includes(x) ? (f.diet as string[]).filter(y => y !== x) : [...f.diet, x] })}>{x.replace("_", " ")}</button>)}</div>
        <p className="d-note">Allergies (foods that usually contain them are removed):</p>
        <div className="d-chips">{["peanut", "egg", "milk", "fish", "gluten", "soy", "coconut"].map(x => <button key={x} className={`d-chip ${(f.allergies as string[]).includes(x) ? "on" : ""}`}
          onClick={() => setF({ ...f, allergies: (f.allergies as string[]).includes(x) ? (f.allergies as string[]).filter(y => y !== x) : [...f.allergies, x] })}>{(f.allergies as string[]).includes(x) ? "⚠ " : ""}{x}</button>)}</div>
        <input className="d-input" value={f.have} onChange={e => setF({ ...f, have: e.target.value })} placeholder="Already at home (rice, eggs, dhal…), used first"/>
        <button className="d-btn" onClick={make}>🥗 Make my week</button></Card>
      {meal && <div className="d-grid-2">
        <Card kicker={`${meal.targets.kcal} kcal · ${meal.targets.protein_g} g protein (${meal.targets.method})`} title={(meal.days as Row[])[day].day}
          action={<div className="d-chips">{(meal.days as Row[]).map((d, i) => <button key={d.day} className={`d-chip ${day === i ? "on" : ""}`} onClick={() => setDay(i)}>{d.day.slice(0, 3)}</button>)}</div>}>
          {((meal.days as Row[])[day].meals as Row[]).map(m => <p key={m.slot}><b style={{ textTransform: "capitalize" }}>{m.slot}</b> <small className="d-note">({m.kcal} kcal · {m.protein_g} g)</small><br/>
            {(m.items as Row[]).map(it => `${it.qty !== 1 ? `${it.qty} × ` : ""}${it.name}`).join(" · ")}</p>)}
          {meal.budget_note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{meal.budget_note}</p>}{meal.targets.floor_note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{meal.targets.floor_note}</p>}
          {meal.protein_note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{meal.protein_note}</p>}
          {(meal.using_from_home as string[])?.length > 0 && <p className="d-note">Using from home: {(meal.using_from_home as string[]).join(", ")}</p>}
          {meal.allergy_note && <p className="d-note" style={{ color: "var(--d-red)" }}>{meal.allergy_note}</p>}</Card>
        <Card kicker="Shopping list" title={`≈ Rs ${Number(meal.week_cost_lkr).toLocaleString()} / week`}>{(meal.shopping as Row[]).map(s => <p key={s.item} className="d-note">{s.at_home ? "🏠 " : ""}{s.item}: {s.portions} × {s.portion} · {s.at_home ? "at home" : `Rs ${Number(s.cost_lkr).toLocaleString()}`}</p>)}
          <p className="d-note">{meal.note}</p></Card>
      </div>}
    </>}
  </div>;
}

const NEXT_STATUS: Record<string, string> = { idea: "scripted", scripted: "recorded", recorded: "published" };

export function ContentPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/content", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const patch = (id: string, body: Row) => void call(`/content/${id}`, token, { method: "PATCH", body: JSON.stringify(body) }).then(load).catch(e => setNote(errText(e)));
  if (!v) return <div className="d-empty">Loading your studio…</div>;
  return <div className="d-dash">
    <Hero kicker="Content studio" title={`${v.stats.published_this_week}`} accent="published this week" sub={`${v.stats.weekly_streak ? `🔥 ${v.stats.weekly_streak}-week streak · ` : ""}${v.how}`}/>
    {note && <p className="d-note">{note}</p>}
    <div className="d-grid-2">
      <Card kicker="This week" title="Schedule">{(v.schedule as Row[]).map(s => <p key={s.day} className="d-note"><b>{s.day}</b> · {s.item ? `${s.item.title} (${s.item.status})` : s.format}</p>)}</Card>
      <Card kicker="Ideas" title="From your goals and skills">{(v.ideas as Row[]).map((i, k) => <div key={k} className="d-row" style={{ justifyContent: "space-between" }}>
        <span>{i.title} <small className="d-note">({i.format})</small></span>
        <button className="text-button" onClick={() => void call("/content", token, postJson({ title: i.title, platform: i.platform, topic: i.topic })).then(load)}>＋ Add</button></div>)}</Card>
    </div>
    <Card kicker="Pipeline" title={`${(v.items as Row[]).length} pieces`}>{(v.items as Row[]).map(it => <div key={it.id} style={{ borderTop: "1px solid var(--d-line)", padding: "8px 0" }}>
      <div className="d-row" style={{ justifyContent: "space-between" }}><button className="text-button" onClick={() => { setOpen(open === it.id ? null : it.id); setDraft(it.script || ""); }}><b>{it.title}</b></button>
        <span className="d-row"><span className="d-note">{it.status}</span>{NEXT_STATUS[it.status] && <button className="d-btn ghost" onClick={() => patch(it.id, { status: NEXT_STATUS[it.status] })}>→ {NEXT_STATUS[it.status]}</button>}
          <button className="danger-link" onClick={() => { if (window.confirm("Delete?")) void call(`/content/${it.id}`, token, { method: "DELETE" }).then(load); }}>✕</button></span></div>
      {open === it.id && <><textarea className="d-input" rows={8} value={draft} onChange={e => setDraft(e.target.value)}/>
        <div className="d-row"><button className="d-btn" onClick={() => patch(it.id, { script: draft })}>💾 Save</button>
          <button className="d-btn ghost" onClick={() => void call<Row>(`/content/${it.id}/script`, token, postJson({})).then(x => { setDraft(x.script); load(); }).catch(e => setNote(errText(e)))}>✨ AI script</button></div></>}
    </div>)}</Card>
  </div>;
}

export function TravelPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [plan, setPlan] = useState<Row | null>(null);
  const [form, setForm] = useState({ days: "3", people: "2", tier: "budget" });
  const [sel, setSel] = useState<Row | null>(null);
  const load = useCallback(() => { call<Row>(`/travel${month ? `?month=${month}` : ""}`, token).then(x => { setV(x); setMonth(m => m || x.month); }).catch(() => undefined); }, [token, month]);
  useEffect(() => { load(); }, [load]);
  const go = (d: Row) => { setSel(d); void call<Row>(`/travel/plan?key=${d.key}&days=${Number(form.days) || 3}&tier=${form.tier}&people=${Number(form.people) || 1}`, token).then(setPlan); };
  if (!v) return <div className="d-empty">Loading destinations…</div>;
  return <div className="d-dash">
    <Hero kicker="Travel guide" title={`${v.done}`} accent="places explored" sub="Estimates to plan with; check prices before booking. Trips abroad link to official travel advice.">
      <div className="d-row" style={{ marginTop: 10 }}>
        <select className="d-input" value={month ?? ""} onChange={e => setMonth(Number(e.target.value))}>{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <input className="d-input" style={{ width: 70 }} value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} title="days"/>
        <input className="d-input" style={{ width: 70 }} value={form.people} onChange={e => setForm({ ...form, people: e.target.value })} title="people"/>
        <select className="d-input" value={form.tier} onChange={e => setForm({ ...form, tier: e.target.value })}><option value="budget">Budget</option><option value="mid">Mid-range</option><option value="luxury">Luxury</option></select></div>
    </Hero>
    {plan && sel && <div className="d-grid-2">
      <Card kicker={`${plan.days} days · ${plan.tier}`} title={plan.destination}>{(plan.itinerary as Row[]).map(d => <p key={d.day} className="d-note"><b>Day {d.day}:</b> {(d.plan as string[]).join(" · ")}</p>)}
        {plan.budget_lkr ? Object.entries(plan.budget_lkr as Record<string, number>).map(([k, n]) => <p key={k} className="d-note" style={{ fontWeight: k === "total" ? 800 : 400 }}>{k.replace(/_/g, " ")}: Rs {Number(n).toLocaleString()}</p>)
          : <p className="d-note"><b>Total ≈ Rs {Number(plan.total_lkr).toLocaleString()}</b> (${plan.budget_usd.total}; {plan.local_currency.code} {Number(plan.local_currency.total).toLocaleString()}) · {plan.visa}</p>}
        <p className="d-note"><a href={plan.maps.directions} target="_blank" rel="noreferrer">🗺 Directions</a>{plan.advisory && <> · <a href={plan.advisory} target="_blank" rel="noreferrer">🛡 Official travel advice</a></>}</p>
        <button className="d-btn" onClick={() => void call("/travel/wishes", token, postJson({ destination: sel.name, key: sel.key, days: Number(form.days) || 3, people: Number(form.people) || 1, tier: form.tier, budget_lkr: plan.budget_lkr?.total ?? plan.total_lkr })).then(load)}>⭐ Add to wish list</button></Card>
      <Card kicker="Map" title={plan.destination}><iframe title="map" src={plan.maps.embed} style={{ width: "100%", height: 300, border: 0, borderRadius: 12 }}/></Card>
      {plan.safety && <Card kicker={`Safety & emergency · ${plan.safety.country}`} title="Save these numbers">
        <div className="d-chips">{(plan.safety.emergency as Row[]).map(e => <span key={e.label} className="d-chip on"><b>{e.number}</b> {e.label}</span>)}</div>
        {(plan.safety.tips as string[]).map(t => <p key={t} className="d-note">• {t}</p>)}
        <p className="d-note">{plan.safety.insurance} <a href={plan.safety.official_advice} target="_blank" rel="noreferrer">Official travel advice (FCDO)</a></p>
        <p className="d-note">Source: {plan.safety.source}. Checked {plan.safety.checked}. {plan.safety.method}</p></Card>}
      {plan.stay_type && <Card kicker="Where you'll stay" title={`${plan.stay_type.label} stays`}><p>{plan.stay_type.examples}</p><p className="d-note">{plan.stay_type.expect}</p>
        {Object.entries(plan.stay_types as Record<string, Row>).filter(([k]) => k !== plan.tier).map(([k, t]) => <p key={k} className="d-note"><b>{t.label}:</b> {t.examples}</p>)}</Card>}
    </div>}
    {(v.wishes as Row[]).length > 0 && <Card kicker="Wish list" title={`${(v.wishes as Row[]).length} places`}>{(v.wishes as Row[]).map(w => <p key={w.id} className="d-note">
      {w.status === "done" ? "✅" : w.status === "planned" ? "📅" : "⭐"} {w.destination} · {w.days}d · {w.tier}{" "}
      <button className="text-button" onClick={() => void call(`/travel/wishes/${w.id}`, token, { method: "PATCH", body: JSON.stringify({ status: w.status === "wish" ? "planned" : "done" }) }).then(load)}>{w.status === "wish" ? "Plan" : "Done"}</button>
      <button className="danger-link" onClick={() => void call(`/travel/wishes/${w.id}`, token, { method: "DELETE" }).then(load)}>✕</button></p>)}</Card>}
    <div className="d-grid-2">{(v.destinations as Row[]).map(d => <Card key={d.key} kicker={`${d.region}${d.good_now ? " · ✓ good now" : ""}`} title={d.name}>
      <p className="d-note">{(d.highlights as string[]).join(" · ")}</p><button className="d-btn ghost" onClick={() => go(d)}>Plan this trip</button></Card>)}</div>
  </div>;
}

export function ResourcesPage({ token }: { token: string }) {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("beginner");
  const [r, setR] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const find = (ai = false) => { if (topic.trim().length < 2) return;
    void call<Row>(`/resources?topic=${encodeURIComponent(topic.trim())}&level=${level}${ai ? "&ai=true" : ""}`, token).then(setR).catch(e => setNote(errText(e))); };
  return <div className="d-dash">
    <Hero kicker="Learn anything · trusted resources" title="What do you" accent="want to learn?" sub="Real search links on reliable sites and a Wikipedia summary. Nothing made up.">
      <div className="d-row" style={{ marginTop: 10 }}><input className="d-input" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => { if (e.key === "Enter") find(); }} placeholder="e.g. swimming, pandas, German A1"/>
        <select className="d-input" value={level} onChange={e => setLevel(e.target.value)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select>
        <button className="d-btn" onClick={() => find()}>🔎 Find</button></div>
    </Hero>
    {note && <p className="d-note">{note}</p>}
    {r && <div className="d-grid-2">
      <Card kicker={`${r.category} · ${r.level}`} title={r.topic}>{(r.items as Row[]).map(i => <p key={i.kind}><b>{i.kind}:</b> <a href={i.url} target="_blank" rel="noreferrer">{i.label}</a><br/><small className="d-note">{i.why}</small></p>)}
        <p style={{ color: "var(--d-green)", fontWeight: 800 }}>Next: {r.next_action}</p><p className="d-note">{r.note}</p></Card>
      <Card kicker="Summary" title={r.summary ? r.summary.title : "No summary found"}>{r.summary && <><p>{r.summary.summary}</p><a href={r.summary.url} target="_blank" rel="noreferrer">Read on Wikipedia</a></>}
        {r.ai_note ? <pre className="d-plan">{r.ai_note}</pre> : <button className="d-btn ghost" onClick={() => find(true)}>✨ What should I learn first?</button>}</Card>
    </div>}
  </div>;
}

export function ReadingPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [q, setQ] = useState(""); const [found, setFound] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [hl, setHl] = useState({ quote: "", page: "" });
  const [note, setNote] = useState("");
  const [reader, setReader] = useState<{ b: Row; at: number } | null>(null);
  const [link, setLink] = useState("");
  const load = useCallback(() => { call<Row>("/reading", token).then(setV).catch(e => setNote(errText(e))); }, [token]);
  const closeReader = () => {
    if (reader) { const mins = Math.round((Date.now() - reader.at) / 60000); if (mins >= 1) void call<Row>(`/reading/books/${reader.b.id}/progress`, token, postJson({ minutes: Math.min(600, mins) })).then(setV); }
    setReader(null);
  };
  const read = (b: Row) => { if (b.is_folder) window.open(b.read_url, "_blank"); else setReader({ b, at: Date.now() }); };
  useEffect(() => { load(); }, [load]);
  const add = (b: Row, status: string) => void call("/reading/books", token, postJson({ title: b.title, author: b.author || "", total_pages: b.pages || undefined, cover_url: b.cover_url || undefined, source_key: b.source_key || undefined, status }))
    .then(() => { setFound(null); setQ(""); load(); }).catch(e => setNote(errText(e)));
  const progress = (b: Row, body: Row) => void call<Row>(`/reading/books/${b.id}/progress`, token, postJson(body)).then(setV).catch(e => setNote(errText(e)));
  const patch = (b: Row, body: Row) => void call<Row>(`/reading/books/${b.id}`, token, { method: "PATCH", body: JSON.stringify(body) }).then(x => { setOpen(o => (o && o.id === x.id ? x : o)); load(); });
  if (!v) return <div className="d-empty">Loading your shelf…</div>;
  const yr = v.year;
  return <div className="d-dash">
    <Hero kicker="Reading" title={`${yr.finished}${yr.goal ? `/${yr.goal}` : ""}`} accent="books this year" sub={`${v.streak ? `🔥 ${v.streak}-day streak · ` : ""}${v.week_pages} pages this week${v.pace_pages_per_day ? ` · ${v.pace_pages_per_day}/day` : ""}`}
      right={<Ring value={yr.goal ? Math.min(100, yr.finished / yr.goal * 100) : 0} size={120} label={yr.goal ? `${Math.round(yr.finished / yr.goal * 100)}%` : "—"} sub="year goal"/>}>
      <div className="d-row" style={{ marginTop: 10 }}><input className="d-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Search books (Open Library)"
        onKeyDown={e => { if (e.key === "Enter") void call<Row>(`/reading/search?q=${encodeURIComponent(q)}`, token).then(x => setFound(x.items)); }}/>
        <select className="d-input" value={yr.goal || ""} onChange={e => void call<Row>("/reading/goal", token, { method: "PUT", body: JSON.stringify({ books_per_year: Number(e.target.value) || null, daily_minutes: v.daily_minutes || 20 }) }).then(setV)}>
          <option value="">Yearly goal</option>{[6, 12, 24, 36, 52].map(n => <option key={n} value={n}>{n} books</option>)}</select></div>
    </Hero>
    {note && <p className="d-note">{note}</p>}
    {found && <Card kicker="Search results" title={`${found.length} books`}>{found.map((b, i) => <div key={i} className="d-row" style={{ justifyContent: "space-between" }}>
      <span>{b.cover_url && <img src={b.cover_url} alt="" style={{ height: 48, borderRadius: 4, verticalAlign: "middle", marginRight: 8 }}/>}<b>{b.title}</b> <small className="d-note">{b.author} {b.year ? `· ${b.year}` : ""} {b.pages ? `· ${b.pages} p` : ""}</small></span>
      <span><button className="text-button" onClick={() => add(b, "reading")}>📖 Reading</button><button className="text-button" onClick={() => add(b, "want")}>Want</button></span></div>)}</Card>}
    <div className="d-grid-2">{(v.books as Row[]).filter(b => b.status === "reading").map(b => <Card key={b.id} kicker={`${b.percent ?? 0}%${b.finish_forecast ? ` · done by ${b.finish_forecast}` : ""}`} title={b.title}>
      <p className="d-note">{b.author} · page {b.current_page}{b.total_pages ? ` of ${b.total_pages}` : ""}</p>
      <div className="d-row"><button className="d-btn" onClick={() => progress(b, { pages: 10 })}>+10 pages</button><button className="d-btn ghost" onClick={() => { const p = window.prompt("Page reached?", String(b.current_page)); if (p) progress(b, { to_page: Number(p) }); }}>Set page</button>
        <button className="d-btn ghost" onClick={() => setOpen(b)}>Highlights</button>{b.read_url && <button className="d-btn" onClick={() => read(b)}>{b.is_folder ? "📁 Folder" : "📄 Read"}</button>}</div></Card>)}</div>
    {reader && <div role="dialog" style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.88)", display: "grid", gridTemplateRows: "auto 1fr", padding: 12, gap: 8 }}>
      <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "#fff" }}>📄 {reader.b.title}</b>
        <span className="d-row"><button className="d-btn ghost" onClick={() => { const p = window.prompt("Page reached?", String(reader.b.current_page)); if (p) void call<Row>(`/reading/books/${reader.b.id}/progress`, token, postJson({ to_page: Number(p) })).then(setV); }}>Set page</button>
          <button className="d-btn" onClick={closeReader}>✕ Close</button></span></div>
      <iframe title={reader.b.title} src={reader.b.read_url} style={{ width: "100%", height: "100%", border: 0, borderRadius: 12, background: "#fff" }} allow="fullscreen"/>
    </div>}
    {open && <Card kicker="Highlights & takeaways" title={open.title} action={<button className="text-button" onClick={() => setOpen(null)}>Close</button>}>
      {(open.highlights as Row[]).map((h, i) => <p key={i}><i>“{h.quote}”</i> <small className="d-note">{h.page != null ? `p. ${h.page}` : ""}</small></p>)}
      <div className="d-row"><input className="d-input" value={hl.quote} onChange={e => setHl({ ...hl, quote: e.target.value })} placeholder="Quote"/><input className="d-input" style={{ width: 80 }} value={hl.page} onChange={e => setHl({ ...hl, page: e.target.value })} placeholder="Page"/>
        <button className="d-btn" onClick={() => void call<Row>(`/reading/books/${open.id}/highlights`, token, postJson({ quote: hl.quote, page: Number(hl.page) || undefined })).then(x => { setOpen(x); setHl({ quote: "", page: "" }); })}>Save</button></div>
      <div className="d-row">{[1, 2, 3, 4, 5].map(n => <button key={n} className="text-button" style={{ fontSize: 20, color: n <= (open.rating || 0) ? "var(--d-amber)" : "var(--d-muted)" }} onClick={() => patch(open, { rating: n })}>★</button>)}
        <button className="d-btn ghost" onClick={() => patch(open, { status: "finished" })}>✅ Finished</button></div>
      <div className="d-row"><input className="d-input" value={link} onChange={e => setLink(e.target.value)} placeholder={open.file_url ? "Change e-book link" : "📎 Google Drive link to the PDF"}/>
        <button className="d-btn ghost" disabled={!link.trim()} onClick={() => { patch(open, { file_url: link.trim() }); setLink(""); }}>Save link</button>
        {open.read_url && <button className="d-btn" onClick={() => read(open)}>📄 Read</button>}</div>
      <p className="d-note">In Drive: Share → “Anyone with the link” → Copy link. The PDF opens in Drive's viewer here.</p></Card>}
    <div className="d-grid-2">
      <Card kicker="Shelf" title="Want to read · finished">{(v.books as Row[]).filter(b => b.status !== "reading").map(b => <p key={b.id} className="d-note">{b.status === "finished" ? "✅" : b.status === "paused" ? "⏸" : "📚"} <b>{b.title}</b> · {b.author}{b.rating ? ` · ${"★".repeat(b.rating)}` : ""}
        {b.status === "want" && <button className="text-button" onClick={() => patch(b, { status: "reading" })}>Start</button>}</p>)}</Card>
      <Card kicker="Books for your goals" title="Real, well-known books">{(v.suggestions as Row[]).map(s => <p key={s.title} className="d-note"><b>{s.title}</b> · {s.author}<br/>{s.why} <button className="text-button" onClick={() => add(s, "want")}>＋ Want</button></p>)}</Card>
    </div>
  </div>;
}

const NBG: Record<string, string> = { default: "var(--d-card2)", green: "#123222", blue: "#13243a", amber: "#3a2f1d", red: "#3a2222", violet: "#261d3a", pink: "#3a1d2f", teal: "#123333" };

export function NotesPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [q, setQ] = useState(""); const [tag, setTag] = useState("");
  const [ed, setEd] = useState<Row | null>(null);
  const load = useCallback(() => { const p = [q && `q=${encodeURIComponent(q)}`, tag && `tag=${encodeURIComponent(tag)}`].filter(Boolean).join("&");
    call<Row>(`/notes${p ? `?${p}` : ""}`, token).then(setV).catch(() => undefined); }, [token, q, tag]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  const save = () => { if (!ed) return; const body = { title: ed.title || "", body: ed.body || "", tags: String(ed.tagsText ?? (ed.tags || []).join(", ")).split(",").map((s: string) => s.trim()).filter(Boolean), color: ed.color || "default", pinned: !!ed.pinned };
    void (ed.id ? call(`/notes/${ed.id}`, token, { method: "PATCH", body: JSON.stringify(body) }) : call("/notes", token, postJson(body))).then(() => { setEd(null); load(); }); };
  if (!v) return <div className="d-empty">Loading notes…</div>;
  return <div className="d-dash">
    <Hero kicker="Notes" title="Your" accent="notebook" sub="Checklists with “- [ ] ”, tags, colours and pins. Notes also appear in Search.">
      <div className="d-row" style={{ marginTop: 10 }}><input className="d-input" value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Search notes"/>
        <button className="d-btn" onClick={() => setEd({ title: "", body: "", color: "default" })}>＋ New note</button></div>
      <div className="d-chips">{["", ...(v.tags as string[])].map(t => <button key={t || "all"} className={`d-chip ${tag === t ? "on" : ""}`} onClick={() => setTag(t)}>{t ? `#${t}` : "All"}</button>)}</div>
    </Hero>
    {ed && <Card kicker={ed.id ? "Edit note" : "New note"} title={ed.title || "Untitled"} action={<button className="text-button" onClick={() => setEd(null)}>Cancel</button>}>
      <input className="d-input" value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="Title"/>
      <textarea className="d-input" rows={10} value={ed.body} onChange={e => setEd({ ...ed, body: e.target.value })} placeholder="Write… use “- [ ] ” for checklist items"/>
      <input className="d-input" value={ed.tagsText ?? (ed.tags || []).join(", ")} onChange={e => setEd({ ...ed, tagsText: e.target.value })} placeholder="Tags, comma separated"/>
      <div className="d-chips">{(v.colors as string[]).map(c => <button key={c} className={`d-chip ${ed.color === c ? "on" : ""}`} style={{ background: NBG[c] }} onClick={() => setEd({ ...ed, color: c })}>{c}</button>)}
        <button className={`d-chip ${ed.pinned ? "on" : ""}`} onClick={() => setEd({ ...ed, pinned: !ed.pinned })}>📌 Pin</button></div>
      <div className="d-row"><button className="d-btn" onClick={save}>💾 Save</button>
        {ed.id && <button className="danger-link" onClick={() => { if (window.confirm("Delete this note?")) void call(`/notes/${ed.id}`, token, { method: "DELETE" }).then(() => { setEd(null); load(); }); }}>Delete</button>}</div></Card>}
    <div style={{ columns: "260px", columnGap: 14 }}>{(v.items as Row[]).map(n => <article key={n.id} className="d-card" style={{ breakInside: "avoid", marginBottom: 14, background: NBG[n.color] || NBG.default, cursor: "pointer" }} onClick={() => setEd(n)}>
      <b style={{ color: "var(--d-text)" }}>{n.pinned ? "📌 " : ""}{n.title}</b>
      {(n.body as string).split("\n").slice(0, 10).map((ln, i) => { const t = ln.trimStart(); const box = t.startsWith("- [ ]") || t.toLowerCase().startsWith("- [x]");
        return box ? <label key={i} className="d-note" style={{ display: "block" }} onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={t[3].toLowerCase() === "x"} onChange={() => void call(`/notes/${n.id}/toggle/${i}`, token, postJson({})).then(load)}/> {t.slice(5)}</label>
          : ln.trim() ? <p key={i} className="d-note" style={{ margin: "2px 0" }}>{ln}</p> : null; })}
      {(n.tags as string[]).length > 0 && <small className="d-note">{(n.tags as string[]).map(t => `#${t}`).join(" ")}</small>}</article>)}</div>
  </div>;
}

export function KegelPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [run, setRun] = useState<{ phases: { label: string; secs: number; squeeze: boolean }[]; i: number; left: number } | null>(null);
  const load = useCallback(() => { call<Row>("/wellness/kegel", token).then(x => { setV(x); setLevel(l => l ?? x.level); }).catch(() => undefined); }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!run || run.i >= run.phases.length) return;
    const t = setInterval(() => setRun(r => !r ? r : r.left > 1 ? { ...r, left: r.left - 1 } : { ...r, i: r.i + 1, left: r.phases[r.i + 1]?.secs ?? 0 }), 1000);
    return () => clearInterval(t);
  }, [run]);
  if (!v || level == null) return <div className="d-empty">Loading…</div>;
  const cfg: Row = v.levels[String(level)];
  const start = () => { const ph = [{ label: "Get ready: relax, breathe", secs: 3, squeeze: false }];
    for (let k = 0; k < cfg.reps; k++) ph.push({ label: `Squeeze & lift · ${k + 1}/${cfg.reps}`, secs: cfg.hold_s, squeeze: true }, { label: "Relax fully", secs: cfg.relax_s, squeeze: false });
    for (let k = 0; k < cfg.quick_flicks; k++) ph.push({ label: `Quick squeeze · ${k + 1}/${cfg.quick_flicks}`, secs: 1, squeeze: true }, { label: "Let go", secs: 1, squeeze: false });
    setRun({ phases: ph, i: 0, left: 3 }); };
  const p = run && run.phases[Math.min(run.i, run.phases.length - 1)];
  const finished = run && run.i >= run.phases.length;
  const g: Row = v.guide;
  return <div className="d-dash">
    <Hero kicker="Pelvic floor · Kegel trainer" title={`${v.today.sets}/${v.today.target}`} accent="sets today" sub={`Level ${level}: ${cfg.name} · hold ${cfg.hold_s}s, relax ${cfg.relax_s}s × ${cfg.reps}${cfg.quick_flicks ? ` + ${cfg.quick_flicks} quick` : ""}${v.streak ? ` · 🔥 ${v.streak} days` : ""}`}
      right={<Ring value={Math.min(100, v.today.sets / v.today.target * 100)} size={120} label={v.today.done ? "✓" : `${v.today.sets}`} sub="today"/>}>
      <div className="d-chips" style={{ marginTop: 10 }}>{[1, 2, 3, 4].map(n => <button key={n} className={`d-chip ${level === n ? "on" : ""}`} onClick={() => setLevel(n)}>L{n} {v.levels[String(n)].name}</button>)}</div>
      {!run && <button className="d-btn" style={{ marginTop: 10 }} onClick={start}>▶ Start a set</button>}
    </Hero>
    {v.ready_for_next && <p className="d-note" style={{ color: "var(--d-green)" }}>⭐ {v.good_days_7} good days this week: try level {v.level + 1} if it feels easy.</p>}
    {run && p && <Card kicker={finished ? "Done" : "Follow the circle"} title={finished ? "🎉 Set complete" : p.label}>
      {!finished ? <div style={{ display: "grid", placeItems: "center", padding: 20 }}><div style={{ width: p.squeeze ? 220 : 150, height: p.squeeze ? 220 : 150, borderRadius: "50%", transition: "all 1s ease",
        border: `4px solid ${p.squeeze ? "var(--d-green)" : "var(--d-blue)"}`, display: "grid", placeItems: "center", fontSize: 56, fontWeight: 900 }}>{run.left}</div>
        <p className="d-note">{p.squeeze ? "Lift inward, keep breathing, stomach and buttocks relaxed" : "Let go completely"}</p>
        <button className="d-btn ghost" onClick={() => setRun(null)}>Stop</button></div>
        : <div className="d-row"><button className="d-btn" onClick={() => void call<Row>("/wellness/kegel/sessions", token, postJson({ level, sets: 1 })).then(x => { setV(x); setRun(null); })}>✓ Save this set</button>
          <button className="d-btn ghost" onClick={() => setRun(null)}>Close</button></div>}</Card>}
    <div className="d-grid-2">
      <Card kicker="How to do it right" title="Technique">
        <p>{g.what}</p><ul className="d-list">{(g.find as string[]).map((t, i) => <li key={i}>{t}</li>)}</ul>
        <ol>{(g.how as string[]).map((t, i) => <li key={i}>{t}</li>)}</ol>
        <p className="d-note" style={{ color: "var(--d-amber)" }}>Mistakes: {(g.mistakes as string[]).join(" · ")}</p><p className="d-note">{g.frequency}</p></Card>
      <Card kicker="Safety, videos and reliable reading" title="Learn more">
        <ul className="d-list">{(g.safety as string[]).map((t, i) => <li key={i}>{t}</li>)}</ul>
        {(v.resources as Row[]).map(r => <p key={r.url} className="d-note"><b>{r.kind}:</b> <a href={r.url} target="_blank" rel="noreferrer">{r.label}</a></p>)}
        <p className="d-note">{v.disclaimer}</p></Card>
    </div>
  </div>;
}


const DISC_TINT = "#8f7bff";
const EVENT_LABEL: Record<string, string> = { ok: "Doing well", urge: "Urge", motivation: "Motivation", reset: "Reset" };

export function DisciplinePage({ token }: { token: string }) {
  const [d, setD] = useState<Row | null>(null);
  const [sel, setSel] = useState("");
  const [mode, setMode] = useState<"" | "urge" | "reset" | "new">("");
  const [trigger, setTrigger] = useState("");
  const [intensity, setIntensity] = useState(3);
  const [noteText, setNoteText] = useState("");
  const [reply, setReply] = useState<Row | null>(null);
  const [left, setLeft] = useState(0);
  const [form, setForm] = useState({ kind: "porn_free", label: "", reasons: "", days: "0", reps: "" });
  const [err, setErr] = useState("");
  const load = useCallback(() => { call<Row>("/discipline", token).then(x => { setD(x); setSel(s => s || x.goals[0]?.id || ""); if (!x.goals.length) setMode("new"); }).catch(e => setErr(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(s => s - 1), 1000); return () => clearTimeout(t); }, [left]);
  if (!d) return <div className="d-empty">Loading…</div>;
  const goals = d.goals as Row[]; const g = goals.find(x => x.id === sel) || goals[0];
  const swap = (x: Row) => setD(v => v && ({ ...v, goals: (v.goals as Row[]).map(y => y.id === x.id ? x : y) }));
  const send = (kind: string, extra: Row = {}) => void call<Row>(`/discipline/goals/${g.id}/checkin`, token, postJson({ kind, ...extra })).then(r => {
    setReply(r); swap(r.goal); setMode(""); setNoteText(""); if (r.timer_minutes) setLeft(r.timer_minutes * 60); }).catch(e => setErr(errText(e)));
  const handled = (stayed: boolean, action?: string) => { const ev = (g.recent as Row[])[0]; if (!ev) return;
    void call(`/discipline/events/${ev.id}`, token, patchJson({ stayed, action })).then(() => { setReply(null); setLeft(0); setSel(g.id); load(); }).catch(e => setErr(errText(e))); };
  const create = () => { const s = new Date(); s.setDate(s.getDate() - Math.max(0, parseInt(form.days, 10) || 0));
    void call<Row>("/discipline/goals", token, postJson({ kind: form.kind, label: form.label.trim() || undefined, reasons: form.reasons.trim() || undefined,
      replacements: form.reps.split(",").map(x => x.trim()).filter(Boolean), started_on: s.toISOString().slice(0, 10) }))
      .then(x => { setMode(""); setSel(String(x.id)); load(); }).catch(e => setErr(errText(e))); };
  const remove = () => { if (!confirm("Remove this commitment and its check-ins?")) return; void call(`/discipline/goals/${g.id}`, token, { method: "DELETE" }).then(() => { setSel(""); load(); }).catch(e => setErr(errText(e))); };
  const b = d.blocking as Row; const next = g?.next_milestone as number | null;
  return <div className="d-dash">
    <p className="d-note">🔒 {d.privacy}</p>
    {err && <p className="d-note">{err}</p>}
    {goals.length > 1 && <div className="d-chips">{goals.map(x => <button key={x.id} className={`d-chip ${x.id === g?.id ? "on" : ""}`} onClick={() => setSel(x.id)}>{x.label}</button>)}</div>}
    {mode === "new" || !g ? <Card kicker="Start a commitment" title="One day at a time">
      <div className="d-chips">{Object.entries(d.kinds as Record<string, string>).map(([k, l]) => <button key={k} className={`d-chip ${form.kind === k ? "on" : ""}`} onClick={() => setForm({ ...form, kind: k })}>{l}</button>)}</div>
      <input className="d-input" placeholder="Name shown on screen (default: Self-control)" value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}/>
      <textarea className="d-input" rows={2} placeholder="Your why (shown when you need motivation)" value={form.reasons} onChange={e => setForm({ ...form, reasons: e.target.value })}/>
      <input className="d-input" placeholder="Already going for how many days?" value={form.days} onChange={e => setForm({ ...form, days: e.target.value })}/>
      <input className="d-input" placeholder={`Replacements, comma separated (e.g. ${(d.default_replacements as string[]).slice(0, 3).join(", ")})`} value={form.reps} onChange={e => setForm({ ...form, reps: e.target.value })}/>
      <div className="d-row"><button className="d-btn" onClick={create}>Start</button>{g && <button className="d-btn ghost" onClick={() => setMode("")}>Cancel</button>}</div>
    </Card> : <>
      <Hero kicker={`🛡 ${g.label}`} title={`${g.streak_days}`} accent={g.streak_days === 1 ? "day" : "days"} sub={`Best ${g.best_streak} · ${g.clean_days_total} good days in total${g.resets ? ` · restarted ${g.resets}×` : ""}`}
        right={<Ring value={next ? Math.min(100, g.streak_days / next * 100) : 100} size={120} label={next ? `${next}` : "🏆"} sub="next"/>}>
        <div className="d-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button className="d-btn" onClick={() => send("ok")}>😊 I&apos;m doing well</button>
          <button className="d-btn ghost" onClick={() => { setMode("urge"); setReply(null); }}>🌊 I&apos;m having an urge</button>
          <button className="d-btn ghost" onClick={() => send("motivation")}>✨ I need motivation</button>
          <button className="d-btn ghost" onClick={() => { setMode("reset"); setReply(null); }}>↺ I want to reset</button>
        </div>
      </Hero>
      {(mode === "urge" || mode === "reset") && <Card kicker={mode === "urge" ? "What's going on?" : "No guilt"} title={mode === "urge" ? "Name the trigger" : "What happened just before?"}>
        <div className="d-chips">{Object.entries(d.triggers as Record<string, string>).map(([k, l]) => <button key={k} className={`d-chip ${trigger === k ? "on" : ""}`} onClick={() => setTrigger(t => t === k ? "" : k)}>{l}</button>)}</div>
        {mode === "urge" && <div className="d-chips">{[1, 2, 3, 4, 5].map(n => <button key={n} className={`d-chip ${intensity === n ? "on" : ""}`} onClick={() => setIntensity(n)}>Strength {n}</button>)}</div>}
        <textarea className="d-input" rows={2} placeholder="Optional note for your trigger journal" value={noteText} onChange={e => setNoteText(e.target.value)}/>
        <div className="d-row"><button className="d-btn" onClick={() => send(mode, { trigger: trigger || undefined, intensity: mode === "urge" ? intensity : undefined, note: noteText.trim() || undefined })}>{mode === "urge" ? "Help me now" : "Restart my streak"}</button>
          <button className="d-btn ghost" onClick={() => setMode("")}>Cancel</button></div>
      </Card>}
      {reply && <Card kicker="Sakuna" title={reply.kind === "urge" ? "Ride it out" : reply.kind === "reset" ? "Fresh start" : "Keep going"}>
        <p>{reply.message}</p>
        {reply.your_why && <p style={{ color: DISC_TINT, fontWeight: 800 }}>Your why: {reply.your_why}</p>}
        {left > 0 && <p style={{ fontSize: 32, fontWeight: 900, color: DISC_TINT }}>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</p>}
        {(reply.suggestions as string[] | undefined)?.map(s => <button key={s} className="d-btn ghost" style={{ display: "block", marginBottom: 6 }} onClick={() => reply.kind === "urge" ? handled(true, s) : setReply(null)}>→ {s}</button>)}
        {reply.kind === "urge" && <div className="d-row"><button className="d-btn" onClick={() => handled(true)}>It passed ✓</button><button className="text-button" onClick={() => { handled(false); setMode("reset"); }}>I slipped</button></div>}
        {reply.kind !== "ok" && <p className="d-note">{reply.support}</p>}
        <button className="text-button" onClick={() => { setReply(null); setLeft(0); }}>Close</button>
      </Card>}
      <div className="d-grid-2">
        <Card kicker="Insights" title="What the data says">{(g.insights as string[]).length ? (g.insights as string[]).map((t, i) => <p key={i}>• {t}</p>) : <p className="d-note">Check in a few times and patterns will show here.</p>}
          {(g.triggers_30d as Row[]).map(t => <p key={t.trigger}>{t.label}: <b>{t.count}</b></p>)}</Card>
        <Card kicker="Milestones" title={next ? `Next: ${next} days` : "All reached 🏆"}><div className="d-chips">{(g.milestones as Row[]).map(m => <span key={m.days} className={`d-chip ${m.reached ? "on" : ""}`}>{m.reached ? "★" : "○"} {m.days}d</span>)}</div>
          <p className="d-note">My replacements: {(g.replacements as string[]).join(" · ")}</p></Card>
      </div>
      {(g.recent as Row[]).length > 0 && <Card kicker="Trigger journal" title="Recent check-ins">{(g.recent as Row[]).map(e => <p key={e.id}>
        {e.date} {String(e.hour).padStart(2, "0")}:00 · {EVENT_LABEL[e.kind]}{e.trigger ? ` · ${(d.triggers as Row)[e.trigger] || e.trigger}` : ""}{e.stayed === true ? " · handled ✓" : e.stayed === false ? " · slipped" : ""}{e.action ? ` → ${e.action}` : ""}{e.note ? ` — ${e.note}` : ""}</p>)}</Card>}
      <div className="d-row"><button className="d-btn ghost" onClick={() => setMode("new")}>＋ Another commitment</button><button className="text-button" onClick={remove}>Remove this commitment</button></div>
    </>}
    <Card kicker="Block apps & websites" title="Make it harder to slip">
      <p>{b.shield}</p><p>{b.dns_how}</p>
      {(b.dns as Row[]).map(x => <p key={x.host}><span className="d-note">{x.name}: </span><code>{x.host}</code></p>)}
    </Card>
    <p className="d-note">{d.support}</p>
  </div>;
}


const ASK_ICON: Record<string, string> = { today: "☀️", important: "🎯", week: "📈", neglecting: "🧭", next: "➡️" };

export function AskPage({ token, onOpenApprovals }: { token: string; onOpenApprovals: () => void }) {
  const [qs, setQs] = useState<Row[]>([]);
  const [q, setQ] = useState("today");
  const [a, setA] = useState<Row | null>(null);
  const [check, setCheck] = useState<Row | null>(null);
  const [err, setErr] = useState("");
  const ask = useCallback((key: string) => { setQ(key); setA(null); call<Row>(`/ask/${key}`, token).then(setA).catch(e => setErr(errText(e))); }, [token]);
  useEffect(() => { call<Row>("/ask", token).then(r => setQs(r.questions as Row[])).catch(e => setErr(errText(e))); ask("today"); }, [token, ask]);
  const [prog, setProg] = useState<Row | null>(null);
  const loadProg = useCallback(() => { call<Row>("/progress", token).then(setProg).catch(e => setErr(errText(e))); }, [token]);
  useEffect(() => { loadProg(); }, [loadProg]);
  const patchGoal = (id: string, body: Row) => void call(`/goals/${id}`, token, patchJson(body)).then(loadProg).catch(e => setErr(errText(e)));
  const runCheck = () => void call<Row>("/plan/check", token, postJson({})).then(setCheck).catch(e => setErr(errText(e)));
  const list = (a?.tasks || a?.done || []) as Row[];
  return <div className="d-dash">
    <Hero kicker="Ask Sakuna" title="Answers from" accent="your own data" sub="Plain calculations on your tasks, goals and life areas. Works without any AI key."/>
    {err && <p className="d-note">{err}</p>}
    <div className="d-chips">{qs.map(x => <button key={x.key} className={`d-chip ${q === x.key ? "on" : ""}`} onClick={() => ask(String(x.key))}>{ASK_ICON[x.key] || "•"} {x.text}</button>)}</div>
    <Card kicker="Sakuna" title={qs.find(x => x.key === q)?.text || ""}>
      <p style={{ fontSize: 18 }}>{a ? a.answer : "Thinking…"}</p>
      {list.map(t => <p key={t.id}><b>{t.title}</b> <span className="d-note">{[t.due ? `due ${t.due}` : null, t.minutes ? `${t.minutes} min` : null, ...((t.why as string[]) || [])].filter(Boolean).join(" · ")}</span></p>)}
      {((a?.items || []) as Row[]).map((i, k) => <p key={k}><b style={{ color: "var(--d-amber)" }}>{i.title}</b>{i.detail ? <span className="d-note"> · {i.detail}</span> : null}</p>)}
      {((a?.areas || []) as Row[]).filter(x => x.percent != null).map(x => <p key={x.name} className="d-note">{x.name}: {x.percent}% · {String(x.status).replaceAll("_", " ")}</p>)}
    </Card>
    {prog && (prog.goals as Row[]).length > 0 && <Card kicker="Goal progress" title="Priority, % and pace">
      {(prog.goals as Row[]).map(g => { const pct = g.progress_percent as number | null; return <div key={g.id} style={{ marginBottom: 10 }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><b>{g.title}</b>
          <button className="d-chip on" title="Change priority" onClick={() => patchGoal(g.id, { priority: ({ low: "medium", medium: "high", high: "low" } as Row)[g.priority] || "medium" })}>{g.priority}</button></div>
        <div style={{ height: 8, borderRadius: 4, background: "var(--d-card2)" }}><div style={{ width: `${pct ?? 0}%`, height: 8, borderRadius: 4, background: g.pace === "behind" ? "var(--d-amber)" : "var(--d-green)" }}/></div>
        <div className="d-row" style={{ justifyContent: "space-between" }}>
          <span className="d-note">{[pct != null ? `${pct}%` : "no % yet", g.pace ? String(g.pace).replace("_", " ") : null, g.days_left != null ? `${g.days_left} days left` : null, g.tasks_open ? `${g.tasks_open} open tasks` : null].filter(Boolean).join(" · ")}</span>
          {g.manual && <span><button className="text-button" onClick={() => patchGoal(g.id, { progress_pct: Math.max(0, (g.progress_pct ?? pct ?? 0) - 10) })}>−10%</button>
            <button className="text-button" onClick={() => patchGoal(g.id, { progress_pct: Math.min(100, (g.progress_pct ?? pct ?? 0) + 10) })}>+10%</button></span>}
        </div></div>; })}
    </Card>}
    <Card kicker="Plan check" title="Fix overdue tasks, with your approval">
      <p className="d-note">Finds overdue tasks and proposes moving each to tomorrow. Nothing changes until you approve it.</p>
      <button className="d-btn" onClick={runCheck}>🔍 Check my plan</button>
      {check && <><p>{check.message}</p>{(check.proposals as Row[]).map(p => <p key={p.id}>• {p.preview}</p>)}
        {(check.proposals as Row[]).length > 0 && <button className="d-btn ghost" onClick={onOpenApprovals}>Review in Approvals</button>}</>}
    </Card>
  </div>;
}


const rs = (n: number) => `Rs ${Math.round(Number(n)).toLocaleString()}`;

export function SportsPage({ token }: { token: string }) {
  const [list, setList] = useState<Row[]>([]);
  const [key, setKey] = useState("swimming");
  const [city, setCity] = useState("Colombo");
  const [p, setP] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => { call<Row>("/sports", token).then(r => setList(r.sports as Row[])).catch(e => setNote(errText(e))); }, [token]);
  const load = useCallback((k: string, c: string) => { call<Row>(`/sports/${k}?city=${encodeURIComponent(c || "Colombo")}`, token).then(setP).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(key, "Colombo"); }, [key, load]);
  const goal = () => { if (p && window.confirm(`Create the goal "${p.goal_plan.title}" with its milestones?`)) void call("/dreams/accept", token, postJson(p.goal_plan)).then(() => setNote("Goal created 💪")).catch(e => setNote(errText(e))); };
  return <div className="d-dash">
    <Hero kicker="Martial arts & swimming" title="From first class to" accent="a solid level" sub="Pathways, weekly schedule, gear and LKR costs, safety, and how to pick a good club."/>
    {note && <p className="d-note">{note}</p>}
    <div className="d-chips">{list.map(s => <button key={s.key} className={`d-chip ${key === s.key ? "on" : ""}`} onClick={() => setKey(String(s.key))}>{s.icon} {s.name}</button>)}</div>
    {p && <div className="d-grid-2">
      <Card kicker={p.kind} title={`${p.icon} ${p.name}`} action={<button className="d-btn" onClick={goal}>🎯 Make it a goal</button>}>
        <p>{p.what}</p><p className="d-note">Good for: {(p.good_for as string[]).join(", ")}</p>
        {(p.stages as Row[]).map((s, i) => <p key={i}><b>{i + 1}. {s.name}</b> <span className="d-note">({s.weeks}{/year|month/.test(s.weeks) ? "" : " weeks"}) · {s.focus}</span></p>)}
        <p className="d-note">A normal week: {(p.week as string[]).join(" · ")}</p></Card>
      <Card kicker="Estimates" title="Equipment & cost">
        {(p.equipment as Row[]).map(e => <p key={e.item}>{e.needed_from_day_one ? "●" : "○"} {e.item}: <span className="d-note">{rs(e.lkr_min)}–{Number(e.lkr_max).toLocaleString()}</span></p>)}
        <p>Monthly fee: <span className="d-note">{rs(p.monthly_fee_lkr.min)}–{Number(p.monthly_fee_lkr.max).toLocaleString()}</span></p>
        {p.grading_fee_lkr && <p>Grading: <span className="d-note">{rs(p.grading_fee_lkr.min)}–{Number(p.grading_fee_lkr.max).toLocaleString()}</span></p>}
        <p style={{ color: "var(--d-green)", fontWeight: 800 }}>First month: {rs(p.first_month_cost_lkr.min)} – {rs(p.first_month_cost_lkr.max)}</p><p className="d-note">{p.note}</p></Card>
      <Card kicker="Learn" title="Online or instructor?"><p>💻 {p.online_ok}</p><p>🧑‍🏫 {p.needs_instructor}</p>
        <div className="d-row"><input className="d-input" value={city} onChange={e => setCity(e.target.value)} onBlur={() => load(key, city)} placeholder="Your city"/>
          <a className="d-btn" href={p.links.find_near_you} target="_blank" rel="noreferrer">📍 Near me</a>
          <a className="d-btn ghost" href={p.links.videos} target="_blank" rel="noreferrer">▶ Videos</a></div>
        {(p.choose_a_club as string[]).map(c => <p key={c} className="d-note">✓ {c}</p>)}
        {(p.first_month as string[]).map(c => <p key={c} className="d-note">• {c}</p>)}</Card>
      <Card kicker="⚠ Safety" title="Train safely">{(p.safety as string[]).map(c => <p key={c} className="d-note">• {c}</p>)}</Card>
    </div>}
  </div>;
}

export function EnglishPage({ token }: { token: string }) {
  const [text, setText] = useState("");
  const [r, setR] = useState<Row | null>(null);
  const [note, setNote] = useState("");
  const check = (deep: boolean) => { if (text.trim()) void call<Row>("/english/check", token, postJson({ text, deep })).then(setR).catch(e => setNote(errText(e))); };
  return <div className="d-dash">
    <Hero kicker="Soft skills · English" title="Say it" accent="right" sub="Grammar corrections for anything you write or plan to say. Built-in rules; a deeper LanguageTool check when you ask."/>
    {note && <p className="d-note">{note}</p>}
    <Card kicker="Your text" title="Write a message, email or what you want to say">
      <textarea className="d-input" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="Yesterday I didn't went to office because i was sick."/>
      <div className="d-row"><button className="d-btn" onClick={() => check(false)}>✓ Check</button><button className="d-btn ghost" onClick={() => check(true)}>🔎 Deeper check</button></div>
      <p className="d-note">The deeper check sends just this text to LanguageTool (api.languagetool.org).</p></Card>
    {r && <Card kicker={r.count ? `${r.count} suggestion${r.count === 1 ? "" : "s"} · score ${r.score}` : "Looks good ✓"} title="Corrected"
      action={<button className="d-btn ghost" onClick={() => setText(String(r.corrected))}>Use corrected</button>}>
      <p style={{ fontSize: 18 }}>{r.corrected}</p>{r.note && <p className="d-note">{r.note}</p>}
      {(r.issues as Row[]).map((i, k) => <p key={k}><s style={{ color: "var(--d-red)" }}>{i.text || "∅"}</s>{i.suggestion != null && <b style={{ color: "var(--d-green)" }}> → {i.suggestion || "(remove)"}</b>} <span className="d-note">{i.message}{i.source === "languagetool" ? " · LanguageTool" : ""}</span></p>)}
    </Card>}
  </div>;
}

export function FreelancePage({ token }: { token: string }) {
  const [f, setF] = useState({ hours: "6", rate: "", level: "beginner", platform: "fiverr", complexity: "standard", revisions: "1" });
  const [est, setEst] = useState<Row | null>(null);
  const [p, setP] = useState({ job: "", skills: "", name: "", experience: "" });
  const [draft, setDraft] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const estimate = () => void call<Row>("/freelance/estimate", token, postJson({ hours: parseFloat(f.hours) || 1, rate_usd: parseFloat(f.rate) || undefined, level: f.level,
    platform: f.platform, complexity: f.complexity, revisions: parseInt(f.revisions, 10) || 0 })).then(setEst).catch(e => setNote(errText(e)));
  const write = () => void call<Row>("/freelance/proposal", token, postJson({ job: p.job, skills: p.skills.split(",").map(s => s.trim()).filter(Boolean), name: p.name,
    experience: p.experience || undefined, days: est?.delivery_days, price_usd: est ? Number(est.price_usd) : undefined })).then(r => { setDraft(String(r.text)); setChecklist(r.checklist as string[]); }).catch(e => setNote(errText(e)));
  const track = () => void call("/career/jobs", token, postJson({ company: f.platform === "direct" ? "Direct client" : f.platform[0].toUpperCase() + f.platform.slice(1),
    role: p.job.split("\n")[0].slice(0, 190) || "Freelance gig", status: "draft", notes: draft })).then(() => setNote("Saved to the Job tracker as a draft")).catch(e => setNote(errText(e)));
  const chips = (k: "level" | "platform" | "complexity", opts: string[]) => <div className="d-chips">{opts.map(o => <button key={o} className={`d-chip ${f[k] === o ? "on" : ""}`} onClick={() => setF({ ...f, [k]: o })}>{o}</button>)}</div>;
  return <div className="d-dash">
    <Hero kicker="Freelancing kit" title="Price it right," accent="pitch it well" sub="Estimates from your own hours and rate. Drafts only: Sakuna never sends, applies or automates any platform."/>
    {note && <p className="d-note">{note}</p>}
    <div className="d-grid-2">
      <Card kicker="Price estimator" title="What should I charge?">
        <div className="d-row"><input className="d-input" value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} placeholder="Hours of work"/>
          <input className="d-input" value={f.rate} onChange={e => setF({ ...f, rate: e.target.value })} placeholder="Your $/hour (optional)"/>
          <input className="d-input" value={f.revisions} onChange={e => setF({ ...f, revisions: e.target.value })} placeholder="Revisions"/></div>
        {chips("level", ["beginner", "intermediate", "expert"])}{chips("platform", ["fiverr", "upwork", "direct"])}{chips("complexity", ["simple", "standard", "complex"])}
        <button className="d-btn" onClick={estimate}>Estimate</button>
        {est && <><p style={{ fontSize: 24, fontWeight: 900, color: "var(--d-green)" }}>${est.price_usd} · {rs(est.price_lkr)}</p>
          <p className="d-note">You receive ${est.you_receive_usd} after the {est.platform_fee_pct}% fee · about {est.delivery_days} day(s) · packages ${est.packages_usd.basic} / ${est.packages_usd.standard} / ${est.packages_usd.premium}</p>
          {(est.explain as string[]).map(x => <p key={x} className="d-note">• {x}</p>)}<p className="d-note">{est.note}</p></>}
      </Card>
      <Card kicker="Proposal writer" title="A draft you edit and send yourself">
        <textarea className="d-input" rows={4} value={p.job} onChange={e => setP({ ...p, job: e.target.value })} placeholder="Paste the job or buyer request"/>
        <input className="d-input" value={p.skills} onChange={e => setP({ ...p, skills: e.target.value })} placeholder="Your skills, comma separated"/>
        <input className="d-input" value={p.experience} onChange={e => setP({ ...p, experience: e.target.value })} placeholder="One line of relevant experience"/>
        <input className="d-input" value={p.name} onChange={e => setP({ ...p, name: e.target.value })} placeholder="Your name"/>
        <button className="d-btn" disabled={p.job.trim().length < 10} onClick={write}>Write draft</button>
        {draft && <><textarea className="d-input" rows={12} value={draft} onChange={e => setDraft(e.target.value)}/>
          <div className="d-row"><button className="d-btn ghost" onClick={() => void navigator.clipboard.writeText(draft).then(() => setNote("Copied"))}>Copy</button><button className="d-btn ghost" onClick={track}>Save to Job tracker</button></div>
          {checklist.map(c => <p key={c} className="d-note">✓ {c}</p>)}</>}
      </Card>
    </div>
  </div>;
}


const BODY_KEYS = ["weight_kg", "waist_cm", "chest_cm", "hips_cm", "neck_cm", "arm_cm", "thigh_cm", "body_fat_pct"];

export function BodyPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [prof, setProf] = useState({ height_cm: "", sex: "" });
  const [note, setNote] = useState("");
  const load = useCallback(() => { call<Row>("/body", token).then(x => { setV(x); setProf(p => p.height_cm || p.sex ? p : { height_cm: x.height_cm ? String(x.height_cm) : "", sex: x.sex || "" }); }).catch(e => setNote(errText(e))); }, [token]);
  useEffect(() => { load(); }, [load]);
  const save = () => { const body: Row = {}; BODY_KEYS.forEach(k => { if (Number(form[k]) > 0) body[k] = Number(form[k]); });
    if (!Object.keys(body).length) { setNote("Enter at least one measurement"); return; }
    void call("/body/measurements", token, postJson(body)).then(() => { setForm({}); setNote("Saved 📏"); load(); }).catch(e => setNote(errText(e))); };
  const saveProf = () => void call("/body/profile", token, { method: "PUT", body: JSON.stringify({ height_cm: Number(prof.height_cm) || null, sex: prof.sex || null }) }).then(load).catch(e => setNote(errText(e)));
  const del = (id: string) => { if (window.confirm("Delete this entry?")) void call(`/body/measurements/${id}`, token, { method: "DELETE" }).then(load).catch(e => setNote(errText(e))); };
  if (!v) return <div className="d-empty">Loading…</div>;
  const ch = v.changes as Record<string, Row>; const w = ch.weight_kg, wa = ch.waist_cm;
  return <div className="d-dash">
    <Hero kicker="Body measurements" title={w ? `${w.latest}` : wa ? `${wa.latest}` : "—"} accent={w ? "kg" : wa ? "cm waist" : "start today"}
      sub={[w && `${w.since_start > 0 ? "+" : ""}${w.since_start} kg since start`, wa && `waist ${wa.since_start > 0 ? "+" : ""}${wa.since_start} cm`, v.due ? "time to measure" : null].filter(Boolean).join(" · ")}
      right={<Ring value={v.waist_to_height ? Math.min(100, Number(v.waist_to_height) / 0.7 * 100) : 0} size={120} label={v.waist_to_height ? `${v.waist_to_height}` : "—"} sub="waist / height"/>}/>
    {note && <p className="d-note">{note}</p>}
    {(v.insights as string[]).map(t => <p key={t} className="d-note">💡 {t}</p>)}
    <div className="d-grid-2">
      <Card kicker="Add today" title="Measurements">
        <div className="d-row" style={{ flexWrap: "wrap" }}>{BODY_KEYS.map(k => <label key={k} className="d-note" title={v.how_to_measure[k] || ""}>{v.labels[k]}
          <input className="d-input" style={{ width: 110 }} value={form[k] || ""} placeholder={ch[k] ? String(ch[k].latest) : ""} onChange={e => setForm({ ...form, [k]: e.target.value })}/></label>)}</div>
        <button className="d-btn" onClick={save}>Save</button><p className="d-note">{v.note} Hover a field for how to measure it.</p></Card>
      <Card kicker="Results" title={v.body_fat_estimate != null ? `Body fat ≈ ${v.body_fat_estimate}%` : "Changes"}>
        {v.body_fat_method && <p className="d-note">{v.body_fat_method}</p>}
        {Object.entries(ch).map(([k, c]) => <p key={k}><b>{c.label}</b>: {c.latest} <span className="d-note">(start {c.since_start > 0 ? "+" : ""}{c.since_start}{c.since_month != null ? `, month ${c.since_month > 0 ? "+" : ""}${c.since_month}` : ""})</span></p>)}
        <div className="d-row"><input className="d-input" style={{ width: 120 }} placeholder="Height cm" value={prof.height_cm} onChange={e => setProf({ ...prof, height_cm: e.target.value })}/>
          <select className="d-input" value={prof.sex} onChange={e => setProf({ ...prof, sex: e.target.value })}><option value="">Sex</option><option value="male">male</option><option value="female">female</option></select>
          <button className="d-btn ghost" onClick={saveProf}>Save</button></div>
        {v.missing_for_fat && <p className="d-note">{v.missing_for_fat}</p>}</Card>
    </div>
    {(v.items as Row[]).length > 0 && <Card kicker="History" title="Your check-ins">{(v.items as Row[]).slice(0, 20).map(r => <p key={r.id} className="d-note">{r.measured_on} · {BODY_KEYS.filter(k => r[k] != null).map(k => `${String(v.labels[k]).split(" (")[0].toLowerCase()} ${r[k]}`).join(", ")}
      <button className="text-button" onClick={() => del(String(r.id))}>delete</button></p>)}</Card>}
  </div>;
}


const LF_TINT: Record<string, string> = { technology: "#4fd1c5", educational: "#5aa8ff", motivational: "#f5b65b", psychology: "#b48cff" };
const LF_LABEL: Record<string, string> = { all: "All", technology: "💻 Technology", educational: "📚 Educational", motivational: "🔥 Motivation", psychology: "🧠 Psychology" };

export function LearnFeedPage({ token }: { token: string }) {
  const [res, setRes] = useState<Row | null>(null);
  const [cat, setCat] = useState("all");
  const [mine, setMine] = useState<Row[]>(() => { try { return JSON.parse(localStorage.getItem("sakuna.watchChannels") || "[]"); } catch { return []; } });
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [add, setAdd] = useState("");
  const [link, setLink] = useState({ url: "", title: "" });
  const [linkRes, setLinkRes] = useState<Row | null>(null);
  const [saved, setSaved] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const load = useCallback(async (list: Row[], useAi: boolean) => {
    setBusy(true);
    try { setRes(await call<Row>(`/learn-feed?channels=${encodeURIComponent(list.map(c => c.channel_id).join(","))}&ai=${useAi}`, token)); }
    catch (e) { setNote(errText(e)); } finally { setBusy(false); }
  }, [token]);
  const loadSaved = useCallback(() => { call<Row>("/media", token).then(m => setSaved((m.items as Row[]).filter(i => String(i.folder).startsWith("Learning")))).catch(() => undefined); }, [token]);
  useEffect(() => { void load(mine, false); loadSaved(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (next: Row[]) => { setMine(next); try { localStorage.setItem("sakuna.watchChannels", JSON.stringify(next)); } catch { /* private window */ } void load(next, ai); };
  const addChannel = () => void call<Row>(`/watch/channel?q=${encodeURIComponent(add.trim())}`, token).then(c => { keep([...mine.filter(x => x.channel_id !== c.channel_id), c].slice(0, 15)); setAdd(""); }).catch(e => setNote(errText(e)));
  const saveLink = (anyway: boolean) => void call<Row>("/learn-feed/link", token, postJson({ url: link.url.trim(), title: link.title.trim(), ai, save_anyway: anyway }))
    .then(r => { setLinkRes(r); if (r.saved) { setLink({ url: "", title: "" }); loadSaved(); } }).catch(e => setNote(errText(e)));
  const videos = ((res?.videos || []) as Row[]).filter(v => cat === "all" || v.category === cat);
  const card = (v: Row) => <a key={v.id} href={v.url} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none", border: `1px solid ${LF_TINT[v.category]}55`, borderRadius: 14, overflow: "hidden" }}>
    {v.thumb && <img src={v.thumb} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover" }}/>}
    <div style={{ padding: 10 }}><small style={{ color: LF_TINT[v.category], fontWeight: 800 }}>{LF_LABEL[v.category]} · {v.channel}</small>
      <p style={{ margin: "4px 0", color: "var(--d-text)", fontWeight: 700 }}>{v.title}</p><small className="d-note">{v.published} · {v.why}</small></div></a>;
  return <div className="d-dash">
    <Hero kicker="Learning feed" title="Only what" accent="grows you" sub="Educational, motivational and psychology videos, auto-selected from trusted channels and yours. Everything else is hidden."/>
    {note && <p className="d-note">{note}</p>}
    <div className="d-chips">{Object.keys(LF_LABEL).map(k => <button key={k} className={`d-chip ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>{LF_LABEL[k]}{k !== "all" && res ? ` ${res.counts[k]}` : ""}</button>)}
      <button className={`d-chip ${ai ? "on" : ""}`} onClick={() => { setAi(!ai); void load(mine, !ai); }}>🤖 AI check {ai ? "on" : "off"}</button>{busy && <span className="d-note">Loading…</span>}</div>
    {res && <>
      {cat === "all" && (res.picks as Row[]).length > 0 && <Card kicker="Today's picks" title="One per topic"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>{(res.picks as Row[]).map(card)}</div></Card>}
      <p className="d-note"><button className="text-button" onClick={() => setShowHidden(!showHidden)}>🚫 {res.hidden_count} hidden (not learning content) {showHidden ? "▲" : "▼"}</button></p>
      {showHidden && <Card kicker="Hidden" title="Filtered out">{(res.hidden as Row[]).map((h, i) => <p key={i} className="d-note">{h.title} · {h.channel} — {h.why}</p>)}<p className="d-note">{res.how}</p></Card>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>{videos.slice(0, 48).map(card)}</div>
    </>}
    <div className="d-grid-2">
      <Card kicker="TikTok · Facebook · Instagram" title="Save a learning clip">
        <p className="d-note">These apps don't share their feed, so paste a link and a few words about it. Only learning content is saved.</p>
        <input className="d-input" value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} placeholder="https://www.tiktok.com/@…/video/…"/>
        <input className="d-input" value={link.title} onChange={e => setLink({ ...link, title: e.target.value })} placeholder="What it's about"/>
        <button className="d-btn" disabled={link.url.trim().length < 8 || link.title.trim().length < 3} onClick={() => saveLink(false)}>Check & save</button>
        {linkRes && !linkRes.saved && <p className="d-note" style={{ color: "var(--d-amber)" }}>{linkRes.why}. {linkRes.hint}
          {!String(linkRes.why).startsWith("Hidden") && <button className="text-button" onClick={() => saveLink(true)}>Save anyway</button>}</p>}
        {saved.slice(0, 10).map(x => <p key={x.id} className="d-note"><a href={x.url} target="_blank" rel="noreferrer">▶ {x.title}</a> · {x.folder}</p>)}
      </Card>
      <Card kicker="Your channels" title="Only their learning videos show">
        <div className="d-row"><input className="d-input" value={add} onChange={e => setAdd(e.target.value)} placeholder="YouTube channel link or @handle"/><button className="d-btn" disabled={!add.trim()} onClick={addChannel}>Add</button></div>
        {mine.map(c => <p key={c.channel_id} className="d-note">{c.name} <button className="text-button" onClick={() => keep(mine.filter(x => x.channel_id !== c.channel_id))}>remove</button></p>)}
        <p className="d-note">Calmer real apps: Shield blocks TikTok/Facebook at set hours; on YouTube pause watch history; on TikTok use Content preferences; on Facebook use Feeds → Favorites.</p>
      </Card>
    </div>
  </div>;
}


export function ReelsPage({ token }: { token: string }) {
  const [items, setItems] = useState<Row[]>([]);
  const [index, setIndex] = useState(0);
  const [stats, setStats] = useState<Row | null>(null);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  const started = useRef(Date.now());
  const send = useCallback((it: Row, action: string, seconds = 0) => {
    if (it) void call("/reels/events", token, postJson({ events: [{ video_id: it.id, channel_id: it.channel_id || undefined, category: it.category, title: it.title, action, seconds: Math.round(seconds) }] })).catch(() => undefined);
  }, [token]);
  const more = useCallback(() => {
    let ch = ""; try { ch = (JSON.parse(localStorage.getItem("sakuna.watchChannels") || "[]") as Row[]).map(c => c.channel_id).join(","); } catch { /* none */ }
    call<Row>(`/reels?channels=${encodeURIComponent(ch)}`, token).then(r => { setStats(r.stats);
      setItems(prev => { const have = new Set(prev.map(p => p.id)); return [...prev, ...(r.items as Row[]).filter(i => !have.has(i.id))]; }); }).catch(e => setNote(errText(e)));
  }, [token]);
  useEffect(() => { more(); }, [more]);
  useEffect(() => { if (items.length && index >= items.length - 3) more(); }, [index, items.length, more]);
  const onScroll = () => {
    const el = box.current; if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== index && items[index]) { const secs = (Date.now() - started.current) / 1000; send(items[index], secs < 4 ? "skip" : "view", secs); started.current = Date.now(); setIndex(i); }
  };
  const like = (it: Row) => { const on = !liked[it.id]; setLiked({ ...liked, [it.id]: on }); send(it, on ? "like" : "unlike"); };
  const hide = (it: Row) => { send(it, "hide"); setItems(items.filter(x => x.id !== it.id)); };
  const src = (it: Row) => it.kind === "youtube" ? `https://www.youtube.com/embed/${it.id}?autoplay=1&playsinline=1&rel=0` : it.embed;
  return <div className="d-dash">
    <Hero kicker="Learning reels" title="Scroll," accent="but grow" sub={`Only educational, motivational and psychology videos, ranked for you. ${stats ? `${stats.minutes_week} min this week.` : ""}`}/>
    {note && <p className="d-note">{note}</p>}
    <div ref={box} onScroll={onScroll} style={{ height: "78vh", maxWidth: 460, margin: "0 auto", overflowY: "scroll", scrollSnapType: "y mandatory", borderRadius: 18, background: "#000" }}>
      {items.map((it, i) => <div key={it.id} style={{ height: "78vh", scrollSnapAlign: "start", position: "relative" }}>
        {i === index && src(it) ? <iframe title={it.title} src={src(it)} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" style={{ width: "100%", height: "100%", border: 0 }}/>
          : it.thumb ? <img src={it.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }}/> : <a href={it.url} target="_blank" rel="noreferrer" style={{ color: "#fff", display: "block", padding: 40 }}>Open ↗</a>}
        <div style={{ position: "absolute", left: 12, right: 70, bottom: 56, color: "#fff", pointerEvents: "none" }}>
          <small style={{ color: LF_TINT[it.category], fontWeight: 800 }}>{LF_LABEL[it.category]} · {it.channel}</small>
          <p style={{ margin: "4px 0", fontWeight: 800 }}>{it.title}</p><small style={{ color: "#ddd" }}>✨ {it.reason}</small></div>
        <div style={{ position: "absolute", right: 10, bottom: 70, display: "grid", gap: 12 }}>
          <button className="d-btn ghost" onClick={() => like(it)}>{liked[it.id] ? "❤️" : "🤍"}</button>
          <button className="d-btn ghost" title="Fewer like this" onClick={() => hide(it)}>👎</button>
          <a className="d-btn ghost" href={it.url} target="_blank" rel="noreferrer">↗</a></div>
      </div>)}
    </div>
    <p className="d-note" style={{ textAlign: "center" }}>Scroll inside the player for the next reel. Ranked by what you finish, like and skip, your goals, freshness and popularity.</p>
  </div>;
}


const HUB_TABS: [string, string][] = [["", "✨ For you"], ["technology", "💻 Tech"], ["educational", "📚 Learn"], ["motivational", "🔥 Motivation"], ["psychology", "🧠 Mind"]];
const hubAgo = (d?: string) => { if (!d) return ""; const n = Math.round((Date.now() - new Date(d).getTime()) / 86400000); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`; };

export function HubPage({ token }: { token: string }) {
  const [tab, setTab] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState("");
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [link, setLink] = useState({ url: "", title: "" });
  const [note, setNote] = useState("");
  const send = useCallback((it: Row, action: string, seconds = 0) => void call("/reels/events", token, postJson({ events: [{ video_id: it.id, channel_id: it.channel_id || undefined,
    category: it.category, title: it.title, action, seconds }] })).catch(() => undefined), [token]);
  const load = useCallback((t: string, more = false, shown: Row[] = []) => {
    let ch = ""; try { ch = (JSON.parse(localStorage.getItem("sakuna.watchChannels") || "[]") as Row[]).map(c => c.channel_id).join(","); } catch { /* none */ }
    const ex = more ? shown.map(i => i.id).slice(-120).join(",") : "";
    setBusy(true);
    call<Row>(`/hub?channels=${encodeURIComponent(ch)}${t ? `&only=${t}` : ""}${ex ? `&exclude=${encodeURIComponent(ex)}` : ""}`, token).then(r => {
      setMeta(r); setItems(prev => { const base = more ? prev : []; const have = new Set(base.map(p => p.id)); return [...base, ...(r.items as Row[]).filter(i => !have.has(i.id))]; });
    }).catch(e => setNote(errText(e))).finally(() => setBusy(false));
  }, [token]);
  useEffect(() => { load(""); }, [load]);
  const open = (it: Row) => { if (it.kind === "youtube" || it.embed) { setPlaying(String(it.id)); send(it, "view", 30); return; } send(it, "view", 30); window.open(String(it.url), "_blank", "noopener"); };
  const share = () => void call<Row>("/learn-feed/link", token, postJson({ url: link.url.trim(), title: link.title.trim() })).then(r => {
    setNote(r.saved ? `Added (${r.folder})` : `${r.why}. ${r.hint || ""}`); if (r.saved) { setLink({ url: "", title: "" }); load(tab); } }).catch(e => setNote(errText(e)));
  const save = (it: Row) => { send(it, "save"); void call("/media", token, postJson({ url: it.url, title: String(it.title).slice(0, 200), folder: it.kind === "post" ? "Saved posts" : "Learning · Other" })).then(() => setNote("Saved")).catch(e => setNote(errText(e))); };
  return <div className="d-dash" style={{ maxWidth: 680, margin: "0 auto" }}>
    <Hero kicker="Learning hub" title="Your feed," accent="only growth" sub="Technology, educational, motivation and psychology posts and videos from trusted sources, ranked for you."/>
    <Card kicker="Share" title="Something you learned">
      <div className="d-row"><input className="d-input" value={link.url} onChange={e => setLink({ ...link, url: e.target.value })} placeholder="LinkedIn, TikTok, Facebook, TED… link"/>
        <input className="d-input" value={link.title} onChange={e => setLink({ ...link, title: e.target.value })} placeholder="What it teaches"/>
        <button className="d-btn" disabled={link.url.trim().length < 8 || link.title.trim().length < 3} onClick={share}>Add</button></div></Card>
    {note && <p className="d-note">{note}</p>}
    <div className="d-chips">{HUB_TABS.map(([k, l]) => <button key={k} className={`d-chip ${tab === k ? "on" : ""}`} onClick={() => { setTab(k); load(k); }}>{l}</button>)}</div>
    {(meta?.errors as string[] | undefined)?.map(e => <p key={e} className="d-note">{e}</p>)}
    {items.map(it => <Card key={it.id} kicker={`${it.channel} · ${hubAgo(it.published)} · ${meta?.categories?.[it.category] || ""}`} title={it.title}>
      {it.excerpt && <p className="d-note">{it.excerpt}</p>}
      {playing === it.id ? <iframe title={it.title} src={it.kind === "youtube" ? `https://www.youtube.com/embed/${it.id}?autoplay=1&rel=0` : it.embed}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen" style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 12 }}/>
        : it.thumb ? <button className="text-button" style={{ display: "block", width: "100%", padding: 0, position: "relative" }} onClick={() => open(it)}>
          <img src={it.thumb} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 12 }}/>{it.kind === "youtube" && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 40 }}>▶</span>}</button>
        : <button className="d-btn ghost" onClick={() => open(it)}>{it.kind === "post" ? "Read" : "Open"} ↗</button>}
      <p className="d-note">✨ {it.reason}</p>
      <div className="d-row"><button className="text-button" onClick={() => { const on = !liked[it.id]; setLiked({ ...liked, [it.id]: on }); send(it, on ? "like" : "unlike"); }}>{liked[it.id] ? "❤️ Liked" : "🤍 Like"}</button>
        <button className="text-button" onClick={() => save(it)}>🔖 Save</button>
        <button className="text-button" onClick={() => { send(it, "hide"); setItems(items.filter(x => x.id !== it.id)); }}>👎 Less</button>
        {it.kind === "post" && <a className="text-button" href={it.url} target="_blank" rel="noreferrer" onClick={() => send(it, "view", 30)}>Read ↗</a>}</div>
    </Card>)}
    {items.length > 0 && <button className="d-btn ghost" disabled={busy} onClick={() => load(tab, true, items)}>{busy ? "Loading…" : "Load more"}</button>}
    {meta && <Card kicker="LinkedIn" title="Learning posts on LinkedIn">
      <p className="d-note">LinkedIn has no public feed, so these open LinkedIn's own search for your goals. Share good posts above.</p>
      {(meta.linkedin as Row[]).map(l => <p key={l.url}><a href={l.url} target="_blank" rel="noreferrer">→ {l.title}</a></p>)}
      <p className="d-note">🚫 {meta.hidden_count} non-learning items hidden. {meta.how}</p></Card>}
  </div>;
}
