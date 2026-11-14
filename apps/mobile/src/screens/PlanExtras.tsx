import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const KIND: Record<string, { label: string; color: string }> = {
  task: { label: "Task", color: C.green }, repeat: { label: "Repeats", color: C.muted },
  goal: { label: "Goal deadline", color: C.amber }, milestone: { label: "Milestone", color: C.blue },
};

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Month plan as an agenda list (phone-friendly version of the web month grid). */
export function MonthAgenda({ api }: { api: Api }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Row>({});
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    api<Row>(`/planner/monthly?month=${month}`).then(setData).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load"));
  }, [api, month]);
  const days = Object.entries((data.days || {}) as Record<string, Row[]>);
  const tz = data.timezone ? { timeZone: String(data.timezone) } : {};
  const title = new Date(`${month}-01T12:00:00`).toLocaleDateString([], { month: "long", year: "numeric" });

  return <Card>
    <Kicker>MONTH PLAN</Kicker>
    <Line style={{ justifyContent: "space-between" }}>
      <Btn kind="outline" title="‹" onPress={() => setMonth(shift(month, -1))}/>
      <Text style={{ color: C.text, fontWeight: "800", fontSize: 16 }}>{title}</Text>
      <Btn kind="outline" title="›" onPress={() => setMonth(shift(month, 1))}/>
    </Line>
    {!!error && <Text style={{ color: "#f18c80" }}>{error}</Text>}
    {days.length ? days.map(([day, entries]) => <View key={day} style={{ gap: 4, paddingVertical: 6, borderTopColor: C.line, borderTopWidth: 1 }}>
      <Text style={{ color: C.text, fontWeight: "700" }}>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</Text>
      {entries.map((e, i) => <Line key={i}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: (KIND[e.kind] || KIND.task).color }}/>
        <Text style={{ color: e.kind === "repeat" ? C.muted : C.text, flex: 1, textDecorationLine: e.status === "done" ? "line-through" : "none" }}>{e.title}</Text>
        <Muted small>{(KIND[e.kind] || KIND.task).label}{e.at ? ` · ${new Date(String(e.at)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...tz })}` : ""}</Muted>
      </Line>)}
    </View>) : <Empty>Nothing dated this month yet.</Empty>}
    <Muted small>“Repeats” are upcoming copies of repeating tasks. Each one is created when you finish the previous one.</Muted>
  </Card>;
}

/** Milestones checklist for one goal. */
export function GoalMilestones({ api, goalId, onError }: { api: Api; goalId: string; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const load = useCallback(() => { api<Row[]>(`/goals/${goalId}/milestones`).then(setRows).catch(() => setRows([])); }, [api, goalId]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>) => void work.then(load).catch(reason => onError(reason instanceof Error ? reason.message : "Could not update"));

  return <View style={{ gap: 4 }}>
    {rows.map(row => <Line key={row.id}>
      <TouchableOpacity accessibilityLabel={`Mark ${row.title}`} onPress={() => run(api(`/milestones/${row.id}`, "PATCH", { done: !row.done_at }))}
        style={{ width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: row.done_at ? C.green : C.line, backgroundColor: row.done_at ? C.green : "transparent", alignItems: "center", justifyContent: "center" }}>
        {!!row.done_at && <Text style={{ color: "#06140d", fontSize: 12, fontWeight: "900" }}>✓</Text>}
      </TouchableOpacity>
      <Text style={{ flex: 1, color: row.done_at ? C.muted : C.text, textDecorationLine: row.done_at ? "line-through" : "none" }}>{row.title}</Text>
      <TouchableOpacity onPress={() => Alert.alert("Delete milestone?", String(row.title), [{ text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => run(api(`/milestones/${row.id}`, "DELETE")) }])}><Text style={{ color: "#f18c80" }}>✕</Text></TouchableOpacity>
    </Line>)}
    <Line><View style={{ flex: 1 }}><Field value={title} onChangeText={setTitle} placeholder="Add a milestone…" onSubmitEditing={() => { if (title.trim()) { run(api(`/goals/${goalId}/milestones`, "POST", { title: title.trim(), position: rows.length })); setTitle(""); } }}/></View>
      <Btn kind="outline" title="Add" disabled={!title.trim()} onPress={() => { run(api(`/goals/${goalId}/milestones`, "POST", { title: title.trim(), position: rows.length })); setTitle(""); }}/></Line>
  </View>;
}
