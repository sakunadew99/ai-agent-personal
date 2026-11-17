"use client";
import { useCallback, useEffect, useState } from "react";
import { apiRequest as call, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Donut, Hero, LineChart, Meter, Ring, SERIES, short, Stat, WeekDots } from "./Charts";
import { NetWorthCard } from "./SmartCards";

const money = (v: unknown, cur = "USD") => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(Number(v || 0)); } catch { return `${cur} ${Math.round(Number(v || 0))}`; } };
const CAT_ICON: Record<string, string> = { food: "🍛", transport: "🚌", housing: "🏠", subscriptions: "🔁", shopping: "🛍️", health: "💊", education: "🎓", business: "💼", other: "📦" };

function useData(path: string, token: string, version = 0) {
  const [data, setData] = useState<Row | null>(null);
  useEffect(() => { let live = true; call<Row>(path, token).then(d => { if (live) setData(d); }).catch(() => undefined); return () => { live = false; }; }, [path, token, version]);
  return data;
}

/** My life: day score, task/habit/goal charts. `version` changes after edits to reload. */
export function LifeDashboard({ token, version = 0, onChanged }: { token: string; version?: number; onChanged?: () => void }) {
  const [bump, setBump] = useState(0);
  const o = useData("/life/overview", token, version + bump);
  if (!o) return null;
  const t: Row = o.tasks || {};
  const hour = new Date().getHours();
  const logToday = async (id: string) => { await call(`/habits/${id}/logs`, token, postJson({ completed: true })); setBump(b => b + 1); onChanged?.(); };
  return <div className="d-dash">
    <Hero kicker={new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} title={hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"} accent="✦"
      sub={`${t.due_today ?? 0} due today · ${t.done_this_week ?? 0} done this week · ${o.habits_done_today}/${(o.habits || []).length} habits today. The score mixes tasks, habits, goals and overdue items (plain maths).`}
      right={<Ring value={o.score} size={140} sub="day score"/>}/>
    <div className="d-stats">
      <Stat label="Open tasks" icon="☑" value={t.open ?? 0} hint={`${t.due_today ?? 0} due today`} tone="solid"/>
      <Stat label="Overdue" icon="⏰" value={t.overdue ?? 0} tone={(t.overdue ?? 0) > 0 ? "red" : "plain"} hint={(t.overdue ?? 0) > 0 ? "reschedule or drop" : "nothing late"}/>
      <Stat label="Done · 7 days" icon="✓" value={t.done_this_week ?? 0} tone="green" hint="tasks finished"/>
      <Stat label="High priority" icon="🔥" value={t.by_priority?.high ?? 0} tone="amber" hint={`${t.by_priority?.medium ?? 0} medium · ${t.by_priority?.low ?? 0} low`}/>
    </div>
    <div className="d-grid-3">
      <Card kicker="Momentum" title="Tasks done · last 2 weeks"><Bars data={(o.done_14_days as Row[]).map((d, i, a) => ({ label: d.label, value: d.done, highlight: i === a.length - 1 }))} height={150} format={n => String(n)}/></Card>
      <Card kicker="Where your work is" title="Open tasks by area">
        <Donut parts={Object.entries(t.by_category || {}).map(([k, v]) => ({ label: k, value: Number(v) }))} format={n => String(n)} size={140}/></Card>
    </div>
    <div className="d-grid-2">
      <Card kicker="Weekly habits" title={`${o.habits_done_today}/${(o.habits || []).length} done today`}>
        {(o.habits || []).length ? <WeekDots today={o.weekday} rows={(o.habits as Row[]).map(h => ({ label: `${h.name}${h.streak > 1 ? ` 🔥${h.streak}` : ""}`, done: h.week,
          onToggle: (i: number) => { if (i === o.weekday && !h.done_today) void logToday(h.id); } }))}/> : <div className="d-empty">Create a habit below to see your week.</div>}
        <p className="d-note">Click today’s circle to log a habit.</p></Card>
      <Card kicker="Your longer view" title="Goal progress">
        {(o.goals || []).length ? (o.goals as Row[]).slice(0, 6).map((g, i) => <Meter key={g.id} label={g.title} color={SERIES[i % SERIES.length]} value={g.percent ?? 0}
          right={g.percent === null ? `${g.current} ${g.unit || ""}` : `${Math.round(g.percent)}%`}/>) : <div className="d-empty">Create a goal below to track progress.</div>}</Card>
    </div>
  </div>;
}

/** Finance: net, savings rate, 6-month trend, daily spend, categories, biggest expenses. */
export function FinanceDashboard({ token, version = 0 }: { token: string; version?: number }) {
  const tr = useData("/finance/trends", token, version);
  if (!tr) return null;
  const cur = String(tr.currency || "USD"), tm: Row = tr.this_month || {};
  const rate = tm.savings_rate === null || tm.savings_rate === undefined ? null : Number(tm.savings_rate);
  const days: Row[] = tr.days || [];
  return <div className="d-dash">
    <Hero kicker={`Money · ${new Date().toLocaleDateString([], { month: "long", year: "numeric" })}`} title={money(tm.net, cur)} sub="left this month after spending (actual records in your display currency)"
      right={<Ring value={Math.max(0, rate ?? 0)} size={140} color={rate !== null && rate < 0 ? "var(--d-red)" : "var(--d-green)"} label={rate === null ? "—" : `${Math.round(rate)}%`} sub="saved"/>}/>
    <div className="d-stats">
      <Stat label="Income" icon="↘" value={money(tm.income, cur)} tone="solid" hint="this month"/>
      <Stat label="Spent" icon="↗" value={money(tm.spent, cur)} tone="red" trend={tm.change_vs_last_month_pct ?? null} hint="vs same day last month"/>
      <Stat label="Per day" icon="📅" value={money(tm.avg_per_day, cur)} tone="amber" hint={`on track for ${money(tm.projected_spend, cur)}`}/>
      <Stat label="Last month" icon="🗓" value={money(tm.last_month_spent, cur)} tone="blue" hint="total spent"/>
    </div>
    <NetWorthCard token={token}/>
    <div className="d-grid-3">
      <Card kicker="Cash flow" title="Income vs spending · 6 months">
        <LineChart series={[{ name: "Income", values: (tr.months as Row[]).map(m => m.income), color: "var(--d-green)" }, { name: "Spent", values: (tr.months as Row[]).map(m => m.expenses), color: "var(--d-red)" }]}
          labels={(tr.months as Row[]).map(m => m.label)} format={short}/></Card>
      <Card kicker="Spending" title="By category">
        <Donut parts={(tr.categories as Row[]).map(c => ({ label: c.category, value: c.amount }))} format={n => money(n, cur)} size={140}/>
        {(tr.categories as Row[]).filter(c => c.previous > 0 && c.amount > c.previous * 1.2).slice(0, 2).map(c => <p key={c.category} className="d-warn">▲ {c.category} is already above last month ({money(c.previous, cur)}).</p>)}
      </Card>
    </div>
    <div className="d-grid-2">
      <Card kicker="This month" title="Daily spending">
        {days.length > 1 ? <Bars data={days.map((d, i) => ({ label: days.length > 16 ? (i % 5 === 0 ? d.label : "") : d.label, value: d.spent, highlight: i === days.length - 1,
          color: d.spent > Number(tm.avg_per_day || 0) * 1.5 ? "var(--d-amber)" : "var(--d-green)" }))} height={140} format={short}/> : <div className="d-empty">Spending per day appears from the 2nd of the month.</div>}
        <p className="d-note">Amber days are well above your daily average.</p></Card>
      <Card kicker="Watch these" title="Biggest expenses">
        {(tr.biggest as Row[]).length ? (tr.biggest as Row[]).map(b => <div className="d-biggest" key={b.id}><i>{CAT_ICON[b.category] || "•"}</i>
          <div><b>{b.merchant || b.notes || b.category}</b><small>{b.category} · {b.date}</small></div><em>−{money(b.amount, cur)}</em></div>) : <div className="d-empty">No expenses this month yet.</div>}
        {tr.other_currency_records > 0 && <p className="d-note">{tr.other_currency_records} record(s) in other currencies are kept separately, never converted by guess.</p>}</Card>
    </div>
  </div>;
}

/** Health & Mi Band: score, steps vs goal, sleep, heart rate, workouts. */
export function HealthDashboard({ token, version = 0 }: { token: string; version?: number }) {
  const [range, setRange] = useState(14);
  const h = useData(`/health/trends?days=${range}`, token, version);
  if (!h) return null;
  const days: Row[] = h.days || [], w: Row = h.week || {}, t: Row = h.today || {};
  const stepGoal = h.goals?.steps || 8000, sleepGoal = h.goals?.sleep_hours || 7.5;
  return <div className="d-dash">
    <Hero kicker="Health · Mi Band via Health Connect" title="Body" accent="battery" sub={h.has_data ? "Synced from the phone app (Mi Fitness → Health Connect → Sakuna) and what you log. Not medical advice." : "No health data yet. Connect Health Connect in the phone app, or log a record below."}
      right={<Ring value={h.score} size={140} sub="health score"/>}>
      <div className="d-chips" style={{ marginTop: 12 }}>{[7, 14, 30].map(n => <button key={n} className={`d-chip ${range === n ? "on" : ""}`} onClick={() => setRange(n)}>{n} days</button>)}</div>
    </Hero>
    <div className="d-stats">
      <Stat label="Steps today" icon="👟" value={Number(t.steps || 0).toLocaleString()} tone="solid" hint={`${Math.round(Math.min(100, (t.steps / stepGoal) * 100) || 0)}% of ${stepGoal.toLocaleString()}`}/>
      <Stat label="Sleep" icon="🌙" value={`${t.sleep_hours || days[days.length - 2]?.sleep_hours || 0} h`} tone="violet" hint={`avg ${w.avg_sleep_hours ?? "—"} h this week`}/>
      <Stat label="Heart rate" icon="❤️" value={w.avg_heart_rate ? `${Math.round(w.avg_heart_rate)} bpm` : "—"} tone="red" hint="weekly average"/>
      <Stat label="Workouts" icon="🏋️" value={`${w.workout_minutes ?? 0} min`} tone="blue" hint={`${w.active_days ?? 0} active days this week`}/>
    </div>
    <div className="d-grid-3">
      <Card kicker="Activity" title={`Steps · goal reached ${w.step_goal_days ?? 0} of 7 days`}>
        <Bars data={days.map((d, i) => ({ label: d.label, value: d.steps, highlight: i === days.length - 1, color: d.steps >= stepGoal ? "var(--d-green)" : "color-mix(in srgb, var(--d-green) 45%, transparent)" }))} goal={stepGoal} height={160}/></Card>
      <Card kicker="This week" title="Goals">
        <Meter label="Step goal days" value={((w.step_goal_days ?? 0) / 7) * 100} right={`${w.step_goal_days ?? 0}/7`}/>
        <Meter label="Sleep goal days" color="var(--d-violet)" value={((w.sleep_goal_days ?? 0) / 7) * 100} right={`${w.sleep_goal_days ?? 0}/7`}/>
        <Meter label="Active days" color="var(--d-blue)" value={((w.active_days ?? 0) / 7) * 100} right={`${w.active_days ?? 0}/7`}/>
        <p className="d-note">Goals: {stepGoal.toLocaleString()} steps, {sleepGoal} h sleep, any workout.</p></Card>
    </div>
    <div className="d-grid-2">
      <Card kicker="Recovery" title="Sleep hours"><Bars data={days.map((d, i) => ({ label: d.label, value: d.sleep_hours, highlight: i === days.length - 1, color: d.sleep_hours >= sleepGoal ? "var(--d-violet)" : "color-mix(in srgb, var(--d-violet) 45%, transparent)" }))} goal={sleepGoal} height={130} format={n => `${n.toFixed(1)}h`}/></Card>
      <Card kicker="Heart" title="Average heart rate"><LineChart series={[{ name: "bpm", values: days.map(d => d.heart_rate), color: "var(--d-red)" }]} labels={days.map(d => d.label)} height={130}/></Card>
    </div>
  </div>;
}

const FIELD_IDEAS = ["Data Science", "Computer Science", "Artificial Intelligence", "Software Engineering", "Business Analytics", "Information Systems", "Cyber Security", "Mechatronics", "Renewable Energy", "MBA"];
const eur = (n: unknown) => `€${Math.round(Number(n || 0)).toLocaleString()}`;
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Study in Germany: search DAAD by the fields you like; summary, costs, deadlines, documents, programmes. */
export function GermanyFinder({ token, onSaved }: { token: string; onSaved?: () => void }) {
  const [fields, setFields] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("sakuna.studyFields") || "[]"); } catch { return []; } });
  const [typed, setTyped] = useState("");
  const [lang, setLang] = useState<"en" | "de" | "any">("en");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Row | null>(null);
  const [plan, setPlan] = useState("");
  const [error, setError] = useState("");
  const [shown, setShown] = useState(12);
  const keep = useCallback((next: string[]) => { setFields(next); try { localStorage.setItem("sakuna.studyFields", JSON.stringify(next)); } catch { /* private window */ } }, []);
  const add = (f: string) => { const v = f.trim(); if (v && fields.length < 5 && !fields.some(x => x.toLowerCase() === v.toLowerCase())) keep([...fields, v]); setTyped(""); };
  async function search() {
    setBusy(true); setError(""); setPlan(""); setShown(12);
    try { setRes(await call<Row>(`/study/germany/search?fields=${encodeURIComponent(fields.join(","))}&lang=${lang}&free=${free}`, token)); }
    catch (e) { setError(e instanceof Error ? e.message : "Search failed"); } finally { setBusy(false); }
  }
  async function explain() {
    setBusy(true);
    try { setPlan(String((await call<Row>("/study/germany/explain", token, postJson({ fields: fields.join(","), lang, free }))).text || "")); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not write the plan"); } finally { setBusy(false); }
  }
  async function save(id: number) {
    try { await call(`/study/germany/${id}/save`, token, { method: "POST" }); setRes(r => r ? { ...r, courses: (r.courses as Row[]).map(c => c.id === id ? { ...c, saved_id: "saved" } : c) } : r); onSaved?.(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
  }
  const s: Row = res?.summary || {}, fy: Row = s.first_year_eur || {};
  const courses: Row[] = res?.courses || [];
  return <div className="d-dash">
    <Hero kicker="Study in Germany · DAAD database" title="Find your" accent="Master's" sub="Add the fields you like. Sakuna reads the DAAD international programmes database and sums up costs, deadlines, language tests and documents.">
      <div className="d-chips" style={{ marginTop: 14 }}>{fields.map(f => <button key={f} className="d-chip on" onClick={() => keep(fields.filter(x => x !== f))}>{f} ✕</button>)}</div>
      <div className="d-row" style={{ marginTop: 12 }}>
        <input className="d-input" value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(typed); }} placeholder="Add a field, e.g. Data Science" maxLength={60}/>
        <button className="d-btn ghost" onClick={() => add(typed)} disabled={!typed.trim()}>Add</button>
      </div>
      <div className="d-chips" style={{ marginTop: 10 }}>{FIELD_IDEAS.filter(f => !fields.includes(f)).map(f => <button key={f} className="d-chip" onClick={() => add(f)}>+ {f}</button>)}</div>
      <div className="d-row" style={{ marginTop: 12 }}>
        {(["en", "de", "any"] as const).map(l => <button key={l} className={`d-chip ${lang === l ? "on" : ""}`} onClick={() => setLang(l)}>{{ en: "Taught in English", de: "German", any: "Any language" }[l]}</button>)}
        <label className="d-row" style={{ color: "var(--d-text)", fontSize: 14 }}><input type="checkbox" checked={free} onChange={e => setFree(e.target.checked)}/> Tuition-free only</label>
        <button className="d-btn" onClick={() => void search()} disabled={busy || !fields.length}>{busy && !res ? "Searching DAAD…" : "Search programmes"}</button>
      </div>
      {error && <p className="d-warn" style={{ marginTop: 10 }}>{error}</p>}
    </Hero>
    {res && <>
      <div className="d-stats">
        <Stat label="Programmes" icon="🎓" value={res.total} tone="solid" hint={`best ${courses.length} shown`}/>
        <Stat label="Tuition-free" icon="✓" value={s.tuition_free ?? 0} tone="green" hint={`${s.with_fee ?? 0} charge fees`}/>
        <Stat label="First year" icon="€" value={eur(fy.total)} tone="amber" hint="blocked account + fees"/>
        <Stat label="IELTS asked" icon="📝" value={s.ielts ? `${s.ielts.min}–${s.ielts.max}` : "6.5 typ."} tone="blue" hint={`from ${s.checked ?? 0} checked`}/>
      </div>
      <div className="d-grid-3">
        <Card kicker="Summary" title={s.headline} action={<button className="d-btn ghost" onClick={() => void explain()} disabled={busy}>{plan ? "Refresh plan" : "✨ Turn into my plan"}</button>}>
          <ul className="d-list">{String(s.text || "").split("\n").map((l, i) => <li key={i}>{l}</li>)}</ul>
          {plan && <pre className="d-plan">{plan.replace(/\*\*/g, "")}</pre>}</Card>
        <Card kicker="First-year money plan" title="EUR">
          <Donut size={140} format={eur} center={<><b style={{ fontSize: 18 }}>{eur(fy.total)}</b><small>year 1</small></>}
            parts={[{ label: "Blocked account", value: fy.blocked_account }, { label: "Tuition", value: fy.tuition }, { label: "Semester fees", value: fy.semester_contributions }, { label: "Visa + applications", value: fy.visa_and_applications }]}/>
          <p className="d-note">Health insurance (about {eur(Number(fy.health_insurance || 0) / 12)}/month) comes out of the €992 monthly blocked-account money. Confirm with the German Embassy Colombo and each university.</p></Card>
      </div>
      <div className="d-grid-2">
        <Card kicker="Next deadlines" title="Apply in time">{(s.deadlines as Row[] || []).length ? (s.deadlines as Row[]).map(d => <div className="d-biggest" key={d.id}><i>📅</i><div><b style={{ textTransform: "none" }}>{d.course}</b><small>{d.university}</small></div><em style={{ color: "var(--d-amber)" }}>{day(d.date)}</em></div>) : <div className="d-empty">No dated deadlines in these results.</div>}</Card>
        <Card kicker="Documents you need" title={`${(res.documents as Row[]).length} items`}><ol className="d-list">{(res.documents as Row[]).map(d => <li key={d.item}><b>{d.item}</b> <span className="d-tag">{d.when}</span><br/><span className="d-note">{d.note}</span></li>)}</ol></Card>
      </div>
      <Card kicker="Cities" title="Where the programmes are"><Bars data={(s.cities as Row[] || []).map(c => ({ label: c.city, value: c.count }))} height={110} format={n => String(n)}/></Card>
      <Card kicker="Programmes" title="Free first, then soonest deadline">
        <div className="d-programs">{courses.slice(0, shown).map(c => { const f: Row | null = c.facts; return <article className="d-program" key={c.id}>
          <h4>{c.course}</h4><p>{c.university} · {c.city}</p>
          <div className="d-row">
            <span className={`d-tag ${c.tuition_per_semester === 0 ? "green" : c.tuition_per_semester ? "red" : ""}`}>{c.tuition_per_semester === 0 ? "tuition-free" : c.tuition_per_semester ? `€${Number(c.tuition_per_semester).toLocaleString()}/sem` : "fees vary"}</span>
            {(c.languages as string[]).slice(0, 2).map(l => <span className="d-tag" key={l}>{l}</span>)}
            {c.duration && <span className="d-tag">{c.duration}</span>}
            {c.next_deadline && <span className="d-tag amber">deadline {day(c.next_deadline)}</span>}
            {f?.ielts && <span className="d-tag">IELTS {f.ielts}</span>}{f?.uni_assist && <span className="d-tag">uni-assist</span>}
          </div>
          {f && <details><summary className="d-note" style={{ cursor: "pointer" }}>Admission, language and costs</summary><dl>
            {[["Admission", f.admission], ["English", f.english], ["German", f.german], ["Semester fee", f.semester_contribution], ["Apply via", f.submit_via], ["Application periods", f.application_periods]]
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v).slice(0, 700)}</dd></div>)}</dl></details>}
          <div className="d-row">{c.saved_id ? <span className="d-tag green">✓ in your tracker</span> : <button className="d-btn" onClick={() => void save(c.id)}>Save to tracker</button>}
            <a className="d-btn ghost" href={c.link} target="_blank" rel="noreferrer">DAAD page ↗</a></div>
        </article>; })}</div>
        {shown < courses.length && <button className="d-btn ghost" onClick={() => setShown(n => n + 12)}>Show more ({courses.length - shown})</button>}
        <p className="d-note">{res.source}</p>
      </Card>
    </>}
  </div>;
}
