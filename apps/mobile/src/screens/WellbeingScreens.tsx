import React, { useCallback, useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KbScroll } from "../keyboard";
import type { ApiRecord as Row } from "../api";
import { Bars, Hero, Ring } from "../charts";
import { syncMedicineReminders } from "../notify";
import { Badge, Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen, soft } from "../ui";
import { Trainer, type TrainerResult } from "./Trainer";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", borderTopWidth: 1, borderColor: C.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 }}>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: "900", flex: 1 }}>{title}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: C.muted, fontSize: 22 }}>✕</Text></TouchableOpacity></View>
        <KbScroll contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</KbScroll>
      </View></View></KeyboardAvoidingView></Modal>;
}
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, fontSize: 15 } as const;
const chip = (on: boolean, color = C.green) => ({ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: on ? color : C.line, backgroundColor: on ? `${color}22` : "transparent" });

// ------------------------------------------------------------------ medicines

function MedicineForm({ api, m, onClose, onSaved, onError }: { api: Api; m: Row | null; onClose: () => void; onSaved: () => void; onError: (s: string) => void }) {
  const [name, setName] = useState(m?.name || ""); const [dose, setDose] = useState(m?.dose || "");
  const [times, setTimes] = useState<string[]>(m?.times || ["08:00"]); const [days, setDays] = useState<number[] | null>(m?.days || null);
  const [food, setFood] = useState(!!m?.with_food); const [stock, setStock] = useState(m?.stock != null ? String(m.stock) : "");
  const [per, setPer] = useState(String(m?.per_dose || 1)); const [notes, setNotes] = useState(m?.notes || "");
  const [newTime, setNewTime] = useState("20:00");
  const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
  async function save() {
    const body = { name: name.trim(), dose: dose.trim() || null, times, days, with_food: food, stock: stock ? Number(stock) : null, per_dose: Number(per) || 1, notes: notes.trim() || null };
    try { await (m ? api(`/medicines/${m.id}`, "PATCH", body) : api("/medicines", "POST", body)); onSaved(); } catch (e) { onError(msg(e)); }
  }
  return <Sheet title={m ? `✎ ${m.name}` : "＋ Add medicine"} onClose={onClose}>
    <TextInput style={input} value={name} onChangeText={setName} placeholder="Name, e.g. Vitamin D" placeholderTextColor={C.muted}/>
    <TextInput style={input} value={dose} onChangeText={setDose} placeholder="Dose as on the label, e.g. 1000 IU, 1 tablet" placeholderTextColor={C.muted}/>
    <Kicker>TIMES</Kicker>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{times.map(t => <TouchableOpacity key={t} onPress={() => times.length > 1 && setTimes(times.filter(x => x !== t))} style={chip(true)}>
      <Text style={{ color: C.green, fontWeight: "800" }}>{`${t}  ✕`}</Text></TouchableOpacity>)}</View>
    <Line><TextInput style={[input, { flex: 1 }]} value={newTime} onChangeText={setNewTime} placeholder="HH:MM" placeholderTextColor={C.muted}/>
      <Btn kind="outline" title="＋ Time" disabled={!valid.test(newTime) || times.includes(newTime)} onPress={() => setTimes([...times, newTime].sort())}/></Line>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{["07:00", "08:00", "13:00", "20:00", "22:00"].map(t => <TouchableOpacity key={t} onPress={() => !times.includes(t) && setTimes([...times, t].sort())} style={chip(times.includes(t))}>
      <Text style={{ color: times.includes(t) ? C.green : C.muted, fontWeight: "700" }}>{t}</Text></TouchableOpacity>)}</View>
    <Kicker>DAYS</Kicker>
    <Line><TouchableOpacity onPress={() => setDays(null)} style={chip(days === null)}><Text style={{ color: days === null ? C.green : C.muted, fontWeight: "800" }}>Every day</Text></TouchableOpacity>
      {DAYS.map((d, i) => { const on = !!days?.includes(i + 1); return <TouchableOpacity key={i} onPress={() => setDays(on ? (days || []).filter(x => x !== i + 1) : [...(days || []), i + 1].sort())} style={chip(on)}>
        <Text style={{ color: on ? C.green : C.muted, fontWeight: "800" }}>{d}</Text></TouchableOpacity>; })}</Line>
    <TouchableOpacity onPress={() => setFood(!food)} style={chip(food, C.amber)}><Text style={{ color: food ? C.amber : C.muted, fontWeight: "800" }}>{food ? "🍽 Take with food" : "Take with food?"}</Text></TouchableOpacity>
    <Line><TextInput style={[input, { flex: 1 }]} value={stock} onChangeText={setStock} keyboardType="number-pad" placeholder="Pills left (optional)" placeholderTextColor={C.muted}/>
      <TextInput style={[input, { width: 110 }]} value={per} onChangeText={setPer} keyboardType="number-pad" placeholder="Per dose" placeholderTextColor={C.muted}/></Line>
    <TextInput style={input} value={notes} onChangeText={setNotes} placeholder="Notes (doctor, purpose)" placeholderTextColor={C.muted}/>
    <Btn title="💾 Save" disabled={!name.trim() || !times.length} onPress={() => void save()}/>
    {m && <Btn kind="danger" title="🗑 Delete medicine" onPress={() => Alert.alert(`Delete ${m.name}?`, "Its history is removed too.", [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/medicines/${m.id}`, "DELETE").then(onSaved).catch(e => onError(msg(e))) }])}/>}
    <Muted small>Sakuna only reminds you of what you enter. It never suggests or changes doses.</Muted>
  </Sheet>;
}

export function MedicinesScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [form, setForm] = useState<Row | null | "new">(null);
  const load = useCallback(() => { api<Row>("/medicines").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const mark = (d: Row, status: string | null) => void api<Row>(`/medicines/${d.medicine_id}/log`, "POST", { slot: d.slot, status }).then(x => { setV(x); void syncMedicineReminders(api); }).catch(e => onError(msg(e)));
  const saved = () => { setForm(null); load(); void syncMedicineReminders(api).then(n => onNotice(n >= 0 ? `Saved · ${n} reminders set` : "Saved (allow notifications for reminders)")); };
  if (!v) return <Screen><Empty>Loading medicines…</Empty></Screen>;
  const doses: Row[] = v.doses;
  const done = doses.filter(d => d.status === "taken").length;
  return <Screen onRefresh={load}>
    <Hero kicker="MEDICINES & SUPPLEMENTS" title={doses.length ? `${done} of ${doses.length}` : "No doses"} accent={doses.length ? "taken" : "today"} color={C.blue}
      sub={v.next ? `Next: ${v.next.icon} ${v.next.name} at ${v.next.slot}` : doses.length ? "All done for today 🎉" : "Add a medicine to get reminders."}
      right={<Ring value={v.adherence_7d ?? 0} size={92} color={C.blue} label={v.adherence_7d != null ? `${v.adherence_7d}%` : "—"} sub="7 DAYS"/>}/>
    {(v.refill as Row[]).map(m => <Card key={m.id} style={{ borderColor: C.amber }}><Text style={{ color: C.amber, fontWeight: "800" }}>{`⚠ ${m.name}: ${m.stock} left (about ${m.days_left} days). Time to refill.`}</Text></Card>)}
    <Card><Kicker>TODAY</Kicker>
      {doses.length ? doses.map(d => <View key={`${d.medicine_id}-${d.slot}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <Text style={{ color: C.text, fontWeight: "900", width: 52 }}>{d.slot}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{`${d.icon} ${d.name}`}</Text><Muted small>{`${d.dose || ""}${d.with_food ? " · with food" : ""}`}</Muted></View>
        {d.status === "taken" ? <TouchableOpacity onPress={() => mark(d, null)}><Badge>✓ taken</Badge></TouchableOpacity>
          : d.status === "skipped" ? <TouchableOpacity onPress={() => mark(d, null)}><Badge tone="muted">skipped</Badge></TouchableOpacity>
          : <View style={{ flexDirection: "row", gap: 6 }}>
            <TouchableOpacity onPress={() => mark(d, "taken")} style={{ backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: C.greenDark, fontWeight: "900" }}>✓ Take</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => mark(d, "skipped")} style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ color: C.muted }}>Skip</Text></TouchableOpacity></View>}
      </View>) : <Muted>No doses today.</Muted>}
    </Card>
    <Card><Line><Kicker>{`MY MEDICINES · ${(v.medicines as Row[]).length}`}</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title="＋ Add" onPress={() => setForm("new")}/></Line>
      {(v.medicines as Row[]).map(m => <TouchableOpacity key={m.id} onPress={() => setForm(m)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}>
        <Text style={{ fontSize: 22 }}>{m.icon}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: m.active ? C.text : C.muted, fontWeight: "800" }}>{`${m.name}${m.dose ? ` · ${m.dose}` : ""}`}</Text>
          <Muted small>{`${(m.times as string[]).join(", ")}${m.days ? ` · ${(m.days as number[]).map(d => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(" ")}` : " · every day"}${m.stock != null ? ` · ${m.stock} left` : ""}`}</Muted></View>
        <Text style={{ color: C.muted }}>✎</Text></TouchableOpacity>)}
      {!(v.medicines as Row[]).length && <Btn title="＋ Add your first medicine" onPress={() => setForm("new")}/>}
    </Card>
    <Muted small>{v.note}</Muted>
    {form && <MedicineForm api={api} m={form === "new" ? null : form} onClose={() => setForm(null)} onSaved={saved} onError={onError}/>}
  </Screen>;
}

// ------------------------------------------------------------------ skills

const CATS: [string, string][] = [["body", "💪 Body"], ["fight", "🥊 Fighting"], ["music", "🎵 Music"], ["soft", "🤝 Soft skills"], ["hard", "🛠 Hard skills"], ["mind", "🧠 Mind"], ["other", "✨ Other"]];
const CAT_COLOR: Record<string, string> = { body: C.green, fight: C.red, music: "#b48cff", soft: C.amber, hard: C.blue, mind: "#4fd1c5", other: C.muted };

function metricText(m: Row | null | undefined) {
  if (!m) return "";
  if (m.kind === "pitch") return `🎤 ${m.in_tune_pct}% in tune · ${m.notes_hit} notes${m.range_low ? ` · ${m.range_low}–${m.range_high}` : ""}`;
  if (m.kind === "karaoke") return `🎶 ${m.song}: ${m.score}/100 · ${m.in_tune_pct}% in tune · ${m.notes_hit}/${m.notes_total} notes`;
  if (m.kind === "swim") return `🏊 ${m.distance_m ?? "?"} m${m.pace_s_per_100m ? ` · ${Math.floor(m.pace_s_per_100m / 60)}:${String(m.pace_s_per_100m % 60).padStart(2, "0")}/100 m` : ""}`;
  if (m.kind === "pose") return `🧘 ${m.mode} · ${m.reps != null ? `${m.reps} reps` : `${m.hold_seconds}s hold`} · ${m.good_pct}% good form`;
  return "";
}

export function SkillsScreen({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen?: (t: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [log, setLog] = useState<Row | null>(null);
  const [mins, setMins] = useState("20"); const [rating, setRating] = useState(4); const [note, setNote] = useState("");
  const [trainer, setTrainer] = useState<{ kind: "pitch" | "pose" | "karaoke"; skill: Row } | null>(null);
  const [advice, setAdvice] = useState<Row | null>(null);
  const loadAdvice = (sessionId: string, ai = false) => void api<Row>(`/skills/sessions/${sessionId}/advice${ai ? "?ai=true" : ""}`, "POST")
    .then(a => setAdvice({ ...a, sessionId })).catch(e => onError(msg(e)));
  const [plan, setPlan] = useState<Row | null>(null);
  const [custom, setCustom] = useState(""); const [cat, setCat] = useState("other");
  const load = useCallback(() => { api<Row>("/skills").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading skills…</Empty></Screen>;
  const add = (t: Row) => void api<Row>("/skills", "POST", { name: t.name, icon: t.icon, category: t.category, trainer: t.trainer || null, goal: t.goal || null }).then(x => { setV(x); onNotice(`${t.name} added`); }).catch(e => onError(msg(e)));
  const saveLog = () => void api<Row>(`/skills/${log!.id}/sessions`, "POST", { minutes: Number(mins) || 10, rating, note: note.trim() || null }).then(x => { setV(x); setLog(null); setNote(""); onNotice("Practice logged 💪"); }).catch(e => onError(msg(e)));
  const onTrainer = (r: TrainerResult) => {
    const s = trainer!.skill; setTrainer(null);
    void api<Row>(`/skills/${s.id}/sessions`, "POST", { minutes: Math.max(1, Math.round(Number(r.minutes) || 1)), source: r.kind, metrics: r, rating: null }).then(x => {
      setV(x); onNotice(`Saved: ${metricText(r)}`);
      const latest = (x.skills as Row[]).find(k => k.id === s.id)?.recent?.[0];
      if (latest && r.kind === "karaoke") loadAdvice(String(latest.id));            // show the coach right after a song
    }).catch(e => onError(msg(e)));
  };
  const skills: Row[] = v.skills;
  return <Screen onRefresh={load}>
    <Hero kicker="SKILLS · PRACTICE EVERY WEEK" title={`${Math.round(v.week_minutes / 6) / 10} h`} accent="this week" color="#b48cff"
      sub={skills.length ? `${skills.length} skills · ${skills.filter(s => s.streak > 0).length} on a streak` : "Add a skill below to start."}
      right={<Ring value={Math.min(100, skills.length ? (skills.reduce((a, s) => a + Math.min(100, s.week_pct || 0), 0) / skills.length) : 0)} size={90} color="#b48cff"
        label={`${skills.length ? Math.round(skills.reduce((a, s) => a + Math.min(100, s.week_pct || 0), 0) / skills.length) : 0}%`} sub="WEEK GOAL"/>}/>
    {(v.week as Row[]).some(d => d.minutes) && <Card><Kicker>MINUTES PER DAY</Kicker><Bars data={(v.week as Row[]).map(d => ({ label: d.label, value: d.minutes, color: "#b48cff" }))} height={90}/></Card>}
    {skills.map(s => { const col = CAT_COLOR[s.category] || C.green, isOpen = open === s.id;
      return <Card key={s.id} style={{ borderColor: `${col}55` }}>
        <TouchableOpacity onPress={() => setOpen(isOpen ? null : s.id)} style={{ gap: 6 }}>
          <Line><Text style={{ fontSize: 26 }}>{s.icon}</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{s.name}</Text>
            <Muted small>{`Level ${s.level} · ${s.total_hours} h total${s.streak ? ` · 🔥 ${s.streak}-day streak` : ""}`}</Muted></View>
            <Text style={{ color: col, fontWeight: "900" }}>{`${s.week_minutes}/${s.weekly_minutes}m`}</Text></Line>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.panel2 }}><View style={{ height: 8, borderRadius: 4, width: `${Math.min(100, s.week_pct || 0)}%`, backgroundColor: col }}/></View>
          {!!s.last_metrics && <Text style={{ color: col, fontSize: 12 }}>{metricText(s.last_metrics)}</Text>}
          {s.level_up_ready && <Text style={{ color: C.amber, fontWeight: "800" }}>⭐ Enough practice for the next level: tap Level +1</Text>}
        </TouchableOpacity>
        <Line>
          <Btn title="＋ Log practice" onPress={() => setLog(s)} style={{ flex: 1 }}/>
          {s.trainer && s.trainer !== "karaoke" && <Btn kind="outline" title={s.trainer === "pitch" ? "🎤 Tuner" : "🧘 Pose coach"} onPress={() => setTrainer({ kind: s.trainer, skill: s })} style={{ flex: 1 }}/>}
        </Line>
        {(s.category === "music" || s.trainer === "pitch" || s.trainer === "karaoke") && <TouchableOpacity onPress={() => setTrainer({ kind: "karaoke", skill: s })}
          style={{ borderRadius: 16, padding: 12, backgroundColor: "#b48cff22", borderWidth: 1, borderColor: "#b48cff66", flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 26 }}>🎶</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900" }}>Sing-along (karaoke)</Text>
            <Muted small>Sing a song, see your voice on the notes, get a match score and coach advice</Muted></View><Text style={{ color: "#b48cff", fontSize: 18 }}>›</Text></TouchableOpacity>}
        {isOpen && <View style={{ gap: 8 }}>
          {!!s.goal && <Muted>{`🎯 ${s.goal}`}</Muted>}
          <Line><Btn kind="outline" title="📋 Today's plan" onPress={() => void api<Row>(`/skills/${s.id}/plan`, "POST").then(setPlan).catch(e => onError(msg(e)))} style={{ flex: 1 }}/>
            <Btn kind="outline" title="✨ AI coach plan" onPress={() => void api<Row>(`/skills/${s.id}/plan?ai=true`, "POST").then(setPlan).catch(e => onError(msg(e)))} style={{ flex: 1 }}/></Line>
          <Line>
            <Btn kind="link" title="Level −1" disabled={s.level <= 1} onPress={() => void api<Row>(`/skills/${s.id}`, "PATCH", { level: s.level - 1 }).then(setV)}/>
            <Btn kind="link" title="Level +1" disabled={s.level >= 10} onPress={() => void api<Row>(`/skills/${s.id}`, "PATCH", { level: s.level + 1 }).then(setV)}/>
            <Btn kind="link" title="Goal −30m" onPress={() => void api<Row>(`/skills/${s.id}`, "PATCH", { weekly_minutes: Math.max(0, s.weekly_minutes - 30) }).then(setV)}/>
            <Btn kind="link" title="+30m" onPress={() => void api<Row>(`/skills/${s.id}`, "PATCH", { weekly_minutes: s.weekly_minutes + 30 }).then(setV)}/></Line>
          {(s.recent as Row[]).map(r => <TouchableOpacity key={r.id} onPress={() => r.metrics && loadAdvice(String(r.id))} onLongPress={() => Alert.alert("Delete this practice?", "", [{ text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => void api(`/skills/sessions/${r.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}>
            <Muted small>{`${r.date} · ${r.minutes} min${r.rating ? ` · ${"★".repeat(r.rating)}` : ""}${r.metrics ? ` · ${metricText(r.metrics)}` : ""}${r.note ? ` · ${r.note}` : ""}`}</Muted></TouchableOpacity>)}
          {(s.recent as Row[]).length > 0 && <Muted small>Tap a session for coach advice · long-press to delete it.</Muted>}
          <Btn kind="danger" title="Remove skill" onPress={() => Alert.alert(`Remove ${s.name}?`, "All its practice history is deleted.", [{ text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => void api(`/skills/${s.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}/>
        </View>}
      </Card>; })}
    {onOpen && <TouchableOpacity onPress={() => onOpen("Gym")} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.panel, borderRadius: 20, padding: 14, borderWidth: 1, borderColor: "#3ee08f44" }}>
      <Text style={{ fontSize: 26 }}>🏋️</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900" }}>Gym log</Text><Muted small>Sets, kg × reps, records: your strength practice</Muted></View>
      <Text style={{ color: C.green, fontSize: 18 }}>›</Text></TouchableOpacity>}
    <Card><Kicker>ADD A SKILL</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(v.templates as Row[]).map(t => <TouchableOpacity key={t.name} onPress={() => add(t)} style={[chip(false), { flexDirection: "row", gap: 6, alignItems: "center" }]}>
        <Text>{t.icon}</Text><Text style={{ color: C.text, fontWeight: "700" }}>{t.name}</Text>{t.trainer && <Text style={{ color: "#b48cff", fontSize: 11 }}>{t.trainer === "pitch" ? "🎤" : "📷"}</Text>}</TouchableOpacity>)}</View>
      <TextInput style={input} value={custom} onChangeText={setCustom} placeholder="Your own: e.g. Chess, Drawing, Negotiation" placeholderTextColor={C.muted}/>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{CATS.map(([k, l]) => <TouchableOpacity key={k} onPress={() => setCat(k)} style={chip(cat === k, CAT_COLOR[k])}>
        <Text style={{ color: cat === k ? CAT_COLOR[k] : C.muted, fontWeight: "700" }}>{l}</Text></TouchableOpacity>)}</View>
      <Btn kind="outline" title="＋ Add my skill" disabled={!custom.trim()} onPress={() => { add({ name: custom.trim(), icon: "🎯", category: cat }); setCustom(""); }}/>
      <Muted small>🎤 = pitch trainer (tuner, singing scale) · 📷 = pose coach (camera checks form and counts). Both run on your phone.</Muted>
    </Card>
    {log && <Sheet title={`${log.icon} Log ${log.name}`} onClose={() => setLog(null)}>
      <Kicker>MINUTES</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{["10", "15", "20", "30", "45", "60", "90"].map(m => <TouchableOpacity key={m} onPress={() => setMins(m)} style={chip(mins === m)}>
        <Text style={{ color: mins === m ? C.green : C.muted, fontWeight: "800" }}>{m}</Text></TouchableOpacity>)}</View>
      <TextInput style={input} value={mins} onChangeText={setMins} keyboardType="number-pad"/>
      <Kicker>HOW DID IT GO?</Kicker>
      <Line>{[1, 2, 3, 4, 5].map(n => <TouchableOpacity key={n} onPress={() => setRating(n)}><Text style={{ fontSize: 30, color: n <= rating ? C.amber : C.line }}>★</Text></TouchableOpacity>)}</Line>
      <TextInput style={input} value={note} onChangeText={setNote} placeholder="What did you practise? What to fix next time?" placeholderTextColor={C.muted} multiline/>
      <Btn title="💾 Save practice" onPress={saveLog}/>
    </Sheet>}
    {plan && <Sheet title={`📋 ${plan.skill}: today`} onClose={() => setPlan(null)}>
      {plan.text ? <Text style={{ color: C.text, lineHeight: 22 }}>{plan.text}</Text> : (plan.steps as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 22 }}>{`${i + 1}. ${x}`}</Text>)}
      <Muted small>{plan.source === "ai" ? "AI coach plan from your recent sessions." : plan.ai_note || "Built-in plan. Turn on AI for a personal plan."}</Muted>
    </Sheet>}
    {trainer && <Trainer kind={trainer.kind} onClose={() => setTrainer(null)} onResult={onTrainer}/>}
    {advice && <Sheet title="🎙 Your coach" onClose={() => setAdvice(null)}>
      {advice.progress && <View style={{ backgroundColor: advice.progress.change >= 0 ? C.greenSoft : soft(C.red), borderRadius: 14, padding: 12 }}>
        <Text style={{ color: advice.progress.change >= 0 ? C.green : C.red, fontWeight: "900", fontSize: 16 }}>{`${advice.progress.previous} → ${advice.progress.now}`}</Text>
        <Muted small>{advice.progress.text}</Muted></View>}
      <Kicker>FROM YOUR SCORES</Kicker>
      {(advice.tips as string[]).map((t, i) => <Text key={i} style={{ color: C.text, lineHeight: 21 }}>{`• ${t}`}</Text>)}
      {advice.ai_text ? <View style={{ backgroundColor: "#b48cff18", borderRadius: 14, padding: 12 }}><Kicker>✨ AI VOCAL COACH</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{advice.ai_text}</Text></View>
        : <Btn title="✨ AI vocal coach advice" onPress={() => loadAdvice(advice.sessionId, true)}/>}
      {!!advice.ai_note && <Muted small>{advice.ai_note}</Muted>}
    </Sheet>}
  </Screen>;
}

// ------------------------------------------------------------------ health advice card (Health screen)

export function HealthAdviceCard({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [a, setA] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback((ai = false) => { setBusy(ai); api<Row>(`/health/advice${ai ? "?ai=true" : ""}`).then(setA).catch(e => onError(msg(e))).finally(() => setBusy(false)); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!a) return null;
  return <Card accent>
    <Kicker>💡 ADVICE FROM YOUR LAST 2 WEEKS</Kicker>
    {(a.tips as Row[]).length ? (a.tips as Row[]).map(t => <View key={t.title} style={{ flexDirection: "row", gap: 10 }}>
      <Text style={{ fontSize: 20 }}>{t.icon}</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{t.title}</Text><Muted small>{t.text}</Muted></View></View>)
      : <Muted>Not enough data yet. Sync Mi Band for a few days.</Muted>}
    {a.ai_text ? <View style={{ backgroundColor: "#b48cff18", borderRadius: 12, padding: 10 }}><Text style={{ color: C.text, lineHeight: 20 }}>{a.ai_text}</Text></View>
      : <Btn kind="outline" title={busy ? "Thinking…" : "✨ AI coach advice"} busy={busy} onPress={() => load(true)}/>}
    {!!a.ai_note && <Muted small>{a.ai_note}</Muted>}
    <Muted small>{a.disclaimer}</Muted>
  </Card>;
}
