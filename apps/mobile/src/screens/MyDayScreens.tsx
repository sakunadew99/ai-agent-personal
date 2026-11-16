import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { syncRoutineReminders } from "../notify";
import { DateField, TimeField } from "../pickers";
import { Badge, Btn, C, Card, Chips, Empty, H2, Kicker, Muted, Progress, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : "");
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return iso(d); };
const pretty = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
const minutesOf = (t?: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);

/** Day / Week / Month switch shown at the top of the Plan tab. */
export type PlanView = "day" | "week" | "month" | "board";
export function PlanSwitch({ value, onChange }: { value: PlanView; onChange: (v: PlanView) => void }) {
  return <View style={s.switch}>{(["day", "week", "month", "board"] as const).map(v => <TouchableOpacity key={v} style={[s.switchTab, value === v && s.switchOn]} onPress={() => onChange(v)}>
    <Text style={[s.switchText, value === v && s.switchTextOn]}>{v === "day" ? "☀️ Day" : v === "week" ? "🗓 Week" : v === "month" ? "📅 Month" : "▦ Board"}</Text></TouchableOpacity>)}</View>;
}

// =====================================================================================================================
// TODAY
// =====================================================================================================================

/** Today's routines and checklists: tick through steps, short version on busy days, skip without guilt. */
export function TodayRoutines({ api, onError, onNotice }: Props) {
  const [data, setData] = useState<Row | null>(() => peek("/routines/today"));
  const [day, setDay] = useState<string | null>(() => (peek<Row>("/routines/today")?.date as string) ?? null);
  const [playing, setPlaying] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [meal, setMeal] = useState(false);
  const [now, setNow] = useState(new Date());

  const load = useCallback((which: string | null = day) => {
    api<Row>(`/routines/today${which ? `?day=${which}` : ""}`).then(d => { setData(d); setDay(String(d.date)); }).catch(r => onError(msg(r)));
  }, [api, day, onError]);
  useEffect(() => { load(null); void syncRoutineReminders(api); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(id); }, []);

  if (!data) return <Empty>Loading your day…</Empty>;
  const items: Row[] = data.items || [];
  const routines = items.filter(i => i.kind === "routine");
  const checklists = items.filter(i => i.kind === "checklist");
  const isToday = day === iso(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const current = isToday ? routines.find(r => { const st = minutesOf(r.starts); return st != null && nowMin >= st && nowMin < st + r.duration_minutes; }) : undefined;

  async function loadStarter() {
    try { const out = await api<Row>("/routines/starter", "POST"); onNotice(`Loaded ${out.added} routines from your notebook`); load(); void syncRoutineReminders(api); }
    catch (r) { onError(msg(r)); }
  }
  const replace = (next: Row) => { setData(d => d && ({ ...d, items: (d.items as Row[]).map(i => (i.id === next.id ? { ...i, ...next } : i)) })); if (playing?.id === next.id) setPlaying({ ...playing, ...next }); };
  async function act(r: Row, path: string, body?: unknown) {
    try { const next = await api<Row>(`/routines/${r.id}/days/${day}/${path}`, "POST", body); replace(next); if (next.status === "done" && r.status !== "done") onNotice(`${r.icon} ${r.name} done · +${next.mode === "short" ? 8 : 15} points`); return next; }
    catch (e) { onError(msg(e)); return null; }
  }

  if (!data.has_routines) {
    return <Card accent>
      <Kicker>MY DAY</Kicker><H2>Bring your notebook to life</H2>
      <Muted>Load your Morning, After gym, Office evening, Weekend evening, Sunday reset and Night routines, plus your gym and office bag checklists. You can edit everything later.</Muted>
      <Btn title="📓 Load my notebook routines" onPress={() => void loadStarter()}/>
      <Btn kind="outline" title="＋ Make my own routine" onPress={() => setEditing("new")}/>
      {editing && <RoutineEditor api={api} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onError={onError}/>}
    </Card>;
  }

  return <View style={{ gap: 12 }}>
    <Card accent>
      <Line>
        <TouchableOpacity style={s.nav} onPress={() => load(shift(day!, -1))}><Text style={s.navText}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={s.dayIcon}>{data.day_type.icon}</Text>
          <Text style={s.dayLabel}>{data.day_type.label}</Text>
          <Muted small>{isToday ? "Today · " : ""}{pretty(day!)}</Muted>
        </View>
        <TouchableOpacity style={s.nav} onPress={() => load(shift(day!, 1))}><Text style={s.navText}>›</Text></TouchableOpacity>
      </Line>
      <Text style={s.theme}>“{data.day_type.theme}”</Text>
      <Line><Text style={s.big}>{data.done}/{data.total}</Text><Muted>routines done</Muted><View style={{ flex: 1 }}/>{!isToday && <Btn kind="link" title="Today" onPress={() => load(iso(new Date()))}/>}</Line>
      <Progress value={(data.score ?? 0) * 100}/>
    </Card>

    {current && <TouchableOpacity onPress={() => setPlaying(current)} activeOpacity={0.85}>
      <View style={s.nowCard}><Text style={s.nowKicker}>HAPPENING NOW</Text>
        <Line><Text style={{ fontSize: 26 }}>{current.icon}</Text><View style={{ flex: 1 }}><Text style={s.nowTitle}>{current.name}</Text>
          <Muted small>{`${Math.round((current.progress || 0) * 100)}% · tap to continue`}</Muted></View><Text style={s.nowGo}>▶</Text></Line></View>
    </TouchableOpacity>}

    {routines.map(r => <RoutineCard key={r.id} r={r} highlight={current?.id === r.id} onOpen={() => setPlaying(r)}
      onShort={() => void act(r, "mode", { mode: r.mode === "short" ? "full" : "short" })} onSkip={() => void act(r, "skip")}/>)}

    {checklists.length > 0 && <Text style={s.section}>Pack before you go</Text>}
    {checklists.map(r => <RoutineCard key={r.id} r={r} onOpen={() => setPlaying(r)}/>)}

    <TouchableOpacity onPress={() => setMeal(true)} activeOpacity={0.85}><Card>
      <Line><Text style={{ fontSize: 24 }}>🍽</Text><View style={{ flex: 1 }}><Text style={s.cardTitle}>Food diary & mindful eating</Text>
        <Muted small>{(data.meals || []).length ? (data.meals as Row[]).map(x => `${x.meal}${x.foods ? `: ${String(x.foods).slice(0, 40)}` : ""}`).join(" · ") : "Log what you ate, and a 10-second mindful check"}</Muted></View><Text style={s.chev}>›</Text></Line>
    </Card></TouchableOpacity>

    <Line><Btn kind="outline" title="＋ New routine" onPress={() => setEditing("new")} style={{ flex: 1 }}/><Btn kind="outline" title="📓 Reload notebook" onPress={() => void loadStarter()} style={{ flex: 1 }}/></Line>
    <Muted small>Busy day? Tap “Short” on a routine: only its ★ steps count, and it still earns points. Skipping is fine, too.</Muted>

    {playing && <RoutinePlayer r={playing} day={day!} onTick={(step, done) => act(playing, `steps/${step}`, { done })}
      onMode={mode => act(playing, "mode", { mode })} onClose={() => setPlaying(null)} onEdit={() => { setEditing(playing); setPlaying(null); }}/>}
    {editing && <RoutineEditor api={api} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); load(); void syncRoutineReminders(api); }} onError={onError}/>}
    {meal && <MealCard api={api} rules={data.eating_rules} meals={data.meals || []} onClose={() => setMeal(false)} onSaved={() => { load(); onNotice("Food diary updated 🍽"); }} onError={onError}/>}
  </View>;
}

function RoutineCard({ r, highlight, onOpen, onShort, onSkip }: { r: Row; highlight?: boolean; onOpen: () => void; onShort?: () => void; onSkip?: () => void }) {
  const tone = r.status === "done" ? "green" : r.status === "skipped" ? "muted" : "amber";
  const needed = (r.needed_step_ids as string[]).length;
  const done = (r.needed_step_ids as string[]).filter(id => (r.done_step_ids as string[]).includes(id)).length;
  return <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
    <View style={[s.routine, highlight && { borderColor: C.green }, r.status === "done" && s.routineDone, r.status === "skipped" && { opacity: 0.6 }]}>
      <Line>
        <View style={s.iconBubble}><Text style={{ fontSize: 22 }}>{r.icon}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.cardTitle}>{r.name}</Text>
          <Muted small>{r.kind === "checklist" ? `${done}/${needed} packed` : `${r.starts ? hhmm(r.starts) : "Any time"} · ${dur(r.duration_minutes)} · ${done}/${needed} steps`}</Muted>
        </View>
        <Badge tone={tone}>{r.status === "done" ? "done ✓" : r.status === "skipped" ? "skipped" : r.mode === "short" ? "short" : `${Math.round(r.progress * 100)}%`}</Badge>
      </Line>
      <Progress value={r.progress * 100}/>
      {(onShort || onSkip) && r.status !== "done" && <Line>
        {onShort && <TouchableOpacity onPress={onShort}><Text style={s.action}>{r.mode === "short" ? "↺ Full version" : "⚡ Short (★ only)"}</Text></TouchableOpacity>}
        <View style={{ flex: 1 }}/>
        {onSkip && r.status !== "skipped" && <TouchableOpacity onPress={onSkip}><Text style={[s.action, { color: C.muted }]}>Skip today</Text></TouchableOpacity>}
      </Line>}
    </View>
  </TouchableOpacity>;
}

/** One step at a time: a big "next step" card, then the full list. */
function RoutinePlayer({ r, day, onTick, onMode, onClose, onEdit }: { r: Row; day: string; onTick: (step: string, done: boolean) => Promise<Row | null>; onMode: (m: "full" | "short") => Promise<Row | null>; onClose: () => void; onEdit: () => void }) {
  const [later, setLater] = useState<string[]>([]);
  const steps: Row[] = r.steps || [];
  const needed = new Set(r.needed_step_ids as string[]);
  const done = new Set(r.done_step_ids as string[]);
  const queue = steps.filter(st => needed.has(st.id) && !done.has(st.id));
  const next = queue.find(st => !later.includes(st.id)) ?? queue[0];
  const finished = r.status === "done";
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={s.modal}>
      <View style={s.modalTop}>
        <TouchableOpacity style={s.nav} onPress={onClose}><Text style={s.navText}>✕</Text></TouchableOpacity>
        <Text style={s.modalTitle}>{r.icon} {r.name}</Text>
        <TouchableOpacity onPress={onEdit}><Text style={s.action}>Edit</Text></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Muted small>{pretty(day)}{r.starts ? ` · ${hhmm(r.starts)}` : ""}</Muted>
        <Progress value={r.progress * 100}/>
        <Line><Text style={s.cardTitle}>Short version</Text><Muted small>only ★ steps</Muted><View style={{ flex: 1 }}/>
          <Switch value={r.mode === "short"} onValueChange={v => void onMode(v ? "short" : "full")} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>

        {finished ? <View style={s.doneCard}><Text style={{ fontSize: 44 }}>🎉</Text><Text style={s.doneTitle}>{r.name} done</Text>
          <Muted>{r.mode === "short" ? "Short version counts. Well done for showing up." : "Every step. Great rhythm."}</Muted></View>
          : next && <View style={s.stepCard}>
            <Text style={s.stepKicker}>NEXT STEP · {queue.length} left</Text>
            <Text style={s.stepTitle}>{next.essential ? "★ " : ""}{next.title}</Text>
            {!!next.detail && <Muted>{next.detail}</Muted>}
            <Line>
              <Btn title="Done ✓" onPress={() => void onTick(next.id, true)} style={{ flex: 2 }}/>
              {queue.length > 1 && <Btn kind="outline" title="Later" onPress={() => setLater(l => [...l.filter(x => x !== next.id), next.id])} style={{ flex: 1 }}/>}
            </Line>
          </View>}

        <Text style={s.section}>All steps</Text>
        {steps.map(st => { const on = done.has(st.id); const off = !needed.has(st.id);
          return <TouchableOpacity key={st.id} style={[s.stepRow, off && { opacity: 0.45 }]} onPress={() => void onTick(st.id, !on)}>
            <View style={[s.check, on && s.checkOn]}><Text style={s.checkText}>{on ? "✓" : ""}</Text></View>
            <Text style={[s.stepText, on && s.stepTextDone]}>{st.title}</Text>
            {st.essential && <Text style={{ color: C.amber }}>★</Text>}
          </TouchableOpacity>; })}
        <Muted small>★ = essential (the short version). Faded steps are optional while the short version is on.</Muted>
      </ScrollView>
    </View>
  </Modal>;
}

const RULES: [string, string][] = [["fixed", "Chosen days"], ["gym", "Gym days"], ["work", "Work days"], ["off", "Days off"]];
const ICONS = ["☀️", "🌙", "🏋️", "💼", "🌿", "🔄", "🎒", "👜", "📚", "🇩🇪", "🇬🇧", "🧘", "💊", "🍽", "✨"];

function RoutineEditor({ api, initial, onClose, onSaved, onError }: { api: Api; initial: Row | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [d, setD] = useState<Row>(() => initial ? { ...initial, steps: (initial.steps as Row[]).map(st => ({ ...st })) }
    : { name: "", icon: "✨", kind: "routine", start_time: "07:00", duration_minutes: 30, day_rule: "fixed", days: [1, 2, 3, 4, 5, 6, 7], steps: [{ title: "", essential: true }] });
  const [error, setError] = useState("");
  const patch = (p: Row) => setD(cur => ({ ...cur, ...p }));
  const setStep = (i: number, p: Row) => patch({ steps: (d.steps as Row[]).map((st, j) => (j === i ? { ...st, ...p } : st)) });
  const start = minutesOf(d.start_time);
  const stepTime = (delta: number) => { const m = ((start ?? 420) + delta + 1440) % 1440; patch({ start_time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` }); };

  async function save() {
    const steps = (d.steps as Row[]).filter(st => String(st.title || "").trim()).map(st => ({ id: st.id, title: String(st.title).trim(), essential: !!st.essential, detail: st.detail || null }));
    if (!String(d.name).trim()) { setError("Give it a name."); return; }
    if (!steps.length) { setError("Add at least one step."); return; }
    const body = { name: String(d.name).trim(), icon: d.icon, kind: d.kind, start_time: d.start_time ? hhmm(d.start_time) : null, duration_minutes: d.duration_minutes,
      day_rule: d.day_rule, days: d.days, steps };
    try { await api(initial ? `/routines/${initial.id}` : "/routines", initial ? "PATCH" : "POST", body); onSaved(); } catch (r) { setError(msg(r)); }
  }
  function remove() {
    Alert.alert("Delete routine?", `“${d.name}” and its history will be removed.`, [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/routines/${initial!.id}`, "DELETE").then(onSaved).catch(r => onError(msg(r))) }]);
  }

  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={s.modal}>
      <View style={s.modalTop}><TouchableOpacity style={s.nav} onPress={onClose}><Text style={s.navText}>✕</Text></TouchableOpacity>
        <Text style={s.modalTitle}>{initial ? "Edit routine" : "New routine"}</Text><View style={{ width: 40 }}/></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <TextInput style={s.input} value={d.name} onChangeText={name => patch({ name })} placeholder="Name, e.g. Study German" placeholderTextColor={C.muted} maxLength={60}/>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{ICONS.map(ic => <TouchableOpacity key={ic} onPress={() => patch({ icon: ic })}
          style={[s.iconPick, d.icon === ic && { borderColor: C.green, backgroundColor: C.greenSoft }]}><Text style={{ fontSize: 20 }}>{ic}</Text></TouchableOpacity>)}</ScrollView>
        <Chips options={["routine", "checklist"] as const} value={d.kind} onChange={kind => patch({ kind })} labels={{ routine: "Routine (timed)", checklist: "Checklist" }}/>
        {d.kind === "routine" && <Card>
          <Kicker>WHEN</Kicker>
          {d.start_time ? <TimeField label="Starts at" value={hhmm(d.start_time)} onChange={t => patch({ start_time: t || "07:00" })}/> : <Text style={s.big}>At wake-up</Text>}
          <Line><Muted small>Starts at wake-up instead</Muted><View style={{ flex: 1 }}/><Switch value={!d.start_time} onValueChange={v => patch({ start_time: v ? null : "07:00" })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>
          <Chips options={["15", "30", "45", "60", "90", "120", "180", "300"] as const} value={String(d.duration_minutes) as "30"} onChange={v => patch({ duration_minutes: Number(v) })}
            labels={{ "15": "15m", "30": "30m", "45": "45m", "60": "1h", "90": "1.5h", "120": "2h", "180": "3h", "300": "5h" }}/>
        </Card>}
        <Card>
          <Kicker>WHICH DAYS</Kicker>
          <View style={s.chipsWrap}>{RULES.map(([k, label]) => <TouchableOpacity key={k} style={[s.chip, d.day_rule === k && s.chipOn]} onPress={() => patch({ day_rule: k })}>
            <Text style={[s.chipText, d.day_rule === k && s.chipTextOn]}>{label}</Text></TouchableOpacity>)}</View>
          {d.day_rule === "fixed" ? <DayPicker value={d.days} onChange={days => patch({ days })}/> : <Muted small>Follows your {d.day_rule === "gym" ? "gym days" : d.day_rule === "work" ? "work days" : "days off (not work days)"}. Change them in Plan → Week.</Muted>}
        </Card>
        <Text style={s.section}>Steps</Text>
        {(d.steps as Row[]).map((st, i) => <Line key={st.id ?? `new-${i}`}>
          <TouchableOpacity onPress={() => setStep(i, { essential: !st.essential })}><Text style={{ fontSize: 20, color: st.essential ? C.amber : C.line }}>★</Text></TouchableOpacity>
          <TextInput style={[s.input, { flex: 1 }]} value={st.title} onChangeText={title => setStep(i, { title })} placeholder={`Step ${i + 1}`} placeholderTextColor={C.muted} maxLength={120}/>
          <TouchableOpacity onPress={() => patch({ steps: (d.steps as Row[]).filter((_, j) => j !== i) })}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></TouchableOpacity>
        </Line>)}
        <Btn kind="outline" title="＋ Add step" onPress={() => patch({ steps: [...(d.steps as Row[]), { title: "", essential: false }] })}/>
        <Muted small>Tap ★ to make a step essential. Essential steps are the short version for busy days.</Muted>
        {initial && <Btn kind="danger" title="Delete routine" onPress={remove}/>}
      </ScrollView>
      <View style={s.footer}>{!!error && <Text style={{ color: C.red }}>{error}</Text>}<Btn title={initial ? "Save" : "Create routine"} onPress={() => void save()}/></View>
    </View>
  </Modal>;
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return <View style={s.days}>{DAY_SHORT.map((name, i) => { const on = value.includes(i + 1);
    return <TouchableOpacity key={name} style={[s.day, on && s.dayOn]} onPress={() => onChange(on ? value.filter(x => x !== i + 1) : [...value, i + 1].sort())}>
      <Text style={[s.dayText, on && s.dayTextOn]}>{name.slice(0, 2)}</Text></TouchableOpacity>; })}</View>;
}

function MealCard({ api, rules, meals, onClose, onSaved, onError }: { api: Api; rules: Row; meals: Row[]; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const hour = new Date().getHours();
  const now = new Date();
  const [m, setM] = useState<Row>({ meal: hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 19 ? "snack" : "dinner", slow: false, no_screen: false, upright: false,
    stopped_80: false, walked_after: false, foods: "", eaten_time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` });
  const [list, setList] = useState<Row[]>(meals);
  const addFood = (f: string) => setM(cur => ({ ...cur, foods: cur.foods ? `${cur.foods}, ${f}` : f }));
  const FOODS: Record<string, string[]> = {
    breakfast: ["String hoppers", "Hoppers", "Pittu", "Bread", "Kiribath", "Oats", "Eggs", "Smoothie", "Tea", "Coffee", "Fruit"],
    lunch: ["Rice & curry", "Dhal", "Chicken curry", "Fish curry", "Vegetables", "Salad", "Fried rice", "Kottu", "Fruit"],
    dinner: ["Roti", "String hoppers", "Rice & curry", "Kottu", "Noodles", "Soup", "Dhal", "Eggs", "Salad"],
    snack: ["Fruit", "Nuts", "Biscuits", "Short eats", "Yoghurt", "Tea", "Coffee", "Iramusu", "Chocolate"],
  };
  const checks: [string, string][] = [["slow", "Ate slowly, chewed well"], ["no_screen", "No phone, TV or laptop"], ["upright", "Sat upright"], ["stopped_80", "Stopped at 80% full"], ["walked_after", "Short walk after"]];
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={s.modal}>
      <View style={s.modalTop}><TouchableOpacity style={s.nav} onPress={onClose}><Text style={s.navText}>✕</Text></TouchableOpacity><Text style={s.modalTitle}>🍽 Mindful eating</Text><View style={{ width: 40 }}/></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
        <Card accent><Kicker>WHILE EATING</Kicker>{(rules.while as string[]).map(t => <Text key={t} style={s.rule}>•  {t}</Text>)}</Card>
        <Card><Kicker>AFTER · 0–10 MIN</Kicker>{(rules.after_0_10 as string[]).map(t => <Text key={t} style={s.rule}>•  {t}</Text>)}
          <Kicker>10–20 MIN</Kicker>{(rules.after_10_20 as string[]).map(t => <Text key={t} style={s.rule}>•  {t}</Text>)}</Card>
        <Card>
          <Kicker>WHAT DID YOU EAT?</Kicker>
          <Chips options={["breakfast", "lunch", "dinner", "snack"] as const} value={m.meal} onChange={meal => setM({ ...m, meal })}
            labels={{ breakfast: "🌅 Breakfast", lunch: "☀️ Lunch", dinner: "🌙 Dinner", snack: "🍎 Snack / other" }}/>
          <View style={s.chipsWrap}>{(FOODS[m.meal] || []).map(f => <TouchableOpacity key={f} style={s.chip} onPress={() => addFood(f)}>
            <Text style={s.chipText}>＋ {f}</Text></TouchableOpacity>)}</View>
          <TextInput style={[s.input, { minHeight: 60, textAlignVertical: "top" }]} multiline value={m.foods} onChangeText={foods => setM({ ...m, foods })}
            placeholder="e.g. rice, dhal, chicken curry, beans" placeholderTextColor={C.muted} maxLength={1000}/>
          <TimeField label="Eaten at" value={m.eaten_time} onChange={eaten_time => setM({ ...m, eaten_time })}/>
          <Kicker>HOW DID IT GO?</Kicker>
          {checks.map(([k, label]) => <Line key={k}><Text style={[s.rule, { flex: 1 }]}>{label}</Text>
            <Switch value={!!m[k]} onValueChange={v => setM({ ...m, [k]: v })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>)}
          <Btn title="Save meal" onPress={() => void api<Row>("/meals", "POST", { ...m, foods: String(m.foods || "").trim() || null })
            .then(saved => { setList(cur => [...cur, saved]); setM(cur => ({ ...cur, foods: "" })); onSaved(); }).catch(r => onError(msg(r)))}/>
          <Muted small>No calories, no judging: what you ate and how. 4+ yes earns a few points.</Muted>
        </Card>
        {list.length > 0 && <Card><Kicker>TODAY'S FOOD DIARY</Kicker>{[...list].sort((a, b) => String(a.eaten_time || "").localeCompare(String(b.eaten_time || ""))).map(x =>
          <View key={x.id} style={s.mealRow}>
            <Line><Text style={[s.cardTitle, { flex: 1, textTransform: "capitalize" }]}>{x.meal}{x.eaten_time ? ` · ${String(x.eaten_time).slice(0, 5)}` : ""}</Text>
              <Badge tone={x.mindful >= 4 ? "green" : "amber"}>{`${x.mindful}/5 mindful`}</Badge>
              <TouchableOpacity hitSlop={8} onPress={() => void api(`/meals/${x.id}`, "DELETE").then(() => { setList(cur => cur.filter(y => y.id !== x.id)); onSaved(); }).catch(r => onError(msg(r)))}>
                <Text style={{ color: C.muted, marginLeft: 6 }}>✕</Text></TouchableOpacity></Line>
            {!!x.foods && <Text style={s.rule}>{x.foods}</Text>}
          </View>)}</Card>}
      </ScrollView>
    </View>
  </Modal>;
}

// =====================================================================================================================
// WEEK
// =====================================================================================================================

/** The shape of your week: office days, gym days, weekend, Sunday reset, and how each day went. */
export function WeekPlan({ api, onError, onNotice }: Props) {
  const [w, setW] = useState<Row | null>(() => peek("/routines/week"));
  const [start, setStart] = useState<string | null>(() => (peek<Row>("/routines/week")?.start as string) ?? null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback((which: string | null = start) => {
    api<Row>(`/routines/week${which ? `?start=${which}` : ""}`).then(v => { setW(v); setStart(String(v.start)); }).catch(r => onError(msg(r)));
  }, [api, start, onError]);
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <Empty>Loading your week…</Empty>;

  async function setDays(key: "work_days" | "gym_days", days: number[]) {
    try { await api("/profile", "PATCH", { [key]: days }); onNotice(key === "gym_days" ? `Gym ${days.length} days a week` : "Work days updated"); load(); void syncRoutineReminders(api); }
    catch (r) { onError(msg(r)); }
  }
  const pct = w.score == null ? null : Math.round(w.score * 100);

  return <View style={{ gap: 12 }}>
    <Card accent>
      <Line>
        <TouchableOpacity style={s.nav} onPress={() => load(shift(start!, -7))}><Text style={s.navText}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}><Kicker>WEEK</Kicker>
          <Text style={s.dayLabel}>{new Date(`${w.start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })} – {new Date(`${w.end}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}</Text></View>
        <TouchableOpacity style={s.nav} onPress={() => load(shift(start!, 7))}><Text style={s.navText}>›</Text></TouchableOpacity>
      </Line>
      <View style={s.statRow}>
        <View style={s.stat}><Text style={s.statValue}>{pct == null ? "—" : `${pct}%`}</Text><Muted small>week score</Muted></View>
        <View style={s.stat}><Text style={s.statValue}>{w.gym.done}/{w.gym.target}</Text><Muted small>gym sessions</Muted></View>
        <View style={s.stat}><Text style={s.statValue}>{(w.perfect_days as string[]).length}🌟</Text><Muted small>perfect days</Muted></View>
      </View>
      <View style={s.gymDots}>{Array.from({ length: w.gym.target }).map((_, i) => <View key={i} style={[s.gymDot, i < w.gym.done && s.gymDotOn]}><Text style={{ fontSize: 14 }}>🏋️</Text></View>)}</View>
      <Text style={s.theme}>{w.message}</Text>
    </Card>

    {(w.days as Row[]).map(d => { const isToday = d.date === w.today; const expanded = open === d.date;
      return <TouchableOpacity key={d.date} onPress={() => setOpen(expanded ? null : d.date)} activeOpacity={0.85}>
        <View style={[s.weekDay, isToday && { borderColor: C.green }, d.date > w.today && { opacity: 0.85 }]}>
          <View style={s.weekDate}><Text style={s.weekDow}>{DAY_SHORT[new Date(`${d.date}T12:00:00`).getDay() === 0 ? 6 : new Date(`${d.date}T12:00:00`).getDay() - 1]}</Text>
            <Text style={s.weekNum}>{Number(String(d.date).slice(8))}</Text></View>
          <View style={{ flex: 1, gap: 4 }}>
            <Line><Text style={s.cardTitle}>{d.day_type.icon} {d.day_type.label}</Text>{isToday && <Badge>today</Badge>}</Line>
            <View style={s.dots}>{(d.routines as Row[]).map(r => <View key={r.id} style={[s.dot, r.status === "done" ? s.dotDone : r.status === "skipped" ? s.dotSkip : null]}/>)}</View>
            {expanded && <View style={{ gap: 3, marginTop: 4 }}>
              <Muted small>{d.day_type.theme}</Muted>
              {(d.routines as Row[]).map(r => <Text key={r.id} style={s.rule}>{r.icon} {r.name} · {r.status === "done" ? `done${r.mode === "short" ? " (short)" : ""} ✓` : r.status}</Text>)}
            </View>}
          </View>
          <Text style={s.weekScore}>{d.score == null ? "" : `${Math.round(d.score * 100)}%`}</Text>
        </View>
      </TouchableOpacity>; })}

    <Card>
      <Kicker>YOUR WEEK SHAPE</Kicker>
      <Text style={s.cardTitle}>💼 Work (office) days</Text>
      <DayPicker value={w.work_days} onChange={days => void setDays("work_days", days)}/>
      <Text style={s.cardTitle}>🏋️ Gym days · {(w.gym_days as number[]).length} a week</Text>
      <DayPicker value={w.gym_days} onChange={days => void setDays("gym_days", days)}/>
      <Muted small>Office-evening and office-bag follow your work days; the weekend evening runs on the other days. After-gym and the gym bag follow your gym days. Tip: avoid 3 gym days in a row so muscles can recover.</Muted>
    </Card>
  </View>;
}

// =====================================================================================================================
// MONTH
// =====================================================================================================================

/** A month at a glance: a completion calendar, gym sessions, streaks and how each routine is going. */
export function MonthRoutines({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(() => peek("/routines/month"));
  const [month, setMonth] = useState<string | null>(() => (peek<Row>("/routines/month")?.month as string) ?? null);
  const load = useCallback((which: string | null = month) => {
    api<Row>(`/routines/month${which ? `?month=${which}` : ""}`).then(x => { setV(x); setMonth(String(x.month)); }).catch(r => onError(msg(r)));
  }, [api, month, onError]);
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = useMemo(() => v ? [...Array((v.first_weekday as number) - 1).fill(null), ...(v.days as Row[])] : [], [v]);
  if (!v) return <Empty>Loading your month…</Empty>;
  const moveMonth = (n: number) => { const [y, m] = String(month).split("-").map(Number); const d = new Date(y, m - 1 + n, 1); load(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const shade = (score: number | null | undefined, future: boolean) => future || score == null ? C.panel2 : score >= 0.99 ? C.green : score >= 0.66 ? "#2f8f5f" : score >= 0.33 ? "#245c40" : "#3a2f1d";

  return <View style={{ gap: 12 }}>
    <Card accent>
      <Line>
        <TouchableOpacity style={s.nav} onPress={() => moveMonth(-1)}><Text style={s.navText}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}><Kicker>MONTH</Kicker><Text style={s.dayLabel}>{new Date(`${v.month}-15T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" })}</Text></View>
        <TouchableOpacity style={s.nav} onPress={() => moveMonth(1)}><Text style={s.navText}>›</Text></TouchableOpacity>
      </Line>
      <View style={s.calHead}>{DAY_SHORT.map(dn => <Text key={dn} style={s.calDow}>{dn.slice(0, 2)}</Text>)}</View>
      <View style={s.cal}>{cells.map((c, i) => <View key={i} style={s.calCell}>{c && <View style={[s.calDay, { backgroundColor: shade(c.score, c.future) }]}>
        <Text style={[s.calNum, c.score >= 0.99 && { color: C.greenDark }]}>{Number(String(c.date).slice(8))}</Text>
        {c.gym_done && <Text style={{ fontSize: 9 }}>🏋️</Text>}</View>}</View>)}</View>
      <Line style={{ flexWrap: "wrap" }}><Muted small>Less</Muted>{["#3a2f1d", "#245c40", "#2f8f5f", C.green].map(col => <View key={col} style={[s.legend, { backgroundColor: col }]}/>)}<Muted small>All routines done · 🏋️ gym</Muted></Line>
    </Card>
    <View style={s.statRow}>
      <View style={s.statCard}><Text style={s.statValue}>{v.score == null ? "—" : `${Math.round(v.score * 100)}%`}</Text><Muted small>month score</Muted></View>
      <View style={s.statCard}><Text style={s.statValue}>{v.gym_sessions}</Text><Muted small>gym sessions</Muted></View>
      <View style={s.statCard}><Text style={s.statValue}>{v.current_streak}🔥</Text><Muted small>{`streak · best ${v.best_streak}`}</Muted></View>
    </View>
    <Card><Kicker>ROUTINES THIS MONTH</Kicker>
      {(v.routines as Row[]).map(r => <View key={r.id} style={{ gap: 4 }}>
        <Line><Text style={[s.rule, { flex: 1 }]}>{r.icon} {r.name}</Text><Muted small>{`${r.done}/${r.due}`}</Muted></Line>
        <Progress value={r.due ? (r.done / r.due) * 100 : 0}/></View>)}
      <Muted small>A day counts toward the streak when at least half its routines are done. Forgiving on purpose.</Muted>
    </Card>
  </View>;
}

/** Small Home card: the routine happening now, or the next one today. */
export function NowRoutineCard({ api, onOpen }: { api: Api; onOpen: () => void }) {
  const [r, setR] = useState<Row | null>(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    api<Row>("/routines/today").then(d => {
      const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
      const list = ((d.items || []) as Row[]).filter(i => i.kind === "routine" && i.status === "open" && i.starts);
      const cur = list.find(i => { const st = minutesOf(i.starts)!; return nowMin >= st && nowMin < st + i.duration_minutes; });
      const next = list.filter(i => minutesOf(i.starts)! > nowMin).sort((a, b) => minutesOf(a.starts)! - minutesOf(b.starts)!)[0];
      setR(cur || next || null); setLabel(cur ? "NOW" : next ? `NEXT · ${hhmm(next.starts)}` : "");
    }).catch(() => setR(null));
  }, [api]);
  if (!r) return null;
  return <TouchableOpacity onPress={onOpen} activeOpacity={0.85}><View style={[s.nowCard, { marginBottom: 10 }]}>
    <Text style={s.nowKicker}>{label}</Text>
    <Line><Text style={{ fontSize: 26 }}>{r.icon}</Text><View style={{ flex: 1 }}><Text style={s.nowTitle}>{r.name}</Text>
      <Muted small>{`${Math.round(r.progress * 100)}% · ${(r.needed_step_ids as string[]).length} steps · open in Plan`}</Muted></View><Text style={s.nowGo}>›</Text></Line>
  </View></TouchableOpacity>;
}

const s = StyleSheet.create({
  switch: { flexDirection: "row", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 99, padding: 4, marginBottom: 12 },
  switchTab: { flex: 1, borderRadius: 99, paddingVertical: 10, alignItems: "center" },
  switchOn: { backgroundColor: C.green },
  switchText: { color: C.muted, fontWeight: "700", fontSize: 13 },
  switchTextOn: { color: C.greenDark },
  nav: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  navText: { color: C.text, fontSize: 20 },
  dayIcon: { fontSize: 30 },
  dayLabel: { color: C.text, fontSize: 18, fontWeight: "800" },
  theme: { color: "#b9c7be", fontSize: 13, fontStyle: "italic", textAlign: "center" },
  big: { color: C.text, fontSize: 24, fontWeight: "900", fontVariant: ["tabular-nums"] },
  section: { color: C.text, fontSize: 16, fontWeight: "800", marginTop: 4 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  chev: { color: C.muted, fontSize: 22 },
  action: { color: C.green, fontWeight: "700", fontSize: 13 },
  routine: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  routineDone: { borderColor: "#2f6b4b", backgroundColor: "#122019" },
  iconBubble: { width: 46, height: 46, borderRadius: 14, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  nowCard: { backgroundColor: "#15281e", borderColor: C.green, borderWidth: 1, borderRadius: 18, padding: 14, gap: 6 },
  nowKicker: { color: C.green, fontSize: 10, fontWeight: "900", letterSpacing: 1.5 },
  nowTitle: { color: C.text, fontSize: 17, fontWeight: "800" },
  nowGo: { color: C.green, fontSize: 22, fontWeight: "900" },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 44, paddingBottom: 8 },
  modalTitle: { color: C.text, fontSize: 19, fontWeight: "800", flexShrink: 1 },
  stepCard: { backgroundColor: C.panel2, borderColor: C.green, borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
  stepKicker: { color: C.green, fontSize: 10, fontWeight: "900", letterSpacing: 1.4 },
  stepTitle: { color: C.text, fontSize: 22, fontWeight: "800", lineHeight: 28 },
  doneCard: { alignItems: "center", gap: 6, backgroundColor: "#122019", borderRadius: 20, padding: 22, borderColor: "#2f6b4b", borderWidth: 1 },
  doneTitle: { color: C.text, fontSize: 22, fontWeight: "900" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  stepText: { color: C.text, fontSize: 14, flex: 1 },
  stepTextDone: { color: C.muted, textDecorationLine: "line-through" },
  check: { width: 26, height: 26, borderRadius: 8, borderColor: "#476051", borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkText: { color: C.greenDark, fontWeight: "900" },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 11, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  iconPick: { width: 42, height: 42, borderRadius: 12, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 13 },
  chipTextOn: { color: C.green },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { width: 40, height: 40, borderRadius: 20, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: C.green, borderColor: C.green },
  dayText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  dayTextOn: { color: C.greenDark },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 22, backgroundColor: C.bg, borderTopColor: C.line, borderTopWidth: 1, gap: 8 },
  rule: { color: "#d1ddd4", fontSize: 14, lineHeight: 21 },
  mealRow: { gap: 4, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  statRow: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, alignItems: "center", backgroundColor: C.field, borderRadius: 14, paddingVertical: 10 },
  statCard: { flex: 1, alignItems: "center", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, paddingVertical: 14 },
  statValue: { color: C.text, fontSize: 20, fontWeight: "900" },
  gymDots: { flexDirection: "row", justifyContent: "center", gap: 8 },
  gymDot: { width: 34, height: 34, borderRadius: 17, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center", opacity: 0.45 },
  gymDotOn: { opacity: 1, borderColor: C.green, backgroundColor: C.greenSoft },
  weekDay: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 12 },
  weekDate: { width: 44, alignItems: "center" },
  weekDow: { color: C.muted, fontSize: 11, fontWeight: "700" },
  weekNum: { color: C.text, fontSize: 20, fontWeight: "900" },
  weekScore: { color: C.green, fontWeight: "800", fontVariant: ["tabular-nums"] },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line },
  dotDone: { backgroundColor: C.green },
  dotSkip: { backgroundColor: C.amber },
  calHead: { flexDirection: "row" },
  calDow: { flex: 1, textAlign: "center", color: C.muted, fontSize: 11, fontWeight: "700" },
  cal: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  calDay: { flex: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  calNum: { color: C.text, fontSize: 12, fontWeight: "700" },
  legend: { width: 14, height: 14, borderRadius: 4 },
});
