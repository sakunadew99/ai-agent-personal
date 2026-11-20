import React, { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const hm = (v: unknown) => (v ? String(v).slice(0, 5) : "");
const shift = (v: string, by: number) => {
  const [h, m] = (v || "09:00").split(":").map(Number);
  const t = (((h * 60 + m + by) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/** A time you set with − / + (15 minutes) or ±1 hour; no keyboard needed. */
function TimeStep({ label, icon, value, onChange, color = C.green }: { label: string; icon: string; value: string; onChange: (v: string) => void; color?: string }) {
  const b = (t: string, by: number) => <TouchableOpacity onPress={() => onChange(shift(value, by))} style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: C.panel2 }}>
    <Text style={{ color: C.text, fontWeight: "800" }}>{t}</Text></TouchableOpacity>;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <Text style={{ fontSize: 18 }}>{icon}</Text><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{label}</Text>
    {b("−1h", -60)}{b("−", -15)}
    <Text style={{ color, fontSize: 20, fontWeight: "900", width: 66, textAlign: "center", fontVariant: ["tabular-nums"] }}>{value || "--:--"}</Text>
    {b("+", 15)}{b("+1h", 60)}
  </View>;
}

function DayPick({ value, onChange, color }: { value: number[]; onChange: (v: number[]) => void; color: string }) {
  return <View style={{ flexDirection: "row", gap: 6 }}>{DAYS.map((d, i) => { const on = value.includes(i + 1);
    return <TouchableOpacity key={i} onPress={() => onChange(on ? value.filter(x => x !== i + 1) : [...value, i + 1].sort())}
      style={{ flex: 1, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: on ? color : C.panel2 }}>
      <Text style={{ color: on ? "#04170d" : C.muted, fontWeight: "900" }}>{d}</Text></TouchableOpacity>; })}</View>;
}

/** Office, gym, wake and sleep times + every routine's time, set by hand or detected from what you logged. */
export function ScheduleScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [p, setP] = useState<Row | null>(null);
  const [routines, setRoutines] = useState<Row[]>([]);
  const [hint, setHint] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => {
    api<Row>("/me").then(me => { const x = me.profile || {};
      setP({ wake_time: hm(x.wake_time), sleep_time: hm(x.sleep_time), work_start: hm(x.work_start), work_end: hm(x.work_end), gym_time: hm(x.gym_time) || "18:00",
        work_days: x.work_days || [1, 2, 3, 4, 5], gym_days: x.gym_days || [1, 3, 5] }); }).catch(e => onError(msg(e)));
    api<Row[]>("/routines").then(r => setRoutines(r.filter(x => x.kind === "routine"))).catch(() => undefined);
    api<Row>("/schedule/suggest").then(setHint).catch(() => undefined);
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!p) return <Screen><Empty>Loading your schedule…</Empty></Screen>;
  const set = (k: string) => (v: unknown) => setP({ ...p, [k]: v });
  async function save(body: Row = p!) {
    setSaving(true);
    try { await api("/profile", "PATCH", body); onNotice("Schedule saved. Today's plan uses it now"); load(); } catch (e) { onError(msg(e)); } finally { setSaving(false); }
  }
  const saveRoutine = (r: Row, patch: Row) => void api(`/routines/${r.id}`, "PATCH", patch).then(() => { setRoutines(rs => rs.map(x => x.id === r.id ? { ...x, ...patch } : x)); }).catch(e => onError(msg(e)));
  const names: Record<string, string> = { work_start: "Office starts", work_end: "Office ends", gym_time: "Gym", wake_time: "Wake up", sleep_time: "Sleep", work_days: "Office days", gym_days: "Gym days" };
  const show = (v: unknown) => (Array.isArray(v) ? v.map(d => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][Number(d) - 1]).join(" ") : String(v ?? "—"));
  return <Screen onRefresh={load}>
    <Card accent>
      <Kicker>✨ DETECTED FROM YOUR LOGS</Kicker>
      {hint?.changes?.length ? <>
        {(hint.changes as Row[]).map(c => <Line key={c.field}><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{names[c.field] || c.field}</Text>
          <Text style={{ color: C.muted, textDecorationLine: "line-through" }}>{show(c.from)}</Text><Text style={{ color: C.green, fontWeight: "900" }}>{`  →  ${show(c.to)}`}</Text></Line>)}
        <Muted small>{Object.values(hint.why || {}).join(" ")}</Muted>
        <Btn title="Use these times" busy={saving} onPress={() => void save(Object.fromEntries((hint.changes as Row[]).map(c => [c.field, c.to])))}/>
      </> : <Muted small>{hint?.enough_data ? "Your schedule already matches what you log. 👍" : hint?.tip || "Checking your logs…"}</Muted>}
    </Card>

    <Card>
      <Kicker>💼 OFFICE</Kicker>
      <TimeStep icon="▶" label="Starts" value={p.work_start} onChange={set("work_start")} color={C.blue}/>
      <TimeStep icon="■" label="Ends" value={p.work_end} onChange={set("work_end")} color={C.blue}/>
      <DayPick value={p.work_days} onChange={set("work_days")} color={C.blue}/>
      {p.work_end && p.work_start && p.work_end < p.work_start && <Muted small>Ends after midnight? Set the night part as a routine below.</Muted>}
    </Card>
    <Card>
      <Kicker>🏋️ GYM</Kicker>
      <TimeStep icon="⏰" label="Gym time" value={p.gym_time} onChange={set("gym_time")} color={C.amber}/>
      <DayPick value={p.gym_days} onChange={set("gym_days")} color={C.amber}/>
    </Card>
    <Card>
      <Kicker>😴 SLEEP</Kicker>
      <TimeStep icon="☀️" label="Wake up" value={p.wake_time} onChange={set("wake_time")} color="#b48cff"/>
      <TimeStep icon="🌙" label="Sleep" value={p.sleep_time} onChange={set("sleep_time")} color="#b48cff"/>
    </Card>
    <Btn title="💾 Save my schedule" busy={saving} onPress={() => void save()}/>

    {routines.length > 0 && <Card>
      <Kicker>🔁 ROUTINES IN YOUR DAY (saved instantly)</Kicker>
      {routines.map(r => <View key={r.id} style={{ gap: 6, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line }}>
        <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{`${r.icon} ${r.name}`}</Text>
          <TouchableOpacity onPress={() => saveRoutine(r, { active: !r.active })}><Text style={{ color: r.active ? C.green : C.muted, fontWeight: "800" }}>{r.active ? "On" : "Off"}</Text></TouchableOpacity></Line>
        {r.active && <>
          <TimeStep icon="⏰" label={r.day_rule === "gym" ? "On gym days" : r.day_rule === "work" ? "On office days" : "Starts"} value={hm(r.start_time)} onChange={v => saveRoutine(r, { start_time: v })}/>
          <Line><Text style={{ color: C.muted, flex: 1 }}>Length</Text>
            {[30, 60, 120, 180, 300].map(m => <TouchableOpacity key={m} onPress={() => saveRoutine(r, { duration_minutes: m })}
              style={{ paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: r.duration_minutes === m ? C.greenSoft : C.panel2 }}>
              <Text style={{ color: r.duration_minutes === m ? C.green : C.muted, fontWeight: "800", fontSize: 12 }}>{m < 60 ? `${m}m` : `${m / 60}h`}</Text></TouchableOpacity>)}</Line>
        </>}
      </View>)}
    </Card>}
  </Screen>;
}
