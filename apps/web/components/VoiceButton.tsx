"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Free speech-to-text with the browser's built-in Web Speech API (Chrome, Edge, Safari). No AI key, no cost.
 * Note: Chrome sends the audio to Google's speech service to recognise it; nothing is stored by Sakuna except the text you keep.
 * The button hides itself in browsers without support (e.g. Firefox).
 */
export const VOICE_LANGS = [
  { code: "en-US", label: "English" },
  { code: "si-LK", label: "සිංහල (Sinhala)" },
  { code: "de-DE", label: "Deutsch (German)" },
  { code: "ta-LK", label: "தமிழ் (Tamil)" },
];
const LANG_KEY = "sakuna-voice-lang";

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function getVoiceLang() {
  try { return localStorage.getItem(LANG_KEY) || "en-US"; } catch { return "en-US"; }
}
export function setVoiceLang(code: string) {
  try { localStorage.setItem(LANG_KEY, code); } catch { /* per-browser convenience only */ }
}

/** Joins dictated text onto what is already typed. */
export function appendSpeech(current: string, spoken: string) {
  const text = spoken.trim();
  if (!text) return current;
  return current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text.charAt(0).toUpperCase() + text.slice(1);
}

let active: Recognition | null = null; // one microphone session at a time across the page

export function VoiceButton({ onText, onError, className = "" }: { onText: (text: string) => void; onError?: (message: string) => void; className?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const latest = useRef(onText);
  latest.current = onText;
  useEffect(() => { setSupported(!!recognitionClass()); return () => rec.current?.abort(); }, []);
  if (!supported) return null;

  function toggle() {
    if (listening) { rec.current?.stop(); return; }
    const Klass = recognitionClass();
    if (!Klass) return;
    active?.abort();
    const r = new Klass();
    r.lang = getVoiceLang(); r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    r.onresult = event => {
      let partial = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) latest.current(result[0].transcript);
        else partial += result[0].transcript;
      }
      setInterim(partial);
    };
    r.onerror = event => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      const message = event.error === "not-allowed" ? "Microphone access is blocked. Allow it in the browser's site settings."
        : event.error === "language-not-supported" ? "This browser can't recognise the chosen voice language. Pick another in Settings."
        : event.error === "network" ? "Voice input needs an internet connection in this browser." : `Voice input error: ${event.error}`;
      if (onError) onError(message); else window.alert(message);
    };
    r.onend = () => { setListening(false); setInterim(""); if (active === r) active = null; };
    rec.current = r; active = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  }

  const lang = VOICE_LANGS.find(l => l.code === (typeof window === "undefined" ? "en-US" : getVoiceLang()))?.label || "English";
  return <span className={`voice-wrap ${className}`}>
    <button type="button" className={`voice-btn${listening ? " listening" : ""}`} onClick={toggle}
      aria-label={listening ? "Stop voice input" : `Speak instead of typing (${lang})`} title={listening ? "Stop" : `Speak (${lang}) · change language in Settings`}>
      {listening ? <span className="voice-stop"/> : <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>}
    </button>
    {listening && <span className="voice-interim" aria-live="polite">{interim || "Listening…"}</span>}
  </span>;
}

/** Settings control: which language the mic listens for. */
export function VoiceLanguageSelect() {
  const [value, setValue] = useState("en-US");
  const [supported, setSupported] = useState(true);
  useEffect(() => { setValue(getVoiceLang()); setSupported(!!recognitionClass()); }, []);
  return <label className="voice-setting"><span>Voice input language</span>
    <select value={value} onChange={e => { setValue(e.target.value); setVoiceLang(e.target.value); }}>
      {VOICE_LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
    <small className="muted">{supported ? "Tap the mic next to any text box to speak. Free, uses your browser's speech recognition." : "This browser has no built-in speech recognition. Use Chrome or Edge, or the phone app."}</small>
  </label>;
}
