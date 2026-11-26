import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const SKILL_COLOR: Record<string, string> = { negotiation: C.amber, leadership: "#b48cff", interview: C.blue, communication: C.green, speaking: "#ff9ecf", sales: "#4fd1c5" };
const tone = (s: number) => (s >= 75 ? C.green : s >= 50 ? C.amber : C.red);

/** Soft-skills academy: pick a real situation, talk it through, get a rubric score, tips and (optional) AI coaching. */
export function RolePlayScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [cat, setCat] = useState<Row | null>(null);
  const [s, setS] = useState<Row | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Row | null>(null);
  const [suggestFinish, setSuggestFinish] = useState(false);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const load = useCallback(() => { api<Row>("/roleplay").then(setCat).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const start = (id: string) => { setResult(null); setSuggestFinish(false); api<Row>("/roleplay", "POST", { scenario: id }).then(setS).catch(e => onError(msg(e))); };
  const send = () => { if (!text.trim() || !s) return; setBusy(true);
    api<Row>(`/roleplay/${s.id}/reply`, "POST", { text: text.trim() }).then(r => { setS({ ...s, messages: r.messages }); setSuggestFinish(r.suggest_finish); setText(""); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80); })
      .catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  const finish = (ai = false) => { setBusy(true); api<Row>(`/roleplay/${s!.id}/finish${ai ? "?ai=true" : ""}`, "POST").then(r => { setResult(r); load(); }).catch(e => onError(msg(e))).finally(() => setBusy(false)); };

  if (!cat) return <Screen><Empty>Loading the academy…</Empty></Screen>;
  if (s) {
    const col = SKILL_COLOR[s.scenario.skill] || C.green;
    return <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => { setS(null); setResult(null); }}><Text style={{ color: C.muted }}>‹ All situations</Text></TouchableOpacity>
        <Card style={{ borderColor: `${col}66` }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{`${s.scenario.icon} ${s.scenario.title}`}</Text>
          <Muted>{s.scenario.setup}</Muted>
          <Muted small>{`You're scored on: ${(s.rubric as string[]).join(" · ")}`}</Muted></Card>
        {(s.messages as Row[]).map((m, i) => <View key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "86%",
          backgroundColor: m.role === "user" ? C.greenSoft : C.panel2, borderRadius: 18, padding: 12, borderWidth: 1, borderColor: m.role === "user" ? "#2a6b4a" : C.line }}>
          <Text style={{ color: C.text, lineHeight: 21 }}>{m.text}</Text></View>)}
        {result && <Card accent>
          <View style={{ alignItems: "center" }}><Ring value={result.score} size={100} color={tone(result.score)} label={`${result.score}`} sub="SCORE"/></View>
          {(result.criteria as Row[]).map(c => <Line key={c.label}><Text style={{ color: c.ok ? C.green : C.red, width: 22 }}>{c.ok ? "✓" : "✗"}</Text>
            <Text style={{ color: C.text, flex: 1 }}>{c.label}</Text><Text style={{ color: C.muted }}>{`${c.ok ? c.points : 0}/${c.points}`}</Text></Line>)}
          <Kicker>TIPS</Kicker>{(result.tips as string[]).map((t, i) => <Text key={i} style={{ color: C.text }}>{`• ${t}`}</Text>)}
          {result.ai ? <View style={{ backgroundColor: "#b48cff18", borderRadius: 12, padding: 10 }}><Kicker>✨ COACH</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{result.ai}</Text></View>
            : cat.ai_partner && <Btn kind="outline" title="✨ AI coach feedback" busy={busy} onPress={() => finish(true)}/>}
          <Btn title="↻ Try this situation again" onPress={() => start(s.scenario.id)}/>
        </Card>}
      </ScrollView>
      {!result && <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg }}>
        <Field voice value={text} onChangeText={setText} placeholder="Your reply (type or tap the mic)" multiline/>
        <Line><Btn title={busy ? "…" : "Send"} busy={busy} disabled={!text.trim()} onPress={send} style={{ flex: 1 }}/>
          <Btn kind={suggestFinish ? "primary" : "outline"} title="🏁 Finish & score" disabled={!(s.messages as Row[]).some(m => m.role === "user")} onPress={() => finish(false)} style={{ flex: 1 }}/></Line>
      </View>}
    </View>;
  }
  const skills: Row[] = cat.skills;
  return <Screen onRefresh={load}>
    <Hero kicker="SOFT-SKILLS ACADEMY · ROLE-PLAY" title="Practise the" accent="real conversation" color={C.amber}
      sub={cat.ai_partner ? "The other person is played by AI. Reply like real life." : "Scripted partner (turn on AI for a live one). Your replies are scored the same way."}
      right={<Ring value={Math.round(skills.reduce((a, k) => a + k.done / k.total, 0) / Math.max(1, skills.length) * 100)} size={86} color={C.amber}
        label={`${skills.reduce((a, k) => a + k.done, 0)}`} sub="TRIED"/>}/>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{skills.map(k => <View key={k.skill}
      style={{ padding: 10, borderRadius: 16, backgroundColor: C.panel, borderWidth: 1, borderColor: `${SKILL_COLOR[k.skill]}55`, minWidth: 120 }}>
      <Text style={{ color: SKILL_COLOR[k.skill], fontWeight: "900" }}>{k.name}</Text><Muted small>{`${k.level}${k.avg_best != null ? ` · ${k.avg_best}` : ""} · ${k.done}/${k.total}`}</Muted></View>)}</ScrollView>
    {skills.map(k => <View key={k.skill} style={{ gap: 8 }}>
      <Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{k.name}</Text>
      {(cat.scenarios as Row[]).filter(x => x.skill === k.skill).map(x => <TouchableOpacity key={x.id} onPress={() => start(x.id)} activeOpacity={0.85}
        style={{ flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: C.panel, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: C.line }}>
        <Text style={{ fontSize: 26 }}>{x.icon}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{x.title}</Text><Muted small>{x.setup}</Muted>
          <Muted small>{`${"●".repeat(x.level)}${"○".repeat(3 - x.level)} level${x.attempts ? ` · best ${x.best} · ${x.attempts} tries` : ""}`}</Muted></View>
        {x.best != null && <Text style={{ color: tone(x.best), fontWeight: "900", fontSize: 18 }}>{x.best}</Text>}</TouchableOpacity>)}
    </View>)}
    <Muted small>{cat.how}</Muted>
  </Screen>;
}
