import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const KEYS = ["weight_kg", "waist_cm", "chest_cm", "hips_cm", "neck_cm", "arm_cm", "thigh_cm", "body_fat_pct"] as const;

function Spark({ series, color }: { series: Row[]; color: string }) {
  if (series.length < 2) return null;
  const vals = series.map(p => Number(p.value)); const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  return <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 28 }}>{vals.map((v, i) =>
    <View key={i} style={{ flex: 1, height: 4 + (v - lo) / span * 24, borderRadius: 2, backgroundColor: i === vals.length - 1 ? color : color + "66" }}/>)}</View>;
}

/** Body measurements: tape + scale every 2 weeks, change since start and last month, waist-to-height and body-fat estimate. */
export function BodyScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null); const [form, setForm] = useState<Record<string, string>>({}); const [height, setHeight] = useState<string>("");
  const [sex, setSex] = useState<string>(""); const [how, setHow] = useState(false);
  const load = useCallback(() => { api<Row>("/body").then(x => { setV(x); setHeight(h => h || (x.height_cm ? String(x.height_cm) : "")); setSex(s => s || x.sex || ""); }).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const save = () => {
    const body: Row = {}; for (const k of KEYS) if (form[k] && Number(form[k]) > 0) body[k] = Number(form[k]);
    if (!Object.keys(body).length) { onError("Enter at least one measurement"); return; }
    void api("/body/measurements", "POST", body).then(() => { setForm({}); onNotice("Saved 📏"); load(); }).catch(e => onError(msg(e)));
  };
  const saveProfile = () => void api("/body/profile", "PUT", { height_cm: Number(height) || null, sex: sex || null }).then(() => { onNotice("Saved"); load(); }).catch(e => onError(msg(e)));
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  const ch = v.changes as Record<string, Row>; const w = ch.weight_kg, wa = ch.waist_cm;
  const whtr = v.waist_to_height as number | null;
  return <Screen onRefresh={load}>
    <Hero kicker="BODY MEASUREMENTS" title={w ? `${w.latest}` : wa ? `${wa.latest}` : "—"} accent={w ? "kg" : wa ? "cm waist" : "start today"} color={C.blue}
      sub={[w && `${w.since_start > 0 ? "+" : ""}${w.since_start} kg since start`, wa && `waist ${wa.since_start > 0 ? "+" : ""}${wa.since_start} cm`, v.due ? "time to measure" : null].filter(Boolean).join(" · ")}
      right={<Ring value={whtr ? Math.min(100, whtr / 0.7 * 100) : 0} size={88} color={whtr && whtr >= 0.5 ? C.amber : C.green} label={whtr ? `${whtr}` : "—"} sub="WAIST/HT"/>}/>
    {(v.insights as string[]).map(t => <Card key={t}><Text style={{ color: C.text, lineHeight: 21 }}>{`💡 ${t}`}</Text></Card>)}
    {v.body_fat_estimate != null && <Card><Kicker>BODY FAT</Kicker><Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>{`${v.body_fat_estimate}%`}</Text><Muted small>{v.body_fat_method}</Muted></Card>}
    <Card style={{ gap: 8 }}><Line><Kicker>ADD TODAY'S MEASUREMENTS</Kicker><View style={{ flex: 1 }}/><TouchableOpacity onPress={() => setHow(x => !x)}><Text style={{ color: C.blue }}>{how ? "Hide how" : "How to measure"}</Text></TouchableOpacity></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{KEYS.map(k => <View key={k} style={{ width: "47%" }}>
        <Field label={v.labels[k]} value={form[k] || ""} onChangeText={t => setForm(f => ({ ...f, [k]: t }))} keyboardType="decimal-pad" placeholder={ch[k] ? String(ch[k].latest) : ""}/>
        {how && v.how_to_measure[k] && <Muted small>{v.how_to_measure[k]}</Muted>}</View>)}</View>
      <Btn title="Save" onPress={save}/><Muted small>Same day again updates that day's entry. {v.note}</Muted></Card>
    {Object.entries(ch).map(([k, c]) => <Card key={k} style={{ gap: 4 }}>
      <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{c.label}</Text><Text style={{ color: C.text, fontWeight: "900" }}>{c.latest}</Text></Line>
      <Spark series={c.series} color={C.blue}/>
      <Muted small>{`Since start ${c.since_start > 0 ? "+" : ""}${c.since_start}${c.since_month != null ? ` · last month ${c.since_month > 0 ? "+" : ""}${c.since_month}` : ""}`}</Muted></Card>)}
    <Card style={{ gap: 8 }}><Kicker>FOR BODY-FAT & WAIST-TO-HEIGHT</Kicker>
      <Line><Field label="Height (cm)" value={height} onChangeText={setHeight} keyboardType="number-pad" style={{ flex: 1 }}/>
        {(["male", "female"] as const).map(s => <TouchableOpacity key={s} onPress={() => setSex(x => x === s ? "" : s)} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1,
          borderColor: sex === s ? C.green : C.line, alignSelf: "flex-end" }}><Text style={{ color: sex === s ? C.green : C.muted, fontWeight: "800" }}>{s}</Text></TouchableOpacity>)}</Line>
      <Btn kind="outline" title="Save" onPress={saveProfile}/>{v.missing_for_fat && <Muted small>{v.missing_for_fat}</Muted>}</Card>
    {(v.items as Row[]).length > 0 && <Card><Kicker>HISTORY</Kicker>{(v.items as Row[]).slice(0, 12).map(r => <TouchableOpacity key={r.id} onLongPress={() => Alert.alert("Delete this entry?", String(r.measured_on), [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/body/measurements/${r.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}>
      <Text style={{ color: C.text, paddingVertical: 4 }}>{`${r.measured_on} · ${KEYS.filter(k => r[k] != null).map(k => `${String(v.labels[k]).split(" (")[0].toLowerCase()} ${r[k]}`).join(", ")}`}</Text></TouchableOpacity>)}
      <Muted small>Long-press an entry to delete it.</Muted></Card>}
  </Screen>;
}
