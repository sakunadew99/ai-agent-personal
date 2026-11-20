import React, { useEffect, useState } from "react";
import { Alert, Switch, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { pendingCount } from "../api";
import { Bars, SplitBar } from "../charts";
import { lockEnabled, setLockEnabled } from "../lock";
import { Badge, Btn, C, Card, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes();

/** Home: one plan for today from everything Sakuna knows (work, routines, gym, study, languages, tasks, best focus hours). */
export function TodayPlanCard({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [p, setP] = useState<Row | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api<Row>("/today/plan").then(setP).catch(() => setP(null)); }, [api]);
  if (!p || !(p.blocks as Row[]).length) return null;
  const blocks = (p.blocks as Row[]).filter(b => all || b.start_min + b.minutes >= nowMin());
  const next = blocks.find(b => b.kind !== "work" && b.start_min >= nowMin());
  return <Card accent>
    <Line><Kicker>TODAY'S PLAN</Kicker><View style={{ flex: 1 }}/><Badge tone="muted">{`${Math.round(p.planned_minutes / 60)} h planned`}</Badge></Line>
    {next && <Text style={{ color: C.green, fontWeight: "800" }}>{`Next: ${next.start} ${next.title}`}</Text>}
    {blocks.slice(0, all ? 30 : 6).map((b, i) => <View key={i} style={{ flexDirection: "row", gap: 10, alignItems: "center", borderLeftWidth: 3, borderLeftColor: b.color, paddingLeft: 10, paddingVertical: 3 }}>
      <Text style={{ color: C.muted, width: 92, fontSize: 12 }}>{`${b.start}–${b.end}`}</Text>
      <Text style={{ color: C.text, flex: 1 }} numberOfLines={1}>{b.title}</Text></View>)}
    {(p.clashes as string[]).length > 0 && <Muted small>{`⚠ ${(p.clashes as string[])[0]}`}</Muted>}
    {(p.gaps as Row[]).length > 0 && <Muted small>{`Free: ${(p.gaps as Row[]).slice(0, 3).map(g => `${g.start}–${g.end}`).join(", ")}`}</Muted>}
    {p.best_focus && <Muted small>{`🎯 Your best focus hours: ${p.best_focus.from}–${p.best_focus.to} (deep work goes there)`}</Muted>}
    <Line><Btn kind="link" title={all ? "Show what's left" : "Show whole day"} onPress={() => setAll(a => !a)}/><View style={{ flex: 1 }}/><Btn kind="link" title="⏰ Times" onPress={() => onOpen("Schedule")}/><Btn kind="link" title="Board ›" onPress={() => onOpen("Plan")}/></Line>
  </Card>;
}

/** Home: a gentle nudge when today's distracting phone time is high. */
export function NudgeBanner({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [n, setN] = useState<Row | null>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => { api<Row>("/nudge").then(r => setN(r.nudge)).catch(() => setN(null)); }, [api]);
  if (!n || hidden) return null;
  return <TouchableOpacity onPress={() => onOpen("Focus")} style={{ borderRadius: 18, padding: 14, gap: 4, backgroundColor: n.level === "high" ? "#3a1620" : "#3a2a12", borderWidth: 1, borderColor: n.level === "high" ? C.red : C.amber }}>
    <Line><Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>📱 Phone check</Text><TouchableOpacity onPress={() => setHidden(true)}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></Line>
    <Text style={{ color: C.text }}>{n.text}</Text><Text style={{ color: C.green, fontWeight: "800" }}>Start a focus block ›</Text>
  </TouchableOpacity>;
}

/** Day tracker: the last 7 days at a glance with plain-language patterns. */
export function WeekInsightsCard({ api }: { api: Api }) {
  const [w, setW] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/insights/week").then(setW).catch(() => setW(null)); }, [api]);
  if (!w) return null;
  return <Card><Kicker>THIS WEEK</Kicker>
    <Bars data={(w.days as Row[]).map((d, i, a) => ({ label: d.label.slice(0, 2), value: d.productive, highlight: i === a.length - 1, color: d.gym ? C.amber : C.green }))} height={90} format={x => `${Math.round(x / 6) / 10}h`}/>
    <Muted small>{`Productive ${Math.round(w.totals.productive / 60)} h · wasted ${Math.round(w.totals.wasted / 60)} h · gym ${w.totals.gym_days} days (amber bars)`}</Muted>
    {(w.insights as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`💡 ${x}`}</Text>)}
  </Card>;
}

/** Finance: everything you own minus what you owe, per currency (accounts, assets, debts, CSE shares). */
export function NetWorthCard({ api }: { api: Api }) {
  const [v, setV] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/finance/all").then(setV).catch(() => setV(null)); }, [api]);
  if (!v || !(v.currencies as Row[]).length) return null;
  return <Card><Kicker>ALL-IN NET WORTH</Kicker>
    {(v.currencies as Row[]).map(c => <View key={c.currency} style={{ gap: 6 }}>
      <Line><Text style={{ color: C.text, fontSize: 22, fontWeight: "900", flex: 1 }}>{`${c.currency} ${Number(c.total).toLocaleString()}`}</Text>
        {Number(c.monthly_subscriptions) > 0 && <Badge tone="amber">{`subs ${Number(c.monthly_subscriptions).toLocaleString()}/mo`}</Badge>}</Line>
      <SplitBar parts={(c.parts as Row[]).filter(x => Number(x.amount) > 0).map(x => ({ label: x.label, value: Number(x.amount) }))} format={n => `${c.currency} ${Math.round(n).toLocaleString()}`}/>
      {(c.parts as Row[]).some(x => Number(x.amount) < 0) && <Muted small>{`Debts: ${(c.parts as Row[]).filter(x => Number(x.amount) < 0).map(x => `${c.currency} ${Math.abs(Number(x.amount)).toLocaleString()}`).join(", ")}`}</Muted>}
    </View>)}
    <Muted small>{v.note}</Muted>
  </Card>;
}

/** AI settings: what may go to the AI, how long tracking data is kept, app lock, offline queue. */
export function PrivacyCard({ api, settings, save }: { api: Api; settings: Row; save: (b: Row) => void }) {
  const [lock, setLock] = useState(false);
  useEffect(() => { void lockEnabled().then(setLock); }, []);
  const keep = settings.keep_activity_days ?? 0;
  void api;
  return <Card><Kicker>PRIVACY</Kicker>
    <Line><Text style={{ color: C.text, flex: 1 }}>🔒 App lock (fingerprint / PIN)</Text><Switch value={lock} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}
      onValueChange={on => void setLockEnabled(on).then(r => { if (r.ok) setLock(on); Alert.alert("App lock", r.message); })}/></Line>
    <Line><Text style={{ color: C.text, flex: 1 }}>Journal may go to AI (only when you tap Reflect)</Text><Switch value={!!settings.share_journal} onValueChange={on => save({ share_journal: on })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>
    <Line><Text style={{ color: C.text, flex: 1 }}>Day tracker may go to AI (only when you tap Coach me)</Text><Switch value={!!settings.share_activity} onValueChange={on => save({ share_activity: on })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>
    <Muted small>Keep hour-by-hour entries and phone usage for</Muted>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{[[30, "30 days"], [90, "90 days"], [365, "1 year"], [0, "forever"]].map(([d, label]) =>
      <TouchableOpacity key={String(d)} onPress={() => save({ keep_activity_days: d })} style={{ borderWidth: 1, borderColor: keep === d ? C.green : C.line, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: keep === d ? C.greenSoft : "transparent" }}>
        <Text style={{ color: C.text }}>{String(label)}</Text></TouchableOpacity>)}</View>
    <Muted small>{`Saved offline, waiting to send: ${pendingCount()}. Export all your data from the website (Settings › AI).`}</Muted>
  </Card>;
}
