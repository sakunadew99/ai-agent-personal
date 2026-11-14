/**
 * Free speech-to-text using the phone's built-in recognizer (Android SpeechRecognizer via expo-speech-recognition).
 * No AI key and no per-minute cost. Depending on the phone, recognition runs on-device or through Google's speech service.
 * Tap the mic to talk; tap again to stop. Long-press to change language.
 */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Text, TouchableOpacity } from "react-native";
import * as SecureStore from "expo-secure-store";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { C } from "./ui";

export const VOICE_LANGS = [
  { code: "en-US", label: "English" },
  { code: "si-LK", label: "සිංහල (Sinhala)" },
  { code: "de-DE", label: "Deutsch (German)" },
  { code: "ta-LK", label: "தமிழ் (Tamil)" },
] as const;
const LANG_KEY = "sakuna.voice.lang";
let currentLang = "en-US";
let activeOwner = 0; // only the button that started listening receives results
let nextId = 1;
void SecureStore.getItemAsync(LANG_KEY).then(saved => { if (saved) currentLang = saved; }).catch(() => undefined);

/** Joins dictated text onto what is already typed. */
export function appendSpeech(current: string, spoken: string) {
  const text = spoken.trim();
  if (!text) return current;
  return current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
}

function chooseLanguage() {
  Alert.alert("Voice language", "Which language will you speak?", [
    ...VOICE_LANGS.map(l => ({ text: `${l.code === currentLang ? "✓ " : ""}${l.label}`, onPress: () => { currentLang = l.code; void SecureStore.setItemAsync(LANG_KEY, l.code).catch(() => undefined); } })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

export function MicButton({ onText, onError, size = 40 }: { onText: (text: string) => void; onError?: (m: string) => void; size?: number }) {
  const id = useRef(nextId++).current;
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const mine = () => activeOwner === id;
  const report = (m: string) => (onError ? onError(m) : Alert.alert("Voice input", m));

  useSpeechRecognitionEvent("start", () => { if (mine()) { setStarting(false); setListening(true); } });
  useSpeechRecognitionEvent("end", () => { if (mine()) { setListening(false); setStarting(false); activeOwner = 0; } });
  useSpeechRecognitionEvent("result", event => {
    if (!mine() || !event.isFinal) return;
    const text = event.results[0]?.transcript;
    if (text) onText(text);
  });
  useSpeechRecognitionEvent("error", event => {
    if (!mine()) return;
    setListening(false); setStarting(false); activeOwner = 0;
    if (event.error === "no-speech" || event.error === "aborted") return;
    const hint = event.error === "language-not-supported" ? " Long-press the mic to pick another language, or install it in Google voice settings." : "";
    report(`Voice input: ${event.message || event.error}.${hint}`);
  });
  useEffect(() => () => { if (activeOwner === id) { ExpoSpeechRecognitionModule.abort(); activeOwner = 0; } }, [id]);

  async function toggle() {
    if (listening || starting) { ExpoSpeechRecognitionModule.stop(); return; }
    try {
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        report("Speech recognition isn't available on this phone. Install or enable the Google app's voice typing."); return;
      }
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) { report("Allow microphone access for Sakuna in Android settings to use voice input."); return; }
      if (activeOwner) ExpoSpeechRecognitionModule.abort();
      activeOwner = id; setStarting(true);
      ExpoSpeechRecognitionModule.start({ lang: currentLang, interimResults: false, continuous: false, addsPunctuation: true, maxAlternatives: 1 });
    } catch (reason) {
      activeOwner = 0; setStarting(false);
      report(reason instanceof Error ? reason.message : "Could not start voice input");
    }
  }

  return <TouchableOpacity onPress={() => void toggle()} onLongPress={chooseLanguage} accessibilityRole="button"
    accessibilityLabel={listening ? "Stop voice input" : "Speak instead of typing. Long-press to change language."}
    style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center",
      backgroundColor: listening ? C.red : C.greenSoft, borderWidth: 1, borderColor: listening ? C.red : C.line }}>
    {starting ? <ActivityIndicator size="small" color={C.green}/> : <Text style={{ fontSize: size * 0.45, color: listening ? "#fff" : C.green }}>{listening ? "■" : "🎙"}</Text>}
  </TouchableOpacity>;
}
