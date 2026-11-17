import React, { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, TouchableOpacity, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { C } from "./ui";

/** Fingerprint / face / phone PIN lock for Sakuna (journal, money and health live here). Off until you turn it on. */
const KEY = "sakuna.appLock";
const RELOCK_AFTER_MS = 60_000;

export async function lockEnabled(): Promise<boolean> {
  try { return (await SecureStore.getItemAsync(KEY)) === "on"; } catch { return false; }
}

/** Turn the lock on (after one successful unlock, so you can't lock yourself out) or off. */
export async function setLockEnabled(on: boolean): Promise<{ ok: boolean; message: string }> {
  if (!on) { await SecureStore.setItemAsync(KEY, "off").catch(() => undefined); return { ok: true, message: "App lock is off" }; }
  const level = await LocalAuthentication.getEnrolledLevelAsync().catch(() => LocalAuthentication.SecurityLevel.NONE);
  if (level === LocalAuthentication.SecurityLevel.NONE) return { ok: false, message: "Set a screen lock (PIN, pattern or fingerprint) on this phone first." };
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Confirm to turn on the Sakuna lock", disableDeviceFallback: false });
  if (!res.success) return { ok: false, message: "Not confirmed; the lock stays off." };
  await SecureStore.setItemAsync(KEY, "on").catch(() => undefined);
  return { ok: true, message: "App lock is on: Sakuna asks for your fingerprint or PIN when opened." };
}

export function LockGate({ children }: { children: ReactNode }) {
  const [locked, setLocked] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const leftAt = useRef<number>(0);
  const unlock = useCallback(async () => {
    setError("");
    try {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Sakuna", disableDeviceFallback: false, cancelLabel: "Cancel" });
      if (res.success) setLocked(false); else setError(res.error === "user_cancel" ? "" : "Not recognised. Try again.");
    } catch { setError("Couldn't open the fingerprint / PIN prompt."); }
  }, []);
  useEffect(() => {
    void lockEnabled().then(on => { setLocked(on); if (on) void unlock(); });
    const sub = AppState.addEventListener("change", state => {
      if (state === "background") leftAt.current = Date.now();
      if (state === "active" && leftAt.current && Date.now() - leftAt.current > RELOCK_AFTER_MS) {
        void lockEnabled().then(on => { if (on) { setLocked(true); void unlock(); } });
      }
    });
    return () => sub.remove();
  }, [unlock]);
  if (locked === null) return <View style={{ flex: 1, backgroundColor: C.bg }}/>;
  if (!locked) return <>{children}</>;
  return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
    <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: C.greenSoft, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.green }}>
      <Text style={{ fontSize: 42 }}>🔒</Text></View>
    <Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>Sakuna is locked</Text>
    <Text style={{ color: C.muted, textAlign: "center" }}>Your journal, money and health stay private.</Text>
    {!!error && <Text style={{ color: C.red }}>{error}</Text>}
    <TouchableOpacity onPress={() => void unlock()} style={{ backgroundColor: C.green, borderRadius: 99, paddingHorizontal: 28, paddingVertical: 14 }}>
      <Text style={{ color: C.greenDark, fontWeight: "900", fontSize: 16 }}>Unlock</Text></TouchableOpacity>
  </View>;
}
