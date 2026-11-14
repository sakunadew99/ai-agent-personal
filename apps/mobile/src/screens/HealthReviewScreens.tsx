import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { connectHealthConnect, getHealthConnectStatus, readTodayHealth, type HealthConnectStatus, type TodayHealth } from "../health/health-connect";
import { Btn, C, Card, Empty, Field, H1, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const LAST_SYNC = "sakuna.lastHealthSync";
const AUTO_SYNC_EVERY_MS = 30 * 60 * 1000;

/** Health Connect sync (Mi Band → Mi Fitness → Health Connect → Sakuna), with automatic sync on open. */
export function HealthScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [status, setStatus] = useState<HealthConnectStatus | null>(null);
  const [today, setToday] = useState<TodayHealth | null>(null);
  const [summary, setSummary] = useState<Row>({});
  const [lastSync, setLastSync] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  const sync = useCallback(async (quiet = false) => {
    setBusy(true);
    try {
      const result = await readTodayHealth();
      const current = await api<Row>("/health/summary");
      const records: Row[] = Array.isArray(current.records) ? current.records : [];
      const sleeps: Row[] = Array.isArray(current.sleep) ? current.sleep : [];
      const savedToday = (metric: string, value: number) => records.some(r => r.metric === metric && r.source === "health_connect" && Number(r.value) === value && new Date(r.recorded_at).toDateString() === new Date().toDateString());
      let saved = 0;
      if (result.steps && !savedToday("steps", result.steps.value)) { await api("/health/records", "POST", { metric: "steps", value: result.steps.value, unit: "steps", recorded_at: result.steps.recordedAt, source: "health_connect" }); saved++; }
      if (result.heartRate && !savedToday("heart_rate", result.heartRate.value)) { await api("/health/records", "POST", { metric: "heart_rate", value: result.heartRate.value, unit: "bpm", recorded_at: result.heartRate.recordedAt, source: "health_connect" }); saved++; }
      if (result.sleep && !sleeps.some(r => r.source === "health_connect" && new Date(r.start_at).getTime() === new Date(result.sleep!.startAt).getTime())) {
        await api("/health/sleep", "POST", { start_at: result.sleep.startAt, end_at: result.sleep.endAt, stages: { stage_codes: result.sleep.stages }, source: "health_connect" }); saved++;
      }
      setToday(result); setSummary(await api<Row>("/health/summary"));
      const now = Date.now(); setLastSync(now); await SecureStore.setItemAsync(LAST_SYNC, String(now)).catch(() => undefined);
      if (!quiet) onNotice(saved ? `Synced ${saved} new record${saved === 1 ? "" : "s"} from Health Connect.` : "Already up to date. If numbers look old, open Mi Fitness so the band syncs first.");
    } catch (reason) { if (!quiet) onError(reason instanceof Error ? reason.message : "Could not sync"); }
    finally { setBusy(false); }
  }, [api, onError, onNotice]);

  useEffect(() => {
    void (async () => {
      const s = await getHealthConnectStatus(); setStatus(s);
      try { setSummary(await api<Row>("/health/summary")); } catch { /* shown on sync */ }
      const saved = Number(await SecureStore.getItemAsync(LAST_SYNC).catch(() => null)) || 0; setLastSync(saved);
      if (s.connected && Date.now() - saved > AUTO_SYNC_EVERY_MS) void sync(true);   // automatic, silent
    })();
  }, [api, sync]);

  async function connect() {
    setBusy(true);
    try { if (await connectHealthConnect()) { setStatus(await getHealthConnectStatus()); await sync(); } else onError("Access was not granted. You can try again any time."); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Could not connect"); } finally { setBusy(false); }
  }

  const records: Row[] = Array.isArray(summary.records) ? summary.records : [];
  const latest = (metric: string) => records.find(r => r.metric === metric);
  const steps = today?.steps?.value ?? Number(latest("steps")?.value ?? 0);
  const hr = today?.heartRate?.value ?? latest("heart_rate")?.value;
  const sleeps: Row[] = Array.isArray(summary.sleep) ? summary.sleep : [];
  const sleepMin = today?.sleep?.minutes ?? Number(sleeps[0]?.duration_minutes ?? 0);

  return <Screen>
    <Card accent={!!status?.connected}>
      <Kicker>HEALTH CONNECT · MI BAND</Kicker>
      <H2>{status?.connected ? "Connected" : "Not connected yet"}</H2>
      <Muted>{status?.reason || "Checking…"}</Muted>
      {!status?.connected ? <Btn title="Connect Health Connect" onPress={() => void connect()} busy={busy}/>
        : <Btn title="Sync now" onPress={() => void sync()} busy={busy}/>}
      {!!lastSync && <Muted small>Last synced {new Date(lastSync).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Sakuna syncs automatically when you open this screen (every 30 min at most).</Muted>}
    </Card>

    <Card><Kicker>TODAY</Kicker>
      <Line><View style={{ flex: 1 }}><Muted small>Steps</Muted><H1>{steps ? steps.toLocaleString() : "—"}</H1><Progress value={steps / 80}/><Muted small>goal 8,000</Muted></View>
        <View style={{ flex: 1 }}><Muted small>Heart rate</Muted><H1>{hr ? `${hr}` : "—"}</H1><Muted small>bpm, latest</Muted></View></Line>
      <Line><View style={{ flex: 1 }}><Muted small>Last sleep</Muted><H2>{sleepMin ? `${Math.floor(sleepMin / 60)} h ${sleepMin % 60} min` : "—"}</H2></View></Line>
      <Muted small>Personal records, not medical advice.</Muted>
    </Card>

    <Card><Kicker>SET UP MI FITNESS (ONCE)</Kicker>
      {[
        "Install Health Connect from Play Store if your phone doesn't have it (built into Android 14+).",
        "Open Mi Fitness → Profile → Settings (or Third-party data) → Health Connect → turn on Steps, Heart rate and Sleep.",
        "Keep the band paired. Mi Fitness syncs it over Bluetooth; open Mi Fitness once if numbers look old.",
        "Here, tap Connect Health Connect and allow Steps, Heart rate and Sleep.",
        "OPPO: Settings → Battery → Mi Fitness → Allow background activity, so it keeps syncing.",
      ].map((step, i) => <Line key={i} style={{ alignItems: "flex-start" }}><Text style={{ color: C.green, fontWeight: "800", width: 18 }}>{i + 1}</Text><Text style={{ color: C.text, flex: 1, lineHeight: 20 }}>{step}</Text></Line>)}
      <Btn kind="outline" title="Open Health Connect in Play Store" onPress={() => void Linking.openURL("market://details?id=com.google.android.apps.healthdata").catch(() => Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"))}/>
      <Muted small>Menu names in Mi Fitness can differ by version. Band 10 support depends on Mi Fitness writing to Health Connect; check that numbers match the band for a few days.</Muted>
    </Card>
  </Screen>;
}

/** Weekly review: what happened, a few code-computed patterns, and up to three changes for next week. */
export function ReviewScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [sessions, setSessions] = useState<Row[]>([]);
  const [dash, setDash] = useState<Row>({});
  const [changes, setChanges] = useState(["", "", ""]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([api<Row[]>("/tasks"), api<Row[]>("/focus/sessions"), api<Row>("/dashboard")])
    .then(([t, s, d]) => { setTasks(t); setSessions(s); setDash(d); }).catch(e => onError(String(e))); }, [api, onError]);

  const week = useMemo(() => {
    const from = Date.now() - 7 * 86400000;
    const inWeek = (v: unknown) => !!v && new Date(String(v)).getTime() >= from;
    const done = tasks.filter(t => t.status === "done" && inWeek(t.completed_at));
    const focus = sessions.filter(s => s.ended_at && inWeek(s.started_at));
    const focusMin = focus.reduce((n, s) => n + Math.max(0, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000)), 0);
    const focusDays = new Set(focus.map(s => new Date(s.started_at).toDateString())).size;
    const sleep: Row[] = (dash.sleep || []).filter((s: Row) => inWeek(s.start_at));
    const sleepAvg = sleep.length ? sleep.reduce((n, s) => n + Number(s.duration_minutes || 0), 0) / sleep.length / 60 : null;
    const habits: Row[] = dash.habits || []; const logs: Row[] = dash.habit_logs || [];
    const habitRate = habits.length ? Math.round(logs.length / (habits.length * 7) * 100) : null;
    const overdue = tasks.filter(t => t.status !== "done" && t.due_at && new Date(t.due_at).getTime() < Date.now()).length;
    const patterns: string[] = [];
    patterns.push(focusDays >= 5 ? `Focus on ${focusDays}/7 days. Keep the rhythm.` : `Focus on ${focusDays}/7 days. One 30-minute block a day is a good floor.`);
    if (sleepAvg !== null) patterns.push(sleepAvg < 7 ? `Sleep averaged ${sleepAvg.toFixed(1)} h, under 7 h. Protect sleep before adding work.` : `Sleep averaged ${sleepAvg.toFixed(1)} h. Well rested.`);
    if (overdue) patterns.push(`${overdue} overdue task${overdue === 1 ? "" : "s"}: move, split or drop.`);
    return { done, focusMin, focusDays, sleepAvg, habitRate, patterns };
  }, [tasks, sessions, dash]);

  async function save() {
    const filled = changes.map(c => c.trim()).filter(Boolean); if (!filled.length) return;
    setBusy(true);
    try {
      const label = `${new Date(Date.now() - 6 * 86400000).toLocaleDateString([], { month: "short", day: "numeric" })} – ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`;
      await api("/memories", "POST", { content: `Weekly review (${label}). Changes for next week: ${filled.map((c, i) => `${i + 1}) ${c}`).join(" ")}`, category: "decision" });
      setChanges(["", "", ""]); onNotice("Review saved to Memory.");
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not save"); } finally { setBusy(false); }
  }

  return <Screen>
    <H1>Weekly review</H1><Muted>Ten minutes: see what happened, notice one pattern, pick at most three changes.</Muted>
    <Card><Line>
      {[["Tasks done", String(week.done.length)], ["Focus", `${(week.focusMin / 60).toFixed(1)} h`], ["Habits", week.habitRate === null ? "—" : `${week.habitRate}%`], ["Sleep", week.sleepAvg === null ? "—" : `${week.sleepAvg.toFixed(1)} h`]]
        .map(([k, v]) => <View key={k} style={{ flex: 1 }}><Muted small>{k}</Muted><H2>{v}</H2></View>)}
    </Line></Card>
    <Card><Kicker>PATTERNS</Kicker>{week.patterns.map(p => <Text key={p} style={{ color: C.text, lineHeight: 20 }}>• {p}</Text>)}</Card>
    <Card><Kicker>WINS</Kicker>{week.done.length ? week.done.slice(0, 8).map(t => <Text key={t.id} style={{ color: C.text }}>✓ {t.title}</Text>) : <Empty>No tasks completed this week yet.</Empty>}</Card>
    <Card><Kicker>UP TO THREE CHANGES FOR NEXT WEEK</Kicker>
      {changes.map((c, i) => <Field key={i} value={c} onChangeText={v => setChanges(changes.map((x, j) => j === i ? v : x))} placeholder={["Shorter focus blocks before lunch", "In bed by 22:30 on weeknights", "Two workouts: Tue and Sat"][i]}/>)}
      <Btn title="Save my review" onPress={() => void save()} busy={busy} disabled={!changes.some(c => c.trim())}/>
    </Card>
  </Screen>;
}

export type MoreTarget = "Assistant" | "Life" | "Learning" | "Jobs" | "Money" | "Rewards" | "AI" | "Study" | "Balance" | "Vault" | "Finance" | "Health" | "Memory" | "Review" | "Approvals" | "Profile";
const MENU: { key: MoreTarget; icon: string; title: string; hint: string }[] = [
  { key: "Assistant", icon: "✳", title: "Assistant", hint: "Chat with Sakuna" },
  { key: "Life", icon: "◫", title: "My life", hint: "Tasks, goals, habits" },
  { key: "Learning", icon: "✎", title: "Learning", hint: "Flashcards & mistakes" },
  { key: "Jobs", icon: "▣", title: "Job tracker", hint: "Applications & follow-ups" },
  { key: "Rewards", icon: "★", title: "Rewards", hint: "Points, streak, treats" },
  { key: "Study", icon: "✈", title: "Study abroad", hint: "Programs, checklist" },
  { key: "Balance", icon: "☀", title: "Life balance", hint: "Areas: target vs actual" },
  { key: "Vault", icon: "▤", title: "Documents", hint: "Passport, visa, expiry" },
  { key: "Money", icon: "◎", title: "Money hub", hint: "Balance, wishes, buy list" },
  { key: "Finance", icon: "$", title: "Finance", hint: "Spending & income" },
  { key: "Health", icon: "♡", title: "Health & Mi Band", hint: "Steps, sleep, heart rate" },
  { key: "Memory", icon: "◈", title: "Memory", hint: "What Sakuna remembers" },
  { key: "Review", icon: "▤", title: "Weekly review", hint: "Plan vs actual" },
  { key: "Approvals", icon: "✓", title: "Approvals", hint: "AI proposals to confirm" },
  { key: "AI", icon: "◐", title: "AI usage", hint: "Meter, off switch, privacy" },
  { key: "Profile", icon: "◉", title: "Profile", hint: "Account & sign out" },
];

export function MoreScreen({ open }: { open: (t: MoreTarget) => void }) {
  return <Screen>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {MENU.map(item => <TouchableOpacity key={item.key} onPress={() => open(item.key)} style={{ width: "48%", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 }}>
        <Text style={{ color: C.green, fontSize: 22 }}>{item.icon}</Text>
        <Text style={{ color: C.text, fontWeight: "700", fontSize: 15 }}>{item.title}</Text>
        <Text style={{ color: C.muted, fontSize: 12 }}>{item.hint}</Text>
      </TouchableOpacity>)}
    </View>
  </Screen>;
}
