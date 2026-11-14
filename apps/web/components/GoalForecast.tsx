"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, type JsonRecord as Row } from "@/lib/api";

const STATUS: Record<string, { label: string; tone: string }> = {
  achieved: { label: "achieved", tone: "good" }, ahead: { label: "ahead", tone: "good" }, on_track: { label: "on track", tone: "good" },
  behind: { label: "behind", tone: "warn" }, missed: { label: "date passed", tone: "warn" },
  not_enough_data: { label: "needs data", tone: "muted" }, no_deadline: { label: "no date", tone: "muted" },
};
const LEVEL_LABEL: Record<string, string> = { floor: "Floor · must-have", realistic: "Realistic", stretch: "Stretch · big dream" };
const num = (v: unknown) => v === null || v === undefined ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Goal engine panel inside a goal card: three levels, status, needed per month/week, forecast range. */
export function GoalForecast({ token, goalId }: { token: string; goalId: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, { value: string; date: string }>>({});
  const [error, setError] = useState("");
  const load = useCallback(() => {
    apiRequest<Row>(`/goals/${goalId}/forecast`, token).then(d => {
      setData(d);
      const f: Record<string, { value: string; date: string }> = {};
      for (const lv of ["floor", "realistic", "stretch"]) {
        const found = (d.levels as Row[]).find(x => x.level === lv);
        f[lv] = { value: found ? String(found.target) : "", date: found?.target_date || "" };
      }
      setForm(f);
    }).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load"));
  }, [goalId, token]);
  useEffect(() => { load(); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    const levels = Object.entries(form).filter(([, v]) => v.value.trim()).map(([level, v]) => ({ level, target_value: v.value.replace(/,/g, ""), ...(v.date ? { target_date: v.date } : {}) }));
    try { setData(await apiRequest<Row>(`/goals/${goalId}/levels`, token, { method: "PUT", body: JSON.stringify({ levels }) })); setEditing(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save"); }
  }

  if (!data) return error ? <p className="warning-copy">{error}</p> : null;
  const unit = data.currency || data.unit || "";
  const rate = data.rate_per_month || {};
  return <div className="forecast">
    <div className="forecast-head"><small className="muted">Now: <b>{num(data.current)} {unit}</b>
      {rate.trend != null ? ` · trend ${Number(rate.trend) >= 0 ? "+" : ""}${num(rate.trend)}/month` : ""} · source: {String(data.metric).replaceAll("_", " ")}</small>
      <button className="text-button" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Set levels"}</button></div>
    {(data.levels as Row[]).map(lv => { const s = STATUS[lv.status] || { label: lv.status, tone: "muted" }; return <div className="forecast-level" key={lv.level}>
      <div className="forecast-level-head"><b>{LEVEL_LABEL[lv.level] || lv.level}</b><span className={`fc-status ${s.tone}`}>{s.label}</span></div>
      <div className="progress"><span style={{ width: `${lv.percent ?? 0}%` }}/></div>
      <small className="muted">{num(lv.target)} {unit}{lv.target_date ? ` by ${new Date(`${lv.target_date}T12:00:00`).toLocaleDateString()}` : ""}
        {lv.required_per_month != null && Number(lv.required_per_month) > 0 ? ` · needs ${num(lv.required_per_month)}/month (${num(lv.required_per_week)}/week)` : ""}
        {lv.projected?.trend != null ? ` · projected ${num(lv.projected.conservative)}–${num(lv.projected.optimistic)}` : ""}
        {lv.eta ? ` · at this pace: ${new Date(`${lv.eta}T12:00:00`).toLocaleDateString([], { month: "short", year: "numeric" })}` : ""}</small>
    </div>; })}
    {!data.levels.length && !editing && <small className="muted">Add floor / realistic / stretch targets so progress is measured against all three.</small>}
    {editing && <form className="levels-form" onSubmit={save}>
      {(["floor", "realistic", "stretch"] as const).map(lv => <label key={lv}><span>{LEVEL_LABEL[lv]}</span>
        <input value={form[lv]?.value || ""} onChange={e => setForm({ ...form, [lv]: { ...form[lv], value: e.target.value } })} placeholder="Target" inputMode="decimal"/>
        <input type="date" value={form[lv]?.date || ""} onChange={e => setForm({ ...form, [lv]: { ...form[lv], date: e.target.value } })} aria-label={`${lv} date`}/></label>)}
      <button className="primary">Save levels</button>
    </form>}
    {(data.notes as string[]).map((n, i) => <small key={i} className="muted fc-note">{n}</small>)}
    {error && <p className="warning-copy">{error}</p>}
  </div>;
}
