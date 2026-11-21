import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Bars, Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";
import { Trainer, type TrainerResult } from "./Trainer";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const PINK = "#ff9ecf";
const tone = (s: number) => (s >= 70 ? C.green : s >= 50 ? C.amber : C.red);

/** Daily face scan: glow score, brightness, redness, evenness, shine and spots, with trend and tips. Numbers only; no photos kept. */
export function SkinScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [scan, setScan] = useState(false);
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(() => { api<Row>("/skin").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const onResult = (r: TrainerResult) => { setScan(false); void api<Row>("/skin", "POST", { metrics: r, note: note.trim() || null }).then(x => { setV(x); setNote(""); onNotice(`Glow score ${r.score} saved`); }).catch(e => onError(msg(e))); };
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  const last: Row | null = v.latest, m: Row = last?.metrics || {};
  const trend: Row[] = v.trend || [];
  return <Screen onRefresh={load}>
    <Hero kicker="SKIN & GLOW · DAILY CHECK" title={last ? `${last.score}` : "Scan"} accent={last ? "glow score" : "your face"} color={PINK}
      sub={last ? `Last check ${new Date(last.created_at).toLocaleDateString()}${v.week_avg != null ? ` · week avg ${v.week_avg}` : ""}` : v.how}
      right={<Ring value={last?.score ?? 0} size={92} color={last ? tone(last.score) : PINK} label={last ? `${last.score}` : "—"} sub="GLOW"/>}>
      <TextInput value={note} onChangeText={setNote} placeholder="Note (optional): new cream, after gym, slept late…" placeholderTextColor={C.muted}
        style={{ color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line }}/>
      <Btn title="📷 Scan my face" onPress={() => setScan(true)}/>
    </Hero>
    {last && <Card>
      <Kicker>LATEST NUMBERS</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }}>
        {[["☀️", "Brightness", m.brightness != null ? Math.round(m.brightness) : "—", C.text], ["🔴", "Redness", m.redness ?? "—", (m.redness ?? 0) >= 14 ? C.red : C.green],
          ["🎨", "Evenness", m.evenness != null ? `${m.evenness}%` : "—", (m.evenness ?? 0) >= 60 ? C.green : C.amber], ["💧", "Shine", m.shine_pct != null ? `${m.shine_pct}%` : "—", (m.shine_pct ?? 0) > 10 ? C.amber : C.green],
          ["•", "Spots", m.spot_density ?? "—", (m.spot_density ?? 0) > 25 ? C.amber : C.green], ["💡", "Lighting", m.lighting_ok === false ? "check" : "good", m.lighting_ok === false ? C.amber : C.green]].map(([i, l, val, c]) =>
          <View key={String(l)} style={{ width: "31.5%", backgroundColor: C.panel2, borderRadius: 14, padding: 10 }}>
            <Text style={{ fontSize: 14 }}>{i}</Text><Text style={{ color: String(c), fontSize: 19, fontWeight: "900" }}>{String(val)}</Text><Text style={{ color: C.muted, fontSize: 11 }}>{l}</Text></View>)}
      </View>
      {!!m.lighting_note && <Muted small>{`💡 ${m.lighting_note}`}</Muted>}
    </Card>}
    {trend.length > 1 && <Card><Kicker>GLOW SCORE OVER TIME</Kicker>
      <Bars data={trend.map((t, i) => ({ label: String(new Date(t.date).getDate()), value: Number(t.score), color: tone(Number(t.score)), highlight: i === trend.length - 1 }))} height={100}/></Card>}
    {(v.tips as string[]).length > 0 && <Card accent><Kicker>💡 TIPS FROM YOUR NUMBERS</Kicker>{(v.tips as string[]).map((t, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${t}`}</Text>)}</Card>}
    {v.sleep_link && <Card><Kicker>😴 SLEEP AND YOUR SKIN</Kicker><Text style={{ color: C.text, fontWeight: "800" }}>{v.sleep_link.text}</Text>
      <Muted small>{`Based on ${v.sleep_link.pairs} checks with Mi Band sleep (correlation ${v.sleep_link.r}).`}</Muted></Card>}
    {(v.checks as Row[]).slice(0, 12).map(c => <Card key={c.id} style={{ padding: 12 }}>
      <Line><Text style={{ color: tone(c.score), fontSize: 20, fontWeight: "900", width: 44 }}>{c.score}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{new Date(c.created_at).toLocaleString([], { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Text>
          {edit === c.id ? <TextInput autoFocus defaultValue={c.note || ""} onSubmitEditing={e => { setEdit(null); void api<Row>(`/skin/${c.id}`, "PATCH", { note: e.nativeEvent.text }).then(setV).catch(x => onError(msg(x))); }}
            style={{ color: C.text, borderBottomWidth: 1, borderBottomColor: C.green, paddingVertical: 2 }} placeholder="Note, then press enter" placeholderTextColor={C.muted}/>
            : <Muted small>{c.note || `redness ${c.metrics?.redness ?? "—"} · evenness ${c.metrics?.evenness ?? "—"}%`}</Muted>}</View>
        <TouchableOpacity onPress={() => setEdit(edit === c.id ? null : c.id)} style={{ padding: 6 }}><Text style={{ color: C.green }}>✎</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => Alert.alert("Delete this check?", "", [{ text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => void api(`/skin/${c.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])} style={{ padding: 6 }}><Text style={{ color: C.red }}>🗑</Text></TouchableOpacity></Line>
    </Card>)}
    <Muted small>{v.disclaimer}</Muted>
    {scan && <Trainer kind="skin" onClose={() => setScan(false)} onResult={onResult}/>}
  </Screen>;
}
