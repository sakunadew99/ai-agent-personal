import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { Bars, Hero, Meter, PALETTE, Ring, Segments, SplitBar, StatTile, TileRow } from "../charts";
import { DateField, isoDate, TimeField } from "../pickers";
import { Badge, Btn, C, Card, Empty, Field, H2, Kicker, Muted, Row as Line, Screen } from "../ui";
import { syncHabitReminders } from "../notify";
import { openInApp, type Track } from "../browser";
import { LinkedInCard } from "./LifeOs3Screens";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : "");
const short = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
const open = (url?: string, title?: string, track?: Track) => openInApp(url, title, track);
const chip = (on: boolean, color = C.green) => ({ borderColor: on ? color : C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: on ? `${color}33` : "transparent" });

/** Two views of one screen (e.g. "Find jobs | My tracker"). */
export function Switcher<T extends string>({ options, labels, render, initial }: { options: readonly T[]; labels: Record<T, string>; render: (v: T) => React.ReactNode; initial?: T }) {
  const [v, setV] = useState<T>(initial && options.includes(initial) ? initial : options[0]);
  return <View style={{ flex: 1 }}>
    {options.length <= 3 ? <View style={{ paddingHorizontal: 16, paddingTop: 10 }}><Segments options={options} value={v} onChange={setV} labels={labels}/></View>
      : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, gap: 8 }}>
        {options.map(o => <TouchableOpacity key={o} onPress={() => setV(o)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1,
          borderColor: v === o ? C.green : C.line, backgroundColor: v === o ? C.greenSoft : "transparent" }}>
          <Text style={{ color: v === o ? C.green : C.muted, fontWeight: "800" }}>{labels[o]}</Text></TouchableOpacity>)}</ScrollView>}
    <View style={{ flex: 1 }}>{render(v)}</View>
  </View>;
}

// =====================================================================================================================
// INBOX (Capture tab): write anything, move it to task / goal / habit / wish / buy / memory
// =====================================================================================================================

const TARGETS: [string, string, string][] = [["task", "✓ Task", "#3ee08f"], ["goal", "🎯 Goal", "#b48cff"], ["habit", "🔁 Habit", "#4fd1c5"],
  ["wish", "✨ Wish", "#e6e15a"], ["buy", "🛒 Buy", "#ff9f5a"], ["memory", "🧠 Memory", "#5aa8ff"]];
const SUGGEST: Record<string, string> = { task: "task", event: "task", reminder: "task", note: "memory", idea: "memory", expense: "buy", goal: "goal", habit: "habit", shopping: "buy" };

export function InboxScreen({ api, onError, onNotice, top }: Props & { top?: React.ReactNode }) {
  const [items, setItems] = useState<Row[] | null>(null);
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"open" | "done">("open");
  const [detail, setDetail] = useState<string | null>(null);
  const [f, setF] = useState<Row>({});
  const load = useCallback(() => { api<Row[]>("/capture").then(setItems).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  async function add() {
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 20);
    if (!lines.length) return;
    try { for (const line of lines) await api("/capture", "POST", { text: line }); setText(""); onNotice(`${lines.length} in your inbox`); load(); } catch (e) { onError(msg(e)); }
  }
  async function move(item: Row, target: string) {
    const body: Row = { target, ...f };
    for (const k of Object.keys(body)) if (body[k] === "" || body[k] == null) delete body[k];
    try { await api(`/capture/${item.id}/move`, "POST", body); onNotice(`Moved to ${TARGETS.find(t => t[0] === target)?.[1].slice(2)} ✓`); setDetail(null); setF({}); load(); } catch (e) { onError(msg(e)); }
  }
  if (!items) return <Screen><Empty>Opening your inbox…</Empty></Screen>;
  const todo = items.filter(i => ["pending", "needs_confirmation"].includes(i.status));
  const done = items.filter(i => !["pending", "needs_confirmation"].includes(i.status));
  const shown = tab === "open" ? todo : done;
  return <Screen>
    <Hero kicker="INBOX · CAPTURE EVERYTHING" title="Empty your head," accent="sort later" sub="One line per thought. Then send each one where it belongs."
      right={<Ring value={items.length ? (done.length / items.length) * 100 : 0} size={92} label={`${todo.length}`} sub="TO SORT"/>}>
      <Field voice multiline value={text} onChangeText={setText} placeholder={"call the bank tomorrow\nnew running shoes\nmilk, eggs"}/>
      <Btn title="Add to inbox" onPress={() => void add()} disabled={!text.trim()}/>
    </Hero>
    {top}
    <Segments options={["open", "done"] as const} value={tab} onChange={setTab} labels={{ open: `To sort · ${todo.length}`, done: `Sorted · ${done.length}` }}/>
    {shown.map(i => { const sug = SUGGEST[i.classified_type] || "task"; const moved = i.extracted?.moved_to?.target || (i.task_id ? "task" : i.status === "saved" ? "memory" : "");
      const color = TARGETS.find(t => t[0] === (tab === "open" ? sug : moved))?.[2] || C.line;
      return <Card key={i.id} style={{ borderLeftWidth: 4, borderLeftColor: color }}>
        <Line><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{i.raw_text}</Text>
          <TouchableOpacity onPress={() => void api(`/capture/${i.id}`, "DELETE").then(load).catch(e => onError(msg(e)))}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></Line>
        {tab === "open" ? <>
          <Muted small>{`Looks like: ${sug}`}</Muted>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{TARGETS.map(([k, label, col]) => <TouchableOpacity key={k} style={chip(k === sug, col)} onPress={() => void move(i, k)}>
            <Text style={{ color: C.text, fontWeight: "700", fontSize: 13 }}>{label}</Text></TouchableOpacity>)}</View>
          <Btn kind="link" title={detail === i.id ? "Hide details" : "＋ date, time, price…"} onPress={() => { setDetail(detail === i.id ? null : i.id); setF({}); }}/>
          {detail === i.id && <View style={{ gap: 8 }}>
            <Field value={f.title || ""} onChangeText={title => setF({ ...f, title })} placeholder="Title (optional)"/>
            <DateField label="Date (task, goal, wish, buy)" value={f.due_date || null} allowClear onChange={d => setF({ ...f, due_date: d || "", due_at: d ? new Date(`${d}T${f.time || "09:00"}:00`).toISOString() : "" })}/>
            <TimeField label="Time (task) / reminder (habit)" value={f.time || null} allowClear onChange={t => setF({ ...f, time: t || "", reminder_time: t || "", due_at: f.due_date && t ? new Date(`${f.due_date}T${t}:00`).toISOString() : f.due_at })}/>
            <Field value={f.price || ""} onChangeText={price => setF({ ...f, price })} placeholder="Price (wish / buy)" keyboardType="decimal-pad"/>
            <Muted small>Then tap where it goes above.</Muted>
          </View>}
        </> : <Badge>{`→ ${moved || i.status}`}</Badge>}
      </Card>; })}
    {!shown.length && <Empty>{tab === "open" ? "Inbox zero 🎉" : "Nothing sorted yet."}</Empty>}
  </Screen>;
}

// =====================================================================================================================
// HABITS: edit, delete, icon, reminder time, times per week (used in My life → habits)
// =====================================================================================================================

const HABIT_ICONS = ["💪", "📚", "🧘", "💧", "🏃", "🥗", "😴", "🇩🇪", "🇬🇧", "✍️", "🙏", "🚭", "📵", "💊", "🎯"];
export function HabitsPanel({ api, onError, onNotice }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ov, setOv] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const load = useCallback(() => { Promise.all([api<Row[]>("/habits"), api<Row>("/life/overview")]).then(([h, o]) => { setRows(h); setOv(o); }).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const stats: Record<string, Row> = Object.fromEntries(((ov?.habits || []) as Row[]).map(h => [h.id, h]));
  async function save() {
    if (!edit?.name?.trim()) return;
    const body = { name: edit.name.trim(), kind: edit.kind || "build", icon: edit.icon || null, reminder_time: edit.reminder_time ? hhmm(edit.reminder_time) : null, target_per_week: edit.target_per_week || null };
    try { await api(edit.id ? `/habits/${edit.id}` : "/habits", edit.id ? "PATCH" : "POST", body); onNotice(edit.id ? "Habit updated" : "Habit created"); setEdit(null); load(); void syncHabitReminders(api); } catch (e) { onError(msg(e)); }
  }
  const remove = (h: Row) => Alert.alert("Delete habit?", `“${h.name}” leaves your list; its history stays in reports.`, [{ text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void api(`/habits/${h.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }]);
  return <View style={{ gap: 12 }}>
    {edit ? <Card accent><Kicker>{edit.id ? "EDIT HABIT" : "NEW HABIT"}</Kicker>
      <Field voice value={edit.name} onChangeText={name => setEdit({ ...edit, name })} placeholder="e.g. Read 20 pages"/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{HABIT_ICONS.map(ic => <TouchableOpacity key={ic} onPress={() => setEdit({ ...edit, icon: ic })}
        style={{ width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: edit.icon === ic ? C.green : C.line }}><Text style={{ fontSize: 20 }}>{ic}</Text></TouchableOpacity>)}</ScrollView>
      <Segments options={["build", "avoid"] as const} value={edit.kind || "build"} onChange={kind => setEdit({ ...edit, kind })} labels={{ build: "Build (do it)", avoid: "Avoid" }}/>
      <TimeField label="Reminder time (optional)" value={edit.reminder_time ? hhmm(edit.reminder_time) : null} allowClear onChange={t => setEdit({ ...edit, reminder_time: t })}/>
      <Muted small>Times per week</Muted>
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>{[0, 1, 2, 3, 4, 5, 6, 7].map(x => <TouchableOpacity key={x} style={chip((edit.target_per_week || 0) === x)} onPress={() => setEdit({ ...edit, target_per_week: x || null })}>
        <Text style={{ color: C.text }}>{x ? `${x}×` : "daily"}</Text></TouchableOpacity>)}</View>
      <Line><Btn title={edit.id ? "Save" : "Create"} onPress={() => void save()} style={{ flex: 1 }}/><Btn kind="outline" title="Cancel" onPress={() => setEdit(null)} style={{ flex: 1 }}/></Line>
    </Card> : <Btn title="＋ New habit" onPress={() => setEdit({ name: "", kind: "build", icon: "💪" })}/>}
    {rows.map((h, i) => { const s = stats[h.id] || {}; const week = ((s.week || []) as boolean[]).filter(Boolean).length; const target = h.target_per_week || 7;
      return <Card key={h.id} style={{ borderTopWidth: 3, borderTopColor: PALETTE[i % PALETTE.length] }}>
        <Line><Text style={{ fontSize: 22 }}>{h.icon || "•"}</Text><View style={{ flex: 1 }}><H2>{h.name}</H2>
          <Muted small>{`${h.kind === "avoid" ? "Avoid" : "Build"} · ${h.target_per_week ? `${h.target_per_week}× a week` : "daily"}${h.reminder_time ? ` · ⏰ ${hhmm(h.reminder_time)}` : ""}`}</Muted></View>
          {s.streak > 1 && <Badge tone="amber">{`🔥 ${s.streak}`}</Badge>}</Line>
        <Meter value={(week / target) * 100} right={`${week}/${target} this week`} color={PALETTE[i % PALETTE.length]}/>
        <Line>{s.done_today ? <Badge>✓ done today</Badge> : <Btn title="Done today ✓" onPress={() => void api(`/habits/${h.id}/logs`, "POST", { completed: true }).then(() => { onNotice(`${h.icon || "✓"} ${h.name} done`); load(); }).catch(e => onError(msg(e)))}/>}
          <View style={{ flex: 1 }}/><Btn kind="link" title="Edit" onPress={() => setEdit({ ...h })}/><Btn kind="link" title="Delete" onPress={() => remove(h)}/></Line>
      </Card>; })}
    {!rows.length && !edit && <Empty>No habits yet. Start with one small daily habit.</Empty>}
  </View>;
}

// =====================================================================================================================
// PLANNER BOARD (Plan tab → Board): week strip with layers + agenda
// =====================================================================================================================

const LAYERS: [string, string, string][] = [["task", "✓ Tasks", "#3ee08f"], ["plan", "▦ Plan", "#5aa8ff"], ["routine", "☀️ Routines", "#4fd1c5"], ["bill", "💳 Bills", "#ff7a8a"],
  ["goal", "🎯 Goals", "#b48cff"], ["exam", "🎓 Exams", "#f5b65b"], ["wish", "✨ Wishes", "#e6e15a"], ["buy", "🛒 Shopping", "#ff9f5a"]];
type Ev = { id: string; layer: string; title: string; day: string; start: number | null; color: string; done?: boolean };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));

export function PlanBoard({ api, onError, onNotice }: Props) {
  const [anchor, setAnchor] = useState(() => new Date());
  const [day, setDay] = useState(() => isoDate(new Date()));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(LAYERS.map(l => [l[0], !["wish", "buy"].includes(l[0])])));
  const [src, setSrc] = useState<Row | null>(null);
  const [v, setV] = useState(0);
  const [title, setTitle] = useState(""); const [time, setTime] = useState<string | null>("09:00");
  useEffect(() => {
    const opt = <T,>(p: Promise<T>, fb: T) => p.catch(() => fb);
    Promise.all([opt(api<Row[]>("/tasks"), []), opt(api<Row[]>(`/planner/weekly?start=${isoDate(monday(anchor))}`), []), opt(api<Row[]>("/routines"), []),
      opt(api<Row>("/routines/week"), {}), opt(api<Row>("/subscriptions"), { items: [] }), opt(api<Row[]>("/goals"), []), opt(api<Row[]>("/exams"), []),
      opt(api<Row[]>("/money/wishlist"), []), opt(api<Row[]>("/money/buy-list?include_checked=false"), [])])
      .then(([tasks, plans, routines, week, subs, goals, exams, wishes, buys]) => setSrc({ tasks, plans, routines, week, subs, goals, exams, wishes, buys }));
  }, [api, anchor, v]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday(anchor), i));
  const events = useMemo<Ev[]>(() => {
    if (!src) return [];
    const out: Ev[] = []; const col = Object.fromEntries(LAYERS.map(l => [l[0], l[2]]));
    const local = (s: string) => { const d = new Date(s); return { day: isoDate(d), min: d.getHours() * 60 + d.getMinutes() }; };
    for (const t of src.tasks as Row[]) if (t.due_at && t.status !== "cancelled") { const x = local(t.due_at); out.push({ id: `t${t.id}`, layer: "task", title: t.title, day: x.day, start: x.min, color: col.task, done: t.status === "done" }); }
    for (const p of src.plans as Row[]) for (const it of (p.items as Row[]) || []) if (it.kind !== "task") { const x = local(it.starts_at); out.push({ id: `p${it.id}`, layer: "plan", title: it.title, day: x.day, start: x.min, color: col.plan }); }
    const work: number[] = src.week?.work_days || [1, 2, 3, 4, 5], gym: number[] = src.week?.gym_days || [];
    for (const d of days) { const wd = ((d.getDay() + 6) % 7) + 1;
      for (const r of src.routines as Row[]) { if (!r.active || r.kind !== "routine") continue;
        const runs = r.day_rule === "gym" ? gym.includes(wd) : r.day_rule === "work" ? work.includes(wd) : r.day_rule === "off" ? !work.includes(wd) : (r.days as number[]).includes(wd);
        const st = r.start_time ? Number(String(r.start_time).slice(0, 2)) * 60 + Number(String(r.start_time).slice(3, 5)) : null;
        if (runs) out.push({ id: `r${r.id}${isoDate(d)}`, layer: "routine", title: `${r.icon} ${r.name}`, day: isoDate(d), start: st, color: col.routine }); } }
    for (const s of (src.subs.items as Row[]) || []) if (s.active) out.push({ id: `s${s.id}`, layer: "bill", title: `💳 ${s.name}${s.amount != null ? ` · ${s.currency} ${Number(s.amount).toLocaleString()}` : ""}`, day: s.next_due, start: null, color: col.bill });
    for (const g of src.goals as Row[]) if (g.due_date) out.push({ id: `g${g.id}`, layer: "goal", title: `🎯 ${g.title}`, day: g.due_date, start: null, color: col.goal });
    for (const x of src.exams as Row[]) if (x.exam_date && x.active) out.push({ id: `e${x.id}`, layer: "exam", title: `🎓 ${x.name} exam`, day: x.exam_date, start: null, color: col.exam });
    for (const w of src.wishes as Row[]) if (w.target_date && w.status === "active") out.push({ id: `w${w.id}`, layer: "wish", title: `✨ ${w.name}`, day: w.target_date, start: null, color: col.wish });
    for (const b of src.buys as Row[]) if (b.need_by) out.push({ id: `b${b.id}`, layer: "buy", title: `🛒 ${b.name}`, day: b.need_by, start: null, color: col.buy });
    return out.filter(e => on[e.layer]);
  }, [src, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = events.filter(e => e.day === day).sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  async function quickAdd() {
    if (!title.trim()) return;
    try { await api("/tasks", "POST", { title: title.trim(), priority: "medium", category: "personal", duration_minutes: 30, due_at: new Date(`${day}T${time || "09:00"}:00`).toISOString() }); setTitle(""); onNotice("Task added"); setV(x => x + 1); }
    catch (e) { onError(msg(e)); }
  }
  return <View style={{ gap: 12 }}>
    <Hero kicker="PLANNER BOARD" title={`${days[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString([], { day: "numeric", month: "short" })}`} sub="Your week in layers. Tap a day, switch layers on and off."
      right={<Ring value={Math.min(100, events.length * 4)} size={84} label={`${events.length}`} sub="ITEMS"/>}>
      <Line><Btn kind="outline" title="‹" onPress={() => setAnchor(a => addDays(a, -7))}/><Btn kind="outline" title="Today" onPress={() => { setAnchor(new Date()); setDay(isoDate(new Date())); }}/><Btn kind="outline" title="›" onPress={() => setAnchor(a => addDays(a, 7))}/></Line>
    </Hero>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{LAYERS.map(([k, label, color]) => <TouchableOpacity key={k} style={[chip(on[k], color), !on[k] && { opacity: 0.5 }]} onPress={() => setOn(o => ({ ...o, [k]: !o[k] }))}>
      <Text style={{ color: C.text, fontWeight: "700", fontSize: 12 }}>{label}</Text></TouchableOpacity>)}</ScrollView>
    <View style={{ flexDirection: "row", gap: 4 }}>{days.map(d => { const k = isoDate(d); const evs = events.filter(e => e.day === k); const sel = k === day; const today = k === isoDate(new Date());
      return <TouchableOpacity key={k} onPress={() => setDay(k)} style={{ flex: 1, borderRadius: 16, paddingVertical: 8, alignItems: "center", gap: 4, borderWidth: 1, borderColor: sel ? C.green : today ? "#2a6b4a" : C.line, backgroundColor: sel ? "#123222" : C.panel, minHeight: 92 }}>
        <Text style={{ color: C.muted, fontSize: 10, fontWeight: "800" }}>{["MO", "TU", "WE", "TH", "FR", "SA", "SU"][(d.getDay() + 6) % 7]}</Text>
        <Text style={{ color: C.text, fontSize: 17, fontWeight: "900" }}>{d.getDate()}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2, justifyContent: "center", paddingHorizontal: 2 }}>{evs.slice(0, 8).map(e => <View key={e.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: e.color }}/>)}</View>
        {evs.length > 0 && <Text style={{ color: C.muted, fontSize: 9 }}>{evs.length}</Text>}
      </TouchableOpacity>; })}</View>
    <Card><Kicker>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</Kicker>
      {!src ? <Muted>Loading…</Muted> : list.length ? list.map(e => <View key={e.id} style={{ flexDirection: "row", gap: 10, alignItems: "center", borderLeftWidth: 3, borderLeftColor: e.color, paddingLeft: 10, paddingVertical: 4 }}>
        <Text style={{ color: C.muted, width: 46, fontSize: 12 }}>{e.start == null ? "all day" : `${String(Math.floor(e.start / 60)).padStart(2, "0")}:${String(e.start % 60).padStart(2, "0")}`}</Text>
        <Text style={{ color: C.text, flex: 1, textDecorationLine: e.done ? "line-through" : "none" }}>{e.title}</Text></View>) : <Muted>Free day.</Muted>}
      <Field value={title} onChangeText={setTitle} placeholder="Add a task to this day…"/>
      <Line><View style={{ flex: 1 }}><TimeField value={time} onChange={setTime}/></View><Btn title="Add" onPress={() => void quickAdd()} disabled={!title.trim()}/></Line>
    </Card>
  </View>;
}

// =====================================================================================================================
// SUBSCRIPTIONS & RENEWALS
// =====================================================================================================================

const CATS = ["subscription", "bill", "insurance", "loan", "rent", "membership", "other"] as const;
const CAT_ICON: Record<string, string> = { subscription: "📺", bill: "💡", insurance: "🛡️", loan: "🏦", rent: "🏠", membership: "🏋️", other: "📌" };
export function SubscriptionsScreen({ api, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(null);
  const [f, setF] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/subscriptions").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  async function save() {
    if (!f?.name?.trim() || !f.next_due) { onError("Name and next due date are needed"); return; }
    const body: Row = { name: f.name.trim(), category: f.category, amount: f.amount ? String(f.amount).replace(/,/g, "") : null, currency: (f.currency || "LKR").toUpperCase(), cycle: f.cycle, next_due: f.next_due, remind_days: Number(f.remind_days || 3) };
    try { await api(f.id ? `/subscriptions/${f.id}` : "/subscriptions", f.id ? "PATCH" : "POST", body); setF(null); onNotice("Saved"); load(); } catch (e) { onError(msg(e)); }
  }
  const act = (s: Row, path: string, body: Row, note: string) => void api(`/subscriptions/${s.id}/${path}`, "POST", body).then(() => { onNotice(note); load(); }).catch(e => onError(msg(e)));
  const cur = Object.keys(v.per_month)[0] || "LKR";
  return <Screen onRefresh={load}>
    <Hero kicker="SUBSCRIPTIONS & RENEWALS" title={`${cur} ${short(Number(v.per_month[cur] || 0))}`} accent="/ month" sub={`${cur} ${short(Number(v.per_year[cur] || 0))} a year. Sakuna reminds you; it never pays.`}
      right={<Ring value={v.items.length ? ((v.items.length - v.due_soon - v.overdue) / v.items.length) * 100 : 100} size={92} color={v.overdue ? C.red : C.green} label={`${v.due_soon + v.overdue}`} sub="DUE SOON"/>}/>
    <TileRow><StatTile label="Due soon" icon="⏰" tone={v.due_soon ? "amber" : "plain"} value={`${v.due_soon}`}/><StatTile label="Overdue" icon="⚠️" tone={v.overdue ? "red" : "plain"} value={`${v.overdue}`}/></TileRow>
    {Object.keys(v.by_category[cur] || {}).length > 0 && <Card><Kicker>MONTHLY COST BY TYPE</Kicker>
      <SplitBar parts={Object.entries(v.by_category[cur] as Record<string, number>).map(([k, x]) => ({ label: `${CAT_ICON[k]} ${k}`, value: Number(x) }))} format={n => `${cur} ${short(n)}`}/></Card>}
    {f ? <Card accent><Kicker>{f.id ? "EDIT" : "ADD A SUBSCRIPTION OR BILL"}</Kicker>
      <Field value={f.name} onChangeText={name => setF({ ...f, name })} placeholder="Netflix, Dialog, insurance, rent…"/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{CATS.map(c => <TouchableOpacity key={c} style={chip(f.category === c)} onPress={() => setF({ ...f, category: c })}><Text style={{ color: C.text }}>{`${CAT_ICON[c]} ${c}`}</Text></TouchableOpacity>)}</ScrollView>
      <Line><View style={{ flex: 2 }}><Field value={String(f.amount ?? "")} onChangeText={amount => setF({ ...f, amount })} placeholder="Amount" keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1 }}><Field value={f.currency} onChangeText={c => setF({ ...f, currency: c.toUpperCase() })} maxLength={3} autoCapitalize="characters"/></View></Line>
      <Segments options={["weekly", "monthly", "quarterly", "yearly"] as const} value={f.cycle} onChange={cycle => setF({ ...f, cycle })}/>
      <DateField label="Next due date" value={f.next_due} onChange={d => d && setF({ ...f, next_due: d })}/>
      <Muted small>Remind me days before</Muted>
      <View style={{ flexDirection: "row", gap: 6 }}>{[0, 1, 3, 7, 14].map(x => <TouchableOpacity key={x} style={chip(Number(f.remind_days) === x)} onPress={() => setF({ ...f, remind_days: x })}><Text style={{ color: C.text }}>{x}</Text></TouchableOpacity>)}</View>
      <Line><Btn title="Save" onPress={() => void save()} style={{ flex: 1 }}/><Btn kind="outline" title="Cancel" onPress={() => setF(null)} style={{ flex: 1 }}/></Line>
    </Card> : <Btn title="＋ Add subscription or bill" onPress={() => setF({ name: "", category: "subscription", currency: "LKR", cycle: "monthly", next_due: isoDate(new Date()), remind_days: 3, amount: "" })}/>}
    {(v.items as Row[]).map(s => <Card key={s.id} style={!s.active ? { opacity: 0.5 } : undefined}>
      <Line><Text style={{ fontSize: 22 }}>{CAT_ICON[s.category]}</Text><View style={{ flex: 1 }}><H2>{s.name}</H2>
        <Muted small>{`${s.amount != null ? `${s.currency} ${Number(s.amount).toLocaleString()} / ${s.cycle}` : s.cycle} · due ${new Date(`${s.next_due}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}`}</Muted></View>
        <Badge tone={s.state === "overdue" ? "red" : s.state === "due_soon" ? "amber" : "green"}>{s.state === "overdue" ? `${-s.days_left}d late` : `${s.days_left}d`}</Badge></Line>
      <Line style={{ flexWrap: "wrap" }}>
        <Btn kind="link" title="✓ Paid" onPress={() => act(s, "paid", { record_expense: s.amount != null }, `${s.name} marked paid${s.amount != null ? " and logged" : ""}`)}/>
        <Btn kind="link" title="⏰ Remind" onPress={() => act(s, "remind", {}, "Reminder task added")}/>
        <Btn kind="link" title="Edit" onPress={() => setF({ ...s, amount: s.amount ?? "" })}/>
        <Btn kind="link" title="Delete" onPress={() => Alert.alert("Delete?", s.name, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void api(`/subscriptions/${s.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}/>
      </Line>
    </Card>)}
  </Screen>;
}

// =====================================================================================================================
// JOB FINDER
// =====================================================================================================================

const JOB_ROLES = ["Software Engineer", "Associate Software Engineer", "Intern - Software Engineering", "Python Developer", "Full Stack Developer", "Frontend Developer (React)",
  "Backend Developer", "Mobile Developer (Flutter / React Native)", "QA Engineer", "DevOps Engineer", "Cloud Engineer", "Data Analyst", "Data Engineer", "Data Scientist",
  "Machine Learning Engineer", "AI Engineer", "Business Analyst", "Project Manager", "UI/UX Designer", "Cyber Security Analyst", "Network Engineer", "IT Support", "Database Administrator"];
const JOB_LOCATIONS = ["Sri Lanka", "Colombo", "Remote", "Worldwide", "Germany", "Berlin", "Munich", "Europe", "Singapore", "UAE", "Australia", "UK", ""];

export function JobFinderScreen({ api, onError, onNotice }: Props) {
  const [q, setQ] = useState("Python developer"); const [loc, setLoc] = useState("Germany"); const [remote, setRemote] = useState(false);
  const [res, setRes] = useState<Row | null>(null); const [busy, setBusy] = useState(false); const [shown, setShown] = useState(10);
  const [pick, setPick] = useState<"role" | "loc" | null>(null);
  useEffect(() => { void SecureStore.getItemAsync("sakuna.jobSearch").then(v => { const x = v ? JSON.parse(v) : { q: "Software Engineer", loc: "Sri Lanka" }; setQ(x.q); setLoc(x.loc); void search(x.q, x.loc); }).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function search(qq = q, ll = loc) {
    setBusy(true); setShown(10); setPick(null); void SecureStore.setItemAsync("sakuna.jobSearch", JSON.stringify({ q: qq, loc: ll })).catch(() => undefined);
    try { setRes(await api<Row>(`/career/find?q=${encodeURIComponent(qq)}&location=${encodeURIComponent(ll)}&remote=${remote}`)); } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  const save = (j: Row) => void api("/career/jobs", "POST", { company: String(j.company).slice(0, 200), role: String(j.title).slice(0, 200), url: j.url, status: "draft", notes: `${j.source} · ${j.location}` })
    .then(() => { onNotice("Saved to your job tracker"); setRes(r => r && ({ ...r, jobs: (r.jobs as Row[]).map(x => x.id === j.id ? { ...x, saved: true } : x) })); }).catch(e => onError(msg(e)));
  const s: Row = res?.summary || {};
  return <Screen>
    <Hero kicker="JOB FINDER" title="Find your" accent="next role" sub="Arbeitnow (Germany & EU), Remotive, Remote OK and Jobicy, summed up. LinkedIn, XING, StepStone and others open as searches.">
      <TouchableOpacity onPress={() => setPick(pick === "role" ? null : "role")} style={{ borderWidth: 1, borderColor: C.green, borderRadius: 14, padding: 12, flexDirection: "row" }}>
        <Text style={{ color: C.muted, width: 70 }}>Role</Text><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{q}</Text><Text style={{ color: C.green }}>▾</Text></TouchableOpacity>
      {pick === "role" && <View style={{ maxHeight: 260, borderWidth: 1, borderColor: C.line, borderRadius: 14 }}><ScrollView nestedScrollEnabled>{JOB_ROLES.map(r => <TouchableOpacity key={r} onPress={() => { setQ(r); void search(r, loc); }}
        style={{ padding: 11, borderBottomColor: C.line, borderBottomWidth: 1 }}><Text style={{ color: r === q ? C.green : C.text }}>{r}</Text></TouchableOpacity>)}</ScrollView></View>}
      <TouchableOpacity onPress={() => setPick(pick === "loc" ? null : "loc")} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12, flexDirection: "row" }}>
        <Text style={{ color: C.muted, width: 70 }}>Where</Text><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{loc || "Anywhere"}</Text><Text style={{ color: C.green }}>▾</Text></TouchableOpacity>
      {pick === "loc" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{JOB_LOCATIONS.map(l => <TouchableOpacity key={l} style={chip(l === loc)} onPress={() => { setLoc(l); void search(q, l); }}>
        <Text style={{ color: C.text }}>{l}</Text></TouchableOpacity>)}</View>}
      <Field value={q} onChangeText={setQ} placeholder="…or type any role / keywords"/>
      <TouchableOpacity onPress={() => setRemote(v => !v)}><Line><View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: remote ? C.green : C.line, backgroundColor: remote ? C.green : "transparent" }}/><Text style={{ color: C.text }}>Remote only</Text></Line></TouchableOpacity>
      <Btn title={busy ? "Searching…" : "Find jobs"} onPress={() => void search()} busy={busy} disabled={q.trim().length < 2}/>
    </Hero>
    {res && <>
      <LinkedInCard api={api} q={q}/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{(res.links as Row[]).map(l => <TouchableOpacity key={l.name} style={chip(false)} onPress={() => open(l.url)}><Text style={{ color: C.text, fontWeight: "700" }}>{`${l.name} ↗`}</Text></TouchableOpacity>)}</ScrollView>
      <TileRow><StatTile label="Jobs" tone="green" value={`${s.total}`}/><StatTile label="Sri Lanka" tone="violet" value={`${s.sri_lanka ?? 0}`}/><StatTile label="Remote" tone="blue" value={`${s.remote}`}/><StatTile label="Germany" tone="amber" value={`${s.germany}`}/></TileRow>
      {(s.skills as [string, number][]).length > 0 && <Card><Kicker>SKILLS IN DEMAND</Kicker><Bars data={(s.skills as [string, number][]).slice(0, 8).map(([k, c]) => ({ label: k.slice(0, 6), value: c }))} height={110}/>
        {(s.skills_to_learn as string[]).length > 0 && <Muted small>{`To learn next: ${(s.skills_to_learn as string[]).join(", ")}`}</Muted>}</Card>}
      {(res.jobs as Row[]).slice(0, shown).map(j => <Card key={j.id}>
        <Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }}>{j.title}</Text><Muted small>{`${j.company} · ${j.location}`}</Muted>
        <Line style={{ flexWrap: "wrap" }}>{j.remote && <Badge>remote</Badge>}<Badge tone="muted">{j.source}</Badge>{!!j.posted && <Badge tone="muted">{j.posted}</Badge>}{!!j.salary && <Badge tone="amber">{j.salary}</Badge>}</Line>
        <Line>{j.saved ? <Badge>✓ in tracker</Badge> : <Btn title="Save" onPress={() => save(j)}/>}<Btn kind="link" title="Open & apply ↗" onPress={() => open(j.url, j.title)}/></Line>
      </Card>)}
      {shown < (res.jobs as Row[]).length && <Btn kind="outline" title="Show more" onPress={() => setShown(x => x + 10)}/>}
      <Muted small>{res.source_note}</Muted>
    </>}
  </Screen>;
}

// =====================================================================================================================
// LEARNING RADAR
// =====================================================================================================================

const TOPIC_IDEAS = ["python", "ai", "llm", "react", "typescript", "system design", "devops", "data engineering", "security", "flutter", "career", "productivity"];
export function RadarScreen({ api, onError, onNotice }: Props) {
  const [topics, setTopics] = useState<string[]>(["python", "ai", "system design"]);
  const [typed, setTyped] = useState(""); const [res, setRes] = useState<Row | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async (list: string[]) => {
    setBusy(true); void SecureStore.setItemAsync("sakuna.learnTopics", JSON.stringify(list)).catch(() => undefined);
    try { setRes(await api<Row>(`/learning/radar?topics=${encodeURIComponent(list.join(","))}`)); } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }, [api, onError]);
  useEffect(() => { void SecureStore.getItemAsync("sakuna.learnTopics").then(v => { const list = v ? JSON.parse(v) : topics; setTopics(list); void load(list); }).catch(() => void load(topics)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const keep = (next: string[]) => { setTopics(next); void load(next); };
  const add = (t: string) => { const v = t.trim().toLowerCase(); if (v && !topics.includes(v) && topics.length < 6) keep([...topics, v]); setTyped(""); };
  return <Screen>
    <Hero kicker="LEARNING RADAR" title="Learn what's" accent="new today" sub="Fresh from Hacker News, dev.to and GitHub for your topics, plus Wikipedia's thing-of-the-day and free courses.">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{topics.map(t => <TouchableOpacity key={t} style={chip(true)} onPress={() => keep(topics.filter(x => x !== t))}><Text style={{ color: C.text, fontWeight: "700" }}>{`${t} ✕`}</Text></TouchableOpacity>)}</View>
      <Line><View style={{ flex: 1 }}><Field value={typed} onChangeText={setTyped} placeholder="Add a topic" onSubmitEditing={() => add(typed)}/></View><Btn kind="outline" title="Add" onPress={() => add(typed)}/></Line>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{TOPIC_IDEAS.filter(t => !topics.includes(t)).map(t => <TouchableOpacity key={t} style={chip(false)} onPress={() => add(t)}><Text style={{ color: C.muted }}>{`+ ${t}`}</Text></TouchableOpacity>)}</ScrollView>
      {busy && <Muted small>Scanning…</Muted>}
    </Hero>
    {res?.today && <Card accent><Kicker>🌍 LEARN ONE THING TODAY</Kicker><H2>{res.today.title}</H2><Text style={{ color: C.text, lineHeight: 20 }}>{String(res.today.summary).slice(0, 320)}…</Text>
      <Btn kind="link" title="Read on Wikipedia ↗" onPress={() => open(res.today.url)}/></Card>}
    {res && (res.summary.hot_tags as [string, number][]).length > 0 && <Card><Kicker>TRENDING AROUND YOUR TOPICS</Kicker>
      <Bars data={(res.summary.hot_tags as [string, number][]).slice(0, 8).map(([k, c]) => ({ label: k.slice(0, 6), value: c }))} height={100}/></Card>}
    {res && (res.items as Row[]).slice(0, 25).map(i => <Card key={i.url}>
      <Line><Badge tone="muted">{`${i.source} · ${i.kind}`}</Badge><View style={{ flex: 1 }}/><Badge tone="amber">{`${i.source === "GitHub" ? "★" : "▲"} ${i.score}`}</Badge></Line>
      <TouchableOpacity onPress={() => open(i.url, i.title, { category: "study", note: `Learning: ${i.title}` })}><Text style={{ color: C.text, fontWeight: "700", fontSize: 15 }}>{i.title}</Text></TouchableOpacity>
      {!!i.summary && <Muted small>{String(i.summary).slice(0, 160)}</Muted>}
      <Line><Btn kind="link" title="📚 Learn later" onPress={() => void api("/tasks", "POST", { title: `Learn: ${i.title}`.slice(0, 200), category: "learning", priority: "medium", duration_minutes: 30, notes: i.url }).then(() => onNotice("Added as a learning task")).catch(e => onError(msg(e)))}/>
        <Btn kind="link" title="🧠 Save" onPress={() => void api("/memories", "POST", { content: `${i.title} — ${i.url}`.slice(0, 2000), category: "note" }).then(() => onNotice("Saved to memory")).catch(e => onError(msg(e)))}/></Line>
    </Card>)}
    {res && (res.tracks as Row[]).map((t, k) => <Card key={t.key} style={{ borderLeftWidth: 4, borderLeftColor: PALETTE[k % PALETTE.length] }}><Kicker>{`${t.icon} FREE TRACK · ${String(t.title).toUpperCase()}`}</Kicker>
      {(t.items as Row[]).map((x, n) => <TouchableOpacity key={x.url} onPress={() => open(x.url)}><Text style={{ color: C.text, lineHeight: 22 }}>{`${n + 1}. ${x.title} ↗`}</Text></TouchableOpacity>)}</Card>)}
  </Screen>;
}

// =====================================================================================================================
// REWARDS GAME
// =====================================================================================================================

const GEMS: Record<string, string> = { health: "❤️", money: "💰", career: "💼", learning: "📚", mind: "🧘", relationships: "🤝", home: "🏠", fun: "🎉" };
export function RewardsGameScreen({ api }: { api: Api }) {
  const [g, setG] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/game").then(setG).catch(() => setG(null)); }, [api]);
  if (!g) return <Screen><Empty>Loading your game…</Empty></Screen>;
  const pct = g.next_level_at ? Math.min(100, (g.into_level / g.next_level_at) * 100) : 100;
  const badges: [string, string, boolean][] = [["🔥", "7-day streak", g.streak_days >= 7], ["🌋", "30-day streak", g.streak_days >= 30], ["⭐", "Level 3", g.level >= 3], ["🏆", "Level 10", g.level >= 10],
    ["💎", "4 areas in a day", (g.today.areas || []).length >= 4], ["💯", "Max day", g.today.points >= g.today.cap], ["🎯", "3 quests", (g.quests || []).length >= 3],
    ["🎁", "Treat ready", (g.treats || []).some((t: Row) => t.affordable)], ["🪙", "1,000 points", g.total_earned >= 1000], ["👑", "10,000 points", g.total_earned >= 10000]];
  return <Screen>
    <View style={{ borderRadius: 26, padding: 18, gap: 10, backgroundColor: "#1a1430", borderWidth: 1, borderColor: "#4b3a80", overflow: "hidden" }}>
      <View style={{ position: "absolute", width: 220, height: 220, borderRadius: 110, right: -70, top: -80, backgroundColor: "#b48cff", opacity: 0.18 }}/>
      <View style={{ position: "absolute", width: 200, height: 200, borderRadius: 100, left: -70, bottom: -90, backgroundColor: "#f5b65b", opacity: 0.14 }}/>
      <Text style={{ color: C.amber, fontWeight: "800", fontSize: 11, letterSpacing: 1.5 }}>{`LIFE QUEST · LEVEL ${g.level}${g.paused ? " · PAUSED" : ""}`}</Text>
      <Text style={{ color: C.text, fontSize: 34, fontWeight: "900" }}>{`${Number(g.balance).toLocaleString()} 🪙`}</Text>
      <View style={{ height: 14, borderRadius: 7, backgroundColor: "#2b2350", overflow: "hidden" }}><View style={{ width: `${pct}%`, height: 14, borderRadius: 7, backgroundColor: C.amber }}/></View>
      <Muted small>{`${g.into_level} / ${g.next_level_at} XP to level ${g.level + 1}`}</Muted>
      <Line style={{ flexWrap: "wrap" }}>{Object.entries(GEMS).map(([a, ic]) => <Text key={a} style={{ fontSize: 22, opacity: (g.today.areas as string[]).includes(a) ? 1 : 0.25 }}>{ic}</Text>)}</Line>
      <Muted small>{`${(g.today.areas as string[]).length}/${g.today.areas_for_bonus} life areas today for the bonus`}</Muted>
      <Line style={{ justifyContent: "space-around" }}>
        <Ring value={(g.today.points / Math.max(1, g.today.cap)) * 100} size={96} color={C.amber} label={`${g.today.points}`} sub={`OF ${g.today.cap}`}/>
        <Ring value={Math.min(100, (g.streak_days / 30) * 100)} size={96} color={C.red} label={`${g.streak_days}🔥`} sub="STREAK"/>
      </Line>
    </View>
    <Card><Kicker>{`BADGES · ${badges.filter(b => b[2]).length}/${badges.length}`}</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{badges.map(([ic, name, got]) => <View key={name} style={{ width: "30%", alignItems: "center", padding: 8, borderRadius: 14, borderWidth: 1, borderColor: got ? C.amber : C.line, opacity: got ? 1 : 0.4 }}>
        <Text style={{ fontSize: 26 }}>{ic}</Text><Text style={{ color: C.text, fontSize: 10, textAlign: "center" }}>{name}</Text></View>)}</View></Card>
    <Card><Kicker>MISSIONS</Kicker>{(g.quests as Row[]).length ? (g.quests as Row[]).map((q, i) => <Meter key={q.id} label={`${q.done ? "✅" : "🗡️"} ${q.title}`} value={(q.count / Math.max(1, q.target)) * 100} right={`${q.count}/${q.target} · +${q.bonus_points}`} color={PALETTE[i % PALETTE.length]}/>)
      : <Muted>Start a quest in Manage.</Muted>}</Card>
    <Card><Kicker>RECENT POINTS</Kicker>{(g.recent as Row[]).slice(0, 8).map((r, i) => <Line key={i}><Text style={{ color: Number(r.points) >= 0 ? C.green : C.red, fontWeight: "800", width: 46 }}>{`${Number(r.points) >= 0 ? "+" : ""}${r.points}`}</Text>
      <Text style={{ color: C.text, flex: 1 }} numberOfLines={1}>{r.reason || r.event_type}</Text></Line>)}</Card>
  </Screen>;
}

