import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Segments } from "../charts";
import { C, Card, Empty, Kicker, Muted, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");

/** "Say it" drill: read a sentence aloud; the phone's recogniser hears you and each word turns green or red. */
export function DrillScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [lang, setLang] = useState<"de" | "en">("de");
  const [phrases, setPhrases] = useState<Row[] | null>(null);
  const [i, setI] = useState(0);
  const [rec, setRec] = useState(false);
  const [heard, setHeard] = useState("");
  const [res, setRes] = useState<Row | null>(null);
  const [streak, setStreak] = useState(0);
  const mine = useRef(false); const started = useRef(0); const text = useRef("");
  const load = useCallback(() => { api<Row>(`/speaking/drill?lang=${lang}`).then(x => { setPhrases(x.phrases); setI(0); setRes(null); setHeard(""); }).catch(e => onError(msg(e))); }, [api, lang, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (mine.current) ExpoSpeechRecognitionModule.abort(); }, []);
  useSpeechRecognitionEvent("result", e => { if (!mine.current) return; text.current = e.results?.[0]?.transcript || ""; setHeard(text.current); });
  useSpeechRecognitionEvent("end", () => {
    if (!mine.current) return;
    mine.current = false; setRec(false);
    const p = phrases?.[i]; if (!p) return;
    void api<Row>("/speaking/drill", "POST", { target: p.text, heard: text.current, lang, seconds: Math.round((Date.now() - started.current) / 1000) })
      .then(r => { setRes(r); setStreak(s => (r.accuracy >= 80 ? s + 1 : 0)); }).catch(e => onError(msg(e)));
  });
  useSpeechRecognitionEvent("error", e => { if (mine.current && e.error !== "no-speech") onError(`Mic: ${e.message || e.error}`); });
  async function say() {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) { onError("Microphone permission is needed."); return; }
    text.current = ""; setHeard(""); setRes(null); mine.current = true; started.current = Date.now(); setRec(true);
    ExpoSpeechRecognitionModule.start({ lang: lang === "de" ? "de-DE" : "en-US", interimResults: true, continuous: false, maxAlternatives: 1 });
  }
  if (!phrases) return <Screen><Empty>Loading sentences…</Empty></Screen>;
  const p = phrases[i];
  const next = () => { setI(n => (n + 1) % phrases.length); setRes(null); setHeard(""); };
  return <Screen>
    <Segments options={["de", "en"] as const} value={lang} onChange={setLang} labels={{ de: "🇩🇪 Deutsch", en: "🇬🇧 English" }}/>
    <Card accent>
      <Kicker>{`SAY THIS · ${i + 1}/${phrases.length}${p?.from === "your cards" ? " · FROM YOUR CARDS" : ""}${streak >= 2 ? ` · 🔥 ${streak}` : ""}`}</Kicker>
      {p && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(res ? res.words as Row[] : p.text.split(" ").map((w: string) => ({ word: w, ok: null }))).map((w: Row, k: number) =>
        <Text key={k} style={{ fontSize: 26, fontWeight: "900", color: w.ok === null ? C.text : w.ok ? C.green : C.red, textDecorationLine: w.ok === false ? "underline" : "none" }}>{w.word}</Text>)}</View>}
      <Muted>{p?.meaning}</Muted>
    </Card>
    <View style={{ alignItems: "center", gap: 10 }}>
      <TouchableOpacity onPress={() => (rec ? ExpoSpeechRecognitionModule.stop() : void say())} accessibilityLabel={rec ? "Stop" : "Say it"}
        style={{ width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center", backgroundColor: rec ? C.red : C.green, borderWidth: 6, borderColor: rec ? "#ff7a8a55" : "#3ee08f44" }}>
        <Text style={{ fontSize: 42 }}>{rec ? "■" : "🎙"}</Text></TouchableOpacity>
      <Text style={{ color: C.muted }}>{rec ? "Listening… say the sentence" : "Tap and say it clearly"}</Text>
      {!!heard && <Text style={{ color: C.muted, textAlign: "center" }}>{`Heard: “${heard}”`}</Text>}
    </View>
    {res && <Card>
      <Text style={{ color: res.accuracy >= 80 ? C.green : res.accuracy >= 50 ? C.amber : C.red, fontSize: 40, fontWeight: "900", textAlign: "center" }}>{`${res.accuracy}%`}</Text>
      <Text style={{ color: C.text, textAlign: "center" }}>{res.tip}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TouchableOpacity onPress={() => void say()} style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line }}><Text style={{ color: C.text, fontWeight: "800" }}>↻ Try again</Text></TouchableOpacity>
        <TouchableOpacity onPress={next} style={{ flex: 1, alignItems: "center", padding: 12, borderRadius: 14, backgroundColor: C.green }}><Text style={{ color: C.greenDark, fontWeight: "900" }}>Next ›</Text></TouchableOpacity></View>
    </Card>}
    {!res && <TouchableOpacity onPress={next}><Text style={{ color: C.muted, textAlign: "center" }}>Skip ›</Text></TouchableOpacity>}
    <Muted small>Uses your phone's own speech recogniser (German needs the Google German voice pack: Settings → Google → Voice). Your German flashcards come first.</Muted>
  </Screen>;
}
