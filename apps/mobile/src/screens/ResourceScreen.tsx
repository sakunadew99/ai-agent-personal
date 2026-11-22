import React, { useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Hero } from "../charts";
import { Btn, C, Card, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const ICON: Record<string, string> = { "Best beginner video": "▶️", "Best practical tutorial": "🛠", "Best educational post": "📰", "Best free resource": "🎁", "More to explore": "🧭" };
const SUGGEST = ["Python for data science", "German A1 grammar", "Swimming for adults", "Public speaking", "Stock market investing", "Guitar chords", "Kegel exercises", "RAG with LLMs"];

/** Learn anything: real search links on trusted sites + a real Wikipedia summary + the next step. Nothing invented. */
export function ResourceScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("beginner");
  const [r, setR] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const find = (t = topic, ai = false) => { if (t.trim().length < 2) return; setBusy(true);
    api<Row>(`/resources?topic=${encodeURIComponent(t.trim())}&level=${level}${ai ? "&ai=true" : ""}`).then(setR).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  const goal = () => void api<Row>("/dreams/propose", "POST", { dream: `Learn ${r!.topic}`, horizon: "month", ai: false }).then(plan =>
    Alert.alert(`Make “Learn ${r!.topic}” a goal?`, `1-month goal with milestones; first step: ${r!.next_action}`, [{ text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => void api("/dreams/accept", "POST", { ...plan, next_action: r!.next_action.slice(0, 300) }).then(() => onNotice("Learning goal created 🎯")).catch(e => onError(msg(e))) }]))
    .catch(e => onError(msg(e)));
  return <Screen>
    <Hero kicker="LEARN ANYTHING · TRUSTED RESOURCES" title="What do you" accent="want to learn?" color="#5aa8ff"
      sub="Real search links on reliable sites and a Wikipedia summary. Sakuna never makes up video titles or links.">
      <Field voice value={topic} onChangeText={setTopic} placeholder="e.g. swimming, pandas, German A1, negotiation" onSubmitEditing={() => find()} returnKeyType="search"/>
      <Line>{["beginner", "intermediate", "advanced"].map(l => <TouchableOpacity key={l} onPress={() => setLevel(l)} style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12,
        borderWidth: 1, borderColor: level === l ? C.blue : C.line, backgroundColor: level === l ? "#5aa8ff22" : "transparent" }}>
        <Text style={{ color: level === l ? C.blue : C.muted, fontWeight: "800", textTransform: "capitalize" }}>{l}</Text></TouchableOpacity>)}</Line>
      <Btn title={busy ? "Finding…" : "🔎 Find the best resources"} busy={busy} disabled={topic.trim().length < 2} onPress={() => find()}/>
      {!r && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{SUGGEST.map(s => <TouchableOpacity key={s} onPress={() => { setTopic(s); find(s); }}>
        <Text style={{ color: C.muted, fontSize: 12, borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 }}>{s}</Text></TouchableOpacity>)}</View>}
    </Hero>
    {r && <>
      {r.summary && <Card accent><Kicker>{`📖 ${r.summary.title.toUpperCase()} · WIKIPEDIA`}</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{r.summary.summary}</Text>
        <Btn kind="link" title="Read the full article" onPress={() => openInApp(r.summary.url, r.summary.title, { category: "study", note: `Learning: ${r.topic}` })}/></Card>}
      {(r.items as Row[]).map(i => <TouchableOpacity key={i.kind} activeOpacity={0.85} onPress={() => openInApp(i.url, i.label, { category: "study", note: `Learning: ${r.topic}` })}>
        <Card style={{ padding: 12 }}><Line><Text style={{ fontSize: 22 }}>{ICON[i.kind] || "🔗"}</Text>
          <View style={{ flex: 1 }}><Text style={{ color: C.blue, fontWeight: "800", fontSize: 12 }}>{i.kind}</Text><Text style={{ color: C.text, fontWeight: "800" }}>{i.label}</Text><Muted small>{i.why}</Muted></View>
          <Text style={{ color: C.muted, fontSize: 18 }}>›</Text></Line></Card></TouchableOpacity>)}
      <Card style={{ borderColor: C.green }}><Kicker>✅ BEST NEXT ACTION</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{r.next_action}</Text>
        <Btn title="🎯 Make it a learning goal" onPress={goal}/></Card>
      {r.ai_note ? <Card><Kicker>✨ WHAT TO LEARN FIRST</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{r.ai_note}</Text></Card>
        : <Btn kind="outline" title="✨ What should I learn first? (AI)" onPress={() => find(r.topic, true)}/>}
      <Muted small>{r.note}</Muted>
    </>}
  </Screen>;
}
