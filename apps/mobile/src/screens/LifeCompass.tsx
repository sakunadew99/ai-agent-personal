import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const COLOR: Record<string, string> = { done: C.green, on_track: C.green, behind: C.amber, no_data: C.muted };
const STATUS: Record<string, string> = { done: "target met", on_track: "on track", behind: "behind", no_data: "not tracked" };
const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** Home: your seven life areas this week (from every feature), today in numbers, and the next best actions. */
export function LifeCompass({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (target: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { api<Row>("/compass").then(setV).catch(() => setV(null)); }, [api]);
  useEffect(() => { load(); }, [load]);
  if (!v) return null;
  const d = v.day;
  const log = (key: string, label: string) => api<Row>(`/compass/${key}/log`, "POST", {}).then(next => { setV(next); onNotice(`Logged: ${label} ✓`); }).catch(e => onError(msg(e)));
  const selected = (v.areas as Row[]).find(a => a.key === open);

  return <View style={s.card}>
    <View style={s.head}>
      <View style={s.ring}><Text style={s.ringText}>{v.overall ?? "–"}</Text><Text style={s.ringUnit}>%</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.kicker}>🧭 LIFE COMPASS · THIS WEEK</Text>
        <Text style={s.message}>{v.message}</Text>
      </View>
    </View>

    <View style={s.grid}>{(v.areas as Row[]).map(a => <TouchableOpacity key={a.key} style={[s.tile, open === a.key && s.tileOn]} onPress={() => setOpen(open === a.key ? null : a.key)} activeOpacity={0.8}>
      <Text style={s.tileIcon}>{a.icon}</Text>
      <Text style={s.tileName} numberOfLines={1}>{a.name.split(" ")[0]}</Text>
      <View style={s.track}><View style={[s.fill, { width: `${a.percent ?? 0}%`, backgroundColor: COLOR[a.status] }]}/></View>
      <Text style={[s.tilePct, { color: COLOR[a.status] }]}>{a.percent == null ? "–" : `${a.percent}%`}</Text>
    </TouchableOpacity>)}</View>

    {selected && <View style={s.detail}>
      <Line><Text style={s.detailTitle}>{selected.icon} {selected.name}</Text><View style={{ flex: 1 }}/>
        <Badge tone={selected.status === "behind" ? "amber" : selected.status === "no_data" ? "muted" : "green"}>{STATUS[selected.status]}</Badge></Line>
      {(selected.signals as Row[]).map(sg => <View key={sg.label} style={{ gap: 2 }}>
        <Line><Text style={[s.body, { flex: 1 }]}>{sg.label}</Text><Text style={s.body}>{sg.actual == null ? "—" : `${sg.actual} / ${sg.target} ${sg.unit}`}</Text></Line>
        {!!sg.note && <Muted small>{sg.note}</Muted>}
      </View>)}
      <Text style={s.tip}>→ {selected.suggestion}</Text>
      <Line>
        {selected.can_log && <Btn title={`✓ ${selected.log_label}`} onPress={() => void log(selected.key, selected.log_label)} style={{ flex: 1 }}/>}
        {selected.open && <Btn kind="outline" title="Open" onPress={() => onOpen(selected.open)} style={{ flex: selected.can_log ? 0 : 1 }}/>}
      </Line>
    </View>}

    <View style={s.numbers}>
      <Num label="sleep" value={d.sleep_hours == null ? "—" : `${d.sleep_hours}h`}/>
      <Num label="routines" value={`${d.routines_done}/${d.routines_total}`}/>
      <Num label="focus" value={hm(d.focus_minutes)}/>
      <Num label="study" value={hm(d.study_minutes)}/>
      <Num label="tasks" value={String(d.tasks_done)}/>
    </View>
    <Muted small>{`${d.day_type} · ${hm(d.awake_minutes_left)} left before bedtime${d.spent_today ? ` · spent ${d.currency} ${Number(d.spent_today).toLocaleString()}` : ""}`}</Muted>

    {(v.actions as Row[]).length > 0 && <View style={{ gap: 8 }}>
      <Text style={s.kicker}>NEXT BEST ACTIONS</Text>
      {(v.actions as Row[]).map((a, i) => <View key={i} style={s.action}>
        <Text style={{ fontSize: 20 }}>{a.icon}</Text>
        <View style={{ flex: 1 }}><Text style={s.actionTitle}>{a.title}</Text><Muted small>{a.detail}</Muted></View>
        {a.log ? <TouchableOpacity style={s.go} onPress={() => void log(a.log, a.log_label)}><Text style={s.goText}>Done ✓</Text></TouchableOpacity>
          : a.open ? <TouchableOpacity style={s.go} onPress={() => onOpen(a.open)}><Text style={s.goText}>Go ›</Text></TouchableOpacity> : null}
      </View>)}
    </View>}
    <Muted small>Tip: tell the assistant “called my mother”, “met friends” or “went to the temple” and it logs the right area.</Muted>
  </View>;
}

function Num({ label, value }: { label: string; value: string }) {
  return <View style={s.num}><Text style={s.numValue}>{value}</Text><Text style={s.numLabel}>{label}</Text></View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.green, borderWidth: 1, borderRadius: 20, padding: 16, gap: 12, marginBottom: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  ring: { width: 68, height: 68, borderRadius: 34, borderWidth: 5, borderColor: C.green, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  ringText: { color: C.text, fontSize: 22, fontWeight: "900" },
  ringUnit: { color: C.muted, fontSize: 11, marginTop: 6 },
  kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  message: { color: C.text, fontSize: 14, lineHeight: 20, marginTop: 4, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { width: "22.6%", flexGrow: 1, backgroundColor: C.panel2, borderRadius: 14, padding: 9, alignItems: "center", gap: 4, borderWidth: 1, borderColor: "transparent" },
  tileOn: { borderColor: C.green },
  tileIcon: { fontSize: 20 },
  tileName: { color: "#b9c7be", fontSize: 10, fontWeight: "700" },
  track: { alignSelf: "stretch", height: 5, borderRadius: 3, backgroundColor: C.line, overflow: "hidden" },
  fill: { height: 5, borderRadius: 3 },
  tilePct: { fontSize: 12, fontWeight: "900" },
  detail: { backgroundColor: C.field, borderRadius: 14, padding: 12, gap: 8 },
  detailTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  body: { color: "#d1ddd4", fontSize: 13 },
  tip: { color: "#a5e3be", fontSize: 13, lineHeight: 19 },
  numbers: { flexDirection: "row", justifyContent: "space-between", backgroundColor: C.field, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6 },
  num: { flex: 1, alignItems: "center" },
  numValue: { color: C.text, fontSize: 15, fontWeight: "900" },
  numLabel: { color: C.muted, fontSize: 10, marginTop: 2 },
  action: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.panel2, borderRadius: 14, padding: 11 },
  actionTitle: { color: C.text, fontSize: 14, fontWeight: "700" },
  go: { backgroundColor: C.greenSoft, borderColor: C.green, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  goText: { color: C.green, fontWeight: "800", fontSize: 12 },
});
