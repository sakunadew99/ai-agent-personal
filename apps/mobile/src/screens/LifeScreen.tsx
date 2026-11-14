import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, niceDate, Progress, Row as Line, Screen } from "../ui";
import { syncReminders } from "../notify";
import { GoalMilestones } from "./PlanExtras";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const TABS = ["tasks", "goals", "habits"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;
const CATEGORIES = ["personal", "work", "learning", "health", "business"] as const;
const WHEN = ["no date", "today", "tomorrow", "in a week"] as const;
const REPEATS = ["once", "daily", "weekdays", "weekly", "monthly"] as const;
const RULES: Record<(typeof REPEATS)[number], string | undefined> = {
  once: undefined, daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY",
};

/** Local date + "HH:MM" -> ISO time (the phone's timezone). Returns undefined for "no date" or a bad time. */
function dueIso(when: (typeof WHEN)[number], hhmm: string): string | undefined {
  if (when === "no date") return undefined;
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(hhmm.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  const d = new Date();
  d.setDate(d.getDate() + (when === "tomorrow" ? 1 : when === "in a week" ? 7 : 0));
  d.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return d.toISOString();
}

/** Tasks, goals and habits (same data as the web "My life" page). */
export function LifeScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("tasks");
  const [tasks, setTasks] = useState<Row[]>([]);
  const [goals, setGoals] = useState<Row[]>([]);
  const [habits, setHabits] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("medium");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("personal");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [when, setWhen] = useState<(typeof WHEN)[number]>("no date");
  const [at, setAt] = useState("18:00");
  const [repeat, setRepeat] = useState<(typeof REPEATS)[number]>("once");
  const [reminders, setReminders] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, g, h] = await Promise.all([api<Row[]>("/tasks"), api<Row[]>("/goals"), api<Row[]>("/habits")]);
      setTasks(t.filter(x => x.status !== "done" && x.status !== "cancelled")); setGoals(g); setHabits(h);
      void syncReminders(api).then(setReminders); // keep phone reminders in step with the task list
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); }
  }, [api, onError]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await load(); } catch (reason) { onError(reason instanceof Error ? reason.message : "Something went wrong"); } finally { setBusy(false); }
  }
  function add() {
    const name = title.trim(); if (!name) return;
    void run(async () => {
      if (tab === "tasks") {
        const due = dueIso(when, at);
        if (when !== "no date" && !due) throw new Error("Time must look like 18:00");
        await api("/tasks", "POST", { title: name, priority, category, duration_minutes: 30, ...(due ? { due_at: due } : {}), ...(RULES[repeat] ? { recurrence: RULES[repeat] } : {}) });
        setRepeat("once");
      }
      if (tab === "goals") await api("/goals", "POST", { title: name, category, ...(target ? { target_value: Number(target), current_value: 0 } : {}), ...(unit ? { unit } : {}) });
      if (tab === "habits") await api("/habits", "POST", { name, schedule: "daily" });
      setTitle(""); setTarget(""); setUnit("");
    });
  }
  const confirmDelete = (label: string, fn: () => Promise<unknown>) =>
    Alert.alert("Delete?", `Delete “${label}”?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void run(fn) }]);

  return <Screen>
    <Chips options={TABS} value={tab} onChange={setTab}/>
    <Card>
      <Kicker>{tab === "tasks" ? "ADD A TASK" : tab === "goals" ? "CREATE A GOAL" : "BUILD A HABIT"}</Kicker>
      <Field value={title} onChangeText={setTitle} placeholder={tab === "tasks" ? "What needs doing?" : tab === "goals" ? "e.g. German B1 by June" : "e.g. Read 20 pages"} onSubmitEditing={add}/>
      {tab === "tasks" && <Chips options={PRIORITIES} value={priority} onChange={setPriority}/>}
      {tab !== "habits" && <Chips options={CATEGORIES} value={category} onChange={setCategory}/>}
      {tab === "tasks" && <>
        <Chips options={WHEN} value={when} onChange={setWhen}/>
        {when !== "no date" && <Field value={at} onChangeText={setAt} placeholder="Time, e.g. 18:00" keyboardType="numbers-and-punctuation" maxLength={5}/>}
        <Chips options={REPEATS} value={repeat} onChange={setRepeat} labels={{ once: "doesn't repeat" }}/>
        {repeat !== "once" && <Muted small>When you finish it, the next one is created automatically at the same time.</Muted>}
      </>}
      {tab === "goals" && <Line><View style={{ flex: 1 }}><Field value={target} onChangeText={setTarget} placeholder="Target (e.g. 100)" keyboardType="numeric"/></View>
        <View style={{ flex: 1 }}><Field value={unit} onChangeText={setUnit} placeholder="Unit (lessons, USD…)"/></View></Line>}
      <Btn title="Add" onPress={add} busy={busy} disabled={!title.trim()}/>
    </Card>

    {tab === "tasks" && <Card><Kicker>{tasks.length} OPEN TASKS</Kicker>
      {reminders !== null && <Muted small>{reminders < 0 ? "Phone reminders are off. Allow notifications for Sakuna in Android settings to get them." : `🔔 ${reminders} reminder${reminders === 1 ? "" : "s"} set on this phone for the next 7 days (quiet hours respected).`}</Muted>}
      {tasks.length ? tasks.map(t => <Line key={t.id} style={{ paddingVertical: 6 }}>
        <TouchableOpacity onPress={() => void run(() => api(`/tasks/${t.id}/complete`, "PATCH"))} style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: C.line }} accessibilityLabel={`Complete ${t.title}`}/>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "600" }}>{t.title}</Text><Muted small>{[t.category, t.due_at && niceDate(t.due_at), t.recurrence && "↻ repeats"].filter(Boolean).join(" · ")}</Muted></View>
        <Badge tone={t.priority === "high" ? "red" : t.priority === "medium" ? "amber" : "green"}>{t.priority}</Badge>
        <TouchableOpacity onPress={() => confirmDelete(t.title, () => api(`/tasks/${t.id}`, "DELETE"))}><Text style={{ color: "#f18c80" }}>✕</Text></TouchableOpacity>
      </Line>) : <Empty>All clear. Add a task above.</Empty>}</Card>}

    {tab === "goals" && <Card><Kicker>GOALS</Kicker>
      {goals.length ? goals.map(g => { const pct = g.target_value ? Math.round(Number(g.current_value || 0) / Number(g.target_value) * 100) : 0;
        return <View key={g.id} style={{ gap: 6, paddingVertical: 6 }}>
          <Line><H2>{g.title}</H2><View style={{ flex: 1 }}/><Text style={{ color: C.green, fontWeight: "700" }}>{pct}%</Text></Line>
          <Progress value={pct}/><Muted small>{g.current_value ?? 0} / {g.target_value ?? "—"} {g.unit || ""}</Muted>
          <GoalMilestones api={api} goalId={String(g.id)} onError={onError}/>
          <Line><Btn kind="link" title="Progress +1" onPress={() => void run(() => api(`/goals/${g.id}`, "PATCH", { current_value: Number(g.current_value || 0) + 1 }))}/>
            <Btn kind="link" title="Delete" onPress={() => confirmDelete(g.title, () => api(`/goals/${g.id}`, "DELETE"))}/></Line>
        </View>; }) : <Empty>Create a goal to track progress.</Empty>}</Card>}

    {tab === "habits" && <Card><Kicker>HABITS</Kicker>
      {habits.length ? habits.map(h => <Line key={h.id} style={{ paddingVertical: 6 }}>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "600" }}>{h.name}</Text><Muted small>{h.schedule}</Muted></View>
        <Btn kind="outline" title="Done today ✓" onPress={() => void run(() => api(`/habits/${h.id}/logs`, "POST", { completed: true }))}/>
      </Line>) : <Empty>Create a habit to start a streak.</Empty>}</Card>}
  </Screen>;
}
