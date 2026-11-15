"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { GermanyFinder } from "./Dashboards";

const STAGES = ["explore", "shortlist", "requirements", "prepare", "apply", "offer", "visa", "move", "dropped"];
const COST_ITEMS = ["application_fee", "test_fee", "translation", "travel", "visa_fee", "deposit", "first_month", "tuition", "living", "insurance", "other"];
const err = (r: unknown) => r instanceof Error ? r.message : "Something went wrong";
const money = (v: unknown, c?: string) => v === null || v === undefined ? "—" : `${c ? `${c} ` : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Study-abroad planner (guide 39). Organises; never submits, pays or contacts anyone. */
export function StudyPage({ token }: { token: string }) {
  const [ov, setOv] = useState<Row | null>(null);
  const [programs, setPrograms] = useState<Row[]>([]);
  const [scholarships, setScholarships] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const [form, setForm] = useState({ country: "", university: "", course: "", deadline: "", language_test: "", currency: "EUR", tuition_per_year: "", living_per_month: "", application_fee: "", link: "" });
  const [sch, setSch] = useState({ name: "", deadline: "", link: "" });
  const load = useCallback(() => {
    Promise.all([apiRequest<Row>("/study", token), apiRequest<Row[]>("/study/programs", token), apiRequest<Row[]>("/study/scholarships", token)])
      .then(([o, p, s]) => { setOv(o); setPrograms(p); setScholarships(s); }).catch(r => setError(err(r)));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) { setError(""); try { await work; setMsg(note); load(); } catch (r) { setError(err(r)); setMsg(""); } }
  function add(e: FormEvent) {
    e.preventDefault();
    const body: Row = { country: form.country, university: form.university, course: form.course, currency: form.currency, stage: "explore" };
    for (const k of ["deadline", "language_test", "tuition_per_year", "living_per_month", "application_fee", "link"] as const) if (form[k]) body[k] = form[k].replace(/,/g, "");
    void run(apiRequest("/study/programs", token, postJson(body)).then(() => setForm({ ...form, university: "", course: "", deadline: "", tuition_per_year: "", living_per_month: "", application_fee: "", link: "" })), "Program added.");
  }

  return <>
    <GermanyFinder token={token} onSaved={load}/>
    {ov && <div className="grid metrics">
      <section className="panel metric"><p className="muted">Programs</p><h2>{ov.programs}</h2><span className="trend">{Object.entries(ov.by_stage as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(" · ") || "add your first"}</span></section>
      <section className="panel metric"><p className="muted">Deadlines (60 days)</p><h2>{ov.deadlines_60_days.length}</h2><span className="trend">{ov.deadlines_60_days[0] ? `next: ${ov.deadlines_60_days[0].title} in ${ov.deadlines_60_days[0].days_left} d` : "none soon"}</span></section>
      <section className="panel metric"><p className="muted">To re-check</p><h2>{ov.to_verify.length}</h2><span className="trend">facts older than 30 days</span></section>
      <section className="panel metric"><p className="muted">First year (largest)</p><h2>{ov.money.first_year_lkr_max ? money(ov.money.first_year_lkr_max, "LKR") : "—"}</h2><span className="trend">add costs + your LKR rate</span></section>
    </div>}
    {msg && <p className="success-note">{msg}</p>}{error && <p className="warning-copy">{error}</p>}
    {ov && <div className="grid main-grid">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">NEXT 3 ACTIONS</p><h2>What to do now</h2></div></div>
        {(ov.next_actions as Row[]).map(a => <div className="money-row" key={a.id}><div><b>{a.title}</b><small className="muted">{a.program}</small></div>
          <small className={a.overdue ? "warning-copy" : "muted"}>{day(a.due_date)}</small>
          <button className="text-button" onClick={() => void run(apiRequest(`/study/requirements/${a.id}`, token, patchJson({ status: "done" })), "Done ✓")}>Done</button></div>)}
        {!ov.next_actions.length && <div className="empty-state">Add a program with a deadline, then build its checklist.</div>}
      </section>
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">DEADLINES · NEXT 60 DAYS</p><h2>Coming up</h2></div></div>
        {(ov.deadlines_60_days as Row[]).map(d => <div className="money-row" key={`${d.kind}${d.id}`}><div><b>{d.title}</b><small className="muted">{d.kind}{d.verify ? " · ⚠ verify on the official page" : " · verified"}</small></div>
          <b>{d.days_left} d</b><small className="muted">{day(d.date)}</small></div>)}
        {!ov.deadlines_60_days.length && <div className="empty-state">No deadlines in the next 60 days.</div>}
        <p className="muted small-copy">{ov.disclaimer}</p>
      </section>
    </div>}

    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">PROGRAMS</p><h2>Explore → Shortlist → Apply → Visa → Move</h2></div></div>
      <form onSubmit={add}>
        <div className="field-grid">
          <label className="span-2">University<input value={form.university} onChange={e => setForm({ ...form, university: e.target.value })} placeholder="e.g. TU Munich" required maxLength={200}/></label>
          <label className="span-2">Course<input value={form.course} onChange={e => setForm({ ...form, course: e.target.value })} placeholder="e.g. MSc Data Science" required maxLength={200}/></label>
          <label>Country<input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} placeholder="e.g. Germany" required maxLength={80}/></label>
          <label>Application deadline<input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })}/></label>
          <label>Language test<input value={form.language_test} onChange={e => setForm({ ...form, language_test: e.target.value })} placeholder="e.g. IELTS 6.5" maxLength={80}/></label>
          <label>Currency<input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} placeholder="EUR"/></label>
          <label>Tuition / year<input value={form.tuition_per_year} onChange={e => setForm({ ...form, tuition_per_year: e.target.value })} placeholder="0 if free" inputMode="decimal"/></label>
          <label>Living / month<input value={form.living_per_month} onChange={e => setForm({ ...form, living_per_month: e.target.value })} placeholder="e.g. 1100" inputMode="decimal"/></label>
          <label>Application fee<input value={form.application_fee} onChange={e => setForm({ ...form, application_fee: e.target.value })} placeholder="e.g. 75" inputMode="decimal"/></label>
          <label className="span-all">Official page link<input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="https://…" maxLength={500}/></label>
        </div>
        <div className="form-actions"><button className="primary" disabled={!form.university.trim() || !form.course.trim() || !form.country.trim()}>Add program</button></div>
      </form>
      <div className="card-list">{programs.map(p => <ProgramCard key={p.id} token={token} p={p} open={open === p.id} toggle={() => setOpen(open === p.id ? null : p.id)} run={run}/>)}
        {!programs.length && <div className="empty-state">Add programs you're considering. Facts you enter get a “last verified” date so you know when to re-check.</div>}</div>
    </section>

    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">SCHOLARSHIPS</p><h2>Funding options</h2></div></div>
      <form className="inline-form" onSubmit={e => { e.preventDefault(); void run(apiRequest("/study/scholarships", token, postJson({ name: sch.name, ...(sch.deadline ? { deadline: sch.deadline } : {}), ...(sch.link ? { link: sch.link } : {}) })).then(() => setSch({ name: "", deadline: "", link: "" })), "Scholarship added."); }}>
        <input value={sch.name} onChange={e => setSch({ ...sch, name: e.target.value })} placeholder="Scholarship (e.g. DAAD EPOS)" required maxLength={200}/>
        <input type="date" value={sch.deadline} onChange={e => setSch({ ...sch, deadline: e.target.value })} aria-label="Deadline"/>
        <input value={sch.link} onChange={e => setSch({ ...sch, link: e.target.value })} placeholder="Official link" maxLength={500}/>
        <button className="primary" disabled={!sch.name.trim()}>Add</button>
      </form>
      {scholarships.map(s => <div className="money-row" key={s.id}><div><b>{s.name}</b><small className="muted">deadline {day(s.deadline)} · {s.last_verified_at ? `verified ${new Date(s.last_verified_at).toLocaleDateString()}` : "⚠ not verified"}</small></div>
        <select value={s.status} onChange={e => void run(apiRequest(`/study/scholarships/${s.id}`, token, patchJson({ status: e.target.value })), "Updated.")}>{["researching", "preparing", "applied", "won", "lost", "dropped"].map(x => <option key={x}>{x}</option>)}</select>
        <div className="row-actions"><button className="text-button" onClick={() => void run(apiRequest(`/study/scholarships/${s.id}`, token, patchJson({ verified: true })), "Marked as verified today.")}>I checked it</button>
          <button className="danger-link" onClick={() => { if (window.confirm(`Delete ${s.name}?`)) void run(apiRequest(`/study/scholarships/${s.id}`, token, { method: "DELETE" }), "Deleted."); }}>×</button></div></div>)}
    </section>
  </>;
}

function ProgramCard({ token, p, open, toggle, run }: { token: string; p: Row; open: boolean; toggle: () => void; run: (w: Promise<unknown>, note: string) => Promise<void> }) {
  const [reqs, setReqs] = useState<Row[]>([]);
  const [costs, setCosts] = useState<Row | null>(null);
  const [cost, setCost] = useState({ item: "visa_fee", amount: "", currency: p.currency });
  const [fx, setFx] = useState({ rate: p.fx_rate_to_lkr ?? "", date: p.fx_rate_date ?? new Date().toISOString().slice(0, 10) });
  const loadDetail = useCallback(() => {
    apiRequest<Row[]>(`/study/programs/${p.id}/requirements`, token).then(setReqs).catch(() => undefined);
    apiRequest<Row>(`/study/programs/${p.id}/costs`, token).then(setCosts).catch(() => undefined);
  }, [p.id, token]);
  useEffect(() => { if (open) loadDetail(); }, [open, loadDetail]);
  const stale = !p.last_verified_at || (Date.now() - new Date(p.last_verified_at).getTime()) > 30 * 86400000;
  const after = (w: Promise<unknown>, note: string) => run(w.then(loadDetail), note);

  return <div className="program-card">
    <div className="program-head" onClick={toggle} role="button" tabIndex={0}>
      <div><b>{p.university}</b> · {p.course}<small className="muted"> · {p.country}{p.language ? ` · ${p.language}` : ""}</small></div>
      <span className={`badge stage-${p.stage}`}>{p.stage}</span>
      <small className="muted">{p.deadline ? `deadline ${day(p.deadline)}` : "no deadline"}</small>
      <small className={stale ? "warning-copy" : "muted"}>{stale ? "⚠ verify" : "verified"}</small>
    </div>
    {open && <div className="program-body">
      <div className="row-actions" style={{ justifyContent: "flex-start" }}>
        <select value={p.stage} onChange={e => void run(apiRequest(`/study/programs/${p.id}`, token, patchJson({ stage: e.target.value })), "Stage updated.")}>{STAGES.map(s => <option key={s}>{s}</option>)}</select>
        <button className="outline" onClick={() => void run(apiRequest(`/study/programs/${p.id}`, token, patchJson({ verified: true })), "Marked as verified today.")}>I checked the official page</button>
        {p.link && /^https?:\/\//i.test(p.link) && <a className="text-button" href={p.link} target="_blank" rel="noopener noreferrer">Official page ↗</a>}
        <button className="danger-link" onClick={() => { if (window.confirm(`Delete ${p.university}? Its checklist and costs are deleted too.`)) void run(apiRequest(`/study/programs/${p.id}`, token, { method: "DELETE" }), "Deleted."); }}>Delete</button>
      </div>
      <h3>Checklist <small className="muted">(counted back from the deadline)</small></h3>
      {reqs.map(r => <label className={`buy-row${r.status !== "todo" ? " done-row" : ""}`} key={r.id}>
        <input type="checkbox" checked={r.status === "done"} onChange={e => void after(apiRequest(`/study/requirements/${r.id}`, token, patchJson({ status: e.target.checked ? "done" : "todo" })), "Updated.")}/>
        <span>{r.title}</span><small className="muted">{day(r.due_date)}</small>
        <button type="button" className="text-button" onClick={() => void after(apiRequest(`/study/requirements/${r.id}`, token, patchJson({ status: r.status === "na" ? "todo" : "na" })), "Updated.")}>{r.status === "na" ? "needed" : "not needed"}</button>
      </label>)}
      {!reqs.length && <div className="row-actions" style={{ justifyContent: "flex-start" }}>
        <button className="primary" disabled={!p.deadline} onClick={() => void after(apiRequest(`/study/programs/${p.id}/checklist`, token, postJson({ create_tasks: true })), "Checklist and tasks created.")}>Build checklist + tasks</button>
        <button className="outline" disabled={!p.deadline} onClick={() => void after(apiRequest(`/study/programs/${p.id}/checklist`, token, postJson({ create_tasks: false })), "Checklist created.")}>Checklist only</button>
        {!p.deadline && <small className="muted">Add the deadline first (set it in the program).</small>}
      </div>}
      <h3>Money plan <small className="muted">(first year, {p.currency})</small></h3>
      {costs && <>
        {(costs.lines as Row[]).map((l, i) => <div className="money-row" key={i}><span>{String(l.item).replaceAll("_", " ")}</span><b>{money(l.amount, l.currency)}</b>
          {l.id ? <button className="danger-link" onClick={() => void after(apiRequest(`/study/costs/${l.id}`, token, { method: "DELETE" }), "Removed.")}>×</button> : <small className="muted">{l.source}</small>}</div>)}
        <div className="money-row"><b>Total</b><b>{money(costs.first_year_total, p.currency)}</b><b>{costs.lkr_total != null ? money(costs.lkr_total, "LKR") : "—"}</b></div>
        {Object.keys(costs.not_converted || {}).length > 0 && <small className="muted">Not converted: {Object.entries(costs.not_converted).map(([c, v]) => money(v, c)).join(", ")}</small>}
      </>}
      <form className="inline-form" onSubmit={e => { e.preventDefault(); void after(apiRequest(`/study/programs/${p.id}/costs`, token, postJson({ ...cost, amount: cost.amount.replace(/,/g, "") })).then(() => setCost({ ...cost, amount: "" })), "Cost added."); }}>
        <select value={cost.item} onChange={e => setCost({ ...cost, item: e.target.value })}>{COST_ITEMS.map(i => <option key={i} value={i}>{i.replaceAll("_", " ")}</option>)}</select>
        <input value={cost.amount} onChange={e => setCost({ ...cost, amount: e.target.value })} placeholder="Amount" inputMode="decimal" required/>
        <input value={cost.currency} onChange={e => setCost({ ...cost, currency: e.target.value.toUpperCase() })} maxLength={3} className="cur-input" aria-label="Currency"/>
        <button className="outline" disabled={!cost.amount}>Add cost</button>
      </form>
      <form className="inline-form" onSubmit={e => { e.preventDefault(); void after(apiRequest(`/study/programs/${p.id}`, token, patchJson({ fx_rate_to_lkr: String(fx.rate), fx_rate_date: fx.date })), "Rate saved."); }}>
        <span className="muted">1 {p.currency} =</span>
        <input value={fx.rate} onChange={e => setFx({ ...fx, rate: e.target.value })} placeholder="LKR rate" inputMode="decimal" required/>
        <input type="date" value={fx.date} onChange={e => setFx({ ...fx, date: e.target.value })} aria-label="Rate date"/>
        <button className="outline" disabled={!fx.rate}>Save rate</button>
        <button type="button" className="primary" onClick={() => void run(apiRequest(`/study/programs/${p.id}/fund-goal`, token, { method: "POST" }), "Study-fund goal created (see My life → Goals).")}>Create study-fund goal</button>
      </form>
      <small className="muted">{costs?.note}</small>
    </div>}
  </div>;
}
