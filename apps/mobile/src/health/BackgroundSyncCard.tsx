import React, { useEffect, useState } from "react";
import { Linking, Text, View } from "react-native";
import { Btn, C, Card, Kicker, Muted } from "../ui";
import { enableBackgroundSync, hasBackgroundHealth, requestBackgroundHealth } from "./background";

/** Health screen card: turn on syncing while the app is closed. */
export function BackgroundSyncCard({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { void hasBackgroundHealth().then(setOn); }, []);
  async function turnOn() {
    const ok = await requestBackgroundHealth();
    setOn(ok);
    if (ok) { await enableBackgroundSync(); onNotice("Background sync is on: about every 30 minutes, even when Sakuna is closed"); }
    else onError("Not allowed. Open Health Connect → App permissions → Sakuna AI → turn on “Access data in background”.");
  }
  return <Card style={{ borderColor: on ? "#2a6b4a" : C.line }}>
    <Kicker>SYNC WHEN THE APP IS CLOSED</Kicker>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: on ? C.green : on === false ? C.amber : C.line }}/>
      <Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{on ? "On · about every 30 minutes" : on === false ? "Off · syncs only when you open Sakuna" : "Checking…"}</Text></View>
    <Muted small>Android runs it when it suits the battery (not exactly every 30 min, and less in battery saver). For best results: Settings → Apps → Sakuna AI → Battery → Unrestricted.</Muted>
    {on === false && <Btn title="Turn on background sync" onPress={() => void turnOn()}/>}
    {on === false && <Btn kind="link" title="Open Health Connect settings" onPress={() => void Linking.sendIntent("android.health.connect.action.HEALTH_HOME_SETTINGS").catch(() => undefined)}/>}
  </Card>;
}
