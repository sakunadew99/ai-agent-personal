"use client";
/* Planner board (week/month grid with layers), Inbox (move anything anywhere), Habit manager, Subscriptions,
   Job finder, Learning radar and the Rewards game hero. Everything is your own data or public feeds; nothing acts alone. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest as call, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { Bars, Card, Donut, Hero, Meter, Ring, SERIES, short, Stat } from "./Charts";
import { LinkedInLinks } from "./LifeOsPages3";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : "");
const minutes = (t?: string | null) => (t ? Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)) : null);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function useNote() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ok = useCallback((text: string) => setNote({ ok: true, text }), []);
  const fail = useCallback((e: unknown) => setNote({ ok: false, text: errText(e) }), []);
  return { ok, fail, view: note ? <p className={note.ok ? "success-note" : "warning-copy"} onClick={() => setNote(null)}>{note.text}</p> : null };
}

// =====================================================================================================================
// PLANNER BOARD: week grid / month grid / agenda, with layers you switch on and off
// =====================================================================================================================

type Ev = { id: string; layer: string; title: string; day: string; start: number | null; end: number | null; color: string; done?: boolean; note?: string };
const LAYERS: { key: string; label: string; color: string }[] = [
  { key: "task", label: "✓ Tasks", color: "var(--d-green)" }, { key: "plan", label: "▦ Plan blocks", color: "var(--d-blue)" },
  { key: "routine", label: "☀️ Routines", color: "var(--d-teal)" }, { key: "bill", label: "💳 Bills & renewals", color: "var(--d-red)" },
  { key: "goal", label: "🎯 Goal dates", color: "var(--d-violet)" }, { key: "exam", label: "🎓 Exams", color: "var(--d-amber)" },
  { key: "wish", label: "✨ Wishes", color: "var(--d-yellow)" }, { key: "buy", label: "🛒 Shopping", color: "var(--d-orange)" },
];
const COLOR = Object.fromEntries(LAYERS.map(l => [l.key, l.color]));

export function PlannerBoard({ token }: { token: string }) {
  const [view, setView] = useState<"week" | "month" | "agenda">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(LAYERS.map(l => [l.key, !["wish", "buy"].includes(l.key)])));
  const [src, setSrc] = useState<Row | null>(null);
  const [version, setVersion] = useState(0);
  const n = useNote();
  useEffect(() => {
    const opt = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const start = iso(mondayOf(anchor));
    Promise.all([opt(call<Row[]>("/tasks", token), []), opt(call<Row[]>(`/planner/weekly?start=${start}`, token), []), opt(call<Row[]>("/routines", token), []),
      opt(call<Row>("/routines/week", token), {}), opt(call<Row>("/subscriptions", token), { items: [] }), opt(call<Row[]>("/goals", token), []),
      opt(call<Row[]>("/exams", token), []), opt(call<Row[]>("/money/wishlist", token), []), opt(call<Row[]>("/money/buy-list?include_checked=false", token), [])])
      .then(([tasks, plans, routines, week, subs, goals, exams, wishes, buys]) => setSrc({ tasks, plans, routines, week, subs, goals, exams, wishes, buys }));
  }, [token, anchor, version]);

  const events = useMemo<Ev[]>(() => {
    if (!src) return [];
    const out: Ev[] = [];
    const local = (s: string) => { const d = new Date(s); return { day: iso(d), min: d.getHours() * 60 + d.getMinutes() }; };
    for (const t of src.tasks as Row[]) if (t.due_at && t.status !== "cancelled") {
      const { day, min } = local(t.due_at); out.push({ id: `t${t.id}`, layer: "task", title: t.title, day, start: min, end: min + (t.duration_minutes || 30), color: COLOR.task, done: t.status === "done", note: t.priority });
    }
    for (const p of src.plans as Row[]) for (const it of (p.items as Row[]) || []) {
      if (it.kind === "task") continue;
      const a = local(it.starts_at), b = local(it.ends_at);
      out.push({ id: `p${it.id}`, layer: "plan", title: it.title, day: a.day, start: a.min, end: b.day === a.day ? b.min : 1440, color: COLOR.plan, note: it.kind });
    }
    const work: number[] = src.week?.work_days || [1, 2, 3, 4, 5], gym: number[] = src.week?.gym_days || [];
    const first = view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : mondayOf(anchor);
    const span = view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() : 7;
    for (let i = 0; i < span; i++) {
      const d = addDays(first, i), wd = ((d.getDay() + 6) % 7) + 1;
      for (const r of src.routines as Row[]) {
        if (!r.active || r.kind !== "routine") continue;
        const runs = r.day_rule === "gym" ? gym.includes(wd) : r.day_rule === "work" ? work.includes(wd) : r.day_rule === "off" ? !work.includes(wd) : (r.days as number[]).includes(wd);
        const st = minutes(r.start_time);
        if (runs) out.push({ id: `r${r.id}${iso(d)}`, layer: "routine", title: `${r.icon} ${r.name}`, day: iso(d), start: st, end: st == null ? null : st + r.duration_minutes, color: COLOR.routine });
      }
    }
    for (const s of (src.subs.items as Row[]) || []) if (s.active) out.push({ id: `s${s.id}`, layer: "bill", title: `${s.name}${s.amount != null ? ` · ${s.currency} ${Number(s.amount).toLocaleString()}` : ""}`, day: s.next_due, start: null, end: null, color: COLOR.bill, note: s.state });
    for (const g of src.goals as Row[]) if (g.due_date) out.push({ id: `g${g.id}`, layer: "goal", title: `🎯 ${g.title}`, day: g.due_date, start: null, end: null, color: COLOR.goal });
    for (const x of src.exams as Row[]) if (x.exam_date && x.active) out.push({ id: `e${x.id}`, layer: "exam", title: `🎓 ${x.name} exam`, day: x.exam_date, start: null, end: null, color: COLOR.exam });
    for (const w of src.wishes as Row[]) if (w.target_date && w.status === "active") out.push({ id: `w${w.id}`, layer: "wish", title: `✨ ${w.name}`, day: w.target_date, start: null, end: null, color: COLOR.wish });
    for (const b of src.buys as Row[]) if (b.need_by) out.push({ id: `b${b.id}`, layer: "buy", title: `🛒 ${b.name}`, day: b.need_by, start: null, end: null, color: COLOR.buy });
    return out.filter(e => on[e.layer]);
  }, [src, on, view, anchor]);

  async function quickAdd(day: string, min: number | null) {
    const title = window.prompt(`New task on ${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}${min != null ? ` at ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}` : ""}:`);
    if (!title?.trim()) return;
    const due = new Date(`${day}T${min != null ? `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}` : "09:00"}:00`);
    try { await call("/tasks", token, postJson({ title: title.trim(), priority: "medium", category: "personal", duration_minutes: 30, due_at: due.toISOString() })); n.ok("Task added"); setVersion(v => v + 1); } catch (e) { n.fail(e); }
  }

  const today = iso(new Date());
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(anchor), i));
  const counts = LAYERS.map(l => ({ label: l.label, value: events.filter(e => e.layer === l.key).length, color: l.color })).filter(x => x.value);
  const move = (k: number) => setAnchor(a => view === "month" ? new Date(a.getFullYear(), a.getMonth() + k, 1) : addDays(a, 7 * k));
  const HOUR = 44, FROM = 5, TO = 24;
  const title = view === "month" ? anchor.toLocaleDateString([], { month: "long", year: "numeric" })
    : `${weekDays[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString([], { day: "numeric", month: "short" })}`;
  return <div className="d-dash">
    <Hero kicker="Planner board" title={title} sub="Your week as layers: tasks, plan blocks, routines, bills, goals, exams, wishes and shopping. Click an empty slot to add a task there."
      right={<Donut size={130} format={x => String(x)} center={<><b style={{ fontSize: 20 }}>{events.length}</b><small>items</small></>} parts={counts}/>}>
      <div className="d-row" style={{ marginTop: 12 }}>
        {(["week", "month", "agenda"] as const).map(v => <button key={v} className={`d-chip ${view === v ? "on" : ""}`} onClick={() => setView(v)}>{{ week: "▦ Week grid", month: "📅 Month grid", agenda: "☰ Agenda" }[v]}</button>)}
        <button className="d-btn ghost" onClick={() => move(-1)}>‹</button><button className="d-btn ghost" onClick={() => setAnchor(new Date())}>Today</button><button className="d-btn ghost" onClick={() => move(1)}>›</button>
      </div>
      <div className="d-chips" style={{ marginTop: 10 }}>{LAYERS.map(l => <button key={l.key} className="d-chip" onClick={() => setOn(o => ({ ...o, [l.key]: !o[l.key] }))}
        style={on[l.key] ? { background: `color-mix(in srgb, ${l.color} 22%, transparent)`, borderColor: l.color, color: "var(--d-text)" } : { opacity: 0.5 }}>{l.label}</button>)}</div>
    </Hero>
    {n.view}
    {!src ? <div className="d-empty">Loading your board…</div> : view === "week" ? <section className="d-card" style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: `52px repeat(7, minmax(110px, 1fr))`, minWidth: 820 }}>
        <div/>{weekDays.map(d => <div key={iso(d)} style={{ textAlign: "center", padding: "6px 0", fontWeight: 800, color: iso(d) === today ? "var(--d-green)" : "var(--d-text)" }}>
          {DAYS[(d.getDay() + 6) % 7]} <span style={{ color: "var(--d-muted)" }}>{d.getDate()}</span></div>)}
        <div style={{ fontSize: 10, color: "var(--d-muted)", padding: "4px 0" }}>all day</div>
        {weekDays.map(d => <div key={`a${iso(d)}`} style={{ borderTop: "1px solid var(--d-line)", padding: 3, minHeight: 28, display: "grid", gap: 3 }}>
          {events.filter(e => e.day === iso(d) && e.start == null).map(e => <span key={e.id} title={e.title} style={{ background: `color-mix(in srgb, ${e.color} 22%, transparent)`, borderLeft: `3px solid ${e.color}`, borderRadius: 6, padding: "2px 6px", fontSize: 11, color: "var(--d-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{e.title}</span>)}</div>)}
        <div style={{ position: "relative", height: (TO - FROM) * HOUR }}>{Array.from({ length: TO - FROM }, (_, h) => <small key={h} style={{ position: "absolute", top: h * HOUR - 6, right: 6, color: "var(--d-muted)", fontSize: 10 }}>{String(FROM + h).padStart(2, "0")}:00</small>)}</div>
        {weekDays.map(d => { const day = iso(d); const list = events.filter(e => e.day === day && e.start != null);
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
          return <div key={`g${day}`} style={{ position: "relative", height: (TO - FROM) * HOUR, borderLeft: "1px solid var(--d-line)", background: day === today ? "color-mix(in srgb, var(--d-green) 5%, transparent)" : undefined }}
            onClick={e => { if (e.target !== e.currentTarget) return; const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const m = Math.round(((e.clientY - rect.top) / HOUR * 60 + FROM * 60) / 30) * 30; void quickAdd(day, m); }}>
            {Array.from({ length: TO - FROM }, (_, h) => <div key={h} style={{ position: "absolute", left: 0, right: 0, top: h * HOUR, borderTop: "1px dashed var(--d-line)", pointerEvents: "none" }}/>)}
            {day === today && nowMin >= FROM * 60 && <div style={{ position: "absolute", left: 0, right: 0, top: (nowMin - FROM * 60) / 60 * HOUR, borderTop: "2px solid var(--d-red)", pointerEvents: "none", zIndex: 3 }}/>}
            {list.map((e, i) => { const st = Math.max(e.start!, FROM * 60), en = Math.min(Math.max(e.end ?? st + 30, st + 20), TO * 60);
              const overlap = list.filter(o => o.start! < en && (o.end ?? o.start! + 30) > st);
              const col = overlap.indexOf(e), cols = overlap.length;
              return <div key={e.id + i} title={`${e.title}${e.note ? ` · ${e.note}` : ""}`} style={{ position: "absolute", top: (st - FROM * 60) / 60 * HOUR, height: Math.max(18, (en - st) / 60 * HOUR - 2),
                left: `calc(${(col / cols) * 100}% + 2px)`, width: `calc(${100 / cols}% - 4px)`, background: `color-mix(in srgb, ${e.color} 26%, var(--d-card))`, borderLeft: `3px solid ${e.color}`,
                borderRadius: 8, padding: "2px 6px", fontSize: 11, color: "var(--d-text)", overflow: "hidden", textDecoration: e.done ? "line-through" : "none", opacity: e.done ? 0.6 : 1 }}>
                <b>{e.title}</b><br/><span style={{ color: "var(--d-muted)" }}>{String(Math.floor(e.start! / 60)).padStart(2, "0")}:{String(e.start! % 60).padStart(2, "0")}</span></div>; })}
          </div>; })}
      </div>
    </section> : view === "month" ? <section className="d-card">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {DAYS.map(d => <small key={d} style={{ textAlign: "center", color: "var(--d-muted)", fontWeight: 800 }}>{d}</small>)}
        {(() => { const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1); const pad = (first.getDay() + 6) % 7; const len = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
          return [...Array(pad).fill(null), ...Array.from({ length: len }, (_, i) => addDays(first, i))].map((d, i) => d == null ? <div key={`x${i}`}/> : (() => {
            const day = iso(d); const list = events.filter(e => e.day === day).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
            return <div key={day} onClick={() => void quickAdd(day, null)} style={{ minHeight: 96, borderRadius: 12, border: day === today ? "2px solid var(--d-green)" : "1px solid var(--d-line)", padding: 5, background: "var(--d-card2)", cursor: "pointer", display: "grid", alignContent: "start", gap: 3 }}>
              <b style={{ color: "var(--d-text)", fontSize: 12 }}>{d.getDate()}</b>
              {list.slice(0, 4).map(e => <span key={e.id} title={e.title} onClick={ev => ev.stopPropagation()} style={{ fontSize: 10.5, borderLeft: `3px solid ${e.color}`, paddingLeft: 4, color: "var(--d-text)", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{e.title}</span>)}
              {list.length > 4 && <small style={{ color: "var(--d-muted)" }}>+{list.length - 4} more</small>}
            </div>; })()); })()}
      </div>
    </section> : <Card kicker="Agenda" title="Next 7 days">{weekDays.map(d => { const day = iso(d); const list = events.filter(e => e.day === day).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
      return <div key={day} style={{ display: "grid", gap: 4 }}><b style={{ color: day === today ? "var(--d-green)" : "var(--d-text)" }}>{d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" })}</b>
        {list.length ? list.map(e => <div key={e.id} className="d-row" style={{ borderLeft: `3px solid ${e.color}`, paddingLeft: 8, color: "var(--d-text)" }}><span style={{ color: "var(--d-muted)", width: 48 }}>{e.start == null ? "all day" : `${String(Math.floor(e.start / 60)).padStart(2, "0")}:${String(e.start % 60).padStart(2, "0")}`}</span>{e.title}</div>) : <span className="d-note">Free</span>}</div>; })}</Card>}
  </div>;
}

// =====================================================================================================================
// INBOX: write anything, then move it to tasks, goals, habits, wish list, buy list or memory
// =====================================================================================================================

const TARGETS: { key: string; label: string; color: string }[] = [
  { key: "task", label: "✓ Task", color: "var(--d-green)" }, { key: "goal", label: "🎯 Goal", color: "var(--d-violet)" },
  { key: "habit", label: "🔁 Habit", color: "var(--d-teal)" }, { key: "wish", label: "✨ Wish", color: "var(--d-yellow)" },
  { key: "buy", label: "🛒 Buy", color: "var(--d-orange)" }, { key: "memory", label: "🧠 Memory", color: "var(--d-blue)" },
];
const SUGGEST: Record<string, string> = { task: "task", event: "task", reminder: "task", note: "memory", idea: "memory", expense: "buy", goal: "goal", habit: "habit", shopping: "buy" };

export function InboxPage({ token }: { token: string }) {
  const [items, setItems] = useState<Row[] | null>(null);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"open" | "done">("open");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Row>({});
  const n = useNote();
  const load = useCallback(() => { call<Row[]>("/capture", token).then(setItems).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 20);
    if (!lines.length) return;
    try { for (const line of lines) await call("/capture", token, postJson({ text: line })); setText(""); n.ok(`${lines.length} item${lines.length === 1 ? "" : "s"} in your inbox`); load(); } catch (e) { n.fail(e); }
  }
  async function move(item: Row, target: string) {
    const body: Row = { target, ...form };
    if (form.due_at) body.due_at = new Date(form.due_at).toISOString();
    for (const k of Object.keys(body)) if (body[k] === "" || body[k] == null) delete body[k];
    try { await call(`/capture/${item.id}/move`, token, postJson(body)); n.ok(`Moved to ${TARGETS.find(t => t.key === target)?.label.slice(2)} ✓`); setOpen(null); setForm({}); load(); } catch (e) { n.fail(e); }
  }
  const remove = (id: string) => call(`/capture/${id}`, token, { method: "DELETE" }).then(load).catch(n.fail);
  if (!items) return <div className="d-empty">Opening your inbox…</div>;
  const todo = items.filter(i => ["pending", "needs_confirmation"].includes(i.status));
  const done = items.filter(i => !["pending", "needs_confirmation"].includes(i.status));
  const where = TARGETS.map(t => ({ label: t.label, value: done.filter(d => (d.extracted?.moved_to?.target || (d.task_id ? "task" : d.status === "saved" ? "memory" : "")) === t.key).length, color: t.color }));
  const shown = tab === "open" ? todo : done;
  return <div className="d-dash">
    <Hero kicker="Inbox · capture everything" title="Empty your head," accent="sort later" sub="One line per thought. Then send each one where it belongs: task, goal, habit, wish list, buy list or memory. Nothing moves until you click."
      right={<Ring value={items.length ? (done.length / items.length) * 100 : 0} size={128} label={`${todo.length}`} sub="to sort"/>}>
      <textarea className="d-input" rows={3} style={{ marginTop: 12, width: "100%", boxSizing: "border-box" }} value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void add(); }} placeholder={"call the bank tomorrow\nnew running shoes\nmilk, eggs\nidea: portfolio site"}/>
      <div className="d-row" style={{ marginTop: 8 }}><button className="d-btn" disabled={!text.trim()} onClick={() => void add()}>Add to inbox</button><span className="d-note">Ctrl + Enter · one line = one item</span></div>
    </Hero>
    {n.view}
    <div className="d-grid-3">
      <Card kicker={tab === "open" ? `To sort · ${todo.length}` : `Sorted · ${done.length}`} title="" action={<div className="d-chips"><button className={`d-chip ${tab === "open" ? "on" : ""}`} onClick={() => setTab("open")}>To sort</button><button className={`d-chip ${tab === "done" ? "on" : ""}`} onClick={() => setTab("done")}>Sorted</button></div>}>
        {shown.length ? shown.map(i => { const suggest = SUGGEST[i.classified_type] || "task"; const moved = i.extracted?.moved_to?.target || (i.task_id ? "task" : i.status === "saved" ? "memory" : "");
          return <div key={i.id} className="d-program" style={{ borderLeft: `4px solid ${TARGETS.find(t => t.key === (tab === "open" ? suggest : moved))?.color || "var(--d-line)"}` }}>
            <div className="d-row" style={{ justifyContent: "space-between" }}><b style={{ color: "var(--d-text)" }}>{i.raw_text}</b>
              <span className="d-row">{tab === "open" ? <span className="d-tag">looks like: {suggest}</span> : <span className="d-tag green">→ {moved || i.status}</span>}<button className="danger-link" onClick={() => void remove(i.id)}>✕</button></span></div>
            {tab === "open" && <>
              <div className="d-chips">{TARGETS.map(t => <button key={t.key} className={`d-chip ${t.key === suggest ? "on" : ""}`} onClick={() => void move(i, t.key)}>{t.label}</button>)}
                <button className="text-button" onClick={() => { setOpen(open === i.id ? null : i.id); setForm({}); }}>{open === i.id ? "Hide details" : "＋ date, time, price…"}</button></div>
              {open === i.id && <div className="d-row">
                <input className="d-input" placeholder="Title (optional)" value={form.title || ""} onChange={e => setForm({ ...form, title: e.target.value })}/>
                <label className="d-note">Task date & time <input className="d-input" type="datetime-local" value={form.due_at || ""} onChange={e => setForm({ ...form, due_at: e.target.value })}/></label>
                <label className="d-note">Date (goal / wish / buy) <input className="d-input" type="date" value={form.due_date || ""} onChange={e => setForm({ ...form, due_date: e.target.value })}/></label>
                <input className="d-input" type="number" placeholder="Price (wish / buy)" value={form.price || ""} onChange={e => setForm({ ...form, price: e.target.value })}/>
                <select className="d-input" value={form.priority || ""} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="">Priority</option><option>low</option><option>medium</option><option>high</option></select>
                <label className="d-note">Habit reminder <input className="d-input" type="time" value={form.reminder_time || ""} onChange={e => setForm({ ...form, reminder_time: e.target.value })}/></label>
              </div>}
            </>}
          </div>; }) : <div className="d-empty">{tab === "open" ? "Inbox zero 🎉 Write anything above." : "Nothing sorted yet."}</div>}
      </Card>
      <Card kicker="Where things went" title={`${done.length} sorted`}><Donut parts={where} size={140} format={x => String(x)}/>
        <p className="d-note">Tip: the assistant understands “add milk to my buy list”, “wish list: headphones” or “remind me to call mum at 6”.</p></Card>
    </div>
  </div>;
}

// =====================================================================================================================
// HABITS: create, edit, archive; icon, reminder time and times-per-week
// =====================================================================================================================

const HABIT_ICONS = ["💪", "📚", "🧘", "💧", "🏃", "🥗", "😴", "🇩🇪", "🇬🇧", "✍️", "🙏", "🚭", "📵", "💊", "🎯"];
export function HabitManager({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ov, setOv] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const n = useNote();
  const load = useCallback(() => { Promise.all([call<Row[]>("/habits", token), call<Row>("/life/overview", token)]).then(([h, o]) => { setRows(h); setOv(o); }).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  const stats = Object.fromEntries(((ov?.habits || []) as Row[]).map(h => [h.id, h]));
  async function save() {
    if (!edit?.name?.trim()) return;
    const body = { name: edit.name.trim(), kind: edit.kind || "build", schedule: edit.schedule || "daily", icon: edit.icon || null, reminder_time: edit.reminder_time ? hhmm(edit.reminder_time) : null, target_per_week: edit.target_per_week ? Number(edit.target_per_week) : null };
    try { await call(edit.id ? `/habits/${edit.id}` : "/habits", token, edit.id ? patchJson(body) : postJson(body)); n.ok(edit.id ? "Habit updated" : "Habit created"); setEdit(null); load(); onChanged?.(); } catch (e) { n.fail(e); }
  }
  async function archive(h: Row) {
    if (!window.confirm(`Remove “${h.name}”? Its history stays in your reports.`)) return;
    try { await call(`/habits/${h.id}`, token, { method: "DELETE" }); load(); onChanged?.(); } catch (e) { n.fail(e); }
  }
  const log = (h: Row) => call(`/habits/${h.id}/logs`, token, postJson({ completed: true })).then(() => { n.ok(`${h.icon || "✓"} ${h.name} done today`); load(); onChanged?.(); }).catch(n.fail);
  return <Card kicker="Habits" title={`${rows.length} active`} action={<button className="d-btn" onClick={() => setEdit({ name: "", kind: "build", schedule: "daily", icon: "💪" })}>＋ New habit</button>}>
    {n.view}
    {edit && <div className="d-program">
      <div className="d-row"><input className="d-input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Read 20 pages"/>
        <select className="d-input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}><option value="build">Build (do it)</option><option value="avoid">Avoid (stay away)</option></select></div>
      <div className="d-chips">{HABIT_ICONS.map(ic => <button key={ic} className={`d-chip ${edit.icon === ic ? "on" : ""}`} onClick={() => setEdit({ ...edit, icon: ic })}>{ic}</button>)}</div>
      <div className="d-row">
        <label className="d-note">Reminder time <input className="d-input" type="time" value={hhmm(edit.reminder_time)} onChange={e => setEdit({ ...edit, reminder_time: e.target.value })}/></label>
        <label className="d-note">Times per week <select className="d-input" value={edit.target_per_week || ""} onChange={e => setEdit({ ...edit, target_per_week: e.target.value })}><option value="">every day</option>{[1, 2, 3, 4, 5, 6, 7].map(x => <option key={x} value={x}>{x}×</option>)}</select></label>
        <label className="d-note">Schedule <select className="d-input" value={edit.schedule} onChange={e => setEdit({ ...edit, schedule: e.target.value })}><option>daily</option><option>weekdays</option><option>weekly</option><option>custom</option></select></label>
      </div>
      <div className="d-row"><button className="d-btn" onClick={() => void save()}>{edit.id ? "Save changes" : "Create habit"}</button><button className="d-btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
    </div>}
    <div className="d-programs">{rows.map((h, i) => { const s = stats[h.id] || {}; const week = (s.week || []).filter(Boolean).length; const target = h.target_per_week || 7;
      return <article key={h.id} className="d-program" style={{ borderTop: `3px solid ${SERIES[i % SERIES.length]}` }}>
        <div className="d-row" style={{ justifyContent: "space-between" }}><h4 style={{ fontSize: 16 }}>{h.icon || "•"} {h.name}</h4>{s.streak > 1 && <span className="d-tag amber">🔥 {s.streak}</span>}</div>
        <p>{h.kind === "avoid" ? "Avoid" : "Build"} · {h.target_per_week ? `${h.target_per_week}× a week` : h.schedule}{h.reminder_time ? ` · ⏰ ${hhmm(h.reminder_time)}` : ""}</p>
        <Meter value={(week / target) * 100} right={`${week}/${target} this week`} color={SERIES[i % SERIES.length]}/>
        <div className="d-row">{s.done_today ? <span className="d-tag green">✓ done today</span> : <button className="d-btn" onClick={() => void log(h)}>Done today ✓</button>}
          <button className="text-button" onClick={() => setEdit({ ...h })}>Edit</button><button className="danger-link" onClick={() => void archive(h)}>Delete</button></div>
      </article>; })}</div>
    {!rows.length && !edit && <div className="d-empty">No habits yet. Start with one small daily habit.</div>}
  </Card>;
}

// =====================================================================================================================
// SUBSCRIPTIONS AND RENEWALS (shown on Documents and Finance)
// =====================================================================================================================

const CATS = ["subscription", "bill", "insurance", "loan", "rent", "membership", "other"];
const CAT_ICON: Record<string, string> = { subscription: "📺", bill: "💡", insurance: "🛡️", loan: "🏦", rent: "🏠", membership: "🏋️", other: "📌" };
export function SubscriptionsPanel({ token }: { token: string }) {
  const [v, setV] = useState<Row | null>(null);
  const [form, setForm] = useState<Row | null>(null);
  const n = useNote();
  const load = useCallback(() => { call<Row>("/subscriptions", token).then(setV).catch(n.fail); }, [token, n.fail]);
  useEffect(() => { load(); }, [load]);
  if (!v) return null;
  async function save() {
    if (!form?.name || !form.next_due) { n.fail(new Error("Name and next due date are needed")); return; }
    const body: Row = { ...form, amount: form.amount === "" || form.amount == null ? null : form.amount, remind_days: Number(form.remind_days ?? 3) };
    delete body.id; for (const k of ["state", "days_left", "per_month", "last_paid_on", "active"]) delete body[k];
    try { await call(form.id ? `/subscriptions/${form.id}` : "/subscriptions", token, form.id ? patchJson(body) : postJson(body)); setForm(null); n.ok("Saved"); load(); } catch (e) { n.fail(e); }
  }
  const act = (s: Row, path: string, body: Row, note: string) => call(`/subscriptions/${s.id}/${path}`, token, postJson(body)).then(() => { n.ok(note); load(); }).catch(n.fail);
  const del = (s: Row) => { if (window.confirm(`Delete ${s.name}?`)) void call(`/subscriptions/${s.id}`, token, { method: "DELETE" }).then(load).catch(n.fail); };
  const cur = Object.keys(v.per_month)[0] || "LKR";
  const cats = Object.entries((v.by_category[cur] || {}) as Record<string, number>).map(([k, x]) => ({ label: `${CAT_ICON[k]} ${k}`, value: Number(x) }));
  return <div className="d-dash">
    <div className="d-stats">
      <Stat label="Per month" icon="💳" value={Object.entries(v.per_month).map(([c, x]) => `${c} ${short(Number(x))}`).join(" · ") || "—"} tone="solid"/>
      <Stat label="Per year" icon="📆" value={Object.entries(v.per_year).map(([c, x]) => `${c} ${short(Number(x))}`).join(" · ") || "—"} tone="blue"/>
      <Stat label="Due soon" icon="⏰" value={v.due_soon} tone={v.due_soon ? "amber" : "plain"} hint="within reminder window"/>
      <Stat label="Overdue" icon="⚠️" value={v.overdue} tone={v.overdue ? "red" : "plain"}/>
    </div>
    {n.view}
    <div className="d-grid-3">
      <Card kicker="Subscriptions, bills & renewals" title={`${(v.items as Row[]).filter(s => s.active).length} active`} action={<button className="d-btn" onClick={() => setForm({ name: "", category: "subscription", currency: "LKR", cycle: "monthly", next_due: iso(new Date()), remind_days: 3, amount: "" })}>＋ Add</button>}>
        {form && <div className="d-program">
          <div className="d-row"><input className="d-input" placeholder="Name, e.g. Netflix, Dialog, car insurance" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/>
            <select className="d-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]} {c}</option>)}</select></div>
          <div className="d-row"><input className="d-input" type="number" placeholder="Amount" value={form.amount ?? ""} onChange={e => setForm({ ...form, amount: e.target.value })}/>
            <input className="d-input" style={{ maxWidth: 90 }} value={form.currency} maxLength={3} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })}/>
            <select className="d-input" value={form.cycle} onChange={e => setForm({ ...form, cycle: e.target.value })}>{["weekly", "monthly", "quarterly", "yearly"].map(c => <option key={c}>{c}</option>)}</select></div>
          <div className="d-row"><label className="d-note">Next due <input className="d-input" type="date" value={form.next_due} onChange={e => setForm({ ...form, next_due: e.target.value })}/></label>
            <label className="d-note">Remind days before <input className="d-input" type="number" min={0} max={60} value={form.remind_days} onChange={e => setForm({ ...form, remind_days: e.target.value })}/></label>
            <input className="d-input" placeholder="Link (optional)" value={form.link || ""} onChange={e => setForm({ ...form, link: e.target.value })}/></div>
          <div className="d-row"><button className="d-btn" onClick={() => void save()}>Save</button><button className="d-btn ghost" onClick={() => setForm(null)}>Cancel</button></div>
        </div>}
        {(v.items as Row[]).map(s => <div key={s.id} className="d-biggest" style={{ opacity: s.active ? 1 : 0.5, gridTemplateColumns: "38px 1fr auto" }}>
          <i>{CAT_ICON[s.category]}</i>
          <div><b style={{ textTransform: "none" }}>{s.name}</b><small>{s.amount != null ? `${s.currency} ${Number(s.amount).toLocaleString()} / ${s.cycle}` : s.cycle} · due {new Date(`${s.next_due}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}
            {" "}<span className={`d-tag ${s.state === "overdue" ? "red" : s.state === "due_soon" ? "amber" : "green"}`}>{s.state === "overdue" ? `${-s.days_left} d overdue` : `${s.days_left} d`}</span></small></div>
          <div className="d-row" style={{ flexWrap: "nowrap" }}>
            <button className="text-button" title="I paid it: move to the next cycle" onClick={() => void act(s, "paid", { record_expense: s.amount != null }, `${s.name}: marked paid${s.amount != null ? " and logged as an expense" : ""}`)}>✓ Paid</button>
            <button className="text-button" title="Add a reminder task" onClick={() => void act(s, "remind", {}, "Reminder task added")}>⏰</button>
            <button className="text-button" onClick={() => setForm({ ...s, amount: s.amount ?? "" })}>Edit</button>
            <button className="danger-link" onClick={() => del(s)}>✕</button></div>
        </div>)}
        {!(v.items as Row[]).length && !form && <div className="d-empty">Add Netflix, phone, internet, insurance, rent, gym… Sakuna reminds you; it never pays.</div>}
      </Card>
      <Card kicker="Monthly cost by type" title={cur}><Donut parts={cats} size={140} format={x => `${cur} ${short(x)}`}/></Card>
    </div>
  </div>;
}

// =====================================================================================================================
// JOB FINDER
// =====================================================================================================================

export function JobFinder({ token }: { token: string }) {
  const [q, setQ] = useState(() => { try { return localStorage.getItem("sakuna.jobQuery") || "Python developer"; } catch { return "Python developer"; } });
  const [loc, setLoc] = useState(() => { try { return localStorage.getItem("sakuna.jobLoc") || "Germany"; } catch { return "Germany"; } });
  const [remote, setRemote] = useState(false);
  const [res, setRes] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(15);
  const n = useNote();
  async function search() {
    setBusy(true); setShown(15);
    try { localStorage.setItem("sakuna.jobQuery", q); localStorage.setItem("sakuna.jobLoc", loc); } catch { /* private window */ }
    try { setRes(await call<Row>(`/career/find?q=${encodeURIComponent(q)}&location=${encodeURIComponent(loc)}&remote=${remote}`, token)); } catch (e) { n.fail(e); } finally { setBusy(false); }
  }
  async function save(j: Row) {
    try { await call("/career/jobs", token, postJson({ company: j.company.slice(0, 200), role: j.title.slice(0, 200), url: j.url, status: "draft", notes: `${j.source} · ${j.location}${j.salary ? ` · ${j.salary}` : ""}` }));
      setRes(r => r && ({ ...r, jobs: (r.jobs as Row[]).map(x => x.id === j.id ? { ...x, saved: true } : x) })); n.ok("Saved to your job tracker"); } catch (e) { n.fail(e); }
  }
  const s: Row = res?.summary || {};
  return <div className="d-dash">
    <Hero kicker="Job finder · public job boards" title="Find your" accent="next role" sub="Searches Arbeitnow (Germany & EU), Remotive, Remote OK and Jobicy, then sums it up: skills in demand, companies, remote and Germany jobs. LinkedIn, XING, StepStone and others open as ready-made searches.">
      <div className="d-row" style={{ marginTop: 12 }}>
        <input className="d-input" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void search(); }} placeholder="Keywords, comma separated: Python developer, data engineer"/>
        <input className="d-input" style={{ maxWidth: 200 }} value={loc} onChange={e => setLoc(e.target.value)} placeholder="Location (optional)"/>
        <label className="d-row" style={{ color: "var(--d-text)" }}><input type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)}/> Remote only</label>
        <button className="d-btn" disabled={busy || q.trim().length < 2} onClick={() => void search()}>{busy ? "Searching…" : "Find jobs"}</button>
      </div>
      {res && <div className="d-chips" style={{ marginTop: 10 }}>{(res.links as Row[]).map(l => <a key={l.name} className="d-chip" href={l.url} target="_blank" rel="noreferrer">{l.name} ↗</a>)}</div>}
    </Hero>
    {n.view}
    {res && <LinkedInLinks token={token} q={q}/>}
    {res && <>
      {(res.errors as string[]).length > 0 && <p className="d-warn">{(res.errors as string[]).join(" · ")}</p>}
      <div className="d-stats">
        <Stat label="Matching jobs" icon="💼" value={s.total} tone="solid"/>
        <Stat label="Remote" icon="🌍" value={s.remote} tone="blue"/>
        <Stat label="In Germany" icon="🇩🇪" value={s.germany} tone="amber"/>
        <Stat label="Visa / relocation" icon="✈️" value={s.visa_or_relocation} tone="violet" hint="mentioned in the post"/>
      </div>
      <div className="d-grid-3">
        <Card kicker="Skills in demand" title="From these jobs"><Bars data={(s.skills as [string, number][]).map(([k, c]) => ({ label: k, value: c }))} height={140} format={x => String(x)}/>
          {(s.skills_to_learn as string[]).length > 0 && <p className="d-note">Not in your Career skills yet: <b style={{ color: "var(--d-amber)" }}>{(s.skills_to_learn as string[]).join(", ")}</b>. The Learning radar can find material for them.</p>}</Card>
        <Card kicker="Where & who" title="">
          <Donut size={130} format={x => String(x)} parts={(s.by_source as [string, number][]).map(([k, c]) => ({ label: k, value: c }))}/>
          <p className="d-note">Top companies: {(s.companies as [string, number][]).slice(0, 5).map(([c, k]) => `${c} (${k})`).join(", ") || "—"}</p></Card>
      </div>
      <Card kicker="Jobs" title="Best match first">
        <div className="d-programs">{(res.jobs as Row[]).slice(0, shown).map(j => <article key={j.id} className="d-program">
          <h4>{j.title}</h4><p>{j.company} · {j.location}</p>
          <div className="d-row">{j.remote && <span className="d-tag green">remote</span>}<span className="d-tag">{j.source}</span>{j.posted && <span className="d-tag">{j.posted}</span>}{j.salary && <span className="d-tag amber">{j.salary}</span>}
            {(j.tags as string[]).slice(0, 3).map(t => <span key={t} className="d-tag">{t}</span>)}</div>
          <p>{j.snippet.slice(0, 180)}{j.snippet.length > 180 ? "…" : ""}</p>
          <div className="d-row">{j.saved ? <span className="d-tag green">✓ in tracker</span> : <button className="d-btn" onClick={() => void save(j)}>Save</button>}<a className="d-btn ghost" href={j.url} target="_blank" rel="noreferrer">Open & apply ↗</a></div>
        </article>)}</div>
        {shown < (res.jobs as Row[]).length && <button className="d-btn ghost" onClick={() => setShown(x => x + 15)}>Show more</button>}
        <p className="d-note">{res.source_note} Applying is always you, on the job site.</p>
      </Card>
    </>}
  </div>;
}

// =====================================================================================================================
// LEARNING RADAR
// =====================================================================================================================

const TOPIC_IDEAS = ["python", "ai", "llm", "react", "typescript", "system design", "devops", "kubernetes", "data engineering", "security", "rust", "flutter", "career", "productivity"];
export function LearnRadar({ token }: { token: string }) {
  const [topics, setTopics] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("sakuna.learnTopics") || "") as string[]; } catch { return ["python", "ai", "system design"]; } });
  const [typed, setTyped] = useState("");
  const [res, setRes] = useState<Row | null>(null);
  const [src, setSrc] = useState("all");
  const [busy, setBusy] = useState(false);
  const n = useNote();
  const load = useCallback(async (list: string[]) => {
    setBusy(true);
    try { localStorage.setItem("sakuna.learnTopics", JSON.stringify(list)); } catch { /* private window */ }
    try { setRes(await call<Row>(`/learning/radar?topics=${encodeURIComponent(list.join(","))}`, token)); } catch (e) { n.fail(e); } finally { setBusy(false); }
  }, [token, n]);
  useEffect(() => { void load(topics); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (next: string[]) => { setTopics(next); void load(next); };
  const add = (t: string) => { const v = t.trim().toLowerCase(); if (v && !topics.includes(v) && topics.length < 6) keep([...topics, v]); setTyped(""); };
  const asTask = (i: Row) => call("/tasks", token, postJson({ title: `Learn: ${i.title}`.slice(0, 200), category: "learning", priority: "medium", duration_minutes: 30, notes: i.url })).then(() => n.ok("Added as a learning task 📚")).catch(n.fail);
  const asMemory = (i: Row) => call("/memories", token, postJson({ content: `${i.title} — ${i.url}`.slice(0, 2000), category: "note" })).then(() => n.ok("Saved to memory 🧠")).catch(n.fail);
  const items: Row[] = ((res?.items || []) as Row[]).filter(i => src === "all" || i.source === src);
  return <div className="d-dash">
    <Hero kicker="Learning radar" title="Learn what's" accent="new today" sub="Fresh and popular from Hacker News, dev.to and GitHub for your topics, one thing about the world from Wikipedia, and free tracks for software engineering, computer science, AI and everyday life.">
      <div className="d-chips" style={{ marginTop: 12 }}>{topics.map(t => <button key={t} className="d-chip on" onClick={() => keep(topics.filter(x => x !== t))}>{t} ✕</button>)}</div>
      <div className="d-row" style={{ marginTop: 8 }}><input className="d-input" value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(typed); }} placeholder="Add a topic"/>
        <button className="d-btn ghost" onClick={() => add(typed)}>Add</button><button className="d-btn" disabled={busy} onClick={() => void load(topics)}>{busy ? "Scanning…" : "↻ Refresh"}</button></div>
      <div className="d-chips" style={{ marginTop: 8 }}>{TOPIC_IDEAS.filter(t => !topics.includes(t)).map(t => <button key={t} className="d-chip" onClick={() => add(t)}>+ {t}</button>)}</div>
    </Hero>
    {n.view}
    {res && <>
      <div className="d-grid-3">
        <Card kicker="Trending around your topics" title={`${res.summary.total} fresh links`}>
          <Bars data={(res.summary.hot_tags as [string, number][]).slice(0, 10).map(([k, c]) => ({ label: k, value: c }))} height={120} format={x => String(x)}/>
          {(res.errors as string[]).length > 0 && <p className="d-warn">{(res.errors as string[]).slice(0, 3).join(" · ")}</p>}</Card>
        {res.today ? <Card kicker="🌍 Learn one thing today" title={res.today.title}>
          <p style={{ margin: 0, color: "var(--d-text)", lineHeight: 1.5 }}>{res.today.summary.slice(0, 320)}…</p>
          {res.today.url && <a className="text-button" href={res.today.url} target="_blank" rel="noreferrer">Read on Wikipedia ↗</a>}
          {(res.today.on_this_day as Row[]).map(e => <p key={e.year} className="d-note"><b>{e.year}</b> · {e.text}</p>)}</Card> : <Card kicker="Learn one thing today" title=""><p className="d-note">Wikipedia didn't answer.</p></Card>}
      </div>
      <Card kicker="Radar" title="Best first" action={<div className="d-chips">{["all", "Hacker News", "dev.to", "GitHub"].map(s => <button key={s} className={`d-chip ${src === s ? "on" : ""}`} onClick={() => setSrc(s)}>{s}</button>)}</div>}>
        <div className="d-programs">{items.slice(0, 30).map(i => <article key={i.url} className="d-program">
          <div className="d-row" style={{ justifyContent: "space-between" }}><span className="d-tag">{i.source} · {i.kind}</span><span className="d-tag amber">{i.source === "GitHub" ? "★" : "▲"} {i.score}</span></div>
          <h4><a href={i.url} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)" }}>{i.title}</a></h4>
          {i.summary && <p>{i.summary.slice(0, 160)}</p>}
          <div className="d-row"><button className="text-button" onClick={() => void asTask(i)}>📚 Learn later</button><button className="text-button" onClick={() => void asMemory(i)}>🧠 Save</button></div>
        </article>)}</div>
      </Card>
      <div className="d-programs">{(res.tracks as Row[]).map((t, k) => <Card key={t.key} kicker={`${t.icon} Free track`} title={t.title}>
        <ol className="d-list" style={{ borderLeft: `3px solid ${SERIES[k % SERIES.length]}`, paddingLeft: 26 }}>{(t.items as Row[]).map(x => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer" style={{ color: "var(--d-text)" }}>{x.title} ↗</a></li>)}</ol></Card>)}</div>
    </>}
  </div>;
}

// =====================================================================================================================
// REWARDS GAME HERO: level, XP bar, today's gems, badges, quests as missions, treats as a shop
// =====================================================================================================================

const BADGES = (g: Row) => [
  { icon: "🔥", name: "On fire", hint: "7-day streak", got: g.streak_days >= 7 }, { icon: "🌋", name: "Unstoppable", hint: "30-day streak", got: g.streak_days >= 30 },
  { icon: "⭐", name: "Rising", hint: "Level 3", got: g.level >= 3 }, { icon: "🏆", name: "Champion", hint: "Level 10", got: g.level >= 10 },
  { icon: "💎", name: "Balanced day", hint: "4 life areas in one day", got: (g.today?.areas || []).length >= 4 },
  { icon: "💯", name: "Max day", hint: "Hit the daily cap", got: g.today?.points >= g.today?.cap },
  { icon: "🎯", name: "Questing", hint: "3 active quests", got: (g.quests || []).length >= 3 }, { icon: "🎁", name: "Treat ready", hint: "Afford a treat", got: (g.treats || []).some((t: Row) => t.affordable) },
  { icon: "🪙", name: "Saver", hint: "1,000 points earned", got: g.total_earned >= 1000 }, { icon: "👑", name: "Legend", hint: "10,000 points earned", got: g.total_earned >= 10000 },
];
const AREA_GEMS: Record<string, string> = { health: "❤️", money: "💰", career: "💼", learning: "📚", mind: "🧘", relationships: "🤝", home: "🏠", fun: "🎉", focus: "⏱", routine: "☀️" };

export function RewardsGame({ token }: { token: string }) {
  const [g, setG] = useState<Row | null>(null);
  useEffect(() => { call<Row>("/game", token).then(setG).catch(() => setG(null)); }, [token]);
  if (!g) return null;
  const pct = g.next_level_at ? Math.min(100, (g.into_level / g.next_level_at) * 100) : 100;
  const badges = BADGES(g);
  const byDay = (g.recent as Row[]).reduce((acc: Record<string, number>, r) => { const d = String(r.at).slice(5, 10); acc[d] = (acc[d] || 0) + Number(r.points); return acc; }, {});
  return <div className="d-dash">
    <section className="d-hero" style={{ background: "radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, var(--d-violet) 30%, transparent), transparent 55%), radial-gradient(90% 120% at 0% 100%, color-mix(in srgb, var(--d-amber) 22%, transparent), transparent 60%), var(--d-card)" }}>
      <div className="d-hero-main">
        <div style={{ display: "grid", gap: 8, minWidth: 260, flex: 1 }}>
          <p className="d-kicker" style={{ color: "var(--d-amber)" }}>Life quest · level {g.level}{g.paused ? " · paused" : ""}</p>
          <h2 style={{ margin: 0, color: "var(--d-text)", fontSize: "clamp(28px, 4vw, 42px)" }}>{g.balance.toLocaleString()} <span style={{ color: "var(--d-amber)" }}>🪙</span></h2>
          <div className="d-track" style={{ height: 14 }}><span style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--d-violet), var(--d-amber))" }}/></div>
          <small style={{ color: "var(--d-muted)" }}>{g.into_level} / {g.next_level_at} XP to level {g.level + 1} · {g.total_earned.toLocaleString()} earned all time</small>
          <div className="d-row">{["health", "money", "career", "learning", "mind", "relationships", "home", "fun"].map(a => <span key={a} title={a} style={{ fontSize: 22, filter: (g.today.areas as string[]).includes(a) ? "none" : "grayscale(1) opacity(.3)" }}>{AREA_GEMS[a]}</span>)}
            <span className="d-note">{(g.today.areas as string[]).length}/{g.today.areas_for_bonus} areas for today's bonus</span></div>
        </div>
        <div className="d-row" style={{ gap: 18 }}>
          <Ring value={(g.today.points / Math.max(1, g.today.cap)) * 100} size={120} color="var(--d-amber)" label={`${g.today.points}`} sub={`of ${g.today.cap} today`}/>
          <Ring value={Math.min(100, (g.streak_days / 30) * 100)} size={120} color="var(--d-red)" label={`${g.streak_days}🔥`} sub="day streak"/>
        </div>
      </div>
    </section>
    <div className="d-grid-3">
      <Card kicker="Badges" title={`${badges.filter(b => b.got).length} / ${badges.length} unlocked`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10 }}>{badges.map(b => <div key={b.name} title={b.hint} style={{ textAlign: "center", padding: 10, borderRadius: 16, border: "1px solid var(--d-line)", background: b.got ? "color-mix(in srgb, var(--d-amber) 14%, var(--d-card2))" : "var(--d-card2)", opacity: b.got ? 1 : 0.45 }}>
          <div style={{ fontSize: 30, filter: b.got ? "none" : "grayscale(1)" }}>{b.icon}</div><b style={{ fontSize: 12, color: "var(--d-text)" }}>{b.name}</b><br/><small style={{ color: "var(--d-muted)", fontSize: 10.5 }}>{b.hint}</small></div>)}</div>
      </Card>
      <Card kicker="Missions" title={`${(g.quests as Row[]).length} active quest${(g.quests as Row[]).length === 1 ? "" : "s"}`}>
        {(g.quests as Row[]).length ? (g.quests as Row[]).map((qst, i) => <Meter key={qst.id} label={`${qst.done ? "✅" : "🗡️"} ${qst.title}`} value={(qst.count / Math.max(1, qst.target)) * 100} right={`${qst.count}/${qst.target} · +${qst.bonus_points}`} color={SERIES[i % SERIES.length]}/>) : <div className="d-empty">Start a quest below.</div>}
        <Bars data={Object.entries(byDay).reverse().map(([d, p]) => ({ label: d, value: p, color: "var(--d-amber)" }))} height={90} format={x => `${x} pts`}/>
      </Card>
    </div>
  </div>;
}
