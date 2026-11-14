"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";

const KINDS: [string, string, string][] = [
  ["passport", "Passport", "🛂"], ["visa", "Visa / residence permit", "🪪"], ["national_id", "National ID", "🆔"], ["driving_license", "Driving licence", "🚗"],
  ["insurance", "Insurance", "🛡️"], ["warranty", "Warranty", "🧾"], ["certificate", "Certificate", "🎓"], ["transcript", "Transcript", "📄"],
  ["language_test", "Language test result", "🗣️"], ["other", "Other", "📁"],
];
const ICON = Object.fromEntries(KINDS.map(([k, , i]) => [k, i]));
const STATUS: Record<string, string> = { expired: "Expired", renew_now: "Renew now", valid: "Valid", no_expiry: "No expiry" };
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Document vault: details and expiry dates, never files. Numbers are encrypted; revealing one is logged. */
export function VaultPage({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [msg, setMsg] = useState(""); const [error, setError] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", kind: "passport", number: "", issued_on: "", expires_on: "", location_note: "" });
  const load = useCallback(() => { apiRequest<Row>("/vault", token).then(setV).catch(r => setError(r instanceof Error ? r.message : "Could not load")); }, [token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) {
    setError("");
    try { await work; setMsg(note); load(); } catch (r) { setError(r instanceof Error ? r.message : "Something went wrong"); setMsg(""); }
  }
  function add(e: FormEvent) {
    e.preventDefault();
    const body: Row = { name: form.name || KINDS.find(k => k[0] === form.kind)?.[1], kind: form.kind };
    for (const k of ["number", "issued_on", "expires_on", "location_note"] as const) if (form[k].trim()) body[k] = form[k].trim();
    void run(apiRequest("/vault/documents", token, postJson(body)).then(() => setForm({ ...form, name: "", number: "", issued_on: "", expires_on: "", location_note: "" })), "Saved to your vault.");
  }
  async function reveal(id: string) {
    try {
      const r = await apiRequest<Row>(`/vault/documents/${id}/reveal`, token, { method: "POST" });
      setShown(s => ({ ...s, [id]: r.number }));
      setTimeout(() => setShown(s => { const c = { ...s }; delete c[id]; return c; }), 20000);
    } catch (r) { setError(r instanceof Error ? r.message : "Could not reveal"); }
  }
  if (!v) return error ? <p className="warning-copy">{error}</p> : <p className="muted">Loading…</p>;
  const docs = v.documents as Row[];

  return <>
    <div className="grid metrics">
      {(["expired", "renew_now", "valid", "no_expiry"] as const).map(s => <section key={s} className={`panel metric vault-metric status-${s}`}><p className="muted">{STATUS[s]}</p><h2>{v.counts[s]}</h2>
        <span className="trend">{s === "renew_now" ? "start renewal" : s === "expired" ? "renew or remove" : s === "valid" ? "all good" : "certificates, etc."}</span></section>)}
    </div>
    {msg && <p className="success-note">{msg}</p>}{error && <p className="warning-copy">{error}</p>}

    {(v.needed_for_plans as Row[]).length > 0 && <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">FOR YOUR STUDY-ABROAD PLANS</p><h2>What you'll need</h2></div></div>
      <div className="needs-grid">{(v.needed_for_plans as Row[]).map(n => <div key={n.kind} className={`need ${n.have ? "have" : "missing"}`}>
        <span>{n.have ? "✓" : "○"}</span><div><b>{n.label}</b><small className="muted">for {n.needed_for}</small>{n.warning && <small className="warning-copy">{n.warning}</small>}</div>
      </div>)}</div>
    </section>}

    <div className="grid main-grid">
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">YOUR DOCUMENTS</p><h2>{docs.length} saved</h2></div></div>
        <div className="doc-list">{docs.map(d => <div className={`doc-row status-${d.status}`} key={d.id}>
          <span className="doc-icon">{ICON[d.kind] || "📁"}</span>
          <div className="doc-main"><b>{d.name}</b>
            <small className="muted">{d.kind_label}{d.number_hint ? ` · ${shown[d.id] ? shown[d.id] : d.number_hint}` : ""}{d.location_note ? ` · 📍 ${d.location_note}` : ""}</small>
            <small className={d.status === "expired" || d.status === "renew_now" ? "warning-copy" : "muted"}>
              {d.expires_on ? `Expires ${day(d.expires_on)} · ${d.days_left < 0 ? `${-d.days_left} days ago` : `${d.days_left} days left`}${d.status !== "expired" ? ` · renew from ${day(d.renew_from)}` : ""}` : "No expiry date"}</small></div>
          <span className={`doc-chip status-${d.status}`}>{STATUS[d.status]}</span>
          <div className="row-actions">
            {d.has_number && <button className="text-button" onClick={() => void reveal(d.id)}>{shown[d.id] ? "Shown 20s" : "Reveal number"}</button>}
            {d.expires_on && <button className="text-button" onClick={() => void run(apiRequest(`/vault/documents/${d.id}/reminder`, token, { method: "POST" }), "Renewal task added to your tasks.")}>{d.reminder_task_id ? "Reminder set ✓" : "Remind me"}</button>}
            <button className="text-button" onClick={() => { const nd = window.prompt("New expiry date (YYYY-MM-DD), empty for none", d.expires_on || ""); if (nd !== null) void run(apiRequest(`/vault/documents/${d.id}`, token, patchJson({ expires_on: nd.trim() || null })), "Updated."); }}>Edit expiry</button>
            <button className="danger-link" onClick={() => { if (window.confirm(`Delete ${d.name} from the vault?`)) void run(apiRequest(`/vault/documents/${d.id}`, token, { method: "DELETE" }), "Deleted."); }}>Delete</button>
          </div>
        </div>)}
          {!docs.length && <div className="empty-state">Add your passport, visas, IDs, insurance and warranties. Sakuna reminds you before they expire.</div>}</div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">ADD A DOCUMENT</p><h2>Details, not files</h2></div></div>
        <form onSubmit={add}>
          <div className="field-grid">
            <label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sri Lankan passport" maxLength={120}/></label>
            <label>Issued<input type="date" value={form.issued_on} onChange={e => setForm({ ...form, issued_on: e.target.value })}/></label>
            <label>Expires<input type="date" value={form.expires_on} onChange={e => setForm({ ...form, expires_on: e.target.value })}/></label>
            <label className="span-all">Number (optional, encrypted)<input value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} placeholder="Stored encrypted; only the last 3 characters are shown" maxLength={60} autoComplete="off"/></label>
            <label className="span-all">Where the copy is<input value={form.location_note} onChange={e => setForm({ ...form, location_note: e.target.value })} placeholder="e.g. Home safe · scan in Google Drive › Documents" maxLength={300}/></label>
          </div>
          <div className="form-actions"><button className="primary">Save document</button></div>
        </form>
        <p className="muted small-copy">{v.note} Passports default to a 9-month renewal reminder because many countries require 6 months of validity: check your destination's rule.</p>
      </section>
    </div>
  </>;
}
