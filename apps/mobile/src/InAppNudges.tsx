import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "./api";
import { C } from "./ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const TONE: Record<string, [string, string]> = { blue: ["#1565c0", "#29b6f6"], red: ["#c62828", "#ff7043"], amber: ["#e65100", "#ffb74d"], orange: ["#d84315", "#ffa726"],
  purple: ["#5e35b1", "#b388ff"], gold: ["#f9a825", "#ffe082"], teal: ["#00796b", "#4dd0e1"] };
const KEY = "sakuna.nudgesSeen";
const GAP_MS = 3 * 60_000;           // at most one pop-up every 3 minutes
const REFRESH_MS = 4 * 60_000;
const SHOW_MS = 14_000;

/** In-app pop-ups (like shopping apps' banners, but for your goals): one at a time, with a one-tap action. */
export function InAppNudges({ api, onOpen, onNotice, onChanged }: { api: Api; onOpen: (t: string) => void; onNotice: (m: string) => void; onChanged?: () => void }) {
  const [cur, setCur] = useState<Row | null>(null);
  const y = useRef(new Animated.Value(-220)).current; const bounce = useRef(new Animated.Value(0)).current; const bar = useRef(new Animated.Value(1)).current;
  const queue = useRef<Row[]>([]); const lastShown = useRef(0); const seen = useRef<Record<string, number>>({}); const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const day = () => new Date().toISOString().slice(0, 10);

  const hide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(y, { toValue: -220, duration: 260, useNativeDriver: true }).start(() => setCur(null));
  }, [y]);
  const show = useCallback((n: Row) => {
    setCur(n); lastShown.current = Date.now(); seen.current[n.id] = Date.now();
    void SecureStore.setItemAsync(KEY, JSON.stringify({ day: day(), seen: seen.current })).catch(() => undefined);
    y.setValue(-220); bar.setValue(1);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
    Animated.loop(Animated.sequence([Animated.timing(bounce, { toValue: 1, duration: 380, useNativeDriver: true, easing: Easing.out(Easing.quad) }),
      Animated.timing(bounce, { toValue: 0, duration: 380, useNativeDriver: true })]), { iterations: 3 }).start();
    Animated.timing(bar, { toValue: 0, duration: SHOW_MS, useNativeDriver: false, easing: Easing.linear }).start();
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(hide, SHOW_MS);
  }, [y, bounce, bar, hide]);
  const next = useCallback(() => {
    if (cur || Date.now() - lastShown.current < GAP_MS) return;
    const n = queue.current.find(x => !seen.current[x.id] || (seen.current[x.id] < 0 && -seen.current[x.id] < Date.now()));
    if (n) { queue.current = queue.current.filter(x => x.id !== n.id); show(n); }
  }, [cur, show]);
  const refresh = useCallback(() => {
    api<Row>("/nudges").then(r => { queue.current = (r.nudges || []) as Row[]; next(); }).catch(() => undefined);
  }, [api, next]);

  useEffect(() => {
    void SecureStore.getItemAsync(KEY).then(v => { const s = v ? JSON.parse(v) : null; if (s?.day === day()) seen.current = s.seen || {}; }).catch(() => undefined)
      .finally(() => setTimeout(refresh, 4000));                       // let the screen settle first
    const iv = setInterval(refresh, REFRESH_MS);
    const sub = AppState.addEventListener("change", st => { if (st === "active") refresh(); });
    return () => { clearInterval(iv); sub.remove(); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [refresh]);
  useEffect(() => { const t = setInterval(next, 30_000); return () => clearInterval(t); }, [next]);

  const act = () => {
    const a = (cur?.action || {}) as Row; hide();
    const done = (m: string) => { onNotice(m); onChanged?.(); setTimeout(refresh, 1500); };
    if (a.kind === "water") void api("/water", "POST", { ml: a.ml || 250 }).then(() => done(`💧 +${a.ml || 250} ml. Keep it up!`)).catch(() => undefined);
    else if (a.kind === "task_done") void api(`/tasks/${a.id}/complete`, "PATCH").then(() => done("✅ Task done! +points")).catch(() => undefined);
    else if (a.kind === "habit_done") void api(`/habits/${a.id}/logs`, "POST", {}).then(() => done("🔥 Streak saved! +points")).catch(() => undefined);
    else if (a.kind === "claim") void api<Row>("/nudges/claim", "POST").then(r => done(String(r.message))).catch(() => undefined);
    else if (a.kind === "open" && a.target) onOpen(String(a.target));
  };
  const later = () => { if (cur) { seen.current[cur.id] = -(Date.now() + 30 * 60_000); queue.current.push(cur); } hide(); };
  if (!cur) return null;
  const [c1, c2] = TONE[String(cur.tone)] || TONE.purple;
  const scale = bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  return <Animated.View pointerEvents="box-none" style={{ position: "absolute", left: 10, right: 10, top: 44, zIndex: 100, elevation: 30, transform: [{ translateY: y }] }}>
    <View style={{ borderRadius: 22, overflow: "hidden", backgroundColor: c1, borderWidth: 2, borderColor: c2, shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 14 }}>
      <View style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: c2, opacity: 0.35 }}/>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
        <Animated.Text style={{ fontSize: 36, transform: [{ scale }] }}>{cur.icon}</Animated.Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 15.5, lineHeight: 20 }} numberOfLines={2}>{cur.title}</Text>
          {!!cur.body && <Text style={{ color: "#ffffffdd", fontSize: 12.5, lineHeight: 17 }} numberOfLines={2}>{cur.body}</Text>}
        </View>
        <TouchableOpacity onPress={hide} accessibilityLabel="Dismiss"><Text style={{ color: "#ffffffcc", fontSize: 18, padding: 4 }}>✕</Text></TouchableOpacity>
      </View>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingBottom: 12 }}>
        <TouchableOpacity onPress={act} style={{ flex: 1, backgroundColor: "#fff", borderRadius: 14, paddingVertical: 10, alignItems: "center" }}>
          <Text style={{ color: c1, fontWeight: "900", fontSize: 14 }}>{String(cur.action?.label || "Open")}</Text></TouchableOpacity>
        <TouchableOpacity onPress={later} style={{ paddingHorizontal: 14, borderRadius: 14, justifyContent: "center", backgroundColor: "#ffffff26" }}>
          <Text style={{ color: "#fff", fontWeight: "800" }}>Later</Text></TouchableOpacity>
      </View>
      <Animated.View style={{ height: 4, backgroundColor: c2, width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }}/>
    </View>
    <Text style={{ color: C.muted, fontSize: 9, textAlign: "center", marginTop: 2 }}> </Text>
  </Animated.View>;
}
