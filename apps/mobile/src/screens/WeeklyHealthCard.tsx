import React, { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Bars } from "../charts";
import { C } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;

/** Home card: last 7 days of steps (bars) and sleep (dots), with weekly averages and goal days. */
export function WeeklyHealthCard({ api, onOpen }: { api: Api; onOpen: () => void }) {
  const [t, setT] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/health/trends?days=14").then(setT).catch(() => undefined); }, [api]);
  if (!t || !t.has_data) return null;
  const days: Row[] = (t.days as Row[]).slice(-7);
  const w: Row = t.week || {}, g: Row = t.goals || {};
  return <TouchableOpacity activeOpacity={0.85} onPress={onOpen} style={{ backgroundColor: C.panel, borderRadius: 24, padding: 16, gap: 12, borderWidth: 1, borderColor: "#3ee08f33" }}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: C.green, fontSize: 10, letterSpacing: 1.6, fontWeight: "800", flex: 1 }}>THIS WEEK · BODY</Text>
      <Text style={{ color: C.green, fontSize: 12, fontWeight: "800" }}>Health ›</Text></View>
    <View style={{ flexDirection: "row", gap: 10 }}>
      {[["👟", w.avg_steps != null ? Math.round(w.avg_steps).toLocaleString() : "—", "avg steps", `${w.step_goal_days ?? 0}/7 goal`, C.green],
        ["😴", w.avg_sleep_hours != null ? `${w.avg_sleep_hours}h` : "—", "avg sleep", `${w.sleep_goal_days ?? 0}/7 ≥ ${g.sleep_hours}h`, "#b48cff"],
        ["🏋️", `${w.workout_minutes ?? 0}`, "workout min", `${w.active_days ?? 0} active days`, C.amber]].map(([icon, v, l, hint, c]) =>
        <View key={String(l)} style={{ flex: 1, backgroundColor: C.panel2, borderRadius: 16, padding: 10, gap: 2 }}>
          <Text style={{ fontSize: 16 }}>{icon}</Text><Text style={{ color: String(c), fontSize: 18, fontWeight: "900" }}>{v}</Text>
          <Text style={{ color: C.muted, fontSize: 10.5 }}>{l}</Text><Text style={{ color: C.muted, fontSize: 10 }}>{hint}</Text></View>)}
    </View>
    <Bars data={days.map((d, i) => ({ label: d.label, value: Number(d.steps || 0), highlight: i === days.length - 1, color: Number(d.steps) >= Number(g.steps) ? C.green : "#2f7d57" }))}
      goal={Number(g.steps) || undefined} height={90} format={n => n.toLocaleString()}/>
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>{days.map(d => { const h = Number(d.sleep_hours || 0);
      return <View key={d.date} style={{ alignItems: "center", flex: 1, gap: 2 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: h >= Number(g.sleep_hours) ? "#b48cff" : h > 0 ? "#b48cff66" : C.line }}/>
        <Text style={{ color: C.muted, fontSize: 9 }}>{h ? `${h.toFixed(1)}h` : "–"}</Text></View>; })}</View>
  </TouchableOpacity>;
}
