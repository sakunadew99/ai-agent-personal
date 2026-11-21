import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Kicker, Muted } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const FACES = ["😫", "😕", "😐", "🙂", "😄"];
const ENERGY = ["🪫", "😴", "⚡", "⚡⚡", "🚀"];
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, fontSize: 15 } as const;

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%", borderTopWidth: 1, borderColor: C.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 }}>
          <Text style={{ color: C.text, fontSize: 21, fontWeight: "900", flex: 1 }}>{title}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: C.muted, fontSize: 22 }}>✕</Text></TouchableOpacity></View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View></View></KeyboardAvoidingView></Modal>;
}

function Scale({ value, onChange, icons, color }: { value: number; onChange: (n: number) => void; icons: string[]; color: string }) {
  return <View style={{ flexDirection: "row", gap: 8 }}>{icons.map((ic, i) => <TouchableOpacity key={i} onPress={() => onChange(i + 1)}
    style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: value === i + 1 ? `${color}33` : C.panel2, borderWidth: 1, borderColor: value === i + 1 ? color : C.line }}>
    <Text style={{ fontSize: 22 }}>{ic}</Text></TouchableOpacity>)}</View>;
}

function Morning({ api, onClose, onDone, onError }: { api: Api; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [energy, setEnergy] = useState(3); const [mood, setMood] = useState(3); const [focus, setFocus] = useState("");
  useEffect(() => { api<Row>("/ritual/morning").then(x => { setD(x); setFocus(x.saved?.focus || x.suggested_focus || ""); if (x.saved) { setEnergy(x.saved.energy); setMood(x.saved.mood); } }).catch(e => onError(msg(e))); }, [api, onError]);
  const save = () => void api("/ritual/morning", "POST", { energy, mood, focus: focus.trim() || null }).then(() => onDone("Morning check-in saved. Have a great day ☀️")).catch(e => onError(msg(e)));
  return <Sheet title={`☀️ ${d?.greeting || "Good morning"}`} onClose={onClose}>
    {!d ? <Muted>Loading your day…</Muted> : <>
      {d.sleep_hours != null && <Text style={{ color: C.text, fontWeight: "800" }}>{`😴 You slept ${d.sleep_hours} h`}</Text>}
      {(d.blocks as Row[]).length > 0 && <View style={{ gap: 4 }}><Kicker>TODAY'S PLAN</Kicker>{(d.blocks as Row[]).map((b, i) => <Text key={i} style={{ color: C.text }}>{`${b.start}  ${b.title}`}</Text>)}</View>}
      {(d.doses as Row[]).length > 0 && <View style={{ gap: 4 }}><Kicker>MEDICINES TODAY</Kicker>{(d.doses as Row[]).map((m, i) => <Text key={i} style={{ color: C.blue }}>{`${m.slot}  ${m.icon} ${m.name}`}</Text>)}</View>}
      <Kicker>ENERGY</Kicker><Scale value={energy} onChange={setEnergy} icons={ENERGY} color={C.amber}/>
      <Kicker>MOOD</Kicker><Scale value={mood} onChange={setMood} icons={FACES} color={C.green}/>
      <Kicker>ONE FOCUS FOR TODAY</Kicker>
      <TextInput style={input} value={focus} onChangeText={setFocus} placeholder="The one thing that makes today a win" placeholderTextColor={C.muted}/>
      {(d.tasks as Row[]).length > 1 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(d.tasks as Row[]).map(t => <TouchableOpacity key={t.id} onPress={() => setFocus(t.title)}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: focus === t.title ? C.green : C.line }}><Text style={{ color: focus === t.title ? C.green : C.muted }}>{t.title}</Text></TouchableOpacity>)}</View>}
      <Btn title="✓ Start my day" onPress={save}/>
    </>}
  </Sheet>;
}

function Evening({ api, onClose, onDone, onError }: { api: Api; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [mood, setMood] = useState(3); const [wins, setWins] = useState(["", ""]); const [lesson, setLesson] = useState(""); const [tomorrow, setTomorrow] = useState(["", "", ""]);
  useEffect(() => { api<Row>("/ritual/evening").then(x => { setD(x); if (x.saved?.mood) setMood(x.saved.mood); if (x.saved?.lesson) setLesson(x.saved.lesson); }).catch(e => onError(msg(e))); }, [api, onError]);
  const save = () => void api<Row>("/ritual/evening", "POST", { mood, wins: wins.filter(w => w.trim()), lesson: lesson.trim() || null, tomorrow: tomorrow.filter(t => t.trim()) })
    .then(r => onDone(`Day closed 🌙${(r.tasks_created as string[]).length ? ` · ${(r.tasks_created as string[]).length} tasks for tomorrow` : ""}`)).catch(e => onError(msg(e)));
  const spent = d ? Object.entries(d.spent as Record<string, string>).map(([c, v]) => `${Number(v).toLocaleString()} ${c}`).join(" + ") : "";
  return <Sheet title="🌙 Close your day" onClose={onClose}>
    {!d ? <Muted>Gathering your day…</Muted> : <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }}>
        {[["✅", `${(d.tasks_done as string[]).length}`, "tasks done"], ["🎯", `${d.focus_minutes}m`, "focus"], ["👟", Number(d.steps).toLocaleString(), "steps"],
          ["🎵", `${d.practice_minutes}m`, "practice"], ["💊", `${d.doses_taken}/${d.doses_total}`, "doses"], ["💸", spent || "0", "spent"]].map(([i, v, l]) =>
          <View key={l} style={{ width: "31.5%", backgroundColor: C.panel2, borderRadius: 14, padding: 10 }}>
            <Text>{i}</Text><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }} numberOfLines={1}>{v}</Text><Muted small>{l}</Muted></View>)}
      </View>
      {!!d.morning_focus && <Text style={{ color: C.amber, fontWeight: "700" }}>{`This morning's focus: ${d.morning_focus}`}</Text>}
      <Kicker>HOW WAS TODAY?</Kicker><Scale value={mood} onChange={setMood} icons={FACES} color={C.green}/>
      <Kicker>TWO WINS (EVEN SMALL)</Kicker>
      {wins.map((w, i) => <TextInput key={i} style={input} value={w} onChangeText={t => setWins(x => x.map((y, j) => j === i ? t : y))} placeholder={i ? "Another win" : "e.g. Finished the report draft"} placeholderTextColor={C.muted}/>)}
      <Kicker>ONE LESSON</Kicker>
      <TextInput style={input} value={lesson} onChangeText={setLesson} placeholder="What would you do differently?" placeholderTextColor={C.muted}/>
      <Kicker>TOMORROW'S TOP 3</Kicker>
      {tomorrow.map((t, i) => <TextInput key={i} style={input} value={t} onChangeText={v => setTomorrow(x => x.map((y, j) => j === i ? v : y))} placeholder={`${i + 1}. ${i === 0 ? "Most important" : "Next"}`} placeholderTextColor={C.muted}/>)}
      {(d.open_tasks as Row[]).length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(d.open_tasks as Row[]).map(t => <TouchableOpacity key={t.id}
        onPress={() => setTomorrow(x => { const i = x.findIndex(y => !y.trim()); return i < 0 ? x : x.map((y, j) => j === i ? t.title : y); })}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.muted }}>{`＋ ${t.title}`}</Text></TouchableOpacity>)}</View>}
      <Btn title="✓ Close my day" onPress={save}/>
      <Muted small>Wins and the lesson go to today's journal. Tomorrow's top 3 become tasks for tomorrow morning.</Muted>
    </>}
  </Sheet>;
}

/** Home card: morning check-in until 3 pm, evening review from 6 pm (each until done). */
export function RitualCard({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [open, setOpen] = useState<"" | "morning" | "evening">("");
  const [done, setDone] = useState<{ morning: boolean; evening: boolean } | null>(null);
  const hour = new Date().getHours();
  const which: "morning" | "evening" | "" = hour < 15 ? "morning" : hour >= 18 ? "evening" : "";
  const load = useCallback(() => {
    if (!which) return;
    api<Row>(`/ritual/${which}`).then(x => setDone(d => ({ morning: which === "morning" ? x.done : d?.morning ?? false, evening: which === "evening" ? x.done : d?.evening ?? false }))).catch(() => undefined);
  }, [api, which]);
  useEffect(() => { load(); }, [load]);
  const finish = (m: string) => { setOpen(""); onNotice(m); load(); };
  if (!which || !done || done[which]) return null;
  const morning = which === "morning";
  return <>
    <TouchableOpacity activeOpacity={0.85} onPress={() => setOpen(which)} style={{ borderRadius: 24, padding: 16, flexDirection: "row", alignItems: "center", gap: 12,
      backgroundColor: morning ? "#3a2f1d" : "#1d1a3a", borderWidth: 1, borderColor: morning ? "#f5b65b66" : "#b48cff66" }}>
      <Text style={{ fontSize: 34 }}>{morning ? "☀️" : "🌙"}</Text>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{morning ? "Morning check-in" : "Close your day"}</Text>
        <Muted small>{morning ? "2 minutes: energy, mood and one focus" : "2 minutes: mood, wins, lesson, tomorrow's top 3"}</Muted></View>
      <Text style={{ color: morning ? C.amber : "#b48cff", fontSize: 22 }}>›</Text>
    </TouchableOpacity>
    {open === "morning" && <Morning api={api} onClose={() => setOpen("")} onDone={finish} onError={onError}/>}
    {open === "evening" && <Evening api={api} onClose={() => setOpen("")} onDone={finish} onError={onError}/>}
  </>;
}

// ------------------------------------------------------------------ quick add (long-press the ＋ button)

const CATS = ["food", "transport", "shopping", "health", "education", "housing", "subscriptions", "business", "other"];
const CAT_ICON: Record<string, string> = { food: "🍛", transport: "🚌", shopping: "🛍️", health: "💊", education: "🎓", housing: "🏠", subscriptions: "🔁", business: "💼", other: "📦" };

export function QuickAdd({ api, onClose, onOpen, onNotice, onError }: { api: Api; onClose: () => void; onOpen: (t: string) => void; onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"" | "expense" | "task">("");
  const [amount, setAmount] = useState(""); const [cat, setCat] = useState("food"); const [cur, setCur] = useState("LKR"); const [note, setNote] = useState("");
  const [title, setTitle] = useState(""); const [prio, setPrio] = useState("medium");
  const go = (t: string) => { onClose(); onOpen(t); };
  const saveExpense = () => void api("/finance/expenses", "POST", { amount: Number(amount), currency: cur, category: cat, notes: note.trim() || undefined, record_kind: "actual", scope: "personal" })
    .then(() => { onNotice(`Expense saved: ${Number(amount).toLocaleString()} ${cur}`); onClose(); }).catch(e => onError(msg(e)));
  const saveTask = () => void api("/tasks", "POST", { title: title.trim(), priority: prio }).then(() => { onNotice("Task added"); onClose(); }).catch(e => onError(msg(e)));
  const tiles: [string, string, () => void][] = [
    ["💸", "Expense", () => setMode("expense")], ["☑", "Task", () => setMode("task")], ["💊", "Medicine", () => go("Meds")],
    ["🎯", "Practice", () => go("Skills")], ["✍️", "Journal", () => go("Journal")], ["🎙", "Voice note", () => go("Capture")]];
  return <Sheet title={mode === "expense" ? "💸 Quick expense" : mode === "task" ? "☑ Quick task" : "＋ Quick add"} onClose={onClose}>
    {!mode && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>{tiles.map(([i, l, f]) =>
      <TouchableOpacity key={l} onPress={f} style={{ width: "31.5%", alignItems: "center", gap: 6, paddingVertical: 16, borderRadius: 18, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line }}>
        <Text style={{ fontSize: 28 }}>{i}</Text><Text style={{ color: C.text, fontWeight: "800" }}>{l}</Text></TouchableOpacity>)}</View>}
    {mode === "expense" && <>
      <TextInput style={[input, { fontSize: 28, fontWeight: "900" }]} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.muted} autoFocus/>
      <View style={{ flexDirection: "row", gap: 6 }}>{["LKR", "USD", "EUR"].map(c => <TouchableOpacity key={c} onPress={() => setCur(c)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: cur === c ? C.green : C.line }}>
        <Text style={{ color: cur === c ? C.green : C.muted, fontWeight: "800" }}>{c}</Text></TouchableOpacity>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{CATS.map(c => <TouchableOpacity key={c} onPress={() => setCat(c)}
        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: cat === c ? C.green : C.line, backgroundColor: cat === c ? C.greenSoft : "transparent" }}>
        <Text style={{ color: cat === c ? C.green : C.muted, fontWeight: "700", textTransform: "capitalize" }}>{`${CAT_ICON[c]} ${c}`}</Text></TouchableOpacity>)}</View>
      <TextInput style={input} value={note} onChangeText={setNote} placeholder="Note (optional)" placeholderTextColor={C.muted}/>
      <Btn title="💾 Save expense" disabled={!(Number(amount) > 0)} onPress={saveExpense}/>
    </>}
    {mode === "task" && <>
      <TextInput style={input} value={title} onChangeText={setTitle} placeholder="What needs doing?" placeholderTextColor={C.muted} autoFocus/>
      <View style={{ flexDirection: "row", gap: 6 }}>{["high", "medium", "low"].map(p => <TouchableOpacity key={p} onPress={() => setPrio(p)} style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: prio === p ? C.green : C.line }}>
        <Text style={{ color: prio === p ? C.green : C.muted, fontWeight: "800", textTransform: "capitalize" }}>{p}</Text></TouchableOpacity>)}</View>
      <Btn title="＋ Add task" disabled={!title.trim()} onPress={saveTask}/>
    </>}
  </Sheet>;
}
