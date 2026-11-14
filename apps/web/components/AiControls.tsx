"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, type JsonRecord as Row } from "@/lib/api";

/** AI usage meter and controls (guide 27.3-27.4): off switch, caps, per-feature off, what the AI can see. */
export function AiControls({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [caps, setCaps] = useState({ daily: "", monthly: "", cost: "" });
  const load = useCallback(() => {
    apiRequest<Row>("/ai/usage", token).then(d => { setV(d); setCaps({ daily: d.settings.daily_token_cap ?? "", monthly: d.settings.monthly_token_cap ?? "", cost: d.settings.monthly_cost_cap_usd ?? "" }); })
      .catch(reason => setError(reason instanceof Error ? reason.message : "Could not load"));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  async function save(body: Row) {
    setError("");
    try { const d = await apiRequest<Row>("/ai/settings", token, patchJson(body)); setV(d); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save"); }
  }
  if (!v) return error ? <p className="warning-copy">{error}</p> : null;
  const s = v.settings;
  const disabled: string[] = s.disabled_features || [];
  const toggleFeature = (g: string) => void save({ disabled_features: disabled.includes(g) ? disabled.filter(x => x !== g) : [...disabled, g] });
  const series = Object.entries(v.last_14_days as Record<string, number>);
  const max = Math.max(1, ...series.map(([, n]) => n));
  const statusText = v.status === "no_key" ? "No AI key on the server: everything runs on built-in rules (free)."
    : v.status === "blocked" ? v.blocked_reason : "AI is on.";

  return <div className="ai-controls">
    <div className="gmail-head"><b>AI usage and privacy</b><span className={`badge status-${v.status === "on" ? "connected" : "expired"}`}>{v.status === "on" ? "on" : v.status === "no_key" ? "rules only" : "paused"}</span></div>
    <small className="muted">{statusText}</small>
    <div className="ai-meter">
      <div><small className="muted">Today</small><b>{Number(v.today.tokens).toLocaleString()}</b><small className="muted">tokens · {v.today.calls} calls{s.daily_token_cap ? ` · cap ${Number(s.daily_token_cap).toLocaleString()}` : ""}</small>
        {s.daily_token_cap ? <div className="progress"><span style={{ width: `${Math.min(100, v.today.tokens / s.daily_token_cap * 100)}%` }}/></div> : null}</div>
      <div><small className="muted">This month</small><b>{Number(v.month.tokens).toLocaleString()}</b><small className="muted">tokens{v.cost_known ? ` · ≈ USD ${Number(v.month.cost_usd).toFixed(4)}` : ""}{s.monthly_token_cap ? ` · cap ${Number(s.monthly_token_cap).toLocaleString()}` : ""}</small></div>
    </div>
    {series.length > 0 && <div className="ai-bars" aria-label="Tokens per day, last 14 days">{series.map(([day, n]) => <span key={day} title={`${day}: ${n.toLocaleString()} tokens`} style={{ height: `${Math.max(4, n / max * 100)}%` }}/>)}</div>}
    <label className="inline-check ai-switch"><input type="checkbox" checked={!s.ai_off} onChange={e => void save({ ai_off: !e.target.checked })}/> Use AI (switch off to run everything on rules)</label>
    <div className="ai-features">{Object.entries(v.groups as Record<string, string>).map(([g, label]) => {
      const usage = (v.by_feature as Record<string, Row>)[g];
      return <label key={g} className="inline-check"><input type="checkbox" checked={!disabled.includes(g)} disabled={s.ai_off} onChange={() => toggleFeature(g)}/>
        {label}{usage ? <small className="muted"> · {Number(usage.tokens).toLocaleString()} tokens this month</small> : null}</label>;
    })}</div>
    <form className="inline-form" onSubmit={e => { e.preventDefault(); void save({ daily_token_cap: Number(caps.daily) || 0, monthly_token_cap: Number(caps.monthly) || 0, monthly_cost_cap_usd: caps.cost ? String(caps.cost) : "0" }); }}>
      <input value={caps.daily} onChange={e => setCaps({ ...caps, daily: e.target.value })} placeholder="Daily token cap" inputMode="numeric"/>
      <input value={caps.monthly} onChange={e => setCaps({ ...caps, monthly: e.target.value })} placeholder="Monthly token cap" inputMode="numeric"/>
      <input value={caps.cost} onChange={e => setCaps({ ...caps, cost: e.target.value })} placeholder="Monthly USD cap" inputMode="decimal"/>
      <button className="outline">Save caps</button>
    </form>
    <small className="muted">Leave a cap empty for no limit. When a cap is reached Sakuna switches to rules and tells you why. Cost is shown only if prices are set on the server.</small>
    <h4>What the AI can see</h4>
    <label className="inline-check"><input type="checkbox" checked={s.share_money} onChange={e => void save({ share_money: e.target.checked })}/> Share money totals with the AI (off = money questions answered privately by rules)</label>
    <label className="inline-check"><input type="checkbox" checked={s.share_health} onChange={e => void save({ share_health: e.target.checked })}/> Share health data with the AI</label>
    <ul className="ai-see">{(v.what_ai_can_see as string[]).map(line => <li key={line}>{line}</li>)}</ul>
    <small className="muted">Never sent: {(v.never_sent as string[]).join(" · ")}.</small>
    {v.last_block && v.status !== "blocked" && <small className="muted">Last time AI was skipped: {v.last_block}</small>}
    {error && <p className="warning-copy">{error}</p>}
  </div>;
}
