"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { appendSpeech, VoiceButton } from "./VoiceButton";

export const JOB_STAGES = ["draft", "applied", "interview", "offer", "accepted", "rejected", "withdrawn"] as const;
const STAGE_LABEL: Record<string, string> = { draft: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn" };
const BOARD = ["draft", "applied", "interview", "offer"];
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";

/** Job pipeline (Phase 4). Tracking only: Sakuna never applies, sends or scrapes anything. */
export function JobTracker({ token }: { token: string }) {
  const [jobs, setJobs] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row>({});
  const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    Promise.all([apiRequest<Row[]>("/career/jobs", token), apiRequest<Row>("/career/jobs/summary", token)])
      .then(([rows, sum]) => { setJobs(rows); setSummary(sum); }).catch(reason => setError(errorText(reason)));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>) { setError(""); try { await work; load(); } catch (reason) { setError(errorText(reason)); } }
  function add(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/career/jobs", token, postJson({ company, role, ...(url.trim() ? { url: url.trim() } : {}) })).then(() => { setCompany(""); setRole(""); setUrl(""); }));
  }
  function nextStep(job: Row) {
    const step = window.prompt("Next step (e.g. “Email recruiter”)", job.next_step || ""); if (step === null) return;
    const when = window.prompt("Follow up on (YYYY-MM-DD, blank for none)", job.follow_up_on || ""); if (when === null) return;
    if (when && !/^\d{4}-\d{2}-\d{2}$/.test(when)) { setError("Date must look like 2026-12-01"); return; }
    void run(apiRequest(`/career/jobs/${job.id}`, token, patchJson({ next_step: step.trim() || null, follow_up_on: when || null })));
  }
  const closed = jobs.filter(job => !BOARD.includes(job.status));
  const followUps: Row[] = summary.follow_ups_due || [];

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">JOB TRACKER</p><h2>{summary.open ?? 0} open applications</h2></div>
      <small className="muted">{summary.interview_rate_percent != null ? `${summary.interview_rate_percent}% of applications reached interview` : "Track every role from saved to offer"}</small></div>
    {followUps.length > 0 && <div className="notice-card"><b>Follow-ups due</b>{followUps.map(f => <p key={f.id}>{f.company} · {f.role}{f.next_step ? `: ${f.next_step}` : ""} <small className="muted">({f.follow_up_on})</small></p>)}</div>}
    <form className="job-add" onSubmit={add}>
      <span className="with-mic"><input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company" required maxLength={200}/><VoiceButton onText={spoken => setCompany(v => appendSpeech(v, spoken))}/></span>
      <span className="with-mic"><input value={role} onChange={e => setRole(e.target.value)} placeholder="Role" required maxLength={200}/><VoiceButton onText={spoken => setRole(v => appendSpeech(v, spoken))}/></span>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Job link (optional)" maxLength={500}/>
      <button className="primary" disabled={!company.trim() || !role.trim()}>Save job</button>
    </form>
    {error && <p className="warning-copy">{error}</p>}
    <div className="job-board">{BOARD.map(stage => {
      const items = jobs.filter(job => job.status === stage);
      return <div className="job-col" key={stage}><div className="job-col-head"><b>{STAGE_LABEL[stage]}</b><span>{items.length}</span></div>
        {items.map(job => <JobCard key={job.id} job={job} onStage={status => void run(apiRequest(`/career/jobs/${job.id}`, token, patchJson({ status })))}
          onNext={() => nextStep(job)} onDelete={() => { if (window.confirm(`Delete ${job.company} · ${job.role}?`)) void run(apiRequest(`/career/jobs/${job.id}`, token, { method: "DELETE" })); }}/>)}
        {!items.length && <small className="muted job-empty">—</small>}</div>;
    })}</div>
    {closed.length > 0 && <details className="job-closed"><summary>Closed ({closed.length})</summary>
      {closed.map(job => <div className="job-closed-row" key={job.id}><span>{job.company} · {job.role}</span><span className={`badge stage-${job.status}`}>{STAGE_LABEL[job.status] || job.status}</span>
        <select value={job.status} onChange={e => void run(apiRequest(`/career/jobs/${job.id}`, token, patchJson({ status: e.target.value })))} aria-label="Change stage">{JOB_STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></div>)}
    </details>}
  </section>;
}

function JobCard({ job, onStage, onNext, onDelete }: { job: Row; onStage: (status: string) => void; onNext: () => void; onDelete: () => void }) {
  const overdue = job.follow_up_on && job.follow_up_on <= new Date().toLocaleDateString("en-CA");
  return <div className="job-card">
    <b>{job.role}</b><span className="muted">{job.company}</span>
    {job.next_step && <small className={overdue ? "job-next overdue" : "job-next"}>→ {job.next_step}{job.follow_up_on ? ` · ${job.follow_up_on}` : ""}</small>}
    <div className="job-card-actions">
      <select value={job.status} onChange={e => onStage(e.target.value)} aria-label={`Stage for ${job.company}`}>{JOB_STAGES.map(s => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
      <button className="text-button" onClick={onNext}>Next step</button>
      {job.url && /^https?:\/\//i.test(job.url) && <a className="text-button" href={job.url} target="_blank" rel="noopener noreferrer">Link ↗</a>}
      <button className="danger-link" onClick={onDelete} aria-label={`Delete ${job.company}`}>×</button>
    </div>
  </div>;
}
