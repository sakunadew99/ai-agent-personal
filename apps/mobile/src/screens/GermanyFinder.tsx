import React, { useEffect, useState } from "react";
import { Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { Hero, Segments, SplitBar, StatTile, TileRow } from "../charts";
import { Badge, Btn, C, Card, Field, H2, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => r instanceof Error ? r.message : "Something went wrong";
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" }) : "—";
const FIELD_IDEAS = ["Data Science", "Computer Science", "Artificial Intelligence", "Software Engineering", "Business Analytics", "Information Systems", "Cyber Security", "Mechatronics", "Renewable Energy", "MBA"];
const FIELDS_KEY = "sakuna.studyFields";
const eur = (n: unknown) => `€${Math.round(Number(n || 0)).toLocaleString()}`;

/** Find Master's programmes in Germany (DAAD database): your fields in, a full summary, costs and documents out. */
export function GermanyFinder({ api, onError, onNotice, onSaved }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onSaved: () => void }) {
  const [fields, setFields] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [lang, setLang] = useState<"en" | "de" | "any">("en");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Row | null>(null);
  const [plan, setPlan] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [shown, setShown] = useState(12);
  useEffect(() => { void SecureStore.getItemAsync(FIELDS_KEY).then(v => { if (v) setFields(JSON.parse(v)); }).catch(() => undefined); }, []);
  const keep = (next: string[]) => { setFields(next); void SecureStore.setItemAsync(FIELDS_KEY, JSON.stringify(next)).catch(() => undefined); };
  const addField = (f: string) => { const v = f.trim(); if (v && !fields.some(x => x.toLowerCase() === v.toLowerCase()) && fields.length < 5) keep([...fields, v]); setTyped(""); };

  async function search() {
    if (!fields.length) { onError("Add at least one field you like, e.g. Data Science."); return; }
    setBusy(true); setPlan(""); setShown(12);
    try { setRes(await api<Row>(`/study/germany/search?fields=${encodeURIComponent(fields.join(","))}&lang=${lang}&free=${free}`)); }
    catch (r) { onError(msg(r)); } finally { setBusy(false); }
  }
  async function explain() {
    setBusy(true);
    try { setPlan(String((await api<Row>("/study/germany/explain", "POST", { fields: fields.join(","), lang, free })).text || "")); }
    catch (r) { onError(msg(r)); } finally { setBusy(false); }
  }
  async function save(id: number) {
    try {
      await api(`/study/germany/${id}/save`, "POST");
      onNotice("Saved to your Study abroad tracker. Build its checklist below."); onSaved();
      setRes(r => r ? { ...r, courses: (r.courses as Row[]).map(c => c.id === id ? { ...c, saved_id: "saved" } : c) } : r);
    } catch (r) { onError(msg(r)); }
  }

  const s: Row = res?.summary || {};
  const fy: Row = s.first_year_eur || {};
  const courses: Row[] = res?.courses || [];
  const cities: Row[] = s.cities || [];
  const deadlines: Row[] = s.deadlines || [];
  const docs: Row[] = res?.documents || [];
  return <>
    <Hero kicker="STUDY IN GERMANY · DAAD" title="Find your" accent="Master's" sub="Pick the fields you like. Sakuna searches the DAAD database and sums up costs, deadlines and documents.">
      {fields.length > 0 && <Line style={{ flexWrap: "wrap" }}>{fields.map(f => <TouchableOpacity key={f} onPress={() => keep(fields.filter(x => x !== f))}
        style={{ backgroundColor: C.green, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: C.greenDark, fontWeight: "800" }}>{`${f}  ✕`}</Text></TouchableOpacity>)}</Line>}
      <Line><View style={{ flex: 1 }}><Field voice value={typed} onChangeText={setTyped} placeholder="Add a field, e.g. Data Science" onSubmitEditing={() => addField(typed)} maxLength={60}/></View>
        <Btn kind="outline" title="Add" onPress={() => addField(typed)} disabled={!typed.trim()}/></Line>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {FIELD_IDEAS.filter(f => !fields.includes(f)).map(f => <TouchableOpacity key={f} onPress={() => addField(f)} style={{ borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 }}>
          <Text style={{ color: C.muted, fontWeight: "600" }}>{`+ ${f}`}</Text></TouchableOpacity>)}
      </ScrollView>
      <Segments options={["en", "de", "any"] as const} value={lang} onChange={setLang} labels={{ en: "English", de: "German", any: "Any language" }}/>
      <TouchableOpacity onPress={() => setFree(v => !v)}><Line>
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: free ? C.green : C.line, backgroundColor: free ? C.green : "transparent" }}/>
        <Text style={{ color: C.text }}>Tuition-free only</Text></Line></TouchableOpacity>
      <Btn title={busy && !res ? "Searching DAAD… (up to 20 s)" : "Search programmes"} onPress={() => void search()} busy={busy} disabled={!fields.length}/>
    </Hero>

    {res && <>
      <Card accent><Kicker>SUMMARY</Kicker><H2>{s.headline}</H2>
        {String(s.text || "").split("\n").map((l, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${l}`}</Text>)}
        <Btn kind="outline" title={plan ? "Refresh my plan" : "✨ Turn this into my plan"} onPress={() => void explain()} busy={busy}/>
        {!!plan && <Text style={{ color: C.text, lineHeight: 21, backgroundColor: C.panel2, borderRadius: 14, padding: 12 }}>{plan.replace(/\*\*/g, "").replace(/^#+\s*/gm, "")}</Text>}
      </Card>
      <TileRow>
        <StatTile label="Tuition-free" tone="green" value={`${s.tuition_free ?? 0}`} hint={`${s.with_fee ?? 0} charge fees`}/>
        <StatTile label="First year" tone="amber" value={eur(fy.total)} hint="blocked account + fees"/>
      </TileRow>
      <TileRow>
        <StatTile label="IELTS asked" tone="blue" value={s.ielts ? `${s.ielts.min}–${s.ielts.max}` : "6.5 typ."} hint={`from ${s.checked ?? 0} checked`}/>
        <StatTile label="Intakes" tone="violet" value={`${s.intakes?.winter ?? 0} / ${s.intakes?.summer ?? 0}`} hint="winter (Oct) / summer (Apr)"/>
      </TileRow>
      <Card><Kicker>FIRST-YEAR MONEY PLAN (EUR)</Kicker>
        <SplitBar parts={[{ label: "Blocked account (living)", value: Number(fy.blocked_account || 0) }, { label: "Tuition", value: Number(fy.tuition || 0) },
          { label: "Semester contributions", value: Number(fy.semester_contributions || 0) }, { label: "Visa + applications", value: Number(fy.visa_and_applications || 0) }]} format={eur}/>
        <Muted small>{`Health insurance (about ${eur(Number(fy.health_insurance || 0) / 12)}/month) is paid from the €992 monthly blocked-account money. Confirm amounts with the German Embassy Colombo and each university.`}</Muted>
      </Card>
      {cities.length > 0 && <Card><Kicker>WHERE THEY ARE</Kicker><SplitBar parts={cities.map(c => ({ label: c.city, value: Number(c.count) }))} format={n => `${n}`}/></Card>}
      {deadlines.length > 0 && <Card><Kicker>NEXT DEADLINES</Kicker>
        {deadlines.map(d => <Line key={d.id}><Text style={{ color: C.amber, fontWeight: "800", width: 72 }}>{day(d.date)}</Text>
          <Text style={{ color: C.text, flex: 1 }} numberOfLines={2}>{`${d.course} · ${d.university}`}</Text></Line>)}</Card>}
      <Card><TouchableOpacity onPress={() => setShowDocs(v => !v)}><Line style={{ justifyContent: "space-between" }}>
        <Kicker>{`DOCUMENTS YOU NEED · ${docs.length}`}</Kicker><Text style={{ color: C.green }}>{showDocs ? "Hide" : "Show"}</Text></Line></TouchableOpacity>
        {showDocs && docs.map((d, i) => <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopColor: C.line, borderTopWidth: i ? 1 : 0 }}>
          <Line><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{`${i + 1}. ${d.item}`}</Text><Badge tone={d.when === "now" || d.when === "before applying" ? "green" : "muted"}>{d.when}</Badge></Line>
          <Muted small>{d.note}</Muted></View>)}</Card>
      <Line style={{ justifyContent: "space-between" }}><H2>{`Programmes · ${courses.length}`}</H2><Muted small>free first, then soonest deadline</Muted></Line>
      {courses.slice(0, shown).map(c => {
        const f: Row | null = c.facts; const isOpen = open === c.id;
        const details: [string, unknown][] = f ? [["Admission", f.admission], ["English", f.english], ["German", f.german], ["Semester fee", f.semester_contribution], ["Apply via", f.submit_via], ["Application periods", f.application_periods]] : [];
        return <Card key={c.id}>
          <TouchableOpacity onPress={() => setOpen(isOpen ? null : c.id)} style={{ gap: 6 }}>
            <Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }}>{c.course}</Text>
            <Muted small>{`${c.university} · ${c.city}`}</Muted>
            <Line style={{ flexWrap: "wrap" }}>
              <Badge tone={c.tuition_per_semester === 0 ? "green" : c.tuition_per_semester ? "red" : "muted"}>{c.tuition_per_semester === 0 ? "tuition-free" : c.tuition_per_semester ? `€${Number(c.tuition_per_semester).toLocaleString()}/sem` : "fees vary"}</Badge>
              {(c.languages as string[]).slice(0, 2).map(l => <Badge key={l} tone="muted">{l}</Badge>)}
              {!!c.duration && <Badge tone="muted">{c.duration}</Badge>}
              {!!c.next_deadline && <Badge tone="amber">{`deadline ${day(c.next_deadline)}`}</Badge>}
              {!!f?.ielts && <Badge tone="muted">{`IELTS ${f.ielts}`}</Badge>}
              {!!f?.uni_assist && <Badge tone="muted">uni-assist</Badge>}
            </Line>
            <Muted small>{isOpen ? "Tap to hide details" : "Tap for admission, language and costs"}</Muted>
          </TouchableOpacity>
          {isOpen && <View style={{ gap: 8 }}>
            {details.filter(([, v]) => v).map(([k, v]) => <View key={k}><Text style={{ color: C.green, fontSize: 11, fontWeight: "800" }}>{k.toUpperCase()}</Text>
              <Text style={{ color: C.text, lineHeight: 19 }}>{String(v).slice(0, 600)}</Text></View>)}
            {!f && <Muted small>{c.deadline_text || "Open the DAAD page for admission, costs and deadlines."}</Muted>}
          </View>}
          <Line>
            {c.saved_id ? <Badge>✓ in your tracker</Badge> : <Btn title="Save to tracker" onPress={() => void save(c.id)}/>}
            <Btn kind="link" title="DAAD page ↗" onPress={() => void Linking.openURL(c.link)}/>
          </Line>
        </Card>;
      })}
      {shown < courses.length && <Btn kind="outline" title={`Show more (${courses.length - shown})`} onPress={() => setShown(n => n + 12)}/>}
      <Muted small>{res.source}</Muted>
    </>}
  </>;
}
