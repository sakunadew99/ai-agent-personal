import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Bars, Hero, Ring, Segments } from "../charts";
import { Badge, Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Upload = (path: string, file: { uri: string; name: string; type?: string | null }, fields?: Record<string, string>) => Promise<Row>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const tone = (s: number) => (s >= 75 ? C.green : s >= 50 ? C.amber : C.red);

/** Speaking coach: talk for 1–2 minutes on a topic; pace, filler words, variety and tips (+ Whisper and AI feedback when on). */
export function SpeakingScreen({ api, upload, onError, onNotice }: { api: Api; upload: Upload; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [lang, setLang] = useState<"en" | "de">("en");
  const [topic, setTopic] = useState("");
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [live, setLive] = useState("");
  const [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const finals = useRef<string[]>([]); const interim = useRef(""); const started = useRef(0);
  const audio = useRef<string | null>(null); const stopping = useRef(false); const recording = useRef(false); const broken = useRef(false);
  const load = useCallback(() => { api<Row>("/speaking").then(x => { setV(x); setTopic(t => t || (x.prompts?.en || [])[0] || ""); }).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs(Math.round((Date.now() - started.current) / 1000)), 500); return () => clearInterval(t); }, [rec]);
  useEffect(() => () => { if (recording.current) ExpoSpeechRecognitionModule.abort(); }, []);

  const begin = (persist: boolean) => ExpoSpeechRecognitionModule.start({ lang: lang === "de" ? "de-DE" : "en-US", interimResults: true, continuous: true, addsPunctuation: true,
    maxAlternatives: 1, ...(persist ? { recordingOptions: { persist: true } } : {}) });

  useSpeechRecognitionEvent("result", e => {
    if (!recording.current) return;
    const t = e.results?.[0]?.transcript || "";
    if (e.isFinal) { if (t.trim()) finals.current.push(t.trim()); interim.current = ""; } else interim.current = t;
    setLive([...finals.current, interim.current].join(" ").slice(-400));
  });
  useSpeechRecognitionEvent("audioend", e => { if (recording.current && e.uri) audio.current = e.uri; });
  useSpeechRecognitionEvent("error", e => { if (recording.current && e.error !== "no-speech") onError(`Mic: ${e.message || e.error}`); });
  useSpeechRecognitionEvent("end", () => {
    if (!recording.current) return;
    if (!stopping.current) { broken.current = true; try { begin(false); } catch { /* finish below */ } return; }   // older Android stops on silence: keep listening
    recording.current = false; setRec(false);
    setTimeout(() => void submit(), 300);
  });

  async function start() {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { onError("Microphone permission is needed for the speaking coach."); return; }
    finals.current = []; interim.current = ""; audio.current = null; stopping.current = false; broken.current = false;
    setLive(""); setResult(null); setSecs(0); started.current = Date.now(); recording.current = true; setRec(true);
    try { begin(!!v?.whisper_available); } catch (e) { recording.current = false; setRec(false); onError(msg(e)); }
  }
  function stop() { stopping.current = true; ExpoSpeechRecognitionModule.stop(); }

  async function submit() {
    const seconds = Math.max(5, Math.round((Date.now() - started.current) / 1000));
    const transcript = [...finals.current, interim.current].join(" ").trim();
    setBusy(true);
    try {
      const out = audio.current && v?.whisper_available && !broken.current
        ? await upload("/speaking/audio", { uri: audio.current, name: "talk.wav", type: "audio/wav" }, { seconds: String(seconds), lang, topic, fallback: transcript })
        : await api<Row>("/speaking/sessions", "POST", { transcript, seconds, lang, topic: topic || undefined });
      setResult(out); load();
    } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }

  if (!v) return <Screen><Empty>Loading your speaking coach…</Empty></Screen>;
  const prompts: string[] = v.prompts?.[lang] || [];
  const d: Row = result?.details || {};
  const trend: Row[] = v.trend || [];
  return <Screen onRefresh={load}>
    <Hero kicker="SPEAKING COACH · ENGLISH & DEUTSCH" title="Speak with" accent="confidence" color="#b48cff"
      sub={`${v.this_week} talks this week${v.best_score != null ? ` · best ${v.best_score}/100` : ""}${v.whisper_available ? " · Whisper on" : ""}`}
      right={<Ring value={result ? result.score : Number(v.best_score || 0)} size={90} color={tone(result ? result.score : Number(v.best_score || 0))} label={`${result ? result.score : v.best_score ?? "—"}`} sub={result ? "THIS TALK" : "BEST"}/>}/>

    <Card>
      <Segments options={["en", "de"] as const} value={lang} onChange={l => { setLang(l); setTopic((v.prompts?.[l] || [])[0] || ""); }} labels={{ en: "🇬🇧 English", de: "🇩🇪 Deutsch" }}/>
      <Kicker>PICK A TOPIC</Kicker>
      {prompts.map(p => <TouchableOpacity key={p} onPress={() => setTopic(p)} style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: topic === p ? "#b48cff" : C.line, backgroundColor: topic === p ? "#b48cff22" : "transparent" }}>
        <Text style={{ color: C.text }}>{p}</Text></TouchableOpacity>)}
    </Card>

    <View style={{ alignItems: "center", gap: 10, paddingVertical: 6 }}>
      <TouchableOpacity onPress={() => (rec ? stop() : void start())} disabled={busy} accessibilityLabel={rec ? "Stop" : "Start talking"}
        style={{ width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center", backgroundColor: rec ? C.red : "#b48cff", borderWidth: 6, borderColor: rec ? "#ff7a8a55" : "#b48cff44" }}>
        <Text style={{ fontSize: 44 }}>{rec ? "■" : "🎙"}</Text></TouchableOpacity>
      <Text style={{ color: C.text, fontSize: 28, fontWeight: "900", fontVariant: ["tabular-nums"] }}>{rec ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : busy ? "Scoring…" : "Tap and talk"}</Text>
      <Muted small>{rec ? "Speak naturally for 1–2 minutes, then tap ■" : "Aim for 1–2 minutes. Your words stay private."}</Muted>
      {!!live && <Text style={{ color: C.muted, textAlign: "center", paddingHorizontal: 10 }}>{live}</Text>}
    </View>

    {result && <Card accent>
      <Line><Kicker>THIS TALK</Kicker><View style={{ flex: 1 }}/><Badge tone={result.source === "whisper" ? "green" : "muted"}>{result.source === "whisper" ? "Whisper transcript" : "Phone transcript"}</Badge></Line>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[["Pace", `${result.wpm}`, "words/min", d.pace_range && result.wpm >= d.pace_range[0] && result.wpm <= d.pace_range[1] ? C.green : C.amber],
          ["Fillers", `${result.fillers}`, "um, like…", result.fillers ? C.amber : C.green],
          ["Variety", `${d.variety_pct ?? 0}%`, "different words", (d.variety_pct ?? 0) >= 45 ? C.green : C.amber]].map(([l, val, h, c]) =>
          <View key={String(l)} style={{ flex: 1, backgroundColor: C.panel2, borderRadius: 14, padding: 10 }}>
            <Text style={{ color: C.muted, fontSize: 11 }}>{l}</Text><Text style={{ color: String(c), fontSize: 22, fontWeight: "900" }}>{val}</Text><Text style={{ color: C.muted, fontSize: 10 }}>{h}</Text></View>)}
      </View>
      {(d.tips as string[] || []).map((t, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${t}`}</Text>)}
      {result.feedback ? <View style={{ backgroundColor: "#b48cff18", borderRadius: 12, padding: 10 }}><Text style={{ color: C.text, lineHeight: 20 }}>{result.feedback}</Text></View>
        : v.ai_available && <Btn kind="outline" title="✨ AI coach feedback" busy={busy} onPress={() => { setBusy(true); api<Row>(`/speaking/${result.id}/feedback`, "POST").then(setResult).catch(e => onError(msg(e))).finally(() => setBusy(false)); }}/>}
      <Muted small>{`“${result.transcript.slice(0, 600)}${result.transcript.length > 600 ? "…" : ""}”`}</Muted>
    </Card>}

    {trend.length > 1 && <Card><Kicker>YOUR PROGRESS · SCORE PER TALK</Kicker>
      <Bars data={trend.map((t, i) => ({ label: String(i + 1), value: Number(t.score), color: tone(Number(t.score)), highlight: i === trend.length - 1 }))} height={100}/></Card>}

    {(v.sessions as Row[]).slice(0, 8).map(s => <TouchableOpacity key={s.id} onPress={() => setResult(s)} onLongPress={() => Alert.alert("Delete this talk?", s.topic || "", [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/speaking/${s.id}`, "DELETE").then(() => { onNotice("Deleted"); load(); }).catch(e => onError(msg(e))) }])}>
      <Card style={{ padding: 12 }}><Line><Text style={{ color: tone(s.score), fontSize: 20, fontWeight: "900", width: 44 }}>{s.score}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }} numberOfLines={1}>{`${s.lang === "de" ? "🇩🇪" : "🇬🇧"} ${s.topic || "Free talk"}`}</Text>
          <Muted small>{`${new Date(s.created_at).toLocaleDateString()} · ${s.wpm} wpm · ${s.fillers} fillers · ${Math.round(s.seconds)} s`}</Muted></View></Line></Card>
    </TouchableOpacity>)}
    <Muted small>{v.how}</Muted>
  </Screen>;
}
