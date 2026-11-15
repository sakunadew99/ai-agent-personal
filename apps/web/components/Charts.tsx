"use client";
import { ReactNode, useState } from "react";

/** Small SVG chart kit for the dashboards. Colours come from CSS variables in dash.css (dark and light themes). */
export const SERIES = ["var(--d-green)", "var(--d-blue)", "var(--d-amber)", "var(--d-violet)", "var(--d-red)", "var(--d-teal)", "var(--d-yellow)", "var(--d-orange)"];
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));
export const short = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

export function Ring({ value, size = 132, stroke = 12, color = "var(--d-green)", label, sub }: { value: number; size?: number; stroke?: number; color?: string; label?: ReactNode; sub?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = clamp(value);
  return <div className="d-ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v)} percent`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--d-track)" strokeWidth={stroke}/>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="d-ring-arc"/>
    </svg>
    <div className="d-ring-text"><b style={{ fontSize: size / 4.2 }}>{label ?? Math.round(v)}</b>{sub && <small>{sub}</small>}</div>
  </div>;
}

export function Meter({ value, label, right, color = "var(--d-green)" }: { value: number; label?: ReactNode; right?: ReactNode; color?: string }) {
  return <div className="d-meter">{(label || right) && <div className="d-meter-head"><span>{label}</span><b style={{ color }}>{right}</b></div>}
    <div className="d-track"><span style={{ width: `${clamp(value)}%`, background: color }}/></div></div>;
}

export type Bar = { label: string; value: number; color?: string; highlight?: boolean };
export function Bars({ data, height = 160, goal, format = (n: number) => short(n) }: { data: Bar[]; height?: number; goal?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, goal || 0, ...data.map(d => d.value));
  const shown = hover ?? data.findIndex(d => d.highlight);
  return <div className="d-bars" style={{ height: height + 22 }}>
    {goal ? <div className="d-goal" style={{ bottom: 22 + (goal / max) * (height - 16) }}><span>goal {format(goal)}</span></div> : null}
    {data.map((d, i) => <div key={`${d.label}-${i}`} className={`d-bar ${i === shown ? "on" : shown >= 0 ? "dim" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${d.label}: ${format(d.value)}`}>
      <div className="d-bar-col" style={{ height: height }}>
        {i === shown && <em>{format(d.value)}</em>}
        <span style={{ height: `${Math.max(d.value > 0 ? 3 : 1, (d.value / max) * (height - 16))}px`, background: d.color || "var(--d-green)" }}/>
      </div>
      <small>{d.label}</small>
    </div>)}
  </div>;
}

export function LineChart({ series, labels, height = 180, format = (n: number) => short(n) }: { series: { name: string; values: (number | null)[]; color?: string }[]; labels: string[]; height?: number; format?: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, P = 14;
  const all = series.flatMap(s => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const n = labels.length;
  if (!all.length || !n) return <div className="d-empty">No data yet</div>;
  let lo = Math.min(0, ...all), hi = Math.max(...all); if (hi === lo) hi = lo + 1;
  const x = (i: number) => n === 1 ? W / 2 : P + (i / (n - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const at = hover ?? n - 1;
  return <div className="d-line">
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} onMouseLeave={() => setHover(null)}>
      {[0, 0.5, 1].map(f => <line key={f} x1={0} x2={W} y1={P + f * (H - 2 * P)} y2={P + f * (H - 2 * P)} className="d-grid"/>)}
      {series.map((s, si) => {
        const color = s.color || SERIES[si % SERIES.length];
        const pts = s.values.map((v, i) => v === null || !Number.isFinite(v) ? null : [x(i), y(v)] as const).filter(Boolean) as (readonly [number, number])[];
        if (!pts.length) return null;
        const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
        return <g key={s.name}>
          {si === 0 && <path d={`${path} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`} fill={color} opacity={0.12}/>}
          <path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
        </g>;
      })}
      <line x1={x(at)} x2={x(at)} y1={P} y2={H - P} className="d-cursor"/>
      {labels.map((_, i) => <rect key={i} x={x(i) - W / n / 2} width={W / n} y={0} height={H} fill="transparent" onMouseEnter={() => setHover(i)}/>)}
    </svg>
    <div className="d-line-foot"><span>{labels[0]}</span>
      <b>{labels[at]}: {series.map((s, si) => <i key={s.name} style={{ color: s.color || SERIES[si % SERIES.length] }}>{s.name} {s.values[at] === null ? "—" : format(Number(s.values[at]))}</i>)}</b>
      <span>{labels[n - 1]}</span></div>
  </div>;
}

export function Donut({ parts, size = 150, format = (n: number) => short(n), center }: { parts: { label: string; value: number; color?: string }[]; size?: number; format?: (n: number) => string; center?: ReactNode }) {
  const clean = parts.filter(p => p.value > 0);
  const total = clean.reduce((a, p) => a + p.value, 0);
  if (!total) return <div className="d-empty">Nothing recorded yet</div>;
  const r = size / 2 - 12, c = 2 * Math.PI * r;
  let offset = 0;
  return <div className="d-donut">
    <div className="d-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>{clean.map((p, i) => { const len = (p.value / total) * c; const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={p.color || SERIES[i % SERIES.length]} strokeWidth={16} strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>; offset += len; return el; })}</svg>
      <div className="d-ring-text">{center ?? <><b style={{ fontSize: 20 }}>{format(total)}</b><small>total</small></>}</div>
    </div>
    <ul className="d-legend">{clean.map((p, i) => <li key={p.label}><i style={{ background: p.color || SERIES[i % SERIES.length] }}/><span>{p.label}</span><em>{Math.round((p.value / total) * 100)}%</em><b>{format(p.value)}</b></li>)}</ul>
  </div>;
}

export function Stat({ label, value, hint, tone = "plain", icon, trend, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "plain" | "solid" | "green" | "blue" | "amber" | "red" | "violet"; icon?: string; trend?: number | null; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return <Tag className={`d-stat tone-${tone}`} onClick={onClick}>
    <div className="d-stat-head"><span>{label}</span>{icon && <i>{icon}</i>}</div>
    <b>{value}</b>
    {(hint || (trend !== undefined && trend !== null)) && <small>{trend !== undefined && trend !== null && <em className={trend >= 0 ? "up" : "down"}>{trend >= 0 ? "↑" : "↓"} {Math.abs(Math.round(trend))}% </em>}{hint}</small>}
  </Tag>;
}

export function WeekDots({ rows, today }: { rows: { label: string; done: boolean[]; onToggle?: (i: number) => void }[]; today?: number }) {
  return <div className="d-week">
    <div className="d-week-row head"><span/>{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <em key={i} className={i === today ? "today" : ""}>{d}</em>)}</div>
    {rows.map(r => <div className="d-week-row" key={r.label}><span>{r.label}</span>{r.done.map((on, i) =>
      <button key={i} className={`d-dot ${on ? "on" : ""} ${i === today ? "today" : ""}`} disabled={!r.onToggle} onClick={() => r.onToggle?.(i)} aria-label={`${r.label} ${on ? "done" : "not done"}`}/>)}</div>)}
  </div>;
}

export function Hero({ kicker, title, accent, sub, right, children }: { kicker?: string; title: ReactNode; accent?: string; sub?: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return <section className="d-hero"><div className="d-hero-glow"/><div className="d-hero-main">
    <div>{kicker && <p className="d-kicker">{kicker}</p>}<h2>{title}{accent && <span> {accent}</span>}</h2>{sub && <p className="d-sub">{sub}</p>}{children}</div>
    {right}</div></section>;
}

export const Card = ({ title, kicker, action, children, className = "" }: { title?: string; kicker?: string; action?: ReactNode; children: ReactNode; className?: string }) =>
  <section className={`d-card ${className}`}>{(title || kicker || action) && <div className="d-card-head"><div>{kicker && <p className="d-kicker">{kicker}</p>}{title && <h3>{title}</h3>}</div>{action}</div>}{children}</section>;
