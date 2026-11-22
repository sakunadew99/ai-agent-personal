"use client";
/* Role-play coach (soft-skills academy) and the next vision pages for the web. */
import { useCallback, useEffect, useState } from "react";
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

export function FitnessGuidePage({ token }: { token: string }) {
  const [tab, setTab] = useState<"today" | "library" | "meals">("today");
  const [plans, setPlans] = useState<Row[]>([]);
  const [plan, setPlan] = useState("full_body");
  const [today, setToday] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [muscle, setMuscle] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState<Row>({ weight_kg: "75", goal: "lose", budget_lkr_day: "", diet: [] as string[] });
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
    const body: Row = { weight_kg: Number(f.weight_kg), goal: f.goal, diet: f.diet };
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
        <button className="d-btn" onClick={make}>🥗 Make my week</button></Card>
      {meal && <div className="d-grid-2">
        <Card kicker={`${meal.targets.kcal} kcal · ${meal.targets.protein_g} g protein (${meal.targets.method})`} title={(meal.days as Row[])[day].day}
          action={<div className="d-chips">{(meal.days as Row[]).map((d, i) => <button key={d.day} className={`d-chip ${day === i ? "on" : ""}`} onClick={() => setDay(i)}>{d.day.slice(0, 3)}</button>)}</div>}>
          {((meal.days as Row[])[day].meals as Row[]).map(m => <p key={m.slot}><b style={{ textTransform: "capitalize" }}>{m.slot}</b> <small className="d-note">({m.kcal} kcal · {m.protein_g} g)</small><br/>
            {(m.items as Row[]).map(it => `${it.qty !== 1 ? `${it.qty} × ` : ""}${it.name}`).join(" · ")}</p>)}
          {meal.budget_note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{meal.budget_note}</p>}{meal.targets.floor_note && <p className="d-note" style={{ color: "var(--d-amber)" }}>{meal.targets.floor_note}</p>}</Card>
        <Card kicker="Shopping list" title={`≈ Rs ${Number(meal.week_cost_lkr).toLocaleString()} / week`}>{(meal.shopping as Row[]).map(s => <p key={s.item} className="d-note">{s.item}: {s.portions} × {s.portion} · Rs {Number(s.cost_lkr).toLocaleString()}</p>)}
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
