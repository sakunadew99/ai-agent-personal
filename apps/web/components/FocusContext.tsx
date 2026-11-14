"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiRequest, ApiError, patchJson, postJson, type JsonRecord } from "@/lib/api";

/**
 * Local-first focus timer (guide §18): the end time lives in the browser, so the countdown survives reloads
 * and network drops. The server session is opened on start and closed with an outcome on finish.
 */
export type Outcome = "done" | "drifted" | "abandoned";
type Phase = "focus" | "ended" | "break";
type FocusState = {
  sessionId: string; phase: Phase; minutes: number; breakMinutes: number;
  startedAt: number; endsAt: number; breakEndsAt?: number; taskTitle?: string;
};
type FocusApi = {
  state: FocusState | null; remaining: number; busy: boolean; error: string;
  start: (opts: { minutes: number; breakMinutes: number; taskId?: string; taskTitle?: string }) => Promise<void>;
  finish: (outcome: Outcome, note?: string) => Promise<void>;
  extend: (minutes: number) => void;
  skipBreak: () => void;
  version: number; // bumps after every server write so pages can refetch history
};

const KEY = "sakuna-focus";
const Ctx = createContext<FocusApi | null>(null);

function load(): FocusState | null {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) as FocusState : null; } catch { return null; }
}
function save(state: FocusState | null) {
  try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}
function chime() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [660, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.frequency.value = freq; osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.5);
      osc.connect(gain).connect(ctx.destination); osc.start(ctx.currentTime + i * 0.18); osc.stop(ctx.currentTime + i * 0.18 + 0.55);
    });
  } catch { /* audio not available */ }
}
function notify(title: string, body: string) {
  chime();
  try { if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, tag: "sakuna-focus" }); } catch { /* ignore */ }
}

export function FocusProvider({ token, children, onChange }: { token: string; children: ReactNode; onChange?: () => void }) {
  const [state, setState] = useState<FocusState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const firedFor = useRef<string>("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => { setState(load()); }, []);
  useEffect(() => { if (version > 0) onChangeRef.current?.(); }, [version]);
  useEffect(() => { save(state); }, [state]);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id); }, []);

  const target = state?.phase === "break" ? state.breakEndsAt ?? now : state?.phase === "focus" ? state.endsAt : now;
  const remaining = state ? Math.max(0, Math.round((target - now) / 1000)) : 0;

  // Phase transitions when the countdown reaches zero (fires once per phase).
  useEffect(() => {
    if (!state || remaining > 0) return;
    const key = `${state.sessionId}:${state.phase}:${state.phase === "break" ? state.breakEndsAt : state.endsAt}`;
    if (firedFor.current === key) return;
    firedFor.current = key;
    if (state.phase === "focus") {
      notify("Focus block finished", `${state.taskTitle || "Your session"}: done, drifted, or need more time?`);
      setState({ ...state, phase: "ended" });
    } else if (state.phase === "break") {
      notify("Break is over", "Ready for the next block?");
      setState(null);
    }
  }, [remaining, state]);

  // Tab title shows the countdown so it is visible from other tabs.
  useEffect(() => {
    const base = "Sakuna AI";
    if (!state || state.phase === "ended") { document.title = state ? "⏰ Focus done · Sakuna" : base; return; }
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0"); const ss = String(remaining % 60).padStart(2, "0");
    document.title = `${state.phase === "break" ? "☕" : "◷"} ${mm}:${ss} · ${base}`;
  }, [remaining, state]);

  const start = useCallback(async ({ minutes, breakMinutes, taskId, taskTitle }: { minutes: number; breakMinutes: number; taskId?: string; taskTitle?: string }) => {
    setBusy(true); setError("");
    try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* ignore */ }
    try {
      let row: JsonRecord;
      try {
        row = await apiRequest("/focus/sessions", token, postJson({ minutes, mode: minutes <= 30 ? "pomodoro" : "focus", ...(taskId ? { task_id: taskId } : {}) }));
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 409) throw reason;
        // A session is already open (another tab/device): adopt it instead of failing.
        const sessions = await apiRequest<JsonRecord[]>("/focus/sessions", token);
        const active = sessions.find(item => !item.ended_at);
        if (!active) throw reason;
        row = active;
      }
      const startedAt = new Date(String(row.started_at)).getTime() || Date.now();
      const planned = Number(row.minutes_planned || minutes);
      setState({ sessionId: String(row.id), phase: "focus", minutes: planned, breakMinutes, startedAt, endsAt: startedAt + planned * 60000, taskTitle });
      setVersion(v => v + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the session");
    } finally { setBusy(false); }
  }, [token]);

  const finish = useCallback(async (outcome: Outcome, note?: string) => {
    if (!state) return;
    setBusy(true); setError("");
    try {
      await apiRequest(`/focus/sessions/${state.sessionId}/finish`, token,
        patchJson({ distractions: outcome === "drifted" ? 1 : 0, notes: `outcome: ${outcome}${note ? ` · ${note}` : ""}` }));
    } catch (reason) {
      // 409 = already finished elsewhere; treat as done locally. Anything else is shown.
      if (!(reason instanceof ApiError) || reason.status !== 409) { setError(reason instanceof Error ? reason.message : "Could not save the session"); setBusy(false); return; }
    }
    setVersion(v => v + 1);
    setBusy(false);
    if (outcome === "abandoned" || state.breakMinutes <= 0) { setState(null); return; }
    setState({ ...state, phase: "break", breakEndsAt: Date.now() + state.breakMinutes * 60000 });
  }, [state, token]);

  const extend = useCallback((minutes: number) => {
    setState(current => current ? { ...current, phase: "focus", endsAt: Math.max(Date.now(), current.phase === "focus" ? current.endsAt : Date.now()) + minutes * 60000 } : current);
  }, []);
  const skipBreak = useCallback(() => setState(null), []);

  return <Ctx.Provider value={{ state, remaining, busy, error, start, finish, extend, skipBreak, version }}>{children}</Ctx.Provider>;
}

export function useFocus() {
  const value = useContext(Ctx);
  if (!value) throw new Error("useFocus must be used inside FocusProvider");
  return value;
}

export function formatClock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
