import React, { useCallback, useEffect, useState } from "react";
import { Alert, AppState, Linking, Modal, ScrollView, Share, Switch, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { connectHealthConnect, getHealthConnectStatus } from "../health/health-connect";
import { errorReport } from "../errors";
import { lockEnabled, setLockEnabled } from "../lock";
import { applyNotificationPrefs, notificationsAllowed } from "../notify";
import { Shield } from "../shield";
import { ACCENTS, LANGS, MODES, TEXT_SIZES, setTheme, theme, type Accent, type Lang, type Mode, type TextSize } from "../theme";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";
import { TimeField } from "../pickers";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function Section({ icon, title, sub, children, open: start = false }: { icon: string; title: string; sub?: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(start);
  return <Card style={{ gap: 10 }}>
    <TouchableOpacity onPress={() => setOpen(o => !o)} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.greenSoft, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 20 }}>{icon}</Text></View>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{title}</Text>{!!sub && <Muted small>{sub}</Muted>}</View>
      <Text style={{ color: C.muted, fontSize: 18 }}>{open ? "▴" : "▾"}</Text>
    </TouchableOpacity>
    {open && children}
  </Card>;
}

function Check({ ok, label, fix, onFix }: { ok: boolean | null; label: string; fix: string; onFix: () => void }) {
  return <Line><Text style={{ fontSize: 18 }}>{ok == null ? "⚪" : ok ? "✅" : "⚠️"}</Text><Text style={{ color: C.text, flex: 1 }}>{label}</Text>
    {!ok && <TouchableOpacity onPress={onFix}><Text style={{ color: C.green, fontWeight: "800" }}>{fix}</Text></TouchableOpacity>}</Line>;
}

/** Settings & profile: everything in one place. */
export function SettingsScreen({ api, onError, onNotice, onOpen, signOut }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (t: string) => void; signOut: () => void }) {
  const [s, setS] = useState<Row | null>(null); const [prof, setProf] = useState<Record<string, string>>({}); const [notify, setNotify] = useState<Row>({});
  const [checks, setChecks] = useState<Record<string, boolean | null>>({}); const [lock, setLock] = useState(false);
  const load = useCallback(() => { api<Row>("/settings").then(r => {
    setS(r); setNotify(r.prefs.notifications);
    const p = r.profile as Row;
    setProf({ full_name: r.user.full_name || "", location: p.location || "", timezone: p.timezone || "", currency: p.currency || "", bio: p.bio || "",
      height_cm: p.height_cm ? String(p.height_cm) : "", sex: p.sex || "", wake_time: p.wake_time || "", sleep_time: p.sleep_time || "",
      work_start: p.work_start || "", work_end: p.work_end || "", gym_time: p.gym_time || "" });
  }).catch(e => onError(msg(e))); }, [api, onError]);
  const refreshChecks = useCallback(async () => {
    const st = Shield ? (() => { try { return Shield!.getStatus(); } catch { return null; } })() : null;
    const hc = await getHealthConnectStatus().catch(() => ({ available: false, connected: false, reason: "" }));
    setChecks({ notifications: await notificationsAllowed(), usage: st ? st.usageAccess : null, blocking: st ? st.accessibility : null, health: hc.available ? hc.connected : null });
    setLock(await lockEnabled());
  }, []);
  useEffect(() => { load(); void refreshChecks(); }, [load, refreshChecks]);
  if (!s) return <Screen><Empty>Loading settings…</Empty></Screen>;
  const set = (k: string) => (v: string) => setProf(p => ({ ...p, [k]: v }));
  const saveProfile = (keys: string[]) => {
    const body: Row = {};
    for (const k of keys) {
      const v = (prof[k] || "").trim();
      if (k.endsWith("_time") || k === "work_start" || k === "work_end") { if (v && !TIME.test(v)) { onError(`${k.replace("_", " ")}: use HH:MM, e.g. 06:30`); return; } body[k] = v || null; }
      else if (k === "height_cm") body[k] = v ? Number(v) : null;
      else if (k === "sex") body[k] = v === "male" || v === "female" ? v : null;
      else if (k === "currency") { if (v) body[k] = v.toUpperCase(); }
      else if (k === "full_name") { if (v) body[k] = v; }
      else body[k] = v || null;
    }
    void api("/profile", "PATCH", body).then(() => { onNotice("Saved ✓"); load(); }).catch(e => onError(msg(e)));
  };
  const saveNotify = () => void api<Row>("/settings/prefs", "PATCH", { notifications: notify }).then(async r => { setNotify(r.notifications); await applyNotificationPrefs(api, r.notifications);
    onNotice("Notifications updated on this phone"); void refreshChecks(); }).catch(e => onError(msg(e)));
  const exportData = () => void api<Row>("/me/export").then(async d => {
    const text = JSON.stringify(d, null, 1);
    if (text.length > 900_000) { Alert.alert("Export is large", `${Math.round(text.length / 1024)} KB. Use the web app's Settings → Export to download it as a file.`); return; }
    await Share.share({ message: text, title: "Sakuna export" });
  }).catch(e => onError(msg(e)));
  const labels = s.prefs.labels as Record<string, string>; const t = theme();
  return <Screen onRefresh={() => { load(); void refreshChecks(); }}>
    <View style={{ alignItems: "center", gap: 6, paddingVertical: 8 }}>
      <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: C.green, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: C.greenDark, fontSize: 34, fontWeight: "900" }}>{String(s.user.full_name || s.user.email || "S").slice(0, 1).toUpperCase()}</Text></View>
      <Text style={{ color: C.text, fontSize: 20, fontWeight: "900" }}>{s.user.full_name || "Your name"}</Text><Muted small>{s.user.email}</Muted>
    </View>
    <Section icon="👤" title="Profile" sub="Name, place, timezone, currency, body">
      <Field label="Name" value={prof.full_name} onChangeText={set("full_name")}/>
      <Field label="Location" value={prof.location} onChangeText={set("location")} placeholder="Colombo"/>
      <Line><Field label="Timezone" value={prof.timezone} onChangeText={set("timezone")} placeholder="Asia/Colombo" style={{ flex: 1 }}/>
        <Field label="Currency" value={prof.currency} onChangeText={set("currency")} placeholder="LKR" autoCapitalize="characters" style={{ width: 90 }}/></Line>
      <Line><Field label="Height (cm)" value={prof.height_cm} onChangeText={set("height_cm")} keyboardType="number-pad" style={{ flex: 1 }}/>
        {(["male", "female"] as const).map(x => <TouchableOpacity key={x} onPress={() => set("sex")(prof.sex === x ? "" : x)} style={{ alignSelf: "flex-end", paddingHorizontal: 12, paddingVertical: 10,
          borderRadius: 12, borderWidth: 1, borderColor: prof.sex === x ? C.green : C.line }}><Text style={{ color: prof.sex === x ? C.green : C.muted }}>{x}</Text></TouchableOpacity>)}</Line>
      <Field label="About me" value={prof.bio} onChangeText={set("bio")} multiline placeholder="What matters to you, what you're working on"/>
      <Btn title="Save profile" onPress={() => saveProfile(["full_name", "location", "timezone", "currency", "height_cm", "sex", "bio"])}/>
    </Section>
    <Section icon="⏰" title="My day" sub="Wake, sleep, office and gym times">
      <Line><TimeField label="⏰ Wake up" value={prof.wake_time} onChange={v => set("wake_time")(v || "")} placeholder="06:30" allowClear/><TimeField label="🌙 Sleep" value={prof.sleep_time} onChange={v => set("sleep_time")(v || "")} placeholder="22:30" allowClear/></Line>
      <Line><TimeField label="💼 Work starts" value={prof.work_start} onChange={v => set("work_start")(v || "")} placeholder="08:30" allowClear/><TimeField label="🏁 Work ends" value={prof.work_end} onChange={v => set("work_end")(v || "")} placeholder="17:30" allowClear/></Line>
      <TimeField label="🏋️ Gym time" value={prof.gym_time} onChange={v => set("gym_time")(v || "")} placeholder="18:00" allowClear/>
      <Btn title="Save times" onPress={() => saveProfile(["wake_time", "sleep_time", "work_start", "work_end", "gym_time"])}/>
      <Btn kind="link" title="Work and gym days →" onPress={() => onOpen("Schedule")}/>
    </Section>
    <Section icon="🔔" title="Notification centre" sub="Every reminder in one place" open>
      {!checks.notifications && <Text style={{ color: C.amber }}>⚠️ Notifications are off for Sakuna on this phone. Tap "Fix" under Phone access.</Text>}
      {Object.keys(labels).map(k => <View key={k} style={{ gap: 4 }}><Line><Text style={{ color: C.text, flex: 1 }}>{labels[k]}</Text>
        <Switch value={!!notify[k]?.on} onValueChange={v => setNotify(n => ({ ...n, [k]: { ...n[k], on: v } }))}/></Line>
        {notify[k]?.time != null && notify[k]?.on && <View style={{ width: 150 }}><TimeField value={notify[k].time} onChange={v => v && setNotify(n => ({ ...n, [k]: { ...n[k], time: v } }))}/></View>}</View>)}
      <Btn title="Save & apply on this phone" onPress={saveNotify}/>
      <Muted small>Buttons right in the notification: ✓ Done / ⏰ +1 hour on tasks, ✓ Done on habits, ✓ Approve / ✕ Reject on approvals, +250 ml on water. They work while Sakuna is open or in the background; if Android has fully closed the app, tap the notification instead.</Muted>
    </Section>
    <Connections api={api} onError={onError} onNotice={onNotice}/>
    <Section icon="🎨" title="Appearance" sub={`${MODES[t.mode]} · ${ACCENTS[t.accent].name} · ${TEXT_SIZES[t.text].label} · ${LANGS[t.lang]}`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(Object.keys(MODES) as Mode[]).map(m => <TouchableOpacity key={m} onPress={() => setTheme({ mode: m })}
        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: t.mode === m ? C.green : C.panel2 }}><Text style={{ color: t.mode === m ? C.greenDark : C.text, fontWeight: "700" }}>{MODES[m]}</Text></TouchableOpacity>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{(Object.keys(ACCENTS) as Accent[]).map(a => <TouchableOpacity key={a} onPress={() => setTheme({ accent: a })}
        style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.resolved === "light" ? ACCENTS[a].light : ACCENTS[a].dark, borderWidth: t.accent === a ? 3 : 0, borderColor: C.text }}/>)}</View>
      <View style={{ flexDirection: "row", gap: 6 }}>{(Object.keys(TEXT_SIZES) as TextSize[]).map(k => <TouchableOpacity key={k} onPress={() => setTheme({ text: k })}
        style={{ flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 12, backgroundColor: t.text === k ? C.green : C.panel2 }}>
        <Text style={{ color: t.text === k ? C.greenDark : C.text, fontWeight: "800", fontSize: 11 }}>{TEXT_SIZES[k].label}</Text></TouchableOpacity>)}</View>
      <View style={{ flexDirection: "row", gap: 6 }}>{(Object.keys(LANGS) as Lang[]).map(k => <TouchableOpacity key={k} onPress={() => setTheme({ lang: k })}
        style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: t.lang === k ? C.green : C.panel2 }}>
        <Text style={{ color: t.lang === k ? C.greenDark : C.text, fontWeight: "900" }}>{LANGS[k]}</Text></TouchableOpacity>)}</View>
      <Btn kind="link" title="Full appearance screen →" onPress={() => onOpen("Appearance")}/>
    </Section>
    <Section icon="📱" title="Phone access" sub="What Sakuna is allowed to use">
      <Check ok={checks.notifications ?? null} label="Notifications (reminders, approvals)" fix="Fix" onFix={() => void Linking.openSettings()}/>
      <Check ok={checks.usage ?? null} label="Usage access (screen time, sleep detection)" fix="Allow" onFix={() => Shield?.openUsageAccessSettings()}/>
      <Check ok={checks.blocking ?? null} label="Accessibility (Shield app blocking)" fix="Allow" onFix={() => Shield?.openAccessibilitySettings()}/>
      <Check ok={checks.health ?? null} label="Health Connect (Mi Band steps, sleep, workouts)" fix="Connect" onFix={() => void connectHealthConnect().then(() => refreshChecks())}/>
      <Btn kind="outline" title="↻ Check again" onPress={() => void refreshChecks()}/>
    </Section>
    <Section icon="🔐" title="Privacy, AI & security" sub="AI sharing, approvals, app lock">
      <Line><Text style={{ color: C.text, flex: 1 }}>🔒 App lock (fingerprint / PIN)</Text><Switch value={lock} onValueChange={v => void setLockEnabled(v).then(r => { onNotice(r.message); setLock(r.ok ? v : !v); })}/></Line>
      {[["AI", "🔐 AI usage & what's shared"], ["Approvals", "✅ Approvals waiting"], ["Memory", "🧩 What Sakuna remembers"]].map(([k, l]) =>
        <TouchableOpacity key={k} onPress={() => onOpen(k)}><Text style={{ color: C.green, paddingVertical: 4 }}>{`${l} →`}</Text></TouchableOpacity>)}
    </Section>
    <Section icon="💾" title="Your data" sub="Export and Google Drive backup">
      <Muted small>One JSON file with everything you've stored (passwords, tokens and encrypted fields are left out).</Muted>
      <Btn kind="outline" title="⬇ Export my data" onPress={exportData}/>
      <DriveBackup api={api} onError={onError} onNotice={onNotice}/>
    </Section>
    <Section icon="❓" title="Help & about" sub="How things work">
      {["Today: your 24-hour ring fills as you log hours; grey means not logged yet.", "Approvals: Sakuna and outside AI tools only propose changes; nothing happens until you approve.",
        "Sleep comes from your phone's screen-off time or your Mi Band.", "Learning feed and reels show only educational, motivational, technology and psychology content.",
        "Without an AI key everything still works with plain rules."].map(x => <Muted key={x} small>{`• ${x}`}</Muted>)}
      <Btn kind="outline" title="📋 Send a problem report" onPress={() => void errorReport().then(t => Share.share({ message: t, title: "Sakuna problem report" }))}/>
      <Btn kind="outline" title="Run the setup guide again" onPress={() => void api("/settings/prefs", "PATCH", { onboarding_done: false }).then(() => onNotice("Reopen the app to see the setup guide")).catch(e => onError(msg(e)))}/>
    </Section>
    <Btn kind="danger" title="Sign out" onPress={() => Alert.alert("Sign out?", "", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: signOut }])}/>
  </Screen>;
}

const HABITS = ["💧 Drink 8 glasses of water", "📖 Read 10 pages", "🏋️ Gym / workout", "🇩🇪 Learn German 15 min", "🧘 Meditate 5 min", "🚶 Walk 20 minutes", "📵 No phone in bed", "✍️ Journal 3 lines"];

/** First-run setup guide: name & times, goals and habits, permissions, look. About two minutes. */
export function Onboarding({ api, onDone }: { api: Api; onDone: () => void }) {
  const [step, setStep] = useState(0); const [name, setName] = useState(""); const [wake, setWake] = useState("06:30"); const [sleep, setSleep] = useState("22:30");
  const [work, setWork] = useState(["08:30", "17:30"]); const [goals, setGoals] = useState(["", "", ""]); const [habits, setHabits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const t = theme();
  const finish = async () => {
    setBusy(true);
    try {
      const body: Row = {};
      if (name.trim()) body.full_name = name.trim();
      if (TIME.test(wake)) body.wake_time = wake; if (TIME.test(sleep)) body.sleep_time = sleep;
      if (TIME.test(work[0])) body.work_start = work[0]; if (TIME.test(work[1])) body.work_end = work[1];
      if (Object.keys(body).length) await api("/profile", "PATCH", body).catch(() => undefined);
      for (const g of goals.filter(x => x.trim())) await api("/goals", "POST", { title: g.trim().slice(0, 200), priority: "high" }).catch(() => undefined);
      for (const h of habits) await api("/habits", "POST", { name: h.slice(2).trim(), icon: h.slice(0, 2).trim(), schedule: "daily" }).catch(() => undefined);
      const r = await api<Row>("/settings/prefs", "PATCH", { onboarding_done: true });
      await applyNotificationPrefs(api, r.notifications).catch(() => undefined);
    } finally { setBusy(false); onDone(); }
  };
  const steps = [
    <View key="0" style={{ gap: 12 }}><Text style={{ color: C.text, fontSize: 28, fontWeight: "900" }}>Welcome to Sakuna 👋</Text>
      <Muted>Two minutes to make the app yours: your day, your goals, your habits and your look.</Muted>
      <Field label="What should I call you?" value={name} onChangeText={setName} placeholder="Your name"/></View>,
    <View key="1" style={{ gap: 12 }}><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>⏰ Your day</Text>
      <Line><Field label="Wake up" value={wake} onChangeText={setWake} style={{ flex: 1 }}/><Field label="Sleep" value={sleep} onChangeText={setSleep} style={{ flex: 1 }}/></Line>
      <Line><Field label="Work starts" value={work[0]} onChangeText={v => setWork([v, work[1]])} style={{ flex: 1 }}/><Field label="Work ends" value={work[1]} onChangeText={v => setWork([work[0], v])} style={{ flex: 1 }}/></Line>
      <Muted small>Used for your plan, check-ins, sleep target and quiet hours. Change any time in Settings.</Muted></View>,
    <View key="2" style={{ gap: 12 }}><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>🎯 Top 3 goals</Text>
      {goals.map((g, i) => <Field key={i} value={g} onChangeText={v => setGoals(x => x.map((y, k) => (k === i ? v : y)))} placeholder={["e.g. Gym 3x a week", "e.g. German B1 by June", "e.g. Save LKR 500,000"][i]}/>)}
      <Text style={{ color: C.text, fontWeight: "900", marginTop: 6 }}>🔁 Pick a few daily habits</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{HABITS.map(h => { const on = habits.includes(h);
        return <TouchableOpacity key={h} onPress={() => setHabits(x => (on ? x.filter(y => y !== h) : [...x, h]))} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
          backgroundColor: on ? C.green : C.panel2 }}><Text style={{ color: on ? C.greenDark : C.text, fontWeight: "700" }}>{h}</Text></TouchableOpacity>; })}</View></View>,
    <View key="3" style={{ gap: 12 }}><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>📱 Let Sakuna help</Text>
      <Muted>Reminders, approvals and the morning brief need notifications. Screen time and sleep need usage access. You can change these later in Settings → Phone access.</Muted>
      <Btn title="🔔 Allow notifications" onPress={() => void notificationsAllowed().then(ok => (ok ? undefined : Linking.openSettings()))}/>
      {Shield && <Btn kind="outline" title="📊 Allow usage access" onPress={() => Shield?.openUsageAccessSettings()}/>}
      <Btn kind="outline" title="❤️ Connect Mi Band (Health Connect)" onPress={() => void connectHealthConnect()}/></View>,
    <View key="4" style={{ gap: 12 }}><Text style={{ color: C.text, fontSize: 24, fontWeight: "900" }}>🎨 Your look</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(Object.keys(MODES) as Mode[]).map(m => <TouchableOpacity key={m} onPress={() => { setTheme({ mode: m }); setStep(4); }}
        style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: t.mode === m ? C.green : C.panel2 }}><Text style={{ color: t.mode === m ? C.greenDark : C.text, fontWeight: "700" }}>{MODES[m]}</Text></TouchableOpacity>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{(Object.keys(ACCENTS) as Accent[]).map(a => <TouchableOpacity key={a} onPress={() => setTheme({ accent: a })}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.resolved === "light" ? ACCENTS[a].light : ACCENTS[a].dark, borderWidth: t.accent === a ? 3 : 0, borderColor: C.text }}/>)}</View></View>,
  ];
  return <Modal visible animationType="slide" onRequestClose={() => undefined}>
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: 50 }}>
      <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 20 }}>{steps.map((_, i) => <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= step ? C.green : C.line }}/>)}</View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">{steps[step]}</ScrollView>
      <View style={{ flexDirection: "row", gap: 10, padding: 20 }}>
        {step > 0 ? <Btn kind="outline" title="Back" onPress={() => setStep(step - 1)} style={{ flex: 1 }}/> : <Btn kind="link" title="Skip setup" onPress={() => void finish()} style={{ flex: 1 }}/>}
        {step < steps.length - 1 ? <Btn title="Next" onPress={() => setStep(step + 1)} style={{ flex: 1 }}/> : <Btn title="Let's go 🚀" busy={busy} onPress={() => void finish()} style={{ flex: 1 }}/>}
      </View>
    </View>
  </Modal>;
}


/** Google Calendar and Gmail: connect (opens Google in your browser), check, disconnect. */
function Connections({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/integrations").then(setV).catch(() => setV(null)); }, [api]);
  useEffect(() => {
    load();
    const sub = AppState.addEventListener("change", st => { if (st === "active") load(); });   // back from the browser
    return () => sub.remove();
  }, [load]);
  const connect = (p: string, write = false) => void api<Row>(`/integrations/${p}/connect`, "POST", { write }).then(r => {
    onNotice("Sign in with Google in your browser, allow access, then come back to Sakuna."); void Linking.openURL(String(r.auth_url)); }).catch(e => onError(msg(e)));
  const check = (p: string) => void api<Row>(`/integrations/${p}/check`, "POST").then(r => { onNotice(r.ok === false ? "Connection needs fixing" : "Connection works ✓"); load(); }).catch(e => onError(msg(e)));
  const off = (p: string) => Alert.alert("Disconnect?", "Sakuna stops reading it; you can reconnect any time.", [{ text: "Cancel", style: "cancel" },
    { text: "Disconnect", style: "destructive", onPress: () => void api(`/integrations/${p}`, "DELETE").then(() => { onNotice("Disconnected"); load(); }).catch(e => onError(msg(e))) }]);
  const row = (p: string, icon: string, name: string, what: string) => {
    const c = v?.[p]?.connection as Row | null; const status = c?.status || "not connected";
    return <View key={p} style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: C.panel2 }}>
      <Line><Text style={{ fontSize: 22 }}>{icon}</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{name}</Text>
        <Muted small>{status === "connected" ? `✅ Connected${c?.email ? ` · ${c.email}` : ""}` : status === "expired" ? "⚠️ Expired: reconnect" : what}</Muted></View></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {status !== "connected" ? <Btn title="Connect" onPress={() => connect(p, p === "calendar")} style={{ flex: 1 }}/>
          : <><Btn kind="outline" title="Check" onPress={() => check(p)} style={{ flex: 1 }}/><Btn kind="link" title="Disconnect" onPress={() => off(p)}/></>}
      </View>
    </View>;
  };
  const configured = v?.calendar?.configured !== false;
  return <Section icon="🔗" title="Connections" sub="Google Calendar and Gmail">
    {!v ? <Muted small>Loading…</Muted> : !configured ? <Text style={{ color: C.amber }}>Google sign-in isn't set up on the server yet (GOOGLE_CLIENT_ID / SECRET on Render).</Text> : <>
      {row("calendar", "📅", "Google Calendar", "See events on Today and add tasks with Google reminders")}
      {row("gmail", "📧", "Gmail (read-only)", "Unread emails in your morning brief; never sends or deletes")}
      {row("drive", "💾", "Google Drive (backups)", "Weekly backup to a “Sakuna backups” folder; sees only files Sakuna makes")}
    </>}
    <Muted small>Sign-in opens in your phone's browser (Google doesn't allow sign-in inside apps). After allowing, come back here; it refreshes by itself.</Muted>
  </Section>;
}


/** Google Drive backup: back up now, and every Sunday evening if switched on. */
function DriveBackup({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api<Row>("/backup/drive").then(setV).catch(() => setV(null)); }, [api]);
  useEffect(() => { load(); }, [load]);
  if (!v) return null;
  if (!v.connected) return <Muted small>💾 Connect Google Drive in Connections above to back up automatically every week.</Muted>;
  const now = () => { setBusy(true); void api<Row>("/backup/drive", "POST").then(r => r.ok ? onNotice(`💾 Saved to Google Drive: ${r.name}`) : onError(String(r.message))).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  return <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: C.panel2 }}>
    <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>💾 Every Sunday at 20:00, to Google Drive</Text>
      <Switch value={!!v.auto} onValueChange={on => void api<Row>("/backup/drive/auto", "PUT", { on }).then(setV).catch(e => onError(msg(e)))}/></Line>
    <Btn kind="outline" title={busy ? "Backing up…" : "Back up to Google Drive now"} disabled={busy} onPress={now}/>
    <Muted small>Saved in a “Sakuna backups” folder; the newest 8 are kept. Sakuna can only see files it created there.</Muted>
  </View>;
}
