import React, { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { DateField, isoDate, prettyDate } from "../pickers";
import { Btn, C, Empty, Muted, Row as Line, Screen, soft } from "../ui";
import { Bars, Ring } from "../charts";
import { appendSpeech, MicButton } from "../voice";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const MOODS: [number, string, string][] = [[1, "😞", "Rough"], [2, "🙁", "Low"], [3, "😐", "Okay"], [4, "🙂", "Good"], [5, "😄", "Great"]];
const MOOD_BG: Record<number, string> = { 1: "#4a2a2a", 2: "#4a3a24", 3: "#33403a", 4: "#1f4a33", 5: "#1f6b45" };
const EMPTY: Row = { mood: null, did: "", positives: [], negatives: [], gratitude: [], lesson: "", notes: "", tags: [] };

/** Daily journal: what I did, good and hard things, gratitude, a lesson, notes and mood. Private; AI only when you tap Reflect. */
export function JournalScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(() => peek("/journal"));
  const [day, setDay] = useState<string | null>(() => (peek<Row>("/journal")?.date as string) ?? null);
  const [d, setD] = useState<Row>(() => ({ ...EMPTY, ...(peek<Row>("/journal")?.entry || {}) }));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback((which: string | null = day) => {
    api<Row>(`/journal${which ? `?day=${which}` : ""}`).then(x => { setV(x); setDay(String(x.date)); setD({ ...EMPTY, ...(x.entry || {}) }); setDirty(false); })
      .catch(r => onError(msg(r)));
  }, [api, day, onError]);
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <Screen><Empty>Opening your journal…</Empty></Screen>;
  const patch = (p: Row) => { setD(cur => ({ ...cur, ...p })); setDirty(true); };
  const go = (next: string | null) => {
    if (!next) return;
    if (dirty) Alert.alert("Unsaved changes", "Save this page first?", [{ text: "Discard", style: "destructive", onPress: () => load(next) }, { text: "Keep editing", style: "cancel" }]);
    else load(next);
  };
  const shift = (n: number) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); go(isoDate(x)); };

  async function save() {
    setBusy("save");
    try {
      const body = { mood: d.mood, did: d.did || null, positives: d.positives, negatives: d.negatives, gratitude: d.gratitude, lesson: d.lesson || null, notes: d.notes || null, tags: d.tags };
      const x = await api<Row>(`/journal/${day}`, "PUT", body);
      setV(x); setD({ ...EMPTY, ...(x.entry || {}) }); setDirty(false); onNotice("Journal saved ✍️");
    } catch (e) { onError(msg(e)); } finally { setBusy(null); }
  }
  async function reflect() {
    if (dirty) await save();
    setBusy("reflect");
    try { const e = await api<Row>(`/journal/${day}/reflect`, "POST"); setD(cur => ({ ...cur, ai_reflection: e.ai_reflection })); } catch (e) { onError(msg(e)); } finally { setBusy(null); }
  }
  const remove = () => Alert.alert("Delete this page?", prettyDate(day), [{ text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void api<Row>(`/journal/${day}`, "DELETE").then(x => { setV(x); setD({ ...EMPTY }); setDirty(false); onNotice("Page deleted"); }).catch(e => onError(msg(e))) }]);

  const isToday = day === v.today;
  const month = v.month;
  return <Screen onRefresh={() => load()}>
    <View style={s.hero}>
      <Line>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>✍️ JOURNAL</Text>
          <Text style={s.heroTitle}>{isToday ? "Today's page" : prettyDate(day)}</Text>
        </View>
        <Ring value={Math.min(100, (v.entries_30_days / 30) * 100)} size={70} label={`${v.streak}🔥`} sub="STREAK"/>
        <View style={s.stat}><Text style={s.statValue}>{v.entries_30_days}</Text><Text style={s.statLabel}>pages / 30d</Text></View>
        <View style={s.stat}><Text style={s.statValue}>{v.gratitude_30_days}</Text><Text style={s.statLabel}>thanks</Text></View>
      </Line>
      <Line>
        <TouchableOpacity style={s.nav} onPress={() => shift(-1)}><Text style={s.navText}>‹</Text></TouchableOpacity>
        <DateField value={day} onChange={go}/>
        <TouchableOpacity style={[s.nav, isToday && { opacity: 0.3 }]} disabled={isToday} onPress={() => shift(1)}><Text style={s.navText}>›</Text></TouchableOpacity>
      </Line>
    </View>

    <View style={s.card}>
      <Text style={s.section}>How was the day?</Text>
      <View style={s.moods}>{MOODS.map(([n, face, label]) => <TouchableOpacity key={n} onPress={() => patch({ mood: d.mood === n ? null : n })}
        style={[s.mood, d.mood === n && { backgroundColor: MOOD_BG[n], borderColor: C.green }]}>
        <Text style={{ fontSize: 28 }}>{face}</Text><Text style={[s.moodLabel, d.mood === n && { color: C.text }]}>{label}</Text></TouchableOpacity>)}</View>
    </View>

    <Section icon="📝" title="What I did" color="#3b82f6">
      <TextArea value={d.did} onChange={did => patch({ did })} placeholder="Gym, office, 45 min IELTS, dinner with family…" voice/>
    </Section>
    <Section icon="🌞" title="Good things" color={C.green}>
      <Lines items={d.positives} onChange={positives => patch({ positives })} placeholder="Something that went well" max={10}/>
    </Section>
    <Section icon="🌧" title="Hard things" color={C.amber}>
      <Lines items={d.negatives} onChange={negatives => patch({ negatives })} placeholder="Something that was difficult" max={10}/>
      <Muted small>Writing it down is enough. No judging.</Muted>
    </Section>
    <Section icon="🙏" title="Grateful for" color="#c59bff">
      <Lines items={d.gratitude} onChange={gratitude => patch({ gratitude })} placeholder={`Thing ${d.gratitude.length + 1} of 3`} max={5}/>
    </Section>
    <Section icon="💡" title="Lesson for tomorrow" color="#f2b768">
      <TextArea value={d.lesson} onChange={lesson => patch({ lesson })} placeholder="One thing to keep or change" small/>
    </Section>
    <Section icon="🗒" title="Free notes" color={C.muted}>
      <View style={s.prompts}>{(v.prompts as string[]).map(p => <TouchableOpacity key={p} style={s.prompt} onPress={() => patch({ notes: `${d.notes ? `${d.notes}\n\n` : ""}${p}\n` })}>
        <Text style={s.promptText}>＋ {p}</Text></TouchableOpacity>)}</View>
      <TextArea value={d.notes} onChange={notes => patch({ notes })} placeholder="Anything on your mind…" voice tall/>
    </Section>

    <View style={s.saveRow}>
      <Btn title={busy === "save" ? "Saving…" : dirty ? "Save page" : "Saved ✓"} busy={busy === "save"} disabled={!dirty} onPress={() => void save()} style={{ flex: 2 }}/>
      <Btn kind="outline" title={busy === "reflect" ? "Thinking…" : "✨ Reflect"} busy={busy === "reflect"} onPress={() => void reflect()} style={{ flex: 1 }}/>
    </View>
    {!!d.ai_reflection && <View style={s.reflection}><Text style={s.kicker}>✨ REFLECTION</Text><Text style={s.body}>{d.ai_reflection}</Text></View>}

    {(v.on_this_day as Row[]).length > 0 && <View style={s.card}>
      <Text style={s.section}>🕰 On this day</Text>
      {(v.on_this_day as Row[]).map(o => <TouchableOpacity key={o.label} onPress={() => go(String(o.date))}>
        <Text style={s.body}><Text style={{ fontWeight: "800" }}>{o.label} {o.mood_icon || ""}</Text>  {o.line}</Text></TouchableOpacity>)}
    </View>}

    <View style={s.card}>
      <Text style={s.section}>Moods this month</Text>
      <Bars data={MOODS.map(([n, face]) => ({ label: face, value: Object.values(month.moods as Record<string, number>).filter(x => x === n).length, color: [C.red, C.amber, C.muted, C.blue, C.green][n - 1] }))} height={90}/>
    </View>

    <View style={s.card}>
      <Text style={s.section}>Mood calendar</Text>
      <View style={s.cal}>{[...Array((month.first_weekday as number) - 1).fill(null), ...Array.from({ length: month.days as number }, (_, i) => i + 1)].map((n, i) => {
        if (n == null) return <View key={`e${i}`} style={s.calCell}/>;
        const key = `${String(month.first).slice(0, 8)}${String(n).padStart(2, "0")}`;
        const mood = month.moods[key];
        const written = (month.written as string[]).includes(key);
        return <TouchableOpacity key={key} style={s.calCell} onPress={() => go(key)}>
          <View style={[s.calDay, mood ? { backgroundColor: MOOD_BG[mood] } : written ? { backgroundColor: C.panel2 } : null, key === day && { borderColor: C.green, borderWidth: 1 }]}>
            <Text style={s.calNum}>{mood ? MOODS[mood - 1][1] : n}</Text></View></TouchableOpacity>;
      })}</View>
    </View>

    {!!v.entry && <Btn kind="danger" title="Delete this page" onPress={remove}/>}
    <Muted small>Your journal is private. Nothing is sent to the AI unless you tap Reflect, and it never goes into memory automatically.</Muted>
  </Screen>;
}

function Section({ icon, title, color, children }: { icon: string; title: string; color: string; children: React.ReactNode }) {
  return <View style={[s.card, { borderLeftColor: color, borderLeftWidth: 4 }]}>
    <Line><Text style={{ fontSize: 18 }}>{icon}</Text><Text style={s.section}>{title}</Text></Line>
    {children}
  </View>;
}

function TextArea({ value, onChange, placeholder, voice, small, tall }: { value: string; onChange: (v: string) => void; placeholder: string; voice?: boolean; small?: boolean; tall?: boolean }) {
  return <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
    <TextInput style={[s.input, { flex: 1, minHeight: tall ? 130 : small ? 48 : 80 }]} multiline value={value || ""} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.muted} textAlignVertical="top"/>
    {voice && <MicButton onText={t => onChange(appendSpeech(value || "", t))}/>}
  </View>;
}

function Lines({ items, onChange, placeholder, max }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; max: number }) {
  const [text, setText] = useState("");
  const add = () => { if (text.trim() && items.length < max) { onChange([...items, text.trim()]); setText(""); } };
  return <View style={{ gap: 6 }}>
    {items.map((t, i) => <View key={i} style={s.lineRow}><Text style={[s.body, { flex: 1 }]}>• {t}</Text>
      <TouchableOpacity hitSlop={8} onPress={() => onChange(items.filter((_, j) => j !== i))}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></View>)}
    {items.length < max && <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={C.muted} onSubmitEditing={add} returnKeyType="done" maxLength={300}/>
      <TouchableOpacity style={s.add} onPress={add}><Text style={s.addText}>＋</Text></TouchableOpacity>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  hero: { backgroundColor: soft(C.blue), borderColor: "#2a3d52", borderWidth: 1, borderRadius: 20, padding: 16, gap: 12 },
  kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: "800" },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: "900", marginTop: 2 },
  stat: { alignItems: "center", minWidth: 52 },
  statValue: { color: C.text, fontSize: 17, fontWeight: "900" },
  statLabel: { color: C.muted, fontSize: 9 },
  nav: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  navText: { color: C.text, fontSize: 22 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 14, gap: 10 },
  section: { color: C.text, fontSize: 15, fontWeight: "800" },
  moods: { flexDirection: "row", gap: 6 },
  mood: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: C.line, gap: 2 },
  moodLabel: { color: C.muted, fontSize: 10, fontWeight: "700" },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, lineHeight: 20 },
  lineRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: C.panel2, borderRadius: 10, padding: 9 },
  add: { width: 44, borderRadius: 12, backgroundColor: C.greenSoft, borderColor: C.green, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addText: { color: C.green, fontSize: 20, fontWeight: "900" },
  body: { color: C.text2, fontSize: 14, lineHeight: 21 },
  prompts: { gap: 6 },
  prompt: { borderColor: C.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 10, padding: 8 },
  promptText: { color: C.text2, fontSize: 13 },
  saveRow: { flexDirection: "row", gap: 8 },
  reflection: { backgroundColor: soft("#7c4dff"), borderColor: "#5b4380", borderWidth: 1, borderRadius: 18, padding: 14, gap: 6 },
  cal: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  calDay: { flex: 1, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  calNum: { color: C.text, fontSize: 12, fontWeight: "700" },
});
