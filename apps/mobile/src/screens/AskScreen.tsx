import React, { useCallback, useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Kicker, Muted, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const ICON: Record<string, string> = { today: "☀️", important: "🎯", week: "📈", neglecting: "🧭", next: "➡️" };

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
    <Card style={{ gap: 8 }}>
      <Kicker>PLAN CHECK</Kicker>
      <Muted small>Finds overdue tasks and proposes moving them to tomorrow. Nothing changes until you approve.</Muted>
      <Btn title="🔍 Check my plan" onPress={runCheck}/>
      {check && <>{(check.proposals as Row[]).map(p => <Text key={p.id} style={{ color: C.text }}>{`• ${p.preview}`}</Text>)}
        {(check.proposals as Row[]).length > 0 && <Btn kind="outline" title="Review in Approvals" onPress={onOpenApprovals}/>}</>}
    </Card>
  </Screen>;
}
