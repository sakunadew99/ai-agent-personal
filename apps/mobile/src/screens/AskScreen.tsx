import React, { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Kicker, Muted, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const ICON: Record<string, string> = { today: "☀️", important: "🎯", week: "📈", neglecting: "🧭", next: "➡️" };

const PRIO_NEXT: Record<string, string> = { low: "medium", medium: "high", high: "low" };
const PRIO_COLOR: Record<string, string> = { high: C.red, medium: C.amber, low: C.muted };
const PACE: Record<string, string> = { ahead: "ahead ✓", on_track: "on track", behind: "behind" };

/** Every active goal: priority (tap to change), % progress (tap ± when there's no numeric target), pace vs dates. */
function GoalProgress({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [p, setP] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/progress").then(setP).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const patch = (id: string, body: Row) => void api(`/goals/${id}`, "PATCH", body).then(load).catch(e => onError(msg(e)));
  if (!p || !(p.goals as Row[]).length) return null;
  return <Card style={{ gap: 10 }}>
    <Kicker>GOAL PROGRESS</Kicker>
    {(p.goals as Row[]).map(g => { const pct = g.progress_percent as number | null; return <View key={g.id} style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{g.title}</Text>
        <TouchableOpacity onPress={() => patch(g.id, { priority: PRIO_NEXT[g.priority] || "medium" })} style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: PRIO_COLOR[g.priority] }}>
          <Text style={{ color: PRIO_COLOR[g.priority], fontSize: 11, fontWeight: "800" }}>{String(g.priority).toUpperCase()}</Text></TouchableOpacity>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: C.line }}><View style={{ width: `${pct ?? 0}%`, height: 8, borderRadius: 4, backgroundColor: g.pace === "behind" ? C.amber : C.green }}/></View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Muted small>{[pct != null ? `${pct}%` : "no % yet", g.pace ? PACE[g.pace] : null, g.days_left != null ? `${g.days_left} days left` : null,
          g.tasks_open ? `${g.tasks_open} open tasks` : null].filter(Boolean).join(" · ")}</Muted>
        <View style={{ flex: 1 }}/>
        {g.manual && <><TouchableOpacity onPress={() => patch(g.id, { progress_pct: Math.max(0, (g.progress_pct ?? pct ?? 0) - 10) })}><Text style={{ color: C.muted, fontSize: 18, paddingHorizontal: 6 }}>−</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => patch(g.id, { progress_pct: Math.min(100, (g.progress_pct ?? pct ?? 0) + 10) })}><Text style={{ color: C.green, fontSize: 18, paddingHorizontal: 6 }}>＋</Text></TouchableOpacity></>}
      </View>
    </View>; })}
    <Muted small>Tap the priority to change it. ± adjusts progress by 10% for goals without a number target.</Muted>
  </Card>;
}

/** Ask Sakuna: five everyday questions answered from your own data (no AI needed), plus a plan check that proposes fixes. */
export function AskScreen({ api, onError, onNotice, onOpenApprovals }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpenApprovals: () => void }) {
  const [qs, setQs] = useState<Row[]>([]); const [q, setQ] = useState<string>("today"); const [a, setA] = useState<Row | null>(null);
  const [check, setCheck] = useState<Row | null>(null);
  const ask = useCallback((key: string) => { setQ(key); setA(null); api<Row>(`/ask/${key}`).then(setA).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { api<Row>("/ask").then(r => setQs(r.questions)).catch(e => onError(msg(e))); ask("today"); }, [api, ask, onError]);
  const runCheck = () => void api<Row>("/plan/check", "POST").then(r => { setCheck(r); onNotice(r.message); }).catch(e => onError(msg(e)));
  const list = (a?.tasks || a?.done || []) as Row[];
  return <Screen onRefresh={() => ask(q)}>
    <View style={{ gap: 8 }}>{qs.map(x => <TouchableOpacity key={x.key} onPress={() => ask(x.key)} style={{ padding: 12, borderRadius: 14, borderWidth: 1,
      borderColor: q === x.key ? C.green : C.line, backgroundColor: q === x.key ? C.greenSoft : C.panel }}>
      <Text style={{ color: C.text, fontWeight: "800" }}>{`${ICON[x.key] || "•"}  ${x.text}`}</Text></TouchableOpacity>)}</View>
    <Card style={{ gap: 8, borderColor: C.green }}>
      <Kicker>SAKUNA</Kicker>
      <Text style={{ color: C.text, fontSize: 17, lineHeight: 24 }}>{a ? a.answer : "Thinking…"}</Text>
      {list.map(t => <View key={t.id} style={{ padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}>
        <Text style={{ color: C.text, fontWeight: "700" }}>{t.title}</Text>
        <Muted small>{[t.due ? `due ${t.due}` : null, t.minutes ? `${t.minutes} min` : null, ...(t.why || [])].filter(Boolean).join(" · ")}</Muted></View>)}
      {((a?.items || []) as Row[]).map((i, k) => <View key={k} style={{ padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}>
        <Text style={{ color: C.amber, fontWeight: "700" }}>{i.title}</Text>{i.detail ? <Muted small>{i.detail}</Muted> : null}</View>)}
      {((a?.areas || []) as Row[]).filter(x => x.percent != null).map(x => <Muted key={x.name} small>{`${x.name}: ${x.percent}% · ${String(x.status).replaceAll("_", " ")}`}</Muted>)}
    </Card>
    <GoalProgress api={api} onError={onError}/>
    <Card style={{ gap: 8 }}>
      <Kicker>PLAN CHECK</Kicker>
      <Muted small>Finds overdue tasks and proposes moving them to tomorrow. Nothing changes until you approve.</Muted>
      <Btn title="🔍 Check my plan" onPress={runCheck}/>
      {check && <>{(check.proposals as Row[]).map(p => <Text key={p.id} style={{ color: C.text }}>{`• ${p.preview}`}</Text>)}
        {(check.proposals as Row[]).length > 0 && <Btn kind="outline" title="Review in Approvals" onPress={onOpenApprovals}/>}</>}
    </Card>
  </Screen>;
}
