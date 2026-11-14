import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AppState, FlatList, Modal, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { type AppInfo, type AppUsage, Shield, type ShieldConfig, type ShieldStatus } from "./shield";

const C = { panel: "#141b18", line: "#27312d", text: "#edf4ef", muted: "#8b9a91", green: "#39d98a", dark: "#082316", amber: "#f2b768", red: "#ff7272", field: "#0e1411" };
const DURATIONS = [25, 60, 120, 240];

function clock(ms: number) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function errorText(reason: unknown) { return reason instanceof Error ? reason.message.replace(/^.*?:\s*/, "") : "Something went wrong"; }

/** Sakuna Shield: app monitor, app + website blocking, focus sessions with strict mode (Android). */
export function ShieldPanel() {
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [config, setConfig] = useState<ShieldConfig>({ apps: [], domains: [], alwaysOn: false });
  const [usage, setUsage] = useState<AppUsage[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [picker, setPicker] = useState(false);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [strict, setStrict] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!Shield) return;
    try {
      setStatus(Shield.getStatus());
      setConfig(Shield.getConfig());
      setUsage(await Shield.getUsageToday());
    } catch (reason) { setMessage(errorText(reason)); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  // Re-check after the user comes back from Android Settings.
  useEffect(() => { const sub = AppState.addEventListener("change", state => { if (state === "active") void refresh(); }); return () => sub.remove(); }, [refresh]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(id); }, []);

  const labels = useMemo(() => new Map([...apps, ...usage].map(a => [a.packageName, a.label])), [apps, usage]);
  const locked = !!status?.strict;

  if (!Shield) {
    return <View style={s.card}><Text style={s.kicker}>SAKUNA SHIELD</Text><Text style={s.title}>App & website blocking</Text>
      <Text style={s.muted}>Available in the Android app build (APK). It isn't available in Expo Go, on iPhone or on the web.</Text></View>;
  }
  const shield = Shield;

  function save(next: ShieldConfig) {
    try { setStatus(shield.setConfig(next.apps, next.domains, next.alwaysOn)); setConfig(shield.getConfig()); setMessage(""); }
    catch (reason) { setMessage(errorText(reason)); }
  }
  function toggleApp(pkg: string) {
    save({ ...config, apps: config.apps.includes(pkg) ? config.apps.filter(a => a !== pkg) : [...config.apps, pkg] });
  }
  function addDomain() {
    const value = domain.trim();
    if (!value) return;
    save({ ...config, domains: [...config.domains, value] });
    setDomain("");
  }
  async function openPicker() {
    setPicker(true);
    if (!apps.length) { try { setApps(await shield.getInstalledApps()); } catch (reason) { setMessage(errorText(reason)); } }
  }
  function start() {
    if (!status?.accessibility) { setMessage("Turn on Sakuna Shield in Accessibility first (step 1 above)."); return; }
    if (!config.apps.length && !config.domains.length) { setMessage("Add at least one app or website to block."); return; }
    try { setStatus(shield.startSession(minutes, strict)); setMessage(strict ? "Strict session started. Rules are locked until it ends." : "Blocking started."); }
    catch (reason) { setMessage(errorText(reason)); }
  }
  function end() {
    try { setStatus(shield.endSession()); setMessage("Session ended."); } catch (reason) { setMessage(errorText(reason)); }
  }
  function requestExit() {
    try { setStatus(shield.requestExit()); setMessage("Cooldown started. You can end the session in 15 minutes."); } catch (reason) { setMessage(errorText(reason)); }
  }

  const exitAt = status?.exitAvailableAt ?? 0;
  const canEndNow = !locked || (exitAt > 0 && now >= exitAt);
  const totalMinutes = usage.reduce((sum, u) => sum + u.minutes, 0);
  const maxMinutes = Math.max(1, ...usage.map(u => u.minutes));
  const filtered = apps.filter(a => a.label.toLowerCase().includes(search.trim().toLowerCase()));

  return <>
    <View style={s.card}>
      <Text style={s.kicker}>SAKUNA SHIELD · SETUP</Text>
      <Text style={s.title}>Block distractions</Text>
      <SetupRow done={!!status?.accessibility} title="1. Allow blocking" detail="Settings → Accessibility → Sakuna Shield → On" action="Turn on" onPress={() => shield.openAccessibilitySettings()}/>
      <SetupRow done={!!status?.usageAccess} title="2. Allow screen-time monitor" detail="Settings → Usage access → Sakuna AI → Allow" action="Allow" onPress={() => shield.openUsageAccessSettings()}/>
      <Text style={s.small}>OPPO/ColorOS: also set Sakuna AI's battery use to “Allow background activity” and lock it in Recents, or Android may stop the shield.</Text>
    </View>

    <View style={[s.card, status?.sessionActive && s.cardActive]}>
      <Text style={s.kicker}>FOCUS BLOCK</Text>
      {status?.sessionActive ? <>
        <Text style={s.title}>Blocking until {clock(status.sessionEndsAt)}</Text>
        {locked && <Text style={s.strictBadge}>STRICT MODE · rules locked</Text>}
        {canEndNow ? <TouchableOpacity style={s.outline} onPress={end}><Text style={s.outlineText}>End session now</Text></TouchableOpacity>
          : exitAt === -1 ? <TouchableOpacity style={s.outline} onPress={requestExit}><Text style={s.outlineText}>Request early exit (15-min wait)</Text></TouchableOpacity>
          : <Text style={s.muted}>Early exit available at {clock(exitAt)}.</Text>}
      </> : <>
        <Text style={s.title}>Start a blocking session</Text>
        <View style={s.chips}>{DURATIONS.map(m => <TouchableOpacity key={m} style={[s.chip, minutes === m && s.chipOn]} onPress={() => setMinutes(m)}>
          <Text style={[s.chipText, minutes === m && s.chipTextOn]}>{m < 60 ? `${m} min` : `${m / 60} h`}</Text></TouchableOpacity>)}</View>
        <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.rowTitle}>Strict mode</Text>
          <Text style={s.small}>Can't stop early or change rules; Sakuna's settings and uninstall are blocked. Early exit needs a 15-minute wait.</Text></View>
          <Switch value={strict} onValueChange={setStrict} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></View>
        <TouchableOpacity style={s.primary} onPress={start}><Text style={s.primaryText}>Start {strict ? "strict " : ""}block · {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</Text></TouchableOpacity>
      </>}
      <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.rowTitle}>Always block</Text><Text style={s.small}>Block the list below all day, not only during sessions.</Text></View>
        <Switch value={config.alwaysOn} disabled={locked} onValueChange={value => save({ ...config, alwaysOn: value })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></View>
      <Text style={s.small}>Blocked today: {status?.blocksToday ?? 0} times</Text>
    </View>

    <View style={s.card}>
      <View style={s.headRow}><Text style={s.kicker}>BLOCKED APPS · {config.apps.length}</Text>
        {!locked && <TouchableOpacity onPress={() => void openPicker()}><Text style={s.link}>Choose apps →</Text></TouchableOpacity>}</View>
      {config.apps.length ? <View style={s.chips}>{config.apps.map(pkg => <TouchableOpacity key={pkg} disabled={locked} style={s.tag} onPress={() => toggleApp(pkg)}>
        <Text style={s.tagText}>{labels.get(pkg) || pkg}{locked ? "" : "  ✕"}</Text></TouchableOpacity>)}</View>
        : <Text style={s.muted}>No apps yet. Tap “Choose apps”, or “Block” next to an app in today's screen time.</Text>}
    </View>

    <View style={s.card}>
      <Text style={s.kicker}>BLOCKED WEBSITES · {config.domains.length}</Text>
      {!locked && <View style={s.inputRow}><TextInput style={s.input} value={domain} onChangeText={setDomain} placeholder="e.g. youtube.com" placeholderTextColor={C.muted}
        autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={addDomain}/>
        <TouchableOpacity style={s.addBtn} onPress={addDomain}><Text style={s.primaryText}>Add</Text></TouchableOpacity></View>}
      {config.domains.length ? <View style={s.chips}>{config.domains.map(d => <TouchableOpacity key={d} disabled={locked} style={s.tag}
        onPress={() => save({ ...config, domains: config.domains.filter(x => x !== d) })}><Text style={s.tagText}>{d}{locked ? "" : "  ✕"}</Text></TouchableOpacity>)}</View>
        : <Text style={s.muted}>Subdomains are included (blocking youtube.com also blocks m.youtube.com). Works in Chrome, Firefox, Edge, Brave, Opera, Samsung and OPPO browsers; in-app browsers may slip through.</Text>}
    </View>

    <View style={s.card}>
      <Text style={s.kicker}>SCREEN TIME TODAY</Text>
      {status?.usageAccess ? usage.length ? <>
        <Text style={s.title}>{Math.floor(totalMinutes / 60)} h {totalMinutes % 60} min</Text>
        {usage.slice(0, 12).map(u => <View key={u.packageName} style={s.usageRow}>
          <View style={{ flex: 1 }}><Text style={s.rowTitle} numberOfLines={1}>{u.label}</Text>
            <View style={s.barTrack}><View style={[s.bar, { width: `${Math.max(4, (u.minutes / maxMinutes) * 100)}%` }]}/></View></View>
          <Text style={s.minutes}>{u.minutes >= 60 ? `${Math.floor(u.minutes / 60)}h ${u.minutes % 60}m` : `${u.minutes}m`}</Text>
          {!locked && <TouchableOpacity onPress={() => toggleApp(u.packageName)}><Text style={config.apps.includes(u.packageName) ? s.unblock : s.link}>{config.apps.includes(u.packageName) ? "Blocked" : "Block"}</Text></TouchableOpacity>}
        </View>)}
        <Text style={s.small}>Calculated on this phone from Android's usage data. Not uploaded.</Text>
      </> : <Text style={s.muted}>No app used for more than a minute yet today.</Text>
        : <Text style={s.muted}>Allow the screen-time monitor (step 2) to see which apps take your time.</Text>}
    </View>

    {!!message && <Text style={s.message}>{message}</Text>}

    <Modal visible={picker} animationType="slide" onRequestClose={() => setPicker(false)}>
      <View style={s.modal}>
        <View style={s.headRow}><Text style={s.title}>Choose apps to block</Text><TouchableOpacity onPress={() => setPicker(false)}><Text style={s.link}>Done</Text></TouchableOpacity></View>
        <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="Search apps" placeholderTextColor={C.muted}/>
        <FlatList data={filtered} keyExtractor={a => a.packageName} style={{ marginTop: 10 }}
          ListEmptyComponent={<Text style={s.muted}>Loading apps…</Text>}
          renderItem={({ item }) => { const on = config.apps.includes(item.packageName); return <TouchableOpacity style={s.pickRow} onPress={() => toggleApp(item.packageName)}>
            <Text style={s.rowTitle}>{item.label}</Text><View style={[s.check, on && s.checkOn]}><Text style={s.checkText}>{on ? "✓" : ""}</Text></View></TouchableOpacity>; }}/>
      </View>
    </Modal>
  </>;
}

function SetupRow({ done, title, detail, action, onPress }: { done: boolean; title: string; detail: string; action: string; onPress: () => void }) {
  return <View style={s.setupRow}>
    <View style={[s.dot, done && s.dotOn]}/>
    <View style={{ flex: 1 }}><Text style={s.rowTitle}>{title}</Text><Text style={s.small}>{done ? "Done" : detail}</Text></View>
    {!done && <TouchableOpacity style={s.smallBtn} onPress={onPress}><Text style={s.primaryText}>{action}</Text></TouchableOpacity>}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12, gap: 10 },
  cardActive: { borderColor: C.green },
  kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.4, fontWeight: "700" },
  title: { color: C.text, fontSize: 18, fontWeight: "700" },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  small: { color: C.muted, fontSize: 11, lineHeight: 16 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  setupRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.amber },
  dotOn: { backgroundColor: C.green },
  smallBtn: { backgroundColor: C.green, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8 },
  primary: { backgroundColor: C.green, borderRadius: 11, paddingVertical: 13, alignItems: "center" },
  primaryText: { color: C.dark, fontWeight: "700", fontSize: 13 },
  outline: { borderColor: C.line, borderWidth: 1, borderRadius: 11, paddingVertical: 12, alignItems: "center" },
  outlineText: { color: C.text, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: C.green, backgroundColor: "#183323" },
  chipText: { color: C.muted, fontWeight: "600" },
  chipTextOn: { color: C.green },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  strictBadge: { color: C.amber, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: C.green, fontWeight: "600", fontSize: 13 },
  unblock: { color: C.amber, fontWeight: "600", fontSize: 13 },
  tag: { backgroundColor: "#203128", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  tagText: { color: "#a5e3be", fontSize: 12, fontWeight: "600" },
  inputRow: { flexDirection: "row", gap: 8 },
  input: { flex: 1, backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 10, color: C.text, paddingHorizontal: 12, paddingVertical: 10 },
  addBtn: { backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 16, justifyContent: "center" },
  usageRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  barTrack: { height: 5, backgroundColor: C.line, borderRadius: 3, marginTop: 6, overflow: "hidden" },
  bar: { height: 5, backgroundColor: C.green, borderRadius: 3 },
  minutes: { color: C.text, fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 52, textAlign: "right" },
  message: { color: C.amber, fontSize: 13, textAlign: "center", marginBottom: 12 },
  modal: { flex: 1, backgroundColor: "#0d1110", padding: 18, paddingTop: 48, gap: 10 },
  pickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, borderBottomColor: C.line, borderBottomWidth: 1 },
  check: { width: 24, height: 24, borderRadius: 7, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkText: { color: C.dark, fontWeight: "800" },
});
