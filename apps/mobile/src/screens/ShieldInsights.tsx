import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { ShieldCtx } from "../ShieldPanel";
import { type AppCategory, type DayInsights, defaultMark, errorText, hm, type Mark, parseLists, Shield } from "../shield";
import { C } from "../ui";
import { s as b } from "./ShieldBlocking";

type Day = Extract<DayInsights, { available: true }>;
type AppTotal = { packageName: string; label: string; category: AppCategory; minutes: number };

const MARK_COLOR: Record<Mark, string> = { distracting: "#c59bff", neutral: C.blue, productive: C.green };
const MARK_LABEL: Record<Mark, string> = { distracting: "Distracting", neutral: "Neutral", productive: "Productive" };
const NEXT_MARK: Record<Mark, Mark> = { distracting: "neutral", neutral: "productive", productive: "distracting" };
const WEEKDAY = (ms: number) => new Date(ms).toLocaleDateString([], { weekday: "short" });

/** Insights: screen time worked out on the phone from Android's usage data. Nothing is uploaded. */
export function ShieldInsights({ status, lists, setLists, say }: ShieldCtx) {
  const [view, setView] = useState<"day" | "week">("day");
  const [daysAgo, setDaysAgo] = useState(0);
  const [day, setDay] = useState<Day | null>(null);
  const [week, setWeek] = useState<Day[] | null>(null);
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [loading, setLoading] = useState(false);
  const shield = Shield!;

  const load = useCallback(async () => {
    if (!status.usageAccess) return;
    setLoading(true);
    try {
      setMarks(shield.getAppMarks());
      if (view === "day") {
        const d = await shield.getInsights(daysAgo);
        setDay(d.available ? d : null);
      } else {
        const days = await Promise.all([6, 5, 4, 3, 2, 1, 0].map(n => shield.getInsights(n)));
        setWeek(days.filter((d): d is Day => d.available));
      }
    } catch (r) { say(errorText(r)); } finally { setLoading(false); }
  }, [shield, view, daysAgo, status.usageAccess, say]);
  useEffect(() => { void load(); }, [load]);

  const markOf = (a: { packageName: string; category: AppCategory }) => marks[a.packageName] ?? defaultMark(a.category);
  function cycleMark(a: { packageName: string; category: AppCategory }) {
    try { setMarks(shield.setAppMark(a.packageName, NEXT_MARK[markOf(a)])); } catch (r) { say(errorText(r)); }
  }
  function blockApp(a: AppTotal) {
    const target = lists[0];
    const list = target ?? { id: `list-${Date.now()}`, name: "My blocklist", mode: "manual", schedule: null, apps: [], domains: [], keywords: [], newApps: false, newAppsSince: 0, adult: false, purchases: false, unsupportedBrowsers: false };
    if (list.apps.includes(a.packageName)) return;
    try { setLists(parseLists(shield.saveList(JSON.stringify({ ...list, apps: [...list.apps, a.packageName] })))); say(`${a.label} added to “${list.name}”.`); }
    catch (r) { say(errorText(r)); }
  }

  const apps: AppTotal[] = useMemo(() => {
    if (view === "day") return day?.apps ?? [];
    const m = new Map<string, AppTotal>();
    for (const d of week ?? []) for (const a of d.apps) {
      const cur = m.get(a.packageName);
      m.set(a.packageName, cur ? { ...cur, minutes: cur.minutes + a.minutes } : { ...a });
    }
    return [...m.values()].sort((x, y) => y.minutes - x.minutes);
  }, [view, day, week]);

  const total = apps.reduce((sum, a) => sum + a.minutes, 0);
  const split = (["distracting", "neutral", "productive"] as Mark[]).map(mk => ({ mark: mk, minutes: apps.filter(a => markOf(a) === mk).reduce((s2, a) => s2 + a.minutes, 0) }));
  const blocked = new Set(lists.flatMap(l => l.apps));

  if (!status.usageAccess) {
    return <View style={[b.card, { alignItems: "center", paddingVertical: 26 }]}>
      <Text style={{ fontSize: 36 }}>📊</Text><Text style={b.title}>See where your time goes</Text>
      <Text style={[b.muted, { textAlign: "center" }]}>Allow usage access so Sakuna can work out screen time, pickups and focus on this phone. Nothing is uploaded.</Text>
      <TouchableOpacity style={[b.primary, { alignSelf: "stretch" }]} onPress={() => shield.openUsageAccessSettings()}><Text style={b.primaryText}>Allow usage access</Text></TouchableOpacity>
    </View>;
  }

  const dayTitle = daysAgo === 0 ? "TODAY" : daysAgo === 1 ? "YESTERDAY" : day ? new Date(day.dayStart).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }).toUpperCase() : "";

  return <>
    <View style={s.switcher}>{(["day", "week"] as const).map(v => <TouchableOpacity key={v} style={[s.switchTab, view === v && s.switchOn]} onPress={() => setView(v)}>
      <Text style={[s.switchText, view === v && s.switchTextOn]}>{v === "day" ? "Day" : "Week"}</Text></TouchableOpacity>)}</View>

    {view === "day" && <View style={s.nav}>
      <TouchableOpacity style={s.navBtn} onPress={() => setDaysAgo(n => Math.min(n + 1, 6))} disabled={daysAgo >= 6}><Text style={[s.navText, daysAgo >= 6 && { opacity: 0.3 }]}>‹</Text></TouchableOpacity>
      <Text style={s.navTitle}>{dayTitle}</Text>
      <TouchableOpacity style={s.navBtn} onPress={() => setDaysAgo(n => Math.max(n - 1, 0))} disabled={daysAgo === 0}><Text style={[s.navText, daysAgo === 0 && { opacity: 0.3 }]}>›</Text></TouchableOpacity>
    </View>}

    {loading && !day && !week ? <ActivityIndicator color={C.green} style={{ marginVertical: 30 }}/> : <>
      <View style={[b.card, { alignItems: "center" }]}>
        <Text style={s.total}>{hm(total)}</Text>
        <Text style={s.totalLabel}>{view === "day" ? "SCREEN TIME" : `THIS WEEK · ${hm(total / 7)} A DAY`}</Text>
        {view === "day" && day && <HourChart hourly={day.hourly}/>}
        {view === "week" && week && <WeekChart days={week}/>}
      </View>

      <View style={b.card}>
        <Text style={s.cardTitle}>Usage</Text>
        {split.map(x => { const pct = total ? Math.round((x.minutes / total) * 100) : 0; return <View key={x.mark} style={s.splitRow}>
          <View style={[s.dot, { backgroundColor: MARK_COLOR[x.mark] }]}/>
          <Text style={[b.rowTitle, { width: 92 }]}>{MARK_LABEL[x.mark]}</Text>
          <View style={s.splitTrack}><View style={[s.splitFill, { width: `${Math.max(pct, pct ? 3 : 0)}%`, backgroundColor: MARK_COLOR[x.mark] }]}/></View>
          <Text style={[s.pct, { color: MARK_COLOR[x.mark] }]}>{pct}%</Text>
        </View>; })}
        <Text style={b.small}>Tap an app's mark below to change it.</Text>
      </View>

      {view === "day" && day && <>
        <Text style={b.section}>Focus</Text>
        <View style={s.tiles}>
          <Tile icon="🎯" label="LONGEST FOCUS" value={day.longestFocusMinutes == null ? "—" : hm(day.longestFocusMinutes)} hint="Longest phone-free stretch, 6:00–23:00"/>
          <Tile icon="📱" label="CONTINUOUS USE" value={hm(day.continuousMinutes)} hint="Longest time the screen stayed on"/>
          <Tile icon="✋" label="PICKUPS" value={`${day.pickups}×`} hint="Times you unlocked the phone"/>
          <Tile icon="⏰" label="PEAK TIME" value={day.peakHour == null ? "—" : `${String(day.peakHour).padStart(2, "0")}:00`} hint="Busiest hour"/>
          {daysAgo === 0 && <Tile icon="🛡" label="BLOCKED" value={`${status.blocksToday}×`} hint="Blocks today"/>}
        </View>
      </>}

      <Text style={b.section}>Apps</Text>
      <View style={b.cardFlat}>
        {!apps.length && <Text style={b.muted}>No app used for more than a minute{view === "day" ? " this day" : " this week"}.</Text>}
        {apps.slice(0, 25).map(a => { const mk = markOf(a); return <View key={a.packageName} style={s.appRow}>
          <View style={b.avatar}><Text style={b.avatarText}>{a.label.slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1, gap: 5 }}>
            <View style={b.headRow}><Text style={b.rowTitle} numberOfLines={1}>{a.label}</Text><Text style={s.minutes}>{hm(a.minutes)}</Text></View>
            <View style={s.splitTrack}><View style={[s.splitFill, { width: `${Math.max(3, (a.minutes / (apps[0]?.minutes || 1)) * 100)}%`, backgroundColor: MARK_COLOR[mk] }]}/></View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => cycleMark(a)}><Text style={[s.mark, { color: MARK_COLOR[mk] }]}>● {MARK_LABEL[mk]}</Text></TouchableOpacity>
              {blocked.has(a.packageName) ? <Text style={s.mark}>🛡 Blocked</Text>
                : <TouchableOpacity onPress={() => blockApp(a)}><Text style={[s.mark, { color: C.green }]}>＋ Block</Text></TouchableOpacity>}
            </View>
          </View>
        </View>; })}
      </View>
      <Text style={b.small}>Worked out on this phone from Android's usage data. Not uploaded. Home screen and Sakuna are left out.</Text>
    </>}
  </>;
}

function HourChart({ hourly }: { hourly: number[] }) {
  const top = Math.max(60, ...hourly);
  const nowHour = new Date().getHours();
  return <View style={{ alignSelf: "stretch", marginTop: 14 }}>
    <View style={s.chart}>
      {hourly.map((m, h) => <View key={h} style={s.barSlot}><View style={[s.bar, { height: `${Math.max(m ? 3 : 0, (m / top) * 100)}%`, backgroundColor: h === nowHour ? C.green : "#c59bff" }]}/></View>)}
      <View style={[s.gridLine, { bottom: `${(30 / top) * 100}%` }]}/>
    </View>
    <View style={s.axis}>{["0", "6", "12", "18", ""].map((t, i) => <Text key={i} style={s.axisText}>{t}</Text>)}</View>
    <Text style={[b.small, { textAlign: "right" }]}>Bar height up to {top > 60 ? hm(top) : "1h"} per hour</Text>
  </View>;
}

function WeekChart({ days }: { days: Day[] }) {
  const top = Math.max(60, ...days.map(d => d.totalMinutes));
  return <View style={{ alignSelf: "stretch", marginTop: 14 }}>
    <View style={[s.chart, { height: 140 }]}>{days.map(d => <View key={d.dayStart} style={[s.barSlot, { paddingHorizontal: 6 }]}>
      <View style={[s.bar, { height: `${Math.max(d.totalMinutes ? 3 : 0, (d.totalMinutes / top) * 100)}%`, backgroundColor: C.green }]}/></View>)}</View>
    <View style={{ flexDirection: "row" }}>{days.map(d => <View key={d.dayStart} style={{ flex: 1, alignItems: "center" }}>
      <Text style={s.axisText}>{WEEKDAY(d.dayStart)}</Text><Text style={[s.axisText, { color: C.text }]}>{hm(d.totalMinutes)}</Text></View>)}</View>
  </View>;
}

function Tile({ icon, label, value, hint }: { icon: string; label: string; value: string; hint: string }) {
  return <View style={s.tile}>
    <Text style={{ fontSize: 28 }}>{icon}</Text>
    <Text style={s.tileLabel}>{label}</Text>
    <Text style={s.tileValue}>{value}</Text>
    <Text style={[b.small, { textAlign: "center" }]}>{hint}</Text>
  </View>;
}

const s = StyleSheet.create({
  switcher: { flexDirection: "row", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 99, padding: 4 },
  switchTab: { flex: 1, borderRadius: 99, paddingVertical: 9, alignItems: "center" },
  switchOn: { backgroundColor: C.panel2, borderColor: C.green, borderWidth: 1 },
  switchText: { color: C.muted, fontWeight: "700" },
  switchTextOn: { color: C.green },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  navText: { color: C.text, fontSize: 22, marginTop: -2 },
  navTitle: { color: C.green, fontWeight: "800", letterSpacing: 1.2, fontSize: 14 },
  total: { color: C.text, fontSize: 46, fontWeight: "900", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  totalLabel: { color: C.muted, fontSize: 12, letterSpacing: 1.4, fontWeight: "700" },
  chart: { height: 160, flexDirection: "row", alignItems: "flex-end", borderBottomColor: C.line, borderBottomWidth: 1 },
  barSlot: { flex: 1, height: "100%", justifyContent: "flex-end", paddingHorizontal: 1.5 },
  bar: { width: "100%", borderRadius: 4, minHeight: 0 },
  gridLine: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: C.line },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  axisText: { color: C.muted, fontSize: 10, fontVariant: ["tabular-nums"] },
  cardTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  splitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  splitTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.line, overflow: "hidden" },
  splitFill: { height: 8, borderRadius: 4 },
  pct: { width: 42, textAlign: "right", fontWeight: "800", fontVariant: ["tabular-nums"] },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tile: { flexBasis: "47%", flexGrow: 1, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 14, alignItems: "center", gap: 4 },
  tileLabel: { color: C.muted, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginTop: 4 },
  tileValue: { color: C.text, fontSize: 22, fontWeight: "800" },
  appRow: { flexDirection: "row", gap: 10, paddingVertical: 9, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  minutes: { color: C.text, fontSize: 12, fontVariant: ["tabular-nums"] },
  mark: { color: C.muted, fontSize: 11, fontWeight: "700" },
});
