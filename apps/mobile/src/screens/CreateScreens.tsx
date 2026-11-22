import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const chip = (on: boolean, col = C.green) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: on ? col : C.line, backgroundColor: on ? `${col}22` : "transparent" });
const STATUS_COL: Record<string, string> = { idea: C.muted, scripted: C.blue, recorded: C.amber, published: C.green };
const NEXT: Record<string, string> = { idea: "scripted", scripted: "recorded", recorded: "published" };
const PLAT_ICON: Record<string, string> = { short: "📱", linkedin: "💼", youtube: "▶️", carousel: "🗂" };

/** Content studio: ideas from your goals and skills, scripts, a weekly schedule; you publish yourself. */
export function ContentScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const load = useCallback(() => { api<Row>("/content").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading your studio…</Empty></Screen>;
  const add = (i: Row, scheduled?: string) => void api("/content", "POST", { title: i.title, platform: i.platform, topic: i.topic, scheduled_on: scheduled }).then(() => { onNotice("Added to your pipeline"); load(); }).catch(e => onError(msg(e)));
  const patch = (id: string, body: Row) => void api(`/content/${id}`, "PATCH", body).then(load).catch(e => onError(msg(e)));
  return <Screen onRefresh={load}>
    <Hero kicker="CONTENT STUDIO · YOUR PERSONAL BRAND" title={`${v.stats.published_this_week}`} accent="published this week" color="#ff9ecf"
      sub={`${v.stats.weekly_streak ? `🔥 ${v.stats.weekly_streak}-week streak · ` : ""}${v.stats.by_status.idea} ideas · ${v.stats.by_status.scripted} scripted · ${v.stats.by_status.recorded} recorded`}
      right={<Ring value={Math.min(100, v.stats.published_this_week / 4 * 100)} size={86} color="#ff9ecf" label={`${v.stats.published_this_week}/4`} sub="THIS WEEK"/>}/>
    <Card><Kicker>THIS WEEK'S SCHEDULE</Kicker>{(v.schedule as Row[]).map(s => <Line key={s.day}>
      <Text style={{ color: C.text, fontWeight: "800", width: 90 }}>{s.day}</Text>
      <Text style={{ color: C.muted, flex: 1 }}>{s.item ? `${PLAT_ICON[s.platform]} ${s.item.title}` : `${PLAT_ICON[s.platform]} ${s.format}`}</Text>
      {s.item && <Text style={{ color: STATUS_COL[s.item.status], fontWeight: "800" }}>{s.item.status}</Text>}</Line>)}</Card>
    <Card><Kicker>FRESH IDEAS FROM YOUR GOALS & SKILLS</Kicker>{(v.ideas as Row[]).map((i, k) => <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 }}>
      <Text style={{ fontSize: 18 }}>{PLAT_ICON[i.platform]}</Text><Text style={{ color: C.text, flex: 1 }}>{i.title}</Text>
      <TouchableOpacity onPress={() => { const slot = (v.schedule as Row[]).find(s => s.platform === i.platform && !s.item); add(i, slot?.date); }} style={chip(false, "#ff9ecf")}>
        <Text style={{ color: "#ff9ecf", fontWeight: "800" }}>＋</Text></TouchableOpacity></View>)}</Card>
    <Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>Pipeline</Text>
    {(v.items as Row[]).map(it => { const isOpen = open === it.id;
      return <Card key={it.id} style={{ borderColor: `${STATUS_COL[it.status]}55` }}>
        <TouchableOpacity onPress={() => { setOpen(isOpen ? null : it.id); setDraft(it.script || ""); }}>
          <Line><Text style={{ fontSize: 18 }}>{PLAT_ICON[it.platform]}</Text><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{it.title}</Text>
            <Text style={{ color: STATUS_COL[it.status], fontWeight: "900" }}>{it.status}</Text></Line>
          <Muted small>{`${it.scheduled_on ? `📅 ${it.scheduled_on} · ` : ""}${it.topic || ""}`}</Muted></TouchableOpacity>
        {isOpen && <View style={{ gap: 8 }}>
          <TextInput value={draft} onChangeText={setDraft} multiline style={{ color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 10, minHeight: 140, textAlignVertical: "top", borderWidth: 1, borderColor: C.line }}/>
          <Line><Btn kind="outline" title="💾 Save script" onPress={() => patch(it.id, { script: draft })} style={{ flex: 1 }}/>
            <Btn kind="outline" title="✨ AI script" onPress={() => void api<Row>(`/content/${it.id}/script`, "POST").then(x => { setDraft(x.script); load(); }).catch(e => onError(msg(e)))} style={{ flex: 1 }}/></Line>
          {NEXT[it.status] && <Btn title={`Mark ${NEXT[it.status]} ›`} onPress={() => patch(it.id, { status: NEXT[it.status], ...(NEXT[it.status] === "scripted" ? { script: draft } : {}) })}/>}
          {it.url && <Btn kind="link" title="Open the post" onPress={() => openInApp(it.url, it.title)}/>}
          <Btn kind="link" title="Delete" onPress={() => Alert.alert("Delete this item?", it.title, [{ text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => void api(`/content/${it.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}/>
        </View>}
      </Card>; })}
    {!(v.items as Row[]).length && <Empty>Tap ＋ on an idea to start your pipeline.</Empty>}
    <Muted small>{v.how}</Muted>
  </Screen>;
}

const TIERS = ["budget", "mid", "luxury"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Travel guide: where to go this month, a day-by-day plan with an LKR budget, maps, official advice, and your wish list. */
export function TravelScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [interest, setInterest] = useState("");
  const [sel, setSel] = useState<Row | null>(null);
  const [days, setDays] = useState("3"); const [people, setPeople] = useState("2"); const [tier, setTier] = useState<string>("budget");
  const [plan, setPlan] = useState<Row | null>(null);
  const load = useCallback(() => { const q = [month && `month=${month}`, interest && `interest=${interest}`].filter(Boolean).join("&");
    api<Row>(`/travel${q ? `?${q}` : ""}`).then(x => { setV(x); if (!month) setMonth(x.month); }).catch(e => onError(msg(e))); }, [api, month, interest, onError]);
  useEffect(() => { load(); }, [load]);
  const makePlan = (d: Row) => { setSel(d); api<Row>(`/travel/plan?key=${d.key}&days=${Number(days) || 3}&tier=${tier}&people=${Number(people) || 1}`).then(setPlan).catch(e => onError(msg(e))); };
  const wish = () => void api("/travel/wishes", "POST", { destination: sel!.name, key: sel!.key, days: Number(days) || 3, people: Number(people) || 1, tier,
    budget_lkr: plan?.budget_lkr?.total ?? plan?.total_lkr }).then(() => { onNotice("Added to your travel wish list ✈️"); load(); }).catch(e => onError(msg(e)));
  if (!v) return <Screen><Empty>Loading destinations…</Empty></Screen>;
  const W: Row[] = v.wishes;
  return <Screen onRefresh={load}>
    <Hero kicker="TRAVEL GUIDE · SRI LANKA & BEYOND" title={`${v.done}`} accent="places explored" color="#4fd1c5"
      sub={`${W.filter(w => w.status === "wish").length} wishes · ${W.filter(w => w.status === "planned").length} planned`}
      right={<Ring value={W.length ? v.done / W.length * 100 : 0} size={86} color="#4fd1c5" label={`${v.done}/${W.length}`} sub="DONE"/>}/>
    {W.length > 0 && <Card><Kicker>YOUR WISH LIST</Kicker>{W.map(w => <Line key={w.id}>
      <Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{`${w.status === "done" ? "✅" : w.status === "planned" ? "📅" : "⭐"} ${w.destination}`}</Text>
      <Muted small>{`${w.days}d · ${w.tier}${w.budget_lkr ? ` · Rs ${Math.round(Number(w.budget_lkr)).toLocaleString()}` : ""}`}</Muted>
      <TouchableOpacity onPress={() => void api(`/travel/wishes/${w.id}`, "PATCH", { status: w.status === "wish" ? "planned" : w.status === "planned" ? "done" : "wish" }).then(load)}>
        <Text style={{ color: "#4fd1c5", fontWeight: "800", marginLeft: 8 }}>{w.status === "wish" ? "Plan" : w.status === "planned" ? "Done" : "Again"}</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => void api(`/travel/wishes/${w.id}`, "DELETE").then(load)}><Text style={{ color: C.muted, marginLeft: 8 }}>✕</Text></TouchableOpacity></Line>)}</Card>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{MONTHS.map((m, i) => <TouchableOpacity key={m} onPress={() => setMonth(i + 1)} style={chip(month === i + 1, "#4fd1c5")}>
      <Text style={{ color: month === i + 1 ? "#4fd1c5" : C.muted, fontWeight: "800" }}>{m}</Text></TouchableOpacity>)}</ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{["", ...(v.interests as string[])].map(x => <TouchableOpacity key={x || "all"} onPress={() => setInterest(x)} style={chip(interest === x, "#4fd1c5")}>
      <Text style={{ color: interest === x ? "#4fd1c5" : C.muted, fontWeight: "700", textTransform: "capitalize" }}>{x || "Everything"}</Text></TouchableOpacity>)}</ScrollView>
    <Card><Kicker>TRIP SETTINGS</Kicker><Line>
      <TextInput value={days} onChangeText={setDays} keyboardType="number-pad" style={{ color: C.text, backgroundColor: C.panel2, borderRadius: 10, padding: 8, width: 60, textAlign: "center" }}/><Muted small>days</Muted>
      <TextInput value={people} onChangeText={setPeople} keyboardType="number-pad" style={{ color: C.text, backgroundColor: C.panel2, borderRadius: 10, padding: 8, width: 60, textAlign: "center" }}/><Muted small>people</Muted></Line>
      <Line>{TIERS.map(t => <TouchableOpacity key={t} onPress={() => setTier(t)} style={[chip(tier === t, "#4fd1c5"), { flex: 1, alignItems: "center" }]}><Text style={{ color: tier === t ? "#4fd1c5" : C.muted, fontWeight: "800", textTransform: "capitalize" }}>{t}</Text></TouchableOpacity>)}</Line></Card>
    {plan && sel && <Card style={{ borderColor: "#4fd1c588" }}>
      <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{`${plan.destination} · ${plan.days} days`}</Text>
      {(plan.itinerary as Row[]).map(d => <View key={d.day}><Text style={{ color: "#4fd1c5", fontWeight: "800" }}>{`Day ${d.day}`}</Text>{(d.plan as string[]).map((p, i) => <Text key={i} style={{ color: C.text }}>{`• ${p}`}</Text>)}</View>)}
      <Kicker>BUDGET (ESTIMATE)</Kicker>
      {plan.budget_lkr ? Object.entries(plan.budget_lkr as Record<string, number>).map(([k, n]) => <Line key={k}><Text style={{ color: k === "total" ? C.text : C.muted, flex: 1, fontWeight: k === "total" ? "900" : "400", textTransform: "capitalize" }}>{k.replace(/_/g, " ")}</Text>
        <Text style={{ color: k === "total" ? "#4fd1c5" : C.text, fontWeight: "800" }}>{`Rs ${Number(n).toLocaleString()}`}</Text></Line>)
        : <><Line><Text style={{ color: C.muted, flex: 1 }}>Flights</Text><Text style={{ color: C.text }}>{`$${plan.budget_usd.flights}`}</Text></Line>
          <Line><Text style={{ color: C.muted, flex: 1 }}>Stay, food, transport, activities</Text><Text style={{ color: C.text }}>{`$${plan.budget_usd.stay_food_transport_activities}`}</Text></Line>
          <Line><Text style={{ color: C.text, flex: 1, fontWeight: "900" }}>Total</Text><Text style={{ color: "#4fd1c5", fontWeight: "900" }}>{`Rs ${Number(plan.total_lkr).toLocaleString()} · ${plan.local_currency.code} ${Number(plan.local_currency.total).toLocaleString()}`}</Text></Line></>}
      <Muted small>{`Per person ≈ Rs ${Number(plan.per_person_lkr).toLocaleString()} (USD ${plan.usd_lkr}). ${plan.note}`}</Muted>
      {plan.visa && <Text style={{ color: C.amber }}>{plan.visa}</Text>}
      <Line><Btn kind="outline" title="🗺 Directions" onPress={() => void Linking.openURL(plan.maps.directions)} style={{ flex: 1 }}/>
        {plan.advisory && <Btn kind="outline" title="🛡 Travel advice" onPress={() => openInApp(plan.advisory, "Official travel advice")} style={{ flex: 1 }}/>}</Line>
      <Btn title="⭐ Add to my wish list" onPress={wish}/>
    </Card>}
    {plan?.stay_type && <Card style={{ gap: 4 }}><Kicker>{`🏨 ${String(plan.stay_type.label).toUpperCase()} STAYS`}</Kicker>
      <Text style={{ color: C.text }}>{plan.stay_type.examples}</Text><Muted small>{plan.stay_type.expect}</Muted></Card>}
    {plan?.safety && <Card style={{ gap: 6, borderColor: C.amber }}><Kicker>{`🛡 SAFETY & EMERGENCY · ${String(plan.safety.country).toUpperCase()}`}</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(plan.safety.emergency as Row[]).map(e => <TouchableOpacity key={e.label} onPress={() => void Linking.openURL(`tel:${e.number}`)}
        style={{ padding: 8, borderRadius: 12, backgroundColor: C.panel2 }}><Text style={{ color: C.amber, fontWeight: "900", fontSize: 16 }}>{e.number}</Text><Muted small>{e.label}</Muted></TouchableOpacity>)}</View>
      {(plan.safety.tips as string[]).map(t => <Text key={t} style={{ color: C.text }}>{`• ${t}`}</Text>)}
      <Muted small>{plan.safety.insurance}</Muted>
      <Btn kind="outline" title="Official travel advice (FCDO)" onPress={() => openInApp(plan.safety.official_advice, "Official travel advice")}/>
      <Muted small>{`Source: ${plan.safety.source}. Checked ${plan.safety.checked}. ${plan.safety.method}`}</Muted></Card>}
    {(v.destinations as Row[]).map(d => <TouchableOpacity key={d.key} activeOpacity={0.85} onPress={() => makePlan(d)}>
      <Card style={{ padding: 12, borderColor: d.good_now ? "#4fd1c566" : C.line }}>
        <Line><Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>{d.name}</Text>{d.good_now && <Text style={{ color: "#4fd1c5", fontWeight: "800" }}>✓ good now</Text>}</Line>
        <Muted small>{`${d.region}${d.hours_from_colombo ? ` · ~${d.hours_from_colombo} h from Colombo` : ""} · ${(d.tags as string[]).join(", ")}`}</Muted>
        <Muted small>{(d.highlights as string[]).slice(0, 3).join(" · ")}</Muted>
      </Card></TouchableOpacity>)}
  </Screen>;
}
