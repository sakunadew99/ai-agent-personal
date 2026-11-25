import React, { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { Bars, Hero, Ring } from "../charts";
import { Shield } from "../shield";
import { Btn, C, Card, Empty, Kicker, Muted, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SENT_KEY = "sakuna.sleepSent";

/** Send last night's (and the night before's) phone-based sleep estimate. Safe to call often: same night = update. */
export async function uploadSleep(api: Api): Promise<number> {
  try {
    if (!Shield?.getSleepWindow) return 0;
    const sent: Record<string, string> = JSON.parse((await SecureStore.getItemAsync(SENT_KEY)) || "{}");
    let n = 0;
    for (const daysAgo of [0, 1]) {
      const w = await Shield.getSleepWindow(daysAgo);
      if (!w.available || !w.detected || w.stillAsleep || !w.lastUse || !w.firstUse) continue;
      const day = new Date(); day.setDate(day.getDate() - daysAgo);
      const night = iso(day);
      const sig = `${Math.round(w.lastUse / 60000)}-${Math.round(w.firstUse / 60000)}`;
      if (sent[night] === sig) continue;
      await api("/sleep/phone", "POST", { night, last_use: new Date(w.lastUse).toISOString(), first_use: new Date(w.firstUse).toISOString(),
        core_minutes: Math.round(w.coreMinutes || 0), interruptions: (w.interruptions || []).slice(0, 30).map(i => ({ at: new Date(i.at).toISOString(), minutes: Math.round(i.minutes) })) });
      sent[night] = sig; n++;
    }
    const keep = Object.fromEntries(Object.entries(sent).sort().slice(-10));
    await SecureStore.setItemAsync(SENT_KEY, JSON.stringify(keep));
    return n;
  } catch { return 0; }
}

/** Sleep & phone: last night, 14 nights, averages, debt and tips. Phone estimate when there's no Mi Band record. */
export function SleepScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const load = useCallback(async () => { await uploadSleep(api); api<Row>("/sleep/insights").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { void load(); }, [load]);
  if (!v) return <Screen><Empty>Reading your nights…</Empty></Screen>;
  const nights = v.nights as Row[]; const last = nights[0];
  const target = Number(v.target_minutes) / 60;
  return <Screen onRefresh={() => void load()}>
    <Hero kicker="SLEEP · FROM YOUR PHONE AND MI BAND" title={last ? `${last.hours}` : "—"} accent={last ? "hours last night" : "no data yet"} color="#b48cff"
      sub={last ? `Last phone use ${last.bed} · first use ${last.wake}${last.interruptions ? ` · woke to check the phone ${last.interruptions}×` : ""} · ${last.source}` : "Give Sakuna usage access (Shield) and keep the phone away at night; tomorrow morning you'll see your sleep here."}
      right={<Ring value={last ? Math.min(100, last.minutes / Number(v.target_minutes) * 100) : 0} size={88} color="#b48cff" label={last ? `${Math.round(last.minutes / Number(v.target_minutes) * 100)}%` : "—"} sub="OF TARGET"/>}/>
    {nights.length > 0 && <Card><Kicker>{`LAST ${nights.length} NIGHTS · TARGET ${target.toFixed(1)} H`}</Kicker>
      <Bars data={[...nights].reverse().map(n => ({ label: String(n.night).slice(8), value: Number(n.hours), color: Number(n.minutes) >= Number(v.target_minutes) - 30 ? "#b48cff" : C.amber }))}
        height={110} goal={target} format={x => `${x.toFixed(1)}h`}/></Card>}
    <View style={{ flexDirection: "row", gap: 10 }}>
      {[["AVG THIS WEEK", v.avg_minutes_week != null ? `${(Number(v.avg_minutes_week) / 60).toFixed(1)} h` : "—"], ["USUAL BEDTIME", v.avg_bed_week || "—"],
        ["SLEEP DEBT", `${Math.floor(Number(v.debt_minutes_week) / 60)}h ${Number(v.debt_minutes_week) % 60}m`]].map(([k, val]) =>
        <Card key={k} style={{ flex: 1, padding: 10 }}><Muted small>{k}</Muted><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{val}</Text></Card>)}
    </View>
    {(v.insights as string[]).map(t => <Card key={t}><Text style={{ color: C.text, lineHeight: 21 }}>{`💡 ${t}`}</Text></Card>)}
    {nights.slice(0, 7).map(n => <Card key={String(n.night)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ color: C.muted, width: 46 }}>{String(n.night).slice(5)}</Text>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{`${n.bed} → ${n.wake} · ${n.hours} h`}</Text>
        <Muted small>{`${n.source}${n.after_midnight ? " · after midnight" : ""}${n.interruptions ? ` · ${n.interruptions} phone check(s)` : ""}`}</Muted></View></Card>)}
    <Muted small>{v.how}</Muted>
  </Screen>;
}

/** "Fill your day": hours with nothing logged, pre-filled from what the phone saw. One tap per hour, or save all suggestions. */
export function GapCards({ api, day, onError, onNotice, onSaved }: { api: Api; day: string; onError: (m: string) => void; onNotice: (m: string) => void; onSaved?: () => void }) {
  const [g, setG] = useState<Row | null>(null); const [pick, setPick] = useState<Record<number, string>>({}); const [open, setOpen] = useState(true);
  const load = useCallback(() => { api<Row>(`/day/gaps?day=${day}`).then(r => { setG(r); setPick(Object.fromEntries((r.gaps as Row[]).filter(x => x.suggestion).map(x => [x.hour, x.suggestion]))); })
    .catch(e => onError(msg(e))); }, [api, day, onError]);
  useEffect(() => { load(); }, [load]);
  const save = (hours: number[]) => {
    const answers = hours.filter(h => pick[h]).map(h => ({ hour: h, category: pick[h] }));
    if (!answers.length) { onError("Pick what you did first"); return; }
    void api("/day/gaps/fill", "POST", { day, answers }).then(() => { onNotice(`Saved ${answers.length} hour${answers.length === 1 ? "" : "s"}`); load(); onSaved?.(); }).catch(e => onError(msg(e)));
  };
  if (!g || !(g.gaps as Row[]).length) return null;
  const gaps = g.gaps as Row[]; const choices = g.choices as Row[];
  return <Card style={{ gap: 10, borderColor: "#5aa8ff" }}>
    <TouchableOpacity onPress={() => setOpen(o => !o)}><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{`🧩 ${g.message} ${open ? "▲" : "▼"}`}</Text></TouchableOpacity>
    {open && <>
      {gaps.map(x => <View key={x.hour} style={{ gap: 6, padding: 10, borderRadius: 14, backgroundColor: C.panel2 }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{x.label}</Text>
        <Muted small>{x.apps.length ? `📱 ${x.phone_minutes} min: ${(x.apps as Row[]).map(a => `${a.label} ${a.minutes}m`).join(", ")}` : x.why}</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{choices.map(c => { const on = pick[x.hour] === c.key;
          return <TouchableOpacity key={c.key} onPress={() => setPick(p => ({ ...p, [x.hour]: c.key }))} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
            backgroundColor: on ? (c.key === "wasted" ? C.red : C.green) : "transparent", borderWidth: 1, borderColor: on ? "transparent" : C.line }}>
            <Text style={{ color: on ? "#04170d" : C.text, fontSize: 12, fontWeight: "700" }}>{c.label}</Text></TouchableOpacity>; })}</View>
      </View>)}
      <Btn title={`✓ Save ${Object.keys(pick).length} answer${Object.keys(pick).length === 1 ? "" : "s"}`} onPress={() => save(gaps.map(x => x.hour))}/>
      <Muted small>Suggestions come from the apps you used in that hour (Shield's app marks). Change any before saving.</Muted>
    </>}
  </Card>;
}
