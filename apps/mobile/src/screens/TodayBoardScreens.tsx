import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Linking, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { peekToday, todayPath, type ApiRecord as Row } from "../api";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";
import { GapCards } from "./SleepDayScreens";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const hm = (m: number) => `${Math.floor(m / 60)}h ${m % 60}m`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const NAME: Record<string, string> = { sleep: "Sleep", work: "Work", deep_work: "Deep work", meeting: "Meetings", study: "Study", exercise: "Exercise", commute: "Travel",
  chores: "Chores", family: "Family", social: "Friends", rest: "Rest", entertainment: "Fun", wasted: "Time waste", other: "Other", focus: "Focus", unknown: "Not logged" };

/** 24-hour ring: 96 quarter-hour dots coloured by what you did (sleep, work, study, waste…); grey = not logged yet. */
function DayRing({ ring, size = 250, center }: { ring: Row[]; size?: number; center: React.ReactNode }) {
  const slots: string[] = [];
  for (const s of ring) for (let i = 0; i < Number(s.slots); i++) slots.push(String(s.color));
  const dot = 9; const r = size / 2 - dot;
  return <View style={{ width: size, height: size, alignSelf: "center", alignItems: "center", justifyContent: "center" }}>
    {slots.map((c, i) => { const a = (i / 96) * Math.PI * 2 - Math.PI / 2;
      return <View key={i} style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, backgroundColor: c,
        left: size / 2 + r * Math.cos(a) - dot / 2, top: size / 2 + r * Math.sin(a) - dot / 2 }}/>; })}
    {[0, 6, 12, 18].map(h => { const a = (h / 24) * Math.PI * 2 - Math.PI / 2; const rr = r - 20;
      return <Text key={h} style={{ position: "absolute", color: C.muted, fontSize: 10, left: size / 2 + rr * Math.cos(a) - 8, top: size / 2 + rr * Math.sin(a) - 7 }}>{String(h).padStart(2, "0")}</Text>; })}
    {center}
  </View>;
}

function Pop({ show }: { show: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (!show) return; v.setValue(0); Animated.sequence([Animated.spring(v, { toValue: 1, useNativeDriver: true }), Animated.delay(500),
    Animated.timing(v, { toValue: 0, duration: 300, useNativeDriver: true })]).start(); }, [show, v]);
  return <Animated.Text pointerEvents="none" style={{ position: "absolute", alignSelf: "center", top: 80, fontSize: 64, opacity: v, transform: [{ scale: v }] }}>🎉</Animated.Text>;
}

/** Today (the Home tab): brief, ring, hours to fill, sleep & water, affirmation, top task, habits, stacking, week, more. Cards can be reordered or hidden. */
export function TodayScreen({ api, onError, onNotice, onOpen, extra, pinnedBar, onMore }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void;
  extra?: React.ReactNode; pinnedBar?: React.ReactNode; onMore?: () => void }) {
  const hour = new Date().getHours();
  const briefKind = hour < 12 ? "morning" : hour >= 19 ? "night" : null;
  // Starts from the last answer saved on this phone (shown at once), then refreshes with ONE request.
  const saved = useRef(peekToday()).current;
  const [t, setT] = useState<Row | null>(saved?.today ?? null); const [rv, setRv] = useState<Row | null>(saved?.week ?? null); const [cons, setCons] = useState<Row | null>(saved?.consistency ?? null); const [pop, setPop] = useState(0);
  const [prefs, setPrefs] = useState<Row | null>(saved?.prefs ?? null); const [brief, setBrief] = useState<Row | null>(saved?.brief?.kind === briefKind ? saved?.brief : null);
  const [goals, setGoals] = useState<Row | null>(saved?.goals ?? null); const [edit, setEdit] = useState(false); const [more, setMore] = useState(false);
  const [sync, setSync] = useState<"" | "updating" | "offline">(saved ? "updating" : "");
  const hasData = useRef(!!saved); hasData.current = hasData.current || !!t;
  const load = useCallback(() => {
    setSync(s => (hasData.current ? "updating" : s));
    api<Row>(todayPath()).then(b => {
      if (b.today) setT(b.today);
      if (b.week) setRv(b.week); if (b.consistency) setCons(b.consistency); if (b.prefs) setPrefs(b.prefs); if (b.goals) setGoals(b.goals);
      setBrief(b.brief && b.brief.kind === briefKind ? b.brief : null); setSync("");
    }).catch(e => { if (hasData.current) setSync("offline"); else onError(msg(e)); });
  }, [api, onError, briefKind]);
  useEffect(() => { load(); }, [load]);
  const habit = (h: Row) => { if (h.done_today) return; void api(`/habits/${h.id}/logs`, "POST", {}).then(() => { setPop(p => p + 1); onNotice(`${h.name} ✓`); load(); }).catch(e => onError(msg(e))); };
  const water = () => void api("/water", "POST", { ml: 250 }).then(() => { onNotice("💧 +250 ml"); load(); }).catch(e => onError(msg(e)));
  const savePrefs = (patch: Row) => void api<Row>("/settings/prefs", "PATCH", patch).then(setPrefs).catch(e => onError(msg(e)));
  if (!t) return <Screen><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>{`${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"} 👋`}</Text>
    {[90, 150, 250, 110].map((h, i) => <View key={i} style={{ height: h, borderRadius: 20, backgroundColor: C.panel, opacity: 1 - i * 0.18 }}/>)}
    <Muted small>Building your day… (the first time can take a few seconds; after that Today opens instantly)</Muted></Screen>;
  const totals = t.totals as Record<string, number>;
  const legend = Object.entries(totals).filter(([k, v]) => v > 0 && k !== "future").sort((a, b) => b[1] - a[1]);
  const order: string[] = prefs?.cards || ["brief", "goals", "tasks", "next_event", "ring", "gaps", "sleep_water", "affirmation", "inbox", "top_task", "habits", "stacking", "week", "more"];
  const hidden: string[] = prefs?.hidden_cards || [];
  const CARD_NAME: Record<string, string> = { brief: "Morning / night brief", goals: "Daily goals", tasks: "Today's tasks", next_event: "Next event (Google Calendar)",
    inbox: "Gmail inbox", ring: "24-hour ring", gaps: "Hours to fill in", sleep_water: "Sleep & water", affirmation: "Affirmation",
    top_task: "Most important task", habits: "Habits", stacking: "Habit stacking", week: "This week", more: "More for today" };
  const move = (k: string, d: number) => { const o = [...order]; const i = o.indexOf(k); const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; savePrefs({ cards: o }); };
  const toggle = (k: string) => savePrefs({ hidden_cards: hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k] });
  const cards: Record<string, React.ReactNode> = {
    goals: <DailyGoals api={api} goals={goals} onChange={load} onNotice={onNotice} onCelebrate={() => setPop(p => p + 1)}/>,
    tasks: <TodayTasks api={api} data={t.tasks_today} calendar={String(t.calendar)} onChange={load} onError={onError} onNotice={onNotice} onCelebrate={() => setPop(p => p + 1)}/>,
    next_event: <NextEvent today={t} onOpen={onOpen}/>,
    inbox: <InboxCard api={api} onOpen={onOpen}/>,
    brief: brief && <Card style={{ gap: 6, borderColor: briefKind === "morning" ? "#ffb74d88" : "#7c4dff88" }}>
      <Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{brief.title}</Text>
      {!!brief.line && <Muted small>{brief.line}</Muted>}
      {(brief.steps as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 21 }}>{`${i + 1}. ${x}`}</Text>)}
      {briefKind === "night" && <Btn kind="outline" title="🙏 Write gratitude" onPress={() => onOpen("Mindset")}/>}
    </Card>,
    ring: <Card style={{ paddingVertical: 16 }}>
      <DayRing ring={t.ring as Row[]} center={<View style={{ alignItems: "center" }}>
        <Text style={{ color: C.green, fontSize: 26, fontWeight: "900" }}>{hm(Number(t.productive_minutes))}</Text><Muted small>productive</Muted>
        <Text style={{ color: C.red, fontWeight: "800", marginTop: 6 }}>{hm(Number(t.wasted_minutes))}</Text><Muted small>time waste</Muted></View>}/>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>{legend.map(([k, v]) =>
        <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: C.panel2 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: (t.colors as Row)[k] || "#455a64" }}/><Text style={{ color: C.text, fontSize: 11 }}>{`${NAME[k] || k} ${hm(v)}`}</Text></View>)}</View>
    </Card>,
    gaps: <GapCards api={api} day={iso(new Date())} onError={onError} onNotice={onNotice} onSaved={load}/>,
    sleep_water: <View style={{ flexDirection: "row", gap: 10 }}>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpen("Sleep")}><Card style={{ gap: 2 }}><Text style={{ fontSize: 22 }}>😴</Text>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{t.sleep ? `${t.sleep.hours} h` : "—"}</Text>
        <Muted small>{t.sleep ? `${t.sleep.bed} → ${t.sleep.wake}` : "No sleep data yet"}</Muted></Card></TouchableOpacity>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpen("Water")}><Card style={{ gap: 2 }}>
        <Line><Text style={{ fontSize: 22 }}>💧</Text><View style={{ flex: 1 }}/><TouchableOpacity onPress={water}><Text style={{ color: "#4fc3f7", fontWeight: "900" }}>+250</Text></TouchableOpacity></Line>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{`${t.water.percent}%`}</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line }}><View style={{ width: `${Math.min(100, Number(t.water.percent))}%`, height: 6, borderRadius: 3, backgroundColor: "#4fc3f7" }}/></View>
        <Muted small>{`${t.water.left_ml} ml to go`}</Muted></Card></TouchableOpacity>
    </View>,
    affirmation: t.affirmation && <TouchableOpacity onPress={() => onOpen("Mindset")}><View style={{ borderRadius: 20, padding: 16, backgroundColor: "#7c4dff" }}>
      <Text style={{ color: "#ffffffcc", fontSize: 11, fontWeight: "800" }}>{t.affirm_read ? "✨ AFFIRMATION · READ TODAY ✓" : "✨ TODAY'S AFFIRMATION · TAP TO READ"}</Text>
      <Text style={{ color: "#fff", fontSize: 17, fontWeight: "900", lineHeight: 24, marginTop: 4 }}>{t.affirmation.text}</Text></View></TouchableOpacity>,
    top_task: <Card style={{ gap: 4 }}><Kicker>🎯 MOST IMPORTANT NOW</Kicker><Text style={{ color: C.text, fontWeight: "800" }}>{t.top_task ? t.top_task.title : "No open tasks"}</Text>
      <Muted small>{t.top_task_answer}</Muted>
      {t.top_task && <Btn kind="outline" title="✓ Done" onPress={() => void api(`/tasks/${t.top_task.id}/complete`, "PATCH").then(() => { setPop(p => p + 1); load(); }).catch(e => onError(msg(e)))}/>}</Card>,
    habits: (t.habits as Row[]).length > 0 && <Card style={{ gap: 8 }}><Line><Kicker>HABITS TODAY</Kicker><View style={{ flex: 1 }}/>
      <TouchableOpacity onPress={() => onOpen("Board")}><Text style={{ color: C.green, fontSize: 12 }}>Board →</Text></TouchableOpacity></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(t.habits as Row[]).map(h => <TouchableOpacity key={h.id} onPress={() => habit(h)}
        style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1.5, minWidth: "46%", flexGrow: 1,
          borderColor: h.done_today ? C.green : h.status === "must" || h.status === "restart" ? C.amber : C.line, backgroundColor: h.done_today ? C.greenSoft : "transparent" }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{`${h.done_today ? "✅" : h.icon} ${h.name}`}</Text>
        <Muted small>{h.done_today ? `🔥 ${h.streak} · strength ${h.strength}` : h.status === "must" ? `Never miss twice · tiny: ${h.tiny}` : h.status === "restart" ? `Restart today · ${h.tiny}` : `strength ${h.strength}`}</Muted>
      </TouchableOpacity>)}</View></Card>,
    stacking: cons && (cons.stacking as Row[]).length > 0 && <Card style={{ gap: 4 }}><Kicker>🔗 HABIT STACKING IDEAS</Kicker>{(cons.stacking as Row[]).map(s => <Text key={s.text} style={{ color: C.text }}>{`• ${s.text}`}</Text>)}</Card>,
    week: rv && <Card style={{ gap: 6 }}>
      <Line><Kicker>📅 THIS WEEK</Kicker><View style={{ flex: 1 }}/><Text style={{ color: C.green, fontWeight: "900", fontSize: 18 }}>{`${rv.score}`}</Text></Line>
      <Muted small>{`Productive ${hm(Number(rv.productive_minutes))} · waste ${hm(Number(rv.wasted_minutes))} · sleep ${rv.sleep_avg_minutes ? `${(Number(rv.sleep_avg_minutes) / 60).toFixed(1)} h avg` : "—"} · water goal ${rv.water_days_met}/7 days · ${rv.tasks_done} tasks done`}</Muted>
      {(rv.wins as string[]).map(w => <Text key={w} style={{ color: C.green }}>{`✓ ${w}`}</Text>)}
      {(rv.fixes as string[]).map(w => <Text key={w} style={{ color: C.amber }}>{`→ ${w}`}</Text>)}
      <Text style={{ color: C.text, fontWeight: "800" }}>{`One change for next week: ${rv.one_change}`}</Text></Card>,
    more: extra ? <View style={{ gap: 10 }}><TouchableOpacity onPress={() => { if (!more) onMore?.(); setMore(m => !m); }}><Card style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>🧰 More for today: rituals, coach, compass</Text><Text style={{ color: C.muted }}>{more ? "▴" : "▾"}</Text></Card></TouchableOpacity>
      {more && extra}</View> : null,
  };
  return <Screen onRefresh={load}>
    <Line><Text style={{ color: C.text, fontSize: 24, fontWeight: "900", flex: 1 }}>{`${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"} 👋`}</Text>
      <TouchableOpacity onPress={() => setEdit(e => !e)}><Text style={{ color: C.green, fontWeight: "800" }}>{edit ? "Done" : "✏️ Customize"}</Text></TouchableOpacity></Line>
    {!!sync && <Muted small>{sync === "updating" ? "↻ Updating…" : "📴 Offline: showing what was saved on this phone"}</Muted>}
    <TouchableOpacity onPress={() => onOpen("Assistant")} activeOpacity={0.85} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 18, backgroundColor: `${C.green}1f`, borderWidth: 1, borderColor: `${C.green}55` }}>
      <Text style={{ fontSize: 22 }}>✨</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900" }}>Tell Sakuna what to do</Text>
        <Muted small>“Drank 500 ml water; add milk to my buy list and remind me to call Amma at 6pm”</Muted></View><Text style={{ color: C.green, fontWeight: "900" }}>›</Text></TouchableOpacity>
    {pinnedBar}
    {edit ? <Card style={{ gap: 8 }}><Kicker>ARRANGE YOUR TODAY</Kicker>{order.map((k, i) => <Line key={k}>
      <Switch value={!hidden.includes(k)} onValueChange={() => toggle(k)}/><Text style={{ color: hidden.includes(k) ? C.muted : C.text, flex: 1 }}>{CARD_NAME[k] || k}</Text>
      <TouchableOpacity disabled={i === 0} onPress={() => move(k, -1)}><Text style={{ color: i === 0 ? C.line : C.text, fontSize: 18, paddingHorizontal: 8 }}>▲</Text></TouchableOpacity>
      <TouchableOpacity disabled={i === order.length - 1} onPress={() => move(k, 1)}><Text style={{ color: i === order.length - 1 ? C.line : C.text, fontSize: 18, paddingHorizontal: 8 }}>▼</Text></TouchableOpacity>
    </Line>)}<Muted small>Pin screens from Settings & profile or by long-pressing them in Hubs.</Muted></Card>
      : order.filter(k => !hidden.includes(k)).map(k => cards[k] ? <View key={k}>{cards[k]}</View> : null)}
    <Pop show={pop}/>
  </Screen>;
}

/** Life board: tasks in Now / Next / Later, habits by strength, goals by progress. */
export function BoardScreen({ api, onError, onNotice, onOpen, top }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void; top?: React.ReactNode }) {
  const [tab, setTab] = useState<"tasks" | "habits" | "goals">("tasks"); const [tasks, setTasks] = useState<Row[]>([]); const [cons, setCons] = useState<Row | null>(null);
  const [prog, setProg] = useState<Row | null>(null); const [pop, setPop] = useState(0);
  const load = useCallback(() => {
    api<Row[]>("/tasks").then(r => setTasks((r as Row[]).filter(x => ["inbox", "todo", "in_progress"].includes(x.status)))).catch(e => onError(msg(e)));
    api<Row>("/consistency").then(setCons).catch(() => undefined); api<Row>("/progress").then(setProg).catch(() => undefined);
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const today = new Date(); today.setHours(23, 59, 59);
  const week = new Date(today.getTime() + 6 * 86400000);
  const col = (x: Row) => { const d = x.due_at ? new Date(x.due_at) : null;
    return x.status === "in_progress" || (d && d <= today) ? "now" : (d && d <= week) || x.priority === "high" ? "next" : "later"; };
  const complete = (x: Row) => void api(`/tasks/${x.id}/complete`, "PATCH").then(() => { setPop(p => p + 1); onNotice(`✓ ${x.title}`); load(); }).catch(e => onError(msg(e)));
  const bump = (x: Row) => void api(`/tasks/${x.id}`, "PATCH", { priority: ({ low: "medium", medium: "high", high: "low" } as Row)[x.priority] || "medium" }).then(load).catch(e => onError(msg(e)));
  const PR: Record<string, string> = { high: C.red, medium: C.amber, low: C.muted };
  const COLS: [string, string, string][] = [["now", "🔥 Now", "#ef5350"], ["next", "⏭ Next", "#ffb74d"], ["later", "🗂 Later", "#78909c"]];
  return <Screen onRefresh={load}>
    {top}
    <View style={{ flexDirection: "row", gap: 6 }}>{([["tasks", "✅ Tasks"], ["habits", "🔁 Habits"], ["goals", "🎯 Goals"]] as const).map(([k, l]) =>
      <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: tab === k ? C.green : C.panel2 }}>
        <Text style={{ color: tab === k ? C.greenDark : C.text, fontWeight: "800" }}>{l}</Text></TouchableOpacity>)}</View>
    {tab === "tasks" && <>{COLS.map(([k, label, color]) => { const list = tasks.filter(x => col(x) === k);
      return <View key={k} style={{ gap: 8 }}>
        <Text style={{ color, fontWeight: "900", fontSize: 15 }}>{`${label} · ${list.length}`}</Text>
        {list.length ? list.map(x => <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, backgroundColor: C.panel, borderLeftWidth: 4, borderLeftColor: PR[x.priority] || C.line }}>
          <TouchableOpacity onPress={() => complete(x)} style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: C.green }}/>
          <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{x.title}</Text>
            <Muted small>{[x.due_at ? new Date(x.due_at).toLocaleDateString([], { day: "numeric", month: "short" }) : null, x.duration_minutes ? `${x.duration_minutes} min` : null, x.category].filter(Boolean).join(" · ")}</Muted></View>
          <TouchableOpacity onPress={() => bump(x)}><Text style={{ color: PR[x.priority], fontSize: 11, fontWeight: "900" }}>{String(x.priority).toUpperCase()}</Text></TouchableOpacity>
        </View>) : <Muted small>Nothing here.</Muted>}
      </View>; })}<Muted small>Tap the circle to finish a task, tap the priority to change it.</Muted></>}
    {tab === "habits" && cons && <>{(cons.habits as Row[]).length ? (cons.habits as Row[]).map(h => <Card key={h.id} style={{ gap: 6 }}>
      <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{`${h.icon} ${h.name}`}</Text><Text style={{ color: C.green, fontWeight: "900" }}>{h.strength}</Text></Line>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line }}><View style={{ width: `${h.strength}%`, height: 8, borderRadius: 4, backgroundColor: h.strength >= 60 ? C.green : h.strength >= 30 ? C.amber : C.red }}/></View>
      <Muted small>{`${h.level} · 🔥 ${h.streak} · day ${h.journey_day}/66 · this week ${h.week_done}/${h.week_target}`}</Muted>
      <Text style={{ color: h.status === "done" ? C.green : h.status === "todo" ? C.muted : C.amber, fontSize: 13 }}>{h.nudge}</Text></Card>)
      : <Empty>No habits yet. Add them in My life.</Empty>}
      {(cons.tips as string[]).map(x => <Muted key={x} small>{`💡 ${x}`}</Muted>)}</>}
    {tab === "goals" && prog && <>{(prog.goals as Row[]).length ? (prog.goals as Row[]).map(g => <TouchableOpacity key={g.id} onPress={() => onOpen("Ask")}><Card style={{ gap: 6 }}>
      <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{g.title}</Text><Text style={{ color: C.muted, fontSize: 11 }}>{String(g.priority).toUpperCase()}</Text></Line>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: C.line }}><View style={{ width: `${g.progress_percent ?? 0}%`, height: 10, borderRadius: 5, backgroundColor: g.pace === "behind" ? C.amber : C.green }}/></View>
      <Muted small>{[g.progress_percent != null ? `${g.progress_percent}%` : "no % yet", g.pace ? String(g.pace).replace("_", " ") : null, g.days_left != null ? `${g.days_left} days left` : null, `${g.tasks_open} open tasks`].filter(Boolean).join(" · ")}</Muted>
      {!!g.next_action && <Text style={{ color: C.green, fontSize: 13 }}>{`Next: ${g.next_action}`}</Text>}</Card></TouchableOpacity>)
      : <Empty>No active goals yet.</Empty>}</>}
    <Pop show={pop}/>
  </Screen>;
}


/** This week at a glance (same numbers as Today): score, productive vs waste, sleep, water, wins, fixes, one change. */
export function WeekReviewCard({ api }: { api: Api }) {
  const [rv, setRv] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/review/week").then(setRv).catch(() => undefined); }, [api]);
  if (!rv) return null;
  return <Card style={{ gap: 6 }} accent>
    <Line><Kicker>📅 YOUR WEEK</Kicker><View style={{ flex: 1 }}/><Text style={{ color: C.green, fontWeight: "900", fontSize: 22 }}>{`${rv.score}`}</Text></Line>
    <Muted small>{`Productive ${hm(Number(rv.productive_minutes))} · waste ${hm(Number(rv.wasted_minutes))} · sleep ${rv.sleep_avg_minutes ? `${(Number(rv.sleep_avg_minutes) / 60).toFixed(1)} h` : "—"} · water ${rv.water_days_met}/7 · ${rv.tasks_done} tasks · habits ${rv.habits_avg_strength ?? "—"}/100`}</Muted>
    {(rv.wins as string[]).map(w => <Text key={w} style={{ color: C.green }}>{`✓ ${w}`}</Text>)}
    {(rv.fixes as string[]).map(w => <Text key={w} style={{ color: C.amber }}>{`→ ${w}`}</Text>)}
    <Text style={{ color: C.text, fontWeight: "800" }}>{`One change: ${rv.one_change}`}</Text>
  </Card>;
}

/** Body hub overview: last night's sleep, water today, latest weight and this week's habit strength. */
export function BodyOverview({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [t, setT] = useState<Row | null>(null); const [b, setB] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/today").then(setT).catch(() => undefined); api<Row>("/body").then(setB).catch(() => undefined); }, [api]);
  const w = b?.changes?.weight_kg;
  const tiles: [string, string, string, string][] = [
    ["😴", t?.sleep ? `${t.sleep.hours} h` : "—", "sleep", "Sleep"], ["💧", t ? `${t.water.percent}%` : "—", "water", "Water"],
    ["⚖️", w ? `${w.latest} kg` : "—", "weight", "Body"], ["🏃", t ? `${Math.round(Number((t.totals as Row)?.exercise || 0))} min` : "—", "exercise today", "Gym"]];
  return <View style={{ flexDirection: "row", gap: 8 }}>{tiles.map(([icon, val, label, target]) =>
    <TouchableOpacity key={label} onPress={() => onOpen(target)} style={{ flex: 1, backgroundColor: C.panel, borderRadius: 16, padding: 10, alignItems: "center", gap: 2 }}>
      <Text style={{ fontSize: 20 }}>{icon}</Text><Text style={{ color: C.text, fontWeight: "900" }}>{val}</Text><Text style={{ color: C.muted, fontSize: 10 }}>{label}</Text></TouchableOpacity>)}</View>;
}


const PRI: Record<string, string> = { high: "#ef5350", medium: "#ffb74d", low: "#78909c" };

/** Today's tasks: big check circles, time / late chips, add to Google Calendar, move to tomorrow, quick add, done list. */
export function TodayTasks({ api, data, calendar, onChange, onError, onNotice, onCelebrate }: { api: Api; data: Row; calendar: string; onChange: () => void;
  onError: (m: string) => void; onNotice: (m: string) => void; onCelebrate: () => void }) {
  const [text, setText] = useState(""); const [showDone, setShowDone] = useState(false); const [busy, setBusy] = useState<string>("");
  const open = (data?.open || []) as Row[]; const done = (data?.done || []) as Row[];
  const total = open.length + Number(data?.done_count || 0); const pct = total ? Math.round(Number(data?.done_count || 0) / total * 100) : 0;
  const run = (id: string, p: Promise<unknown>, okMsg: string, celebrate = false) => { setBusy(id);
    void p.then(() => { onNotice(okMsg); if (celebrate) onCelebrate(); onChange(); }).catch(e => onError(msg(e))).finally(() => setBusy("")); };
  const complete = (t: Row) => run(t.id, api(`/tasks/${t.id}/complete`, "PATCH"), `✓ ${t.title}`, true);
  const tomorrow = (t: Row) => { const d = new Date(); d.setDate(d.getDate() + 1); const [hh, mm] = String(t.due || "09:00").split(":").map(Number); d.setHours(hh, mm, 0, 0);
    run(t.id, api(`/tasks/${t.id}`, "PATCH", { due_at: d.toISOString() }), "⏭ Moved to tomorrow"); };
  const toCal = (t: Row) => run(t.id, api(`/tasks/${t.id}/calendar`, "POST", { popup_minutes: 10 }), "📅 Added to Google Calendar with a 10-min reminder");
  const add = () => { const title = text.trim(); if (!title) return; const d = new Date(); d.setHours(Math.min(22, d.getHours() + 2), 0, 0, 0);
    run("new", api("/tasks", "POST", { title: title.slice(0, 200), due_at: d.toISOString(), priority: "medium" }), "＋ Added for today"); setText(""); };
  return <Card style={{ gap: 10, borderColor: C.green + "55" }}>
    <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 17, flex: 1 }}>✅ Today's tasks</Text>
      <Text style={{ color: C.green, fontWeight: "900" }}>{`${data?.done_count || 0}/${total}`}</Text></Line>
    <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line, overflow: "hidden" }}><View style={{ width: `${pct}%`, height: 8, backgroundColor: C.green }}/></View>
    {open.length === 0 ? <Text style={{ color: C.muted }}>{total ? "🎉 Everything for today is done!" : "Nothing due today. Add one small thing that moves a goal."}</Text>
      : open.map(t => <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, backgroundColor: C.panel2,
        borderLeftWidth: 4, borderLeftColor: PRI[t.priority] || C.line, opacity: busy === t.id ? 0.5 : 1 }}>
        <TouchableOpacity onPress={() => complete(t)} accessibilityLabel={`Complete ${t.title}`} style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, borderColor: C.green,
          alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.green, fontSize: 14 }}>{busy === t.id ? "…" : ""}</Text></TouchableOpacity>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={2}>{t.title}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
            {t.overdue_days > 0 ? <Text style={{ color: "#fff", backgroundColor: C.red, fontSize: 10, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 }}>{`${t.overdue_days}d late`}</Text>
              : t.due ? <Text style={{ color: t.overdue ? "#fff" : C.text, backgroundColor: t.overdue ? C.red : C.line, fontSize: 10, fontWeight: "800", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 }}>{`⏰ ${t.due}`}</Text> : null}
            {!!t.minutes && <Text style={{ color: C.muted, fontSize: 10 }}>{`⏱ ${t.minutes}m`}</Text>}
            {t.status === "in_progress" && <Text style={{ color: C.blue, fontSize: 10, fontWeight: "800" }}>in progress</Text>}
            {t.on_calendar && <Text style={{ color: "#29b6f6", fontSize: 10 }}>📅 on calendar</Text>}
          </View>
        </View>
        {calendar === "connected" && !t.on_calendar && <TouchableOpacity onPress={() => toCal(t)} accessibilityLabel="Add to Google Calendar"><Text style={{ fontSize: 18 }}>📅</Text></TouchableOpacity>}
        <TouchableOpacity onPress={() => tomorrow(t)} accessibilityLabel="Move to tomorrow"><Text style={{ fontSize: 18 }}>⏭</Text></TouchableOpacity>
      </View>)}
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12 }}>
      <Text style={{ color: C.green, fontSize: 18 }}>＋</Text>
      <TextInput value={text} onChangeText={setText} onSubmitEditing={add} placeholder="Add a task for today…" placeholderTextColor={C.muted} returnKeyType="done"
        style={{ flex: 1, color: C.text, paddingVertical: 10 }}/>
      {!!text.trim() && <TouchableOpacity onPress={add}><Text style={{ color: C.green, fontWeight: "900" }}>Add</Text></TouchableOpacity>}
    </View>
    {done.length > 0 && <TouchableOpacity onPress={() => setShowDone(s => !s)}><Muted small>{`✓ ${data.done_count} done today ${showDone ? "▴" : "▾"}`}</Muted></TouchableOpacity>}
    {showDone && done.map(d => <Text key={d.id} style={{ color: C.muted, textDecorationLine: "line-through" }}>{`✓ ${d.title}`}</Text>)}
  </Card>;
}

/** The 5 daily goals as rings; finishing all of them unlocks a bonus. */
export function DailyGoals({ api, goals, onChange, onNotice, onCelebrate }: { api: Api; goals: Row | null; onChange: () => void; onNotice: (m: string) => void; onCelebrate: () => void }) {
  if (!goals) return null;
  const items = goals.items as Row[];
  const claim = () => void api<Row>("/nudges/claim", "POST").then(r => { onNotice(r.message); if (r.ok && r.points) onCelebrate(); onChange(); }).catch(() => undefined);
  return <Card style={{ gap: 10, borderColor: "#b48cff66" }}>
    <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 17, flex: 1 }}>🎁 Daily goals</Text>
      <Text style={{ color: "#b48cff", fontWeight: "900" }}>{`${goals.done}/${goals.total} · +${goals.bonus}`}</Text></Line>
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{items.map(i => <View key={i.key} style={{ alignItems: "center", gap: 4, width: "19%" }}>
      <View style={{ width: 50, height: 50, borderRadius: 25, borderWidth: 3, borderColor: i.done ? C.green : C.line, backgroundColor: i.done ? C.greenSoft : "transparent",
        alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 22 }}>{i.done ? "✅" : i.icon}</Text></View>
      <Text style={{ color: C.text, fontSize: 10, fontWeight: "700", textAlign: "center" }} numberOfLines={1}>{i.label}</Text>
      <Text style={{ color: i.done ? C.green : C.muted, fontSize: 9 }}>{i.progress}</Text></View>)}</View>
    {goals.complete && !goals.claimed ? <Btn title={`🏆 Claim +${goals.bonus} bonus`} onPress={claim}/>
      : goals.claimed ? <Text style={{ color: C.green, fontWeight: "800", textAlign: "center" }}>🏆 Bonus claimed today. Amazing!</Text>
      : <Muted small>{`${goals.total - goals.done} more to unlock +${goals.bonus} points. Small wins add up.`}</Muted>}
  </Card>;
}

/** Next calendar event + today's list, or a prompt to connect Google Calendar. */
export function NextEvent({ today, onOpen }: { today: Row; onOpen: (t: string) => void }) {
  const evs = (today.events || []) as Row[];
  if (today.calendar !== "connected") return <TouchableOpacity onPress={() => onOpen("Profile")}><Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <Text style={{ fontSize: 24 }}>📅</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>Connect Google Calendar</Text>
      <Muted small>{today.calendar === "expired" ? "Your connection expired. Tap to reconnect." : "See meetings on your ring and add tasks with reminders."}</Muted></View>
    <Text style={{ color: C.green }}>›</Text></Card></TouchableOpacity>;
  const n = today.next_event as Row | null;
  return <Card style={{ gap: 6, borderColor: "#29b6f666" }}>
    <Kicker>📅 NEXT UP</Kicker>
    {n ? <><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{n.title}</Text>
      <Text style={{ color: "#29b6f6", fontWeight: "800" }}>{`${n.start}–${n.end} · ${n.in_minutes <= 0 ? "now" : n.in_minutes < 60 ? `in ${n.in_minutes} min` : `in ${Math.floor(n.in_minutes / 60)} h ${n.in_minutes % 60} min`}`}</Text></>
      : <Muted small>No more events today.</Muted>}
    {evs.filter(e => e !== n).slice(0, 4).map((e, i) => <Text key={i} style={{ color: e.upcoming ? C.text : C.muted, fontSize: 12 }}>{`${e.all_day ? "All day" : `${e.start}–${e.end}`} · ${e.title}`}</Text>)}
  </Card>;
}

/** Unread primary emails (read-only). */
export function InboxCard({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [m, setM] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/gmail/inbox").then(setM).catch(() => undefined); }, [api]);
  if (!m || m.status === "not_connected") return null;
  if (m.status !== "connected") return <TouchableOpacity onPress={() => onOpen("Profile")}><Card><Text style={{ color: C.amber }}>📧 Gmail needs reconnecting. Tap to fix.</Text></Card></TouchableOpacity>;
  return <Card style={{ gap: 6 }}>
    <Line><Kicker>{`📧 INBOX · ${m.unread} UNREAD`}</Kicker></Line>
    {(m.emails as Row[]).length ? (m.emails as Row[]).slice(0, 3).map(e => <TouchableOpacity key={e.id} onPress={() => void Linking.openURL(e.url)}>
      <View style={{ paddingVertical: 4 }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>{e.subject}</Text>
        <Muted small>{`${e.from} · ${e.snippet}`.slice(0, 110)}</Muted></View></TouchableOpacity>) : <Muted small>Inbox zero. 🎉</Muted>}
    <Muted small>Read-only: Sakuna never sends or deletes email.</Muted>
  </Card>;
}


/** Plan → Day: today's Google Calendar events (from the same cached Today answer), or a prompt to connect. */
export function CalendarDay({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [b, setB] = useState<Row | null>(() => peekToday());
  useEffect(() => { api<Row>(todayPath()).then(setB).catch(() => undefined); }, [api]);
  const t = b?.today;
  if (!t) return null;
  if (t.calendar !== "connected") return <TouchableOpacity onPress={() => onOpen("Profile")}><Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
    <Text style={{ fontSize: 22 }}>📅</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{t.calendar === "expired" ? "Google Calendar needs reconnecting" : "See your meetings here"}</Text>
      <Muted small>Settings → Connections → Google Calendar</Muted></View><Text style={{ color: C.green, fontWeight: "900" }}>›</Text></Card></TouchableOpacity>;
  const evs = (t.events as Row[]) || [];
  return <Card style={{ gap: 8 }}><Kicker>{`📅 GOOGLE CALENDAR TODAY · ${evs.length}`}</Kicker>
    {evs.length ? evs.map((e, i) => <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, opacity: e.upcoming || e.all_day ? 1 : 0.5 }}>
      <View style={{ width: 62, paddingVertical: 4, borderRadius: 8, alignItems: "center", backgroundColor: "#29b6f633" }}><Text style={{ color: "#29b6f6", fontWeight: "900", fontSize: 12 }}>{e.all_day ? "All day" : e.start}</Text></View>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }} numberOfLines={1}>{`${e.from_sakuna ? "✅ " : ""}${e.title}`}</Text>
        {!e.all_day && <Muted small>{`until ${e.end} · ${e.minutes} min`}</Muted>}</View></View>) : <Muted small>No events today. Your time plan below has the whole day.</Muted>}
  </Card>;
}
