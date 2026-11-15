import React, { useCallback, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { ShieldBlocking } from "./screens/ShieldBlocking";
import { ShieldInsights } from "./screens/ShieldInsights";
import { ShieldStrict } from "./screens/ShieldStrict";
import { type BlockList, errorText, parseLists, Shield, type ShieldStatus } from "./shield";
import { C } from "./ui";

export type ShieldCtx = {
  status: ShieldStatus;
  lists: BlockList[];
  setStatus: (s: ShieldStatus) => void;
  setLists: (l: BlockList[]) => void;
  refresh: () => void;
  say: (message: string) => void;
};

type Tab = "blocking" | "strict" | "insights";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "blocking", label: "Blocking", icon: "🛡" }, { key: "strict", label: "Strict Mode", icon: "🔒" }, { key: "insights", label: "Insights", icon: "📊" },
];

/** Sakuna Shield (Android): blocklists, Strict Mode and screen-time insights. */
export function ShieldPanel() {
  const [tab, setTab] = useState<Tab>("blocking");
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [lists, setLists] = useState<BlockList[]>([]);
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    if (!Shield) return;
    try { setStatus(Shield.getStatus()); setLists(parseLists(Shield.getLists())); } catch (reason) { setMessage(errorText(reason)); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  // Re-check after the user comes back from Android Settings, and now and then for timers and schedules.
  useEffect(() => { const sub = AppState.addEventListener("change", state => { if (state === "active") refresh(); }); return () => sub.remove(); }, [refresh]);
  useEffect(() => { const id = setInterval(refresh, 20000); return () => clearInterval(id); }, [refresh]);
  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(""), 6000); return () => clearTimeout(id); }, [message]);

  if (!Shield) {
    return <View style={s.card}><Text style={s.kicker}>SAKUNA SHIELD</Text><Text style={s.title}>App & website blocking</Text>
      <Text style={s.muted}>Available in the Android app build (APK). It isn't available in Expo Go, on iPhone or on the web.</Text></View>;
  }
  if (!status) return null;
  const shield = Shield;
  const ctx: ShieldCtx = { status, lists, setStatus, setLists, refresh, say: setMessage };
  const activeCount = status.activeListIds.length;

  return <View style={{ gap: 12 }}>
    <View style={[s.card, s.hero, status.strict && s.heroStrict]}>
      <View style={s.heroRow}>
        <View style={[s.shieldIcon, activeCount > 0 && s.shieldIconOn]}><Text style={{ fontSize: 24 }}>{status.strict ? "🔒" : "🛡"}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>SAKUNA SHIELD</Text>
          <Text style={s.title}>{activeCount ? `Blocking now · ${activeCount} ${activeCount === 1 ? "list" : "lists"}` : "Nothing blocked right now"}</Text>
          <Text style={s.small}>{status.strict ? "Strict Mode is on" : "Strict Mode is off"} · blocked {status.blocksToday}× today</Text>
        </View>
      </View>
      {(!status.accessibility || !status.usageAccess) && <View style={s.setup}>
        {!status.accessibility && <SetupRow title="Allow blocking" detail="Accessibility → Sakuna Shield → On" onPress={() => shield.openAccessibilitySettings()}/>}
        {!status.usageAccess && <SetupRow title="Allow screen-time insights" detail="Usage access → Sakuna AI → Allow" onPress={() => shield.openUsageAccessSettings()}/>}
        <Text style={s.small}>OPPO/ColorOS: also set Sakuna AI's battery use to “Allow background activity” and lock it in Recents, or Android may stop the shield.</Text>
      </View>}
    </View>

    <View style={s.tabs}>{TABS.map(t => <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && s.tabOn]} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}>
      <Text style={[s.tabText, tab === t.key && s.tabTextOn]}>{t.icon} {t.label}</Text></TouchableOpacity>)}</View>

    {!!message && <Text style={s.message}>{message}</Text>}
    {tab === "blocking" && <ShieldBlocking {...ctx}/>}
    {tab === "strict" && <ShieldStrict {...ctx}/>}
    {tab === "insights" && <ShieldInsights {...ctx}/>}
  </View>;
}

function SetupRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return <View style={s.setupRow}>
    <View style={s.dot}/>
    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{title}</Text><Text style={s.small}>{detail}</Text></View>
    <TouchableOpacity style={s.smallBtn} onPress={onPress}><Text style={s.smallBtnText}>Open</Text></TouchableOpacity>
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  hero: { backgroundColor: C.panel2 },
  heroStrict: { borderColor: C.amber },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  shieldIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.line, alignItems: "center", justifyContent: "center" },
  shieldIconOn: { backgroundColor: C.greenSoft },
  kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  title: { color: C.text, fontSize: 18, fontWeight: "800", marginTop: 2 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  small: { color: C.muted, fontSize: 11, lineHeight: 16 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  setup: { gap: 8, borderTopColor: C.line, borderTopWidth: 1, paddingTop: 10 },
  setupRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.amber },
  smallBtn: { backgroundColor: C.green, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
  smallBtnText: { color: C.greenDark, fontWeight: "800", fontSize: 12 },
  tabs: { flexDirection: "row", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 99, padding: 4 },
  tab: { flex: 1, borderRadius: 99, paddingVertical: 10, alignItems: "center" },
  tabOn: { backgroundColor: C.green },
  tabText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  tabTextOn: { color: C.greenDark },
  message: { color: C.amber, backgroundColor: "#2b2418", borderRadius: 10, padding: 10, fontSize: 13, textAlign: "center", overflow: "hidden" },
});
