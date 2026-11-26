import React, { useCallback, useEffect, useState } from "react";
import { Alert, Dimensions, FlatList, Switch, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Bars } from "../charts";
import { scheduleWaterReminders } from "../notify";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen, soft } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const WATER = "#4fc3f7";
const GRAD: Record<string, string> = { confidence: "#ff8a65", discipline: "#7c4dff", health: "#43a047", money: "#fbc02d", calm: "#26a69a", study: "#42a5f5", custom: "#ec407a" };

// ------------------------------------------------------------------ water

export function WaterScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [w, setW] = useState<Row | null>(null); const [custom, setCustom] = useState<string>(""); const [remind, setRemind] = useState(false);
  const load = useCallback(() => { api<Row>("/water").then(setW).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); void SecureStore.getItemAsync("sakuna.waterReminders").then(v => setRemind(v === "on")).catch(() => undefined); }, [load]);
  const add = (ml: number) => void api<Row>("/water", "POST", { ml }).then(r => { setW(r); if (r.today_ml >= r.target_ml && r.today_ml - ml < r.target_ml) onNotice("🎉 Daily water goal reached!"); }).catch(e => onError(msg(e)));
  const toggle = async (on: boolean) => { setRemind(on); await SecureStore.setItemAsync("sakuna.waterReminders", on ? "on" : "off").catch(() => undefined);
    const n = await scheduleWaterReminders(on); onNotice(on ? (n > 0 ? "Water reminders every 2 hours, 10:00–20:00" : "Allow notifications to get reminders") : "Water reminders off"); };
  if (!w) return <Screen><Empty>Loading…</Empty></Screen>;
  const pct = Number(w.percent);
  return <Screen onRefresh={load}>
    <Card style={{ alignItems: "center", gap: 10, paddingVertical: 20 }}>
      <View style={{ width: 120, height: 220, borderRadius: 30, borderWidth: 3, borderColor: WATER, overflow: "hidden", justifyContent: "flex-end", backgroundColor: soft("#4fc3f7", 0.12) }}>
        <View style={{ height: `${pct}%`, backgroundColor: WATER + "cc" }}/>
        <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontSize: 30, fontWeight: "900" }}>{`${pct}%`}</Text>
          <Text style={{ color: "#e1f5fe", fontWeight: "700" }}>{`${(Number(w.today_ml) / 1000).toFixed(2)} L`}</Text></View>
      </View>
      <Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{w.left_ml > 0 ? `${w.left_ml} ml to go` : "Goal reached 💧"}</Text>
      <Muted small>{`Target ${(Number(w.target_ml) / 1000).toFixed(1)} L · ${w.glasses} glasses${w.streak ? ` · 🔥 ${w.streak}-day streak` : ""}`}</Muted>
    </Card>
    <Line>{[[150, "☕ 150"], [250, "🥛 250"], [500, "🍶 500"], [750, "🧴 750"]].map(([ml, l]) =>
      <TouchableOpacity key={String(ml)} onPress={() => add(Number(ml))} style={{ flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: 16, backgroundColor: WATER + "22", borderWidth: 1, borderColor: WATER }}>
        <Text style={{ color: C.text, fontWeight: "900" }}>{`${l}`}</Text><Muted small>ml</Muted></TouchableOpacity>)}</Line>
    <Line><Field value={custom} onChangeText={setCustom} placeholder="Other amount (ml)" keyboardType="number-pad" style={{ flex: 1 }}/>
      <Btn title="Add" onPress={() => { const n = parseInt(custom, 10); if (n > 0) { add(n); setCustom(""); } }}/></Line>
    <Card><Kicker>THIS WEEK</Kicker><Bars data={(w.week as Row[]).map(d => ({ label: String(d.date).slice(8), value: Number(d.ml) / 1000, color: Number(d.ml) >= Number(w.base_ml) ? WATER : C.amber }))}
      height={90} goal={Number(w.base_ml) / 1000} format={x => `${x.toFixed(1)}L`}/></Card>
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Text style={{ color: C.text, flex: 1 }}>🔔 Remind me every 2 hours (10:00–20:00)</Text>
      <Switch value={remind} onValueChange={v => void toggle(v)}/></Card>
    {(w.entries as Row[]).length > 0 && <Card><Kicker>TODAY</Kicker>{(w.entries as Row[]).map(e => <TouchableOpacity key={e.id} onLongPress={() => Alert.alert("Remove this drink?", `${e.ml} ml`, [{ text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void api(`/water/${e.id}`, "DELETE").then(load).catch(err => onError(msg(err))) }])}>
      <Text style={{ color: C.text, paddingVertical: 3 }}>{`💧 ${e.ml} ml · ${new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</Text></TouchableOpacity>)}
      <Muted small>Long-press to remove a mistake.</Muted></Card>}
    <Muted small>{w.how}</Muted>
  </Screen>;
}

// ------------------------------------------------------------------ mindset studio

function AffirmationDeck({ api, m, onChange, onError, onNotice }: { api: Api; m: Row; onChange: () => void; onError: (e: string) => void; onNotice: (e: string) => void }) {
  const width = Dimensions.get("window").width - 32;
  const [cat, setCat] = useState<string>(""); const [text, setText] = useState<string>("");
  const cards = (m.affirmations as Row[]).filter(a => !cat || a.category === cat);
  const read = () => void api("/mindset/entries", "POST", { kind: "affirm_read" }).then(() => { onNotice("✨ Affirmations done for today"); onChange(); }).catch(e => onError(msg(e)));
  const add = () => void api("/affirmations", "POST", { text: text.trim(), category: cat || "custom" }).then(() => { setText(""); onChange(); }).catch(e => onError(msg(e)));
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{[["", "All"], ...Object.entries(m.categories as Record<string, string>)].map(([k, l]) =>
      <TouchableOpacity key={k} onPress={() => setCat(k)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: cat === k ? (GRAD[k] || C.green) : C.panel2 }}>
        <Text style={{ color: cat === k ? "#fff" : C.text, fontSize: 12, fontWeight: "700" }}>{l}</Text></TouchableOpacity>)}</View>
    <FlatList horizontal pagingEnabled showsHorizontalScrollIndicator={false} data={cards} keyExtractor={a => a.id} snapToInterval={width + 10} decelerationRate="fast"
      contentContainerStyle={{ gap: 10 }} renderItem={({ item }) => <View style={{ width, minHeight: 200, borderRadius: 24, padding: 22, justifyContent: "space-between", backgroundColor: GRAD[item.category] || C.green }}>
        <Text style={{ color: "#ffffffcc", fontWeight: "800", fontSize: 12 }}>{String((m.categories as Row)[item.category] || "").toUpperCase()}</Text>
        <Text style={{ color: "#fff", fontSize: 22, fontWeight: "900", lineHeight: 30 }}>{item.text}</Text>
        <Line><TouchableOpacity onPress={() => void api(`/affirmations/${item.id}`, "PATCH", { favorite: !item.favorite }).then(onChange).catch(e => onError(msg(e)))}>
          <Text style={{ fontSize: 22 }}>{item.favorite ? "⭐" : "☆"}</Text></TouchableOpacity><View style={{ flex: 1 }}/>
          <TouchableOpacity onPress={() => void api(`/affirmations/${item.id}`, "PATCH", { active: false }).then(onChange).catch(e => onError(msg(e)))}><Text style={{ color: "#ffffffaa" }}>Hide</Text></TouchableOpacity></Line>
      </View>}/>
    <Muted small>Swipe through, read each one slowly, and picture what you'll do today because of it. ⭐ your favourites; they show first.</Muted>
    <Btn title={m.read_today ? `✓ Done today · 🔥 ${m.read_streak}` : "✨ I read my affirmations"} onPress={read} disabled={!!m.read_today}/>
    <Line><Field value={text} onChangeText={setText} placeholder="Write your own (present tense, about your values)" style={{ flex: 1 }}/><Btn title="Add" onPress={add} disabled={text.trim().length < 3}/></Line>
  </View>;
}

function Scripting({ api, m, onChange, onError, onNotice }: { api: Api; m: Row; onChange: () => void; onError: (e: string) => void; onNotice: (e: string) => void }) {
  const [mode, setMode] = useState<"free" | "55x5">("free"); const [body, setBody] = useState<string>(""); const [st, setSt] = useState<string>(m.fifty_five?.statement || "");
  const [ai, setAi] = useState(false);
  const lines = body.split("\n").filter(l => l.trim()).length;
  const save = () => void api("/mindset/entries", "POST", { kind: "scripting", body, data: mode === "55x5" ? { mode, statement: st } : { mode }, ai_mood: ai })
    .then(() => { setBody(""); onNotice(mode === "55x5" ? `Day saved (${Math.min(55, lines)}/55 lines)` : "Scripting saved ✍️"); onChange(); }).catch(e => onError(msg(e)));
  const f = m.fifty_five as Row;
  return <View style={{ gap: 10 }}>
    <Line>{(["free", "55x5"] as const).map(k => <TouchableOpacity key={k} onPress={() => setMode(k)} style={{ flex: 1, alignItems: "center", padding: 10, borderRadius: 14,
      backgroundColor: mode === k ? "#7c4dff" : C.panel2 }}><Text style={{ color: "#fff", fontWeight: "800" }}>{k === "free" ? "✍️ Future story" : "5️⃣ 55 × 5"}</Text></TouchableOpacity>)}</Line>
    {mode === "free" ? <>{(m.scripting_prompts as string[]).map(p => <TouchableOpacity key={p} onPress={() => setBody(b => b || `${p.replace(/“|”/g, "").split(":").pop()?.trim() || ""} `)}>
      <Muted small>{`💡 ${p}`}</Muted></TouchableOpacity>)}</>
      : <><Muted small>{f.active ? `Day ${f.day} of 5${f.done_today ? " · done today ✓" : ""}` : "Write one short statement 55 times a day for 5 days in a row."}</Muted>
        <Field value={st} onChangeText={setSt} placeholder="Your statement, e.g. I am disciplined and healthy"/>
        <Btn kind="outline" title="Fill 55 lines with it" onPress={() => setBody(Array(55).fill(st.trim()).join("\n"))} disabled={!st.trim()}/></>}
    <Field value={body} onChangeText={setBody} multiline placeholder="Write in the present tense: “I am…”, “I wake up…”" style={{ minHeight: 180 }}/>
    <Line><Text style={{ color: C.muted, flex: 1 }}>{mode === "55x5" ? `${Math.min(55, lines)}/55 lines` : `${body.split(/\s+/).filter(Boolean).length} words`}</Text>
      <Text style={{ color: C.muted }}>Mood check (AI)</Text><Switch value={ai} onValueChange={setAi}/></Line>
    <Btn title="Save" onPress={save} disabled={!body.trim()}/>
    {m.scripting_streak > 0 && <Muted small>{`🔥 Scripting streak: ${m.scripting_streak} day(s)`}</Muted>}
  </View>;
}

function Woop({ api, m, onChange, onError, onNotice }: { api: Api; m: Row; onChange: () => void; onError: (e: string) => void; onNotice: (e: string) => void }) {
  const [f, setF] = useState<Record<string, string>>({ wish: "", outcome: "", obstacle: "", plan: "" });
  const steps = m.woop_steps as Record<string, string>;
  const save = () => void api<Row>("/mindset/entries", "POST", { kind: "woop", data: f }).then(() => {
    Alert.alert("Make the plan a daily habit?", f.plan, [{ text: "Not now", style: "cancel" },
      { text: "Make habit", onPress: () => void api("/habits", "POST", { name: f.plan.slice(0, 120), schedule: "daily", kind: "build" }).then(() => onNotice("Habit created")).catch(e => onError(msg(e))) }]);
    setF({ wish: "", outcome: "", obstacle: "", plan: "" }); onChange(); }).catch(e => onError(msg(e)));
  return <View style={{ gap: 10 }}>
    <Muted small>WOOP turns a wish into action: picture the result, then the real obstacle, then an if-then plan. It's one of the best-tested motivation methods.</Muted>
    {Object.entries(steps).map(([k, label]) => <Field key={k} label={label} value={f[k]} onChangeText={t => setF(x => ({ ...x, [k]: t }))} multiline={k !== "wish"}/>)}
    <Btn title="Save my plan" onPress={save} disabled={Object.values(f).some(v => !v.trim())}/>
    {(m.woop as Row[]).map(w => <Card key={w.id} style={{ gap: 2 }}><Text style={{ color: C.text, fontWeight: "800" }}>{`🎯 ${w.wish}`}</Text>
      <Muted small>{`Obstacle: ${w.obstacle}`}</Muted><Text style={{ color: C.green }}>{`→ ${w.plan}`}</Text></Card>)}
  </View>;
}

function Gratitude({ api, m, onChange, onError, onNotice }: { api: Api; m: Row; onChange: () => void; onError: (e: string) => void; onNotice: (e: string) => void }) {
  const [items, setItems] = useState<string[]>(["", "", ""]); const [ai, setAi] = useState(false);
  const save = () => void api("/mindset/entries", "POST", { kind: "gratitude", data: { items }, ai_mood: ai }).then(() => { setItems(["", "", ""]); onNotice("🙏 Saved"); onChange(); }).catch(e => onError(msg(e)));
  return <View style={{ gap: 10 }}>
    <Muted small>{`Three good things, a few times a week (${m.gratitude_week} this week). Be specific: "my sister helped me with…" works better than "family".`}</Muted>
    {items.map((v, i) => <Field key={i} value={v} onChangeText={t => setItems(x => x.map((y, k) => (k === i ? t : y)))} placeholder={`${i + 1}. I'm grateful for…`}/>)}
    <Line><Text style={{ color: C.muted, flex: 1 }}>Mood check (AI)</Text><Switch value={ai} onValueChange={setAi}/></Line>
    <Btn title="Save" onPress={save} disabled={!items.some(x => x.trim())}/>
    {(m.journal as Row[]).filter(j => j.kind === "gratitude").slice(0, 5).map(j => <Card key={j.id}><Muted small>{`${j.date}${j.mood ? ` · ${j.mood}` : ""}`}</Muted>
      {(j.items as string[] || []).map(t => <Text key={t} style={{ color: C.text }}>{`🙏 ${t}`}</Text>)}</Card>)}
  </View>;
}

/** Mindset studio: affirmations (swipe cards), scripting (future story + 55x5), WOOP plans, gratitude, and videos. */
export function MindsetScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [m, setM] = useState<Row | null>(null); const [tab, setTab] = useState<string>("affirm");
  const load = useCallback(() => { api<Row>("/mindset").then(setM).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!m) return <Screen><Empty>Loading…</Empty></Screen>;
  const a = m.affirmation_of_the_day as Row | null;
  const props = { api, m, onChange: load, onError, onNotice };
  return <Screen onRefresh={load}>
    {a && <View style={{ borderRadius: 24, padding: 20, gap: 8, backgroundColor: GRAD[a.category] || "#7c4dff" }}>
      <Text style={{ color: "#ffffffcc", fontWeight: "800", fontSize: 12 }}>TODAY'S AFFIRMATION</Text>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900", lineHeight: 28 }}>{a.text}</Text>
      <Text style={{ color: "#ffffffcc", fontSize: 12 }}>{`🔥 ${m.read_streak} day affirmation streak · ✍️ ${m.scripting_streak} day scripting streak`}</Text></View>}
    <View style={{ flexDirection: "row", gap: 6 }}>{[["affirm", "✨ Affirm"], ["script", "✍️ Script"], ["woop", "🎯 WOOP"], ["thanks", "🙏 Thanks"]].map(([k, l]) =>
      <TouchableOpacity key={k} onPress={() => setTab(k)} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: tab === k ? C.green : C.panel2 }}>
        <Text style={{ color: tab === k ? C.greenDark : C.text, fontWeight: "800", fontSize: 12 }}>{l}</Text></TouchableOpacity>)}</View>
    {tab === "affirm" && <AffirmationDeck {...props}/>}
    {tab === "script" && <Scripting {...props}/>}
    {tab === "woop" && <Woop {...props}/>}
    {tab === "thanks" && <Gratitude {...props}/>}
    <Card style={{ gap: 4 }}><Kicker>VIDEOS: AFFIRMATIONS, MEDITATION, MOTIVATION</Kicker>
      {(m.videos as Row[]).map(v => <TouchableOpacity key={v.url} onPress={() => openInApp(v.url, v.title, { category: "rest", note: "Mindset video" })}>
        <Text style={{ color: C.blue, paddingVertical: 4 }}>{`▶ ${v.title}`}</Text></TouchableOpacity>)}
      <Muted small>Opens YouTube search inside Sakuna (works even when Shield blocks the YouTube app).</Muted></Card>
    <Muted small>{m.honest}</Muted>
  </Screen>;
}
