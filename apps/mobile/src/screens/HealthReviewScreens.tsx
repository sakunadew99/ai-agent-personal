import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { peek, type ApiRecord as Row } from "../api";
import { Bars, Hero, LineChart, Ring, StatTile, TileRow } from "../charts";
import { connectHealthConnect, getHealthConnectStatus, type HealthConnectStatus, type TodayHealth } from "../health/health-connect";
import { syncHealthNow } from "../health/autosync";
import { HealthAdviceCard } from "./WellbeingScreens";
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
  const [trends, setTrends] = useState<Row | null>(() => peek<Row>("/health/trends?days=14"));
  const [showSetup, setShowSetup] = useState(false);
  const loadTrends = useCallback(() => { api<Row>("/health/trends?days=14").then(setTrends).catch(() => undefined); }, [api]);

  const sync = useCallback(async (quiet = false) => {
    setBusy(true);
    try {
      const { saved, today: result } = await syncHealthNow(api);
      setToday(result); setSummary(await api<Row>("/health/summary")); loadTrends();
      setLastSync(Date.now());
      if (!quiet) onNotice(saved ? `Synced ${saved} new record${saved === 1 ? "" : "s"} from Health Connect.` : "Already up to date. If numbers look old, open Mi Fitness so the band syncs first.");
    } catch (reason) { if (!quiet) onError(reason instanceof Error ? reason.message : "Could not sync"); }
    finally { setBusy(false); }
  }, [api, onError, onNotice, loadTrends]);

  useEffect(() => {
    loadTrends();
    void (async () => {
      const s = await getHealthConnectStatus(); setStatus(s);
      try { setSummary(await api<Row>("/health/summary")); } catch { /* shown on sync */ }
      const saved = Number(await SecureStore.getItemAsync(LAST_SYNC).catch(() => null)) || 0; setLastSync(saved);
      if (s.connected && Date.now() - saved > AUTO_SYNC_EVERY_MS) void sync(true);   // automatic, silent
    })();
  }, [api, sync, loadTrends]);

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

  const days: Row[] = Array.isArray(trends?.days) ? trends!.days : [];
  const week: Row = trends?.week || {};
  const stepGoal = Number(trends?.goals?.steps || 8000), sleepGoal = Number(trends?.goals?.sleep_hours || 7.5);
  const score = Number(trends?.score ?? Math.round(Math.min(1, steps / stepGoal) * 100));

  return <Screen>
    <Hero kicker="HEALTH · MI BAND" title="Body" accent="battery"
      sub={status?.connected ? `Connected${lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : status?.reason || "Checking Health Connect…"}
      right={<Ring value={score} size={104} label={`${score}`} sub="SCORE"/>}>
      {!status?.connected ? <Btn title="Connect Health Connect" onPress={() => void connect()} busy={busy}/>
        : <Btn kind="outline" title="Sync now ↻" onPress={() => void sync()} busy={busy}/>}
      {status?.connected && /workouts/.test(status.reason) && <>
        <Btn kind="outline" title="🏊 Allow workouts & swims" onPress={() => void connect()} busy={busy}/>
        <Muted small>Lets Sakuna read Mi Band workouts (swimming, running…) and distance. Swims also log to your Swimming skill.</Muted></>}
    </Hero>

    <TileRow>
      <StatTile label="Steps" icon="👟" tone="green" value={Number(steps || 0).toLocaleString()} hint={`${Math.round(Math.min(100, (steps / stepGoal) * 100))}% of ${stepGoal.toLocaleString()}`}/>
      <StatTile label="Heart" icon="❤️" tone="red" value={hr ? `${hr}` : "—"} hint="bpm, latest"/>
    </TileRow>
    <TileRow>
      <StatTile label="Sleep" icon="🌙" tone="violet" value={sleepMin ? `${Math.floor(sleepMin / 60)}h ${sleepMin % 60}m` : "—"} hint={`goal ${sleepGoal} h`}/>
      <StatTile label="Active week" icon="🏋️" tone="blue" value={`${week.active_days ?? 0}/7`} hint={`${week.workout_minutes ?? 0} min workouts`}/>
    </TileRow>

    {days.length > 0 && <>
      <Card><Line style={{ justifyContent: "space-between" }}><Kicker>STEPS · 14 DAYS</Kicker><Muted small>{`avg ${Math.round(Number(week.avg_steps || 0)).toLocaleString()}/day`}</Muted></Line>
        <Bars data={days.map((d, i) => ({ label: d.label, value: Number(d.steps), highlight: i === days.length - 1, color: Number(d.steps) >= stepGoal ? C.green : "#2f6b4c" }))}
          goal={stepGoal} format={n => Math.round(n).toLocaleString()}/>
        <Muted small>{`Goal reached ${week.step_goal_days ?? 0} of the last 7 days. Tap a bar for the number.`}</Muted></Card>
      <Card><Line style={{ justifyContent: "space-between" }}><Kicker>SLEEP HOURS</Kicker><Muted small>{week.avg_sleep_hours ? `avg ${week.avg_sleep_hours} h` : "no sleep data yet"}</Muted></Line>
        <Bars data={days.map((d, i) => ({ label: d.label, value: Number(d.sleep_hours), highlight: i === days.length - 1, color: Number(d.sleep_hours) >= sleepGoal ? "#b48cff" : "#4e3d78" }))}
          goal={sleepGoal} height={110} format={n => `${n.toFixed(1)}h`}/></Card>
      {days.some(d => d.heart_rate) && <Card><Line style={{ justifyContent: "space-between" }}><Kicker>HEART RATE</Kicker><Muted small>{week.avg_heart_rate ? `avg ${week.avg_heart_rate} bpm` : ""}</Muted></Line>
        <LineChart series={[{ values: days.map(d => (d.heart_rate ? Number(d.heart_rate) : null)), color: C.red }]} labels={days.map(d => d.label)} height={110} format={n => `${Math.round(n)} bpm`}/></Card>}
    </>}
    <Muted small>{trends?.note || "Personal records, not medical advice."}</Muted>

    <HealthAdviceCard api={api} onError={onError}/>
    <Card><TouchableOpacity onPress={() => setShowSetup(v => !v)}><Line style={{ justifyContent: "space-between" }}><Kicker>SET UP MI FITNESS (ONCE)</Kicker><Text style={{ color: C.green }}>{showSetup ? "Hide" : "Show"}</Text></Line></TouchableOpacity>
      {showSetup && <>
      {[
        "Install Health Connect from Play Store if your phone doesn't have it (built into Android 14+).",
        "Open Mi Fitness → Profile → Settings (or Third-party data) → Health Connect → turn on Steps, Heart rate and Sleep.",
        "Keep the band paired. Mi Fitness syncs it over Bluetooth; open Mi Fitness once if numbers look old.",
        "Here, tap Connect Health Connect and allow Steps, Heart rate and Sleep.",
        "OPPO: Settings → Battery → Mi Fitness → Allow background activity, so it keeps syncing.",
      ].map((step, i) => <Line key={i} style={{ alignItems: "flex-start" }}><Text style={{ color: C.green, fontWeight: "800", width: 18 }}>{i + 1}</Text><Text style={{ color: C.text, flex: 1, lineHeight: 20 }}>{step}</Text></Line>)}
      <Btn kind="outline" title="Open Health Connect in Play Store" onPress={() => void Linking.openURL("market://details?id=com.google.android.apps.healthdata").catch(() => Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata"))}/>
      <Muted small>Menu names in Mi Fitness can differ by version. Band 10 support depends on Mi Fitness writing to Health Connect; check that numbers match the band for a few days.</Muted>
      </>}
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

export type MoreTarget = "Ask" | "Discipline" | "Notes" | "Kegel" | "Reading" | "Resources" | "Content" | "Travel" | "Fitness" | "Wealth" | "Roleplay" | "Dreams" | "Skin" | "Meds" | "Skills" | "Speak" | "Schedule" | "Videos" | "Day" | "Gym" | "Brain" | "Assistant" | "Journal" | "Invest" | "News" | "You" | "Team" | "Exams" | "Life" | "Learning" | "Jobs" | "Money" | "Rewards" | "AI" | "Study" | "Balance" | "Vault" | "Finance" | "Health" | "Memory" | "Review" | "Approvals" | "Profile";
