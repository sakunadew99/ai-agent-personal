import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Empty, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const EVIDENCE: Record<string, "green" | "amber" | "muted"> = { strong: "green", some: "amber", early: "muted" };
const short = (day: string) => day.slice(0, 3);

/** "About you": what Sakuna has learned from your own records (last 28 days), plus the weekly report. No fine-tuning. */
export function AboutYouScreen({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [reports, setReports] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    Promise.all([api<Row>("/you"), api<Row[]>("/you/reports")]).then(([you, list]) => { setV(you); setReports(list); }).catch(r => onError(msg(r)));
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Reading your last four weeks…</Empty></Screen>;
  const p = v.profile, change = v.change, latest = v.latest_report;

  async function writeReport() {
    setBusy(true);
    try { await api("/you/report", "POST"); onNotice("This week's report is ready"); load(); } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  async function keep(report: Row) {
    try {
      const out = await api<Row>(`/you/reports/${report.id}/memory`, "POST");
      onNotice(`${out.saved} pattern${out.saved === 1 ? "" : "s"} saved to memory` + (out.skipped.length ? ` · ${out.skipped.length} skipped (sensitive, e.g. health); save those by hand if you want` : ""));
    } catch (e) { onError(msg(e)); }
  }
  const weekdayMax = Math.max(30, ...Object.values(p.focus.by_weekday as Record<string, number>));

  return <Screen onRefresh={load}>
    <Card accent>
      <Kicker>ABOUT YOU · LAST 28 DAYS</Kicker>
      <H2>{p.data_days ? `${p.data_days} days of your own data` : "Just getting started"}</H2>
      <Muted small>Sakuna learns from your routines, focus, sleep, check-ins, study and your 👍/👎. Patterns only appear when there's enough evidence. It doesn't retrain an AI on your life (fine-tuning): this updates every day, stays in your account, and you can read all of it.</Muted>
    </Card>

    {change && <Card style={{ borderColor: C.green }}>
      <Kicker>ONE CHANGE FOR NEXT WEEK</Kicker>
      <Text style={s.change}>{change.title}</Text>
      <Text style={s.body}><Text style={s.bold}>Why: </Text>{change.why}</Text>
      <Text style={s.body}><Text style={s.bold}>How: </Text>{change.how}</Text>
      {String(change.action || "").startsWith("open:") && <Btn title="Do it now" onPress={() => onOpen(String(change.action).slice(5))}/>}
    </Card>}

    <Card>
      <Kicker>PATTERNS</Kicker>
      {(v.findings as Row[]).length ? (v.findings as Row[]).map((f, i) => <Line key={i} style={{ alignItems: "flex-start" }}>
        <Text style={[s.body, { flex: 1 }]}>{f.text}</Text><Badge tone={EVIDENCE[f.evidence] || "muted"}>{f.evidence}</Badge></Line>)
        : <Muted>Not enough data yet. Keep ticking routines and logging focus and study; patterns appear after about a week.</Muted>}
      <Muted small>Evidence: early = a few days · some = about a week · strong = two weeks or more.</Muted>
    </Card>

    <Card>
      <Kicker>FOCUS BY WEEKDAY (AVG MIN)</Kicker>
      <View style={s.chart}>{Object.entries(p.focus.by_weekday as Record<string, number>).map(([day, m]) => <View key={day} style={s.col}>
        <Text style={s.colVal}>{m || ""}</Text>
        <View style={s.track}><View style={[s.bar, { height: `${Math.max(m ? 6 : 0, (m / weekdayMax) * 100)}%` }]}/></View>
        <Text style={s.colLabel}>{short(day)}</Text></View>)}</View>
      {p.focus.best_hours && <Muted small>{`Best hours: ${p.focus.best_hours.from}–${p.focus.best_hours.to}`}</Muted>}
    </Card>

    {(p.routines as Row[]).length > 0 && <Card>
      <Kicker>ROUTINES (DONE / DUE)</Kicker>
      {(p.routines as Row[]).map(r => <View key={r.name} style={{ gap: 3 }}>
        <Line><Text style={[s.body, { flex: 1 }]}>{r.icon} {r.name}</Text><Muted small>{`${r.done}/${r.due} · ${Math.round(r.rate * 100)}%`}</Muted></Line>
        <Progress value={r.rate * 100}/></View>)}
      {Object.keys(p.routine_by_weekday).length > 0 && <Muted small>{"By weekday: " + Object.entries(p.routine_by_weekday as Record<string, number>).map(([d, x]) => `${short(d)} ${Math.round(x * 100)}%`).join(" · ")}</Muted>}
      {p.short_version_used > 0 && <Muted small>{`Short version saved the day ${p.short_version_used} time${p.short_version_used === 1 ? "" : "s"} 💪`}</Muted>}
    </Card>}

    {(p.sleep.effect || Object.keys(p.energy_by_weekday).length > 0) && <Card>
      <Kicker>SLEEP AND ENERGY</Kicker>
      {p.sleep.effect && <Text style={s.body}>{`After short nights (<6.5 h): ${p.sleep.effect.focus_after_short} min focus · after good sleep: ${p.sleep.effect.focus_after_good} min`}</Text>}
      {Object.keys(p.energy_by_weekday).length > 0 && <Text style={s.body}>{"Energy (1-5): " + Object.entries(p.energy_by_weekday as Record<string, number>).map(([d, x]) => `${short(d)} ${x}`).join(" · ")}</Text>}
    </Card>}

    {((p.avoid as Row[]).length > 0 || (p.study as Row[]).length > 0) && <Card>
      <Kicker>AVOID LIST AND STUDY</Kicker>
      {(p.avoid as Row[]).map(a => <Text key={a.name} style={s.body}>{`${a.name}: slipped ${a.slips} of ${a.logged} logged days${a.worst_day ? ` (mostly ${a.worst_day}s)` : ""}`}</Text>)}
      {(p.study as Row[]).filter(x => x.planned).map(x => <View key={x.exam} style={{ gap: 3 }}>
        <Line><Text style={[s.body, { flex: 1 }]}>{x.exam === "ielts" ? "🇬🇧 IELTS" : "🇩🇪 German"}</Text><Muted small>{`${x.done}/${x.planned} min`}</Muted></Line>
        <Progress value={Math.min(100, (x.ratio || 0) * 100)}/></View>)}
    </Card>}

    <Card>
      <Kicker>HOW SAKUNA ADAPTS TO YOU</Kicker>
      <Text style={s.body}>{v.preferences ? `From your 👍/👎: ${v.preferences}.` : "Rate the AI team's notes with 👍/👎: helpers you rate down write shorter, more concrete notes, and every helper is told what you like."}</Text>
      <Text style={s.body}>{`AI answers reused ${v.cache.hits} time${v.cache.hits === 1 ? "" : "s"}, saving about ${Number(v.cache.tokens_saved).toLocaleString()} tokens.`}</Text>
    </Card>

    <Card>
      <Line><Kicker>WEEKLY REPORT</Kicker><View style={{ flex: 1 }}/>{latest?.used_ai ? <Badge>✨ AI</Badge> : latest ? <Badge tone="muted">rules</Badge> : null}</Line>
      {latest ? <Text style={s.body}>{latest.body}</Text> : <Muted>The weekly reviewer writes it every Sunday at 18:00. You can also write it now.</Muted>}
      <Line><Btn title={busy ? "Writing…" : "Write this week's report"} onPress={() => void writeReport()} style={{ flex: 1 }}/>
        {latest && <Btn kind="outline" title="Save to memory" onPress={() => void keep(latest)} style={{ flex: 1 }}/>}</Line>
    </Card>

    {reports.length > 1 && <Card><Kicker>EARLIER WEEKS</Kicker>
      {reports.slice(1).map(r => <TouchableOpacity key={r.id} onPress={() => setV({ ...v, latest_report: r })}>
        <Text style={s.past}>{`Week of ${new Date(`${r.week_start}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })} · ${(r.findings as Row[]).length} patterns${r.change ? ` · tried: ${r.change.title}` : ""}`}</Text></TouchableOpacity>)}
    </Card>}
  </Screen>;
}

const s = StyleSheet.create({
  change: { color: C.green, fontSize: 19, fontWeight: "900" },
  body: { color: "#d1ddd4", fontSize: 14, lineHeight: 21 },
  bold: { fontWeight: "800", color: C.text },
  chart: { flexDirection: "row", height: 120, gap: 6, alignItems: "flex-end" },
  col: { flex: 1, alignItems: "center", gap: 3, height: "100%" },
  colVal: { color: C.muted, fontSize: 9 },
  track: { flex: 1, width: "70%", justifyContent: "flex-end", backgroundColor: C.field, borderRadius: 5, overflow: "hidden" },
  bar: { width: "100%", backgroundColor: C.green, borderRadius: 5 },
  colLabel: { color: C.muted, fontSize: 10 },
  past: { color: "#b9c7be", fontSize: 13, paddingVertical: 6 },
});
