import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, KeyboardAvoidingView, Modal, ScrollView, Text, TextInput, TouchableOpacity, Vibration, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Bars, Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const NOTE_BG: Record<string, string> = { default: "#141d19", green: "#123222", blue: "#13243a", amber: "#3a2f1d", red: "#3a2222", violet: "#261d3a", pink: "#3a1d2f", teal: "#123333" };
const NOTE_DOT: Record<string, string> = { default: "#8a9b92", green: "#3ee08f", blue: "#5aa8ff", amber: "#f5b65b", red: "#ff7a8a", violet: "#b48cff", pink: "#ff9ecf", teal: "#4fd1c5" };

// ------------------------------------------------------------------ notes

function NoteEditor({ api, note, onClose, onSaved, onError }: { api: Api; note: Row | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [title, setTitle] = useState<string>(note?.title || ""); const [body, setBody] = useState<string>(note?.body || "");
  const [tags, setTags] = useState((note?.tags || []).join(", ")); const [color, setColor] = useState(note?.color || "default"); const [pinned, setPinned] = useState(!!note?.pinned);
  const save = () => {
    const payload = { title, body, tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean), color, pinned };
    if (!title.trim() && !body.trim()) { onClose(); return; }
    void (note ? api(`/notes/${note.id}`, "PATCH", payload) : api("/notes", "POST", payload)).then(onSaved).catch(e => onError(msg(e)));
  };
  return <Modal visible animationType="slide" onRequestClose={save}><KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: NOTE_BG[color] }}>
    <View style={{ flexDirection: "row", alignItems: "center", padding: 14, paddingTop: 44, gap: 10 }}>
      <TouchableOpacity onPress={save}><Text style={{ color: C.text, fontSize: 16, fontWeight: "800" }}>‹ Save</Text></TouchableOpacity><View style={{ flex: 1 }}/>
      <TouchableOpacity onPress={() => setPinned(p => !p)}><Text style={{ fontSize: 20, opacity: pinned ? 1 : 0.4 }}>📌</Text></TouchableOpacity>
      {note && <TouchableOpacity onPress={() => Alert.alert("Delete this note?", note.title || "", [{ text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void api(`/notes/${note.id}`, "DELETE").then(onSaved).catch(e => onError(msg(e))) }])}><Text style={{ fontSize: 20 }}>🗑</Text></TouchableOpacity>}
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <TextInput value={title} onChangeText={setTitle} placeholder="Title" placeholderTextColor={C.muted} style={{ color: C.text, fontSize: 24, fontWeight: "900" }}/>
      <Field voice value={body} onChangeText={setBody} placeholder="Write, or tap the mic… Use “- [ ] ” for checklist items." multiline style={{ minHeight: 260, backgroundColor: "transparent", borderWidth: 0, fontSize: 16 }}/>
      <Line><Btn kind="outline" title="＋ Checklist item" onPress={() => setBody(b => `${b}${b && !b.endsWith("\n") ? "\n" : ""}- [ ] `)} style={{ flex: 1 }}/></Line>
      <TextInput value={tags} onChangeText={setTags} placeholder="Tags, separated by commas" placeholderTextColor={C.muted} autoCapitalize="none"
        style={{ color: C.text, backgroundColor: "#0006", borderRadius: 12, padding: 10 }}/>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>{Object.keys(NOTE_DOT).map(c => <TouchableOpacity key={c} onPress={() => setColor(c)}
        style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: NOTE_DOT[c], borderWidth: color === c ? 3 : 0, borderColor: "#fff" }}/>)}</View>
    </ScrollView>
  </KeyboardAvoidingView></Modal>;
}

/** Notes: a notebook with checklists, tags, colours, pins, voice typing and search. */
export function NotesScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [q, setQ] = useState(""); const [tag, setTag] = useState("");
  const [edit, setEdit] = useState<Row | null | "new">(null);
  const load = useCallback(() => { const p = [q && `q=${encodeURIComponent(q)}`, tag && `tag=${encodeURIComponent(tag)}`].filter(Boolean).join("&");
    api<Row>(`/notes${p ? `?${p}` : ""}`).then(setV).catch(e => onError(msg(e))); }, [api, q, tag, onError]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  if (!v) return <Screen><Empty>Loading your notes…</Empty></Screen>;
  const items: Row[] = v.items;
  const col = (k: number) => items.filter((_, i) => i % 2 === k);
  const toggle = (n: Row, line: number) => void api<Row>(`/notes/${n.id}/toggle/${line}`, "POST").then(load).catch(e => onError(msg(e)));
  const card = (n: Row) => <TouchableOpacity key={n.id} activeOpacity={0.85} onPress={() => setEdit(n)}
    style={{ backgroundColor: NOTE_BG[n.color] || NOTE_BG.default, borderRadius: 18, padding: 12, gap: 6, borderWidth: 1, borderColor: `${NOTE_DOT[n.color] || C.line}44` }}>
    <Line>{!!n.title && <Text style={{ color: C.text, fontWeight: "900", flex: 1 }} numberOfLines={2}>{n.title}</Text>}{n.pinned && <Text>📌</Text>}</Line>
    {(n.body as string).split("\n").slice(0, 8).map((ln, i) => { const t = ln.trimStart(); const box = t.startsWith("- [ ]") || t.toLowerCase().startsWith("- [x]");
      return box ? <TouchableOpacity key={i} onPress={() => toggle(n, i)} style={{ flexDirection: "row", gap: 6 }}>
        <Text style={{ color: NOTE_DOT[n.color] || C.green }}>{t[3].toLowerCase() === "x" ? "☑" : "☐"}</Text>
        <Text style={{ color: t[3].toLowerCase() === "x" ? C.muted : C.text, textDecorationLine: t[3].toLowerCase() === "x" ? "line-through" : "none", flex: 1 }}>{t.slice(5).trim()}</Text></TouchableOpacity>
        : ln.trim() ? <Text key={i} style={{ color: C.text, opacity: 0.85 }} numberOfLines={3}>{ln}</Text> : null; })}
    {n.checklist && <Muted small>{`${n.checklist.done}/${n.checklist.total} done`}</Muted>}
    {(n.tags as string[]).length > 0 && <Text style={{ color: C.muted, fontSize: 11 }}>{(n.tags as string[]).map(t => `#${t}`).join(" ")}</Text>}
  </TouchableOpacity>;
  return <View style={{ flex: 1 }}>
    <Screen onRefresh={load}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.panel2, borderRadius: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: C.line }}>
        <Text>🔍</Text><TextInput value={q} onChangeText={setQ} placeholder="Search notes" placeholderTextColor={C.muted} style={{ flex: 1, color: C.text, paddingVertical: 11 }}/></View>
      {(v.tags as string[]).length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {["", ...(v.tags as string[])].map(t => <TouchableOpacity key={t || "all"} onPress={() => setTag(t)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1,
          borderColor: tag === t ? C.green : C.line, backgroundColor: tag === t ? C.greenSoft : "transparent" }}><Text style={{ color: tag === t ? C.green : C.muted, fontWeight: "700" }}>{t ? `#${t}` : "All"}</Text></TouchableOpacity>)}</ScrollView>}
      {items.length ? <View style={{ flexDirection: "row", gap: 10 }}>{[0, 1].map(k => <View key={k} style={{ flex: 1, gap: 10 }}>{col(k).map(card)}</View>)}</View>
        : <Empty>{q || tag ? "No notes match." : "No notes yet. Tap ＋ to write your first one."}</Empty>}
    </Screen>
    <TouchableOpacity onPress={() => setEdit("new")} style={{ position: "absolute", right: 20, bottom: 100, width: 60, height: 60, borderRadius: 30, backgroundColor: C.green,
      alignItems: "center", justifyContent: "center", elevation: 8 }}><Text style={{ fontSize: 30, color: "#04170d", fontWeight: "900" }}>＋</Text></TouchableOpacity>
    {edit && <NoteEditor api={api} note={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} onError={onError}/>}
  </View>;
}

// ------------------------------------------------------------------ pelvic floor (Kegel) trainer

type Phase = { label: string; secs: number; squeeze: boolean };

function plan(cfg: Row): Phase[] {
  const out: Phase[] = [{ label: "Get ready: relax, breathe", secs: 3, squeeze: false }];
  for (let i = 0; i < cfg.reps; i++) { out.push({ label: `Squeeze & lift · ${i + 1}/${cfg.reps}`, secs: cfg.hold_s, squeeze: true }); out.push({ label: "Relax fully", secs: cfg.relax_s, squeeze: false }); }
  for (let i = 0; i < cfg.quick_flicks; i++) { out.push({ label: `Quick squeeze · ${i + 1}/${cfg.quick_flicks}`, secs: 1, squeeze: true }); out.push({ label: "Let go", secs: 1, squeeze: false }); }
  return out;
}

function Session({ cfg, onDone, onClose }: { cfg: Row; onDone: () => void; onClose: () => void }) {
  const phases = useRef(plan(cfg)).current;
  const [i, setI] = useState(0); const [left, setLeft] = useState(phases[0].secs); const [paused, setPaused] = useState(false);
  const scale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const p = phases[i];
    if (!p) return;
    Vibration.vibrate(p.squeeze ? 60 : 25);
    Animated.timing(scale, { toValue: p.squeeze ? 1 : 0.6, duration: Math.min(1200, p.secs * 1000), easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start();
    setLeft(p.secs);
  }, [i, phases, scale]);
  useEffect(() => {
    if (paused || i >= phases.length) return;
    const t = setInterval(() => setLeft(s => { if (s > 1) return s - 1; setI(x => x + 1); return 0; }), 1000);
    return () => clearInterval(t);
  }, [paused, i, phases.length]);
  const done = i >= phases.length;
  useEffect(() => { if (done) Vibration.vibrate([0, 80, 80, 80]); }, [done]);
  const p = phases[Math.min(i, phases.length - 1)];
  return <Modal visible animationType="fade" onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}>
    {done ? <>
      <Text style={{ fontSize: 60 }}>🎉</Text><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>Set complete</Text>
      <Muted>Relax for a minute. Spread your sets across the day.</Muted>
      <Btn title="✓ Save this set" onPress={onDone} style={{ alignSelf: "stretch" }}/><Btn kind="link" title="Close without saving" onPress={onClose}/>
    </> : <>
      <Text style={{ color: p.squeeze ? C.green : C.blue, fontSize: 22, fontWeight: "900", textAlign: "center" }}>{p.label}</Text>
      <Animated.View style={{ width: 220, height: 220, borderRadius: 110, backgroundColor: p.squeeze ? "#3ee08f33" : "#5aa8ff22", borderWidth: 4, borderColor: p.squeeze ? C.green : C.blue,
        alignItems: "center", justifyContent: "center", transform: [{ scale }] }}>
        <Text style={{ color: C.text, fontSize: 64, fontWeight: "900" }}>{left}</Text></Animated.View>
      <Muted small>{p.squeeze ? "Lift inward, keep breathing, stomach and buttocks relaxed" : "Let go completely"}</Muted>
      <Line><Btn kind="outline" title={paused ? "▶ Resume" : "⏸ Pause"} onPress={() => setPaused(x => !x)} style={{ flex: 1 }}/><Btn kind="link" title="Stop" onPress={onClose}/></Line>
    </>}
  </View></Modal>;
}

/** Pelvic floor (Kegel) trainer: guided squeeze / relax timer with vibration cues, 4 gradual levels, guide and reliable links. */
export function KegelScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [guide, setGuide] = useState(false);
  const load = useCallback(() => { api<Row>("/wellness/kegel").then(x => { setV(x); setLevel(l => l ?? x.level); }).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v || level == null) return <Screen><Empty>Loading…</Empty></Screen>;
  const cfg: Row = v.levels[String(level)] || v.levels[level];
  const g: Row = v.guide;
  const save = () => { setRunning(false); void api<Row>("/wellness/kegel/sessions", "POST", { level, sets: 1 }).then(x => { setV(x); onNotice(x.today.done ? "Today's sets done 💪" : `Set saved · ${x.today.sets}/${x.today.target} today`); }).catch(e => onError(msg(e))); };
  return <Screen onRefresh={load}>
    <Hero kicker="PELVIC FLOOR · KEGEL TRAINER" title={`${v.today.sets}/${v.today.target}`} accent="sets today" color="#4fd1c5"
      sub={`Level ${level}: ${cfg.name} · hold ${cfg.hold_s}s, relax ${cfg.relax_s}s × ${cfg.reps}${cfg.quick_flicks ? ` + ${cfg.quick_flicks} quick` : ""}${v.streak ? ` · 🔥 ${v.streak} days` : ""}`}
      right={<Ring value={Math.min(100, v.today.sets / v.today.target * 100)} size={88} color="#4fd1c5" label={v.today.done ? "✓" : `${v.today.sets}`} sub="TODAY"/>}>
      <Btn title={`▶ Start a set (about ${Math.max(1, Math.round((3 + cfg.reps * (cfg.hold_s + cfg.relax_s) + cfg.quick_flicks * 2) / 60))} min)`} onPress={() => setRunning(true)}/>
    </Hero>
    {v.ready_for_next && level === v.level && <Card style={{ borderColor: C.green }}><Text style={{ color: C.green, fontWeight: "800" }}>{`⭐ ${v.good_days_7} good days this week: ready for level ${level + 1} if it feels easy.`}</Text>
      <Btn kind="outline" title={`Try level ${level + 1}`} onPress={() => setLevel(level + 1)}/></Card>}
    <Line>{[1, 2, 3, 4].map(n => <TouchableOpacity key={n} onPress={() => setLevel(n)} style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, borderWidth: 1,
      borderColor: level === n ? "#4fd1c5" : C.line, backgroundColor: level === n ? "#4fd1c522" : "transparent" }}>
      <Text style={{ color: level === n ? "#4fd1c5" : C.muted, fontWeight: "900" }}>{`L${n}`}</Text><Text style={{ color: C.muted, fontSize: 10 }}>{v.levels[String(n)]?.name || v.levels[n]?.name}</Text></TouchableOpacity>)}</Line>
    <Muted small>{cfg.goal}</Muted>
    {(v.week as Row[]).some(w => w.sets) && <Card><Kicker>SETS THIS WEEK</Kicker><Bars data={(v.week as Row[]).map(w => ({ label: w.label, value: w.sets, color: "#4fd1c5" }))} height={70} goal={3}/></Card>}
    <TouchableOpacity onPress={() => setGuide(x => !x)}><Card><Line><Kicker>HOW TO DO IT RIGHT</Kicker><View style={{ flex: 1 }}/><Text style={{ color: "#4fd1c5" }}>{guide ? "Hide" : "Show"}</Text></Line>
      {guide && <View style={{ gap: 6 }}>
        <Text style={{ color: C.text, lineHeight: 21 }}>{g.what}</Text>
        <Kicker>FIND THE RIGHT MUSCLES</Kicker>{(g.find as string[]).map((t, i) => <Text key={i} style={{ color: C.text }}>{`• ${t}`}</Text>)}
        <Kicker>HOW</Kicker>{(g.how as string[]).map((t, i) => <Text key={i} style={{ color: C.text }}>{`${i + 1}. ${t}`}</Text>)}
        <Kicker>COMMON MISTAKES</Kicker>{(g.mistakes as string[]).map((t, i) => <Text key={i} style={{ color: C.amber }}>{`✗ ${t}`}</Text>)}
        <Muted small>{g.frequency}</Muted>
      </View>}</Card></TouchableOpacity>
    <Card style={{ borderColor: C.amber }}><Kicker>⚠ SAFETY</Kicker>{(g.safety as string[]).map((t, i) => <Text key={i} style={{ color: C.text }}>{`• ${t}`}</Text>)}</Card>
    <Card><Kicker>VIDEOS & RELIABLE READING</Kicker>{(v.resources as Row[]).map(r => <TouchableOpacity key={r.url} onPress={() => openInApp(r.url, r.label, { category: "study", note: "Pelvic floor learning" })}>
      <View style={{ paddingVertical: 6 }}><Text style={{ color: "#4fd1c5", fontSize: 11, fontWeight: "800" }}>{r.kind}</Text><Text style={{ color: C.text }}>{r.label}</Text></View></TouchableOpacity>)}</Card>
    <Muted small>{v.disclaimer}</Muted>
    {running && <Session cfg={cfg} onDone={save} onClose={() => setRunning(false)}/>}
  </Screen>;
}
