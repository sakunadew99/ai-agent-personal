import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
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

/** Today: the whole day on one screen. */
export function TodayScreen({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void }) {
  const [t, setT] = useState<Row | null>(null); const [rv, setRv] = useState<Row | null>(null); const [cons, setCons] = useState<Row | null>(null); const [pop, setPop] = useState(0);
  const load = useCallback(() => {
    api<Row>("/today").then(setT).catch(e => onError(msg(e)));
    api<Row>("/review/week").then(setRv).catch(() => undefined);
    api<Row>("/consistency").then(setCons).catch(() => undefined);
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const habit = (h: Row) => { if (h.done_today) return; void api(`/habits/${h.id}/logs`, "POST", {}).then(() => { setPop(p => p + 1); onNotice(`${h.name} ✓`); load(); }).catch(e => onError(msg(e))); };
  const water = () => void api("/water", "POST", { ml: 250 }).then(() => { onNotice("💧 +250 ml"); load(); }).catch(e => onError(msg(e)));
  if (!t) return <Screen><Empty>Building your day…</Empty></Screen>;
  const totals = t.totals as Record<string, number>;
  const legend = Object.entries(totals).filter(([k, v]) => v > 0 && k !== "future").sort((a, b) => b[1] - a[1]);
  const hour = new Date().getHours();
  return <Screen onRefresh={load}>
    <Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>{`${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"} 👋`}</Text>
    <Card style={{ paddingVertical: 16 }}>
      <DayRing ring={t.ring as Row[]} center={<View style={{ alignItems: "center" }}>
        <Text style={{ color: C.green, fontSize: 26, fontWeight: "900" }}>{hm(Number(t.productive_minutes))}</Text><Muted small>productive</Muted>
        <Text style={{ color: C.red, fontWeight: "800", marginTop: 6 }}>{hm(Number(t.wasted_minutes))}</Text><Muted small>time waste</Muted></View>}/>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 8 }}>{legend.map(([k, v]) =>
        <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, backgroundColor: C.panel2 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: (t.colors as Row)[k] || "#455a64" }}/><Text style={{ color: C.text, fontSize: 11 }}>{`${NAME[k] || k} ${hm(v)}`}</Text></View>)}</View>
    </Card>
    <GapCards api={api} day={iso(new Date())} onError={onError} onNotice={onNotice} onSaved={load}/>
    <View style={{ flexDirection: "row", gap: 10 }}>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpen("Sleep")}><Card style={{ gap: 2, borderColor: "#7c4dff66" }}><Text style={{ fontSize: 22 }}>😴</Text>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{t.sleep ? `${t.sleep.hours} h` : "—"}</Text>
        <Muted small>{t.sleep ? `${t.sleep.bed} → ${t.sleep.wake}` : "No sleep data yet"}</Muted></Card></TouchableOpacity>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => onOpen("Water")}><Card style={{ gap: 2, borderColor: "#4fc3f766" }}>
        <Line><Text style={{ fontSize: 22 }}>💧</Text><View style={{ flex: 1 }}/><TouchableOpacity onPress={water}><Text style={{ color: "#4fc3f7", fontWeight: "900" }}>+250</Text></TouchableOpacity></Line>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{`${t.water.percent}%`}</Text>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line }}><View style={{ width: `${Math.min(100, Number(t.water.percent))}%`, height: 6, borderRadius: 3, backgroundColor: "#4fc3f7" }}/></View>
        <Muted small>{`${t.water.left_ml} ml to go`}</Muted></Card></TouchableOpacity>
    </View>
    {t.affirmation && <TouchableOpacity onPress={() => onOpen("Mindset")}><View style={{ borderRadius: 20, padding: 16, backgroundColor: "#7c4dff" }}>
      <Text style={{ color: "#ffffffcc", fontSize: 11, fontWeight: "800" }}>{t.affirm_read ? "✨ AFFIRMATION · READ TODAY ✓" : "✨ TODAY'S AFFIRMATION · TAP TO READ"}</Text>
      <Text style={{ color: "#fff", fontSize: 17, fontWeight: "900", lineHeight: 24, marginTop: 4 }}>{t.affirmation.text}</Text></View></TouchableOpacity>}
    <Card style={{ gap: 4 }}><Kicker>🎯 MOST IMPORTANT NOW</Kicker><Text style={{ color: C.text, fontWeight: "800" }}>{t.top_task ? t.top_task.title : "No open tasks"}</Text>
      <Muted small>{t.top_task_answer}</Muted>
      {t.top_task && <Btn kind="outline" title="✓ Done" onPress={() => void api(`/tasks/${t.top_task.id}/complete`, "PATCH").then(() => { setPop(p => p + 1); load(); }).catch(e => onError(msg(e)))}/>}</Card>
    {(t.habits as Row[]).length > 0 && <Card style={{ gap: 8 }}><Line><Kicker>HABITS TODAY</Kicker><View style={{ flex: 1 }}/>
      <TouchableOpacity onPress={() => onOpen("Board")}><Text style={{ color: C.green, fontSize: 12 }}>Board →</Text></TouchableOpacity></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(t.habits as Row[]).map(h => <TouchableOpacity key={h.id} onPress={() => habit(h)}
        style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1.5, minWidth: "46%", flexGrow: 1,
          borderColor: h.done_today ? C.green : h.status === "must" || h.status === "restart" ? C.amber : C.line, backgroundColor: h.done_today ? C.greenSoft : "transparent" }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{`${h.done_today ? "✅" : h.icon} ${h.name}`}</Text>
        <Muted small>{h.done_today ? `🔥 ${h.streak} · strength ${h.strength}` : h.status === "must" ? `Never miss twice · tiny: ${h.tiny}` : h.status === "restart" ? `Restart today · ${h.tiny}` : `strength ${h.strength}`}</Muted>
      </TouchableOpacity>)}</View></Card>}
    {cons && (cons.stacking as Row[]).length > 0 && <Card style={{ gap: 4 }}><Kicker>🔗 HABIT STACKING IDEAS</Kicker>{(cons.stacking as Row[]).map(s => <Text key={s.text} style={{ color: C.text }}>{`• ${s.text}`}</Text>)}</Card>}
    {rv && <Card style={{ gap: 6, borderColor: "#5aa8ff66" }}>
      <Line><Kicker>📅 THIS WEEK</Kicker><View style={{ flex: 1 }}/><Text style={{ color: C.green, fontWeight: "900", fontSize: 18 }}>{`${rv.score}`}</Text></Line>
      <Muted small>{`Productive ${hm(Number(rv.productive_minutes))} · waste ${hm(Number(rv.wasted_minutes))} · sleep ${rv.sleep_avg_minutes ? `${(Number(rv.sleep_avg_minutes) / 60).toFixed(1)} h avg` : "—"} · water goal ${rv.water_days_met}/7 days · ${rv.tasks_done} tasks done`}</Muted>
      {(rv.wins as string[]).map(w => <Text key={w} style={{ color: C.green }}>{`✓ ${w}`}</Text>)}
      {(rv.fixes as string[]).map(w => <Text key={w} style={{ color: C.amber }}>{`→ ${w}`}</Text>)}
      <Text style={{ color: C.text, fontWeight: "800" }}>{`One change for next week: ${rv.one_change}`}</Text></Card>}
    <Pop show={pop}/>
  </Screen>;
}

/** Life board: tasks in Now / Next / Later, habits by strength, goals by progress. */
export function BoardScreen({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void }) {
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
    <View style={{ flexDirection: "row", gap: 6 }}>{([["tasks", "✅ Tasks"], ["habits", "🔁 Habits"], ["goals", "🎯 Goals"]] as const).map(([k, l]) =>
      <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: tab === k ? C.green : C.panel2 }}>
        <Text style={{ color: tab === k ? "#04170d" : C.text, fontWeight: "800" }}>{l}</Text></TouchableOpacity>)}</View>
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
