import React, { useState } from "react";
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";

import type { ShieldCtx } from "../ShieldPanel";
import { clock, errorText, scheduleText, Shield, type StrictMethod } from "../shield";
import { C } from "../ui";
import { s as b } from "./ShieldBlocking";

const DURATIONS = [30, 60, 120, 240, 480, 1440];
const label = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

const METHODS: { key: StrictMethod | "approval"; title: string; text: string; icon: string; level: "HARD" | "MEDIUM" | "LATER" }[] = [
  { key: "timer", title: "Timer", text: "Strict Mode turns off by itself when the time runs out.", icon: "⏱", level: "HARD" },
  { key: "schedule", title: "Follow schedules", text: "You can turn Strict Mode off only while none of your scheduled blocklists is running.", icon: "🗓", level: "HARD" },
  { key: "charger", title: "Charger", text: "You can turn Strict Mode off only while the phone is on a charger.", icon: "🔌", level: "MEDIUM" },
  { key: "approval", title: "Approval", text: "A partner approves before Strict Mode can end. Coming in a later version.", icon: "✅", level: "LATER" },
];

/** Strict Mode: lock the blocklists and the shield itself until the chosen unlock method allows it. */
export function ShieldStrict({ status, lists, setStatus, say }: ShieldCtx) {
  const [method, setMethod] = useState<StrictMethod>("timer");
  const [minutes, setMinutes] = useState(120);
  const [alsoBlock, setAlsoBlock] = useState(true);
  const shield = Shield!;
  const scheduled = lists.filter(l => l.mode === "schedule");

  function start() {
    if (!status.accessibility) { say("Turn on “Allow blocking” first (top of this screen)."); return; }
    if (!lists.length) { say("Create a blocklist first."); return; }
    const how = method === "timer" ? `for ${label(minutes)}` : method === "schedule" ? "until you turn it off when no schedule is running" : "until you turn it off while charging";
    Alert.alert("Turn on Strict Mode?", `Strict Mode stays on ${how}. While it's on you can't remove blocked items, delete lists, stop a quick block, or turn off Sakuna in Settings.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Turn on", style: "destructive", onPress: () => {
        try {
          let next = shield.startStrict(method, minutes);
          if (method === "timer" && alsoBlock && !status.sessionActive) next = shield.startSession(Math.min(minutes, 720), []);
          setStatus(next); say("Strict Mode is on.");
        } catch (r) { say(errorText(r)); }
      } },
    ]);
  }
  function end() { try { setStatus(shield.endStrict()); say("Strict Mode is off."); } catch (r) { say(errorText(r)); } }
  function askExit() { try { setStatus(shield.requestStrictExit()); say("The 15-minute wait has started."); } catch (r) { say(errorText(r)); } }

  if (status.strict) {
    const m = METHODS.find(x => x.key === status.strictMethod)!;
    const canEnd = !status.strictBlockedReason;
    const waiting = status.strictMethod === "timer" && status.exitAvailableAt > 0 && !canEnd;
    return <>
      <View style={[b.card, s.lockCard]}>
        <View style={s.lockIcon}><Text style={{ fontSize: 40 }}>🔒</Text></View>
        <Text style={s.lockTitle}>Strict Mode is on</Text>
        <Text style={s.method}>{m.icon} Unlock method: {m.title}</Text>
        {status.strictMethod === "timer" && <Text style={s.big}>Ends at {clock(status.strictEndsAt)}</Text>}
        {status.strictMethod === "charger" && <Text style={[s.big, { color: status.charging ? C.green : C.amber }]}>{status.charging ? "⚡ Charging: you can turn it off" : "Not charging"}</Text>}
        {status.strictMethod === "schedule" && <Text style={b.muted}>{scheduled.map(l => `${l.name}: ${scheduleText(l.schedule)}`).join("\n") || "No scheduled blocklists."}</Text>}
        {!!status.strictBlockedReason && <Text style={s.reason}>{status.strictBlockedReason}</Text>}
        {canEnd ? <TouchableOpacity style={[b.primary, { alignSelf: "stretch" }]} onPress={end}><Text style={b.primaryText}>Turn off Strict Mode</Text></TouchableOpacity>
          : status.strictMethod === "timer" && !waiting ? <TouchableOpacity style={[b.outline, { alignSelf: "stretch" }]} onPress={askExit}><Text style={b.outlineText}>Ask for early exit (15-minute wait)</Text></TouchableOpacity>
          : waiting ? <Text style={b.small}>Early exit opens at {clock(status.exitAvailableAt)}.</Text> : null}
      </View>
      <Locks/>
    </>;
  }

  return <>
    <Text style={s.h1}>Unlock method</Text>
    <Text style={b.muted}>Strict Mode locks your blocklists. Choose what has to happen before you can turn it off.</Text>
    {METHODS.map(x => {
      const disabled = x.key === "approval";
      const on = method === x.key;
      return <TouchableOpacity key={x.key} disabled={disabled} activeOpacity={0.85} style={[b.card, s.methodCard, on && b.cardOn, disabled && { opacity: 0.5 }]}
        onPress={() => setMethod(x.key as StrictMethod)}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.methodTitle}>{x.title}</Text>
            <Text style={b.muted}>{x.text}</Text>
            <Text style={[s.level, x.level === "HARD" ? s.levelHard : x.level === "MEDIUM" ? s.levelMedium : s.levelLater]}>{x.level}</Text>
          </View>
          <View style={[s.methodIcon, on && s.methodIconOn]}><Text style={{ fontSize: 30 }}>{x.icon}</Text></View>
        </View>
        {on && x.key === "timer" && <View style={{ gap: 10, marginTop: 4 }}>
          <View style={b.chips}>{DURATIONS.map(d => <TouchableOpacity key={d} style={[b.chip, minutes === d && b.chipOn]} onPress={() => setMinutes(d)}>
            <Text style={[b.chipText, minutes === d && b.chipTextOn]}>{label(d)}</Text></TouchableOpacity>)}</View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}><Text style={b.rowTitle}>Also start a quick block</Text><Text style={b.small}>Blocks all your lists for the same time (max 12 h).</Text></View>
            <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/>
          </View>
        </View>}
        {on && x.key === "schedule" && <Text style={scheduled.length ? b.small : s.reason}>{scheduled.length
          ? scheduled.map(l => `• ${l.name}: ${scheduleText(l.schedule)}`).join("\n")
          : "No blocklist has a schedule yet. Open a blocklist in the Blocking tab and choose “On a schedule”."}</Text>}
        {on && x.key === "charger" && <Text style={b.small}>{status.charging ? "Your phone is charging now." : "Plug in whenever you want to turn Strict Mode off."} Lists that are Always on or scheduled keep blocking meanwhile.</Text>}
      </TouchableOpacity>;
    })}
    <TouchableOpacity style={b.primary} onPress={start}><Text style={b.primaryText}>🔒 Turn on Strict Mode{method === "timer" ? ` · ${label(minutes)}` : ""}</Text></TouchableOpacity>
    <Locks/>
  </>;
}

function Locks() {
  return <View style={b.card}>
    <Text style={b.kicker}>WHILE STRICT MODE IS ON</Text>
    {["You can add apps, sites and keywords, but not remove them", "Blocklists can't be deleted, paused or have options switched off", "A running quick block can't be stopped early",
      "Sakuna's Accessibility switch and uninstall screen are blocked"].map(t => <Text key={t} style={b.muted}>•  {t}</Text>)}
  </View>;
}

const s = StyleSheet.create({
  h1: { color: C.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, marginTop: 4 },
  methodCard: { gap: 10 },
  methodTitle: { color: C.text, fontSize: 20, fontWeight: "800" },
  methodIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  methodIconOn: { backgroundColor: C.greenSoft },
  level: { alignSelf: "flex-start", fontSize: 11, fontWeight: "800", borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, overflow: "hidden" },
  levelHard: { color: "#c59bff", borderColor: "#5b4380" },
  levelMedium: { color: C.blue, borderColor: "#2f4c6e" },
  levelLater: { color: C.muted, borderColor: C.line },
  lockCard: { alignItems: "center", paddingVertical: 24, borderColor: C.amber },
  lockIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: "#2b2418", alignItems: "center", justifyContent: "center" },
  lockTitle: { color: C.text, fontSize: 24, fontWeight: "800" },
  method: { color: C.muted, fontSize: 13, fontWeight: "600" },
  big: { color: C.text, fontSize: 20, fontWeight: "800" },
  reason: { color: "#ffd38a", fontSize: 12, lineHeight: 18, textAlign: "center" },
});
