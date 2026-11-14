import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiRequest as request, getServerUrl, loadServerUrl, saveServerUrl, type ApiRecord as Row } from "./src/api";
import { connectHealthConnect, getHealthConnectStatus, readTodayHealth, type TodayHealth } from "./src/health/health-connect";

type Tab = "Home" | "Plan" | "Capture" | "AI" | "Health" | "Focus" | "Profile";

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [server, setServer] = useState(getServerUrl());
  const [showServer, setShowServer] = useState(false);
  const [token, setToken] = useState("");
  const [user, setUser] = useState<Row>({});
  const [tab, setTab] = useState<Tab>("Home");
  const [dashboard, setDashboard] = useState<Row>({});
  const [plan, setPlan] = useState<Row>({});
  const [captures, setCaptures] = useState<Row[]>([]);
  const [finance, setFinance] = useState<Row>({});
  const [health, setHealth] = useState<Row>({});
  const [captureText, setCaptureText] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatReply, setChatReply] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(25 * 60);
  const [focusActive, setFocusActive] = useState(false);
  const [todayHealth, setTodayHealth] = useState<TodayHealth>({ steps: null, heartRate: null, sleep: null });

  const loadTab = useCallback(async (selected: Tab, currentToken = token) => {
    if (!currentToken) return;
    setError("");
    try {
      if (selected === "Home") {
        const [dash, money, activity] = await Promise.all([
          request<Row>("/dashboard", currentToken), request<Row>("/finance/summary", currentToken), request<Row>("/health/summary", currentToken),
        ]);
        setDashboard(dash); setFinance(money); setHealth(activity);
      } else if (selected === "Plan") {
        setPlan(await request<Row>("/planner/daily", currentToken));
      } else if (selected === "Capture") {
        setCaptures(await request<Row[]>("/capture", currentToken));
      } else if (selected === "Profile") {
        const me = await request<Row>("/me", currentToken); setUser(me.user || {});
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load your data"); }
  }, [token]);

  useEffect(() => { if (token) void loadTab(tab); }, [token, tab, loadTab]);

  useEffect(() => {
    if (!focusActive) return;
    const timer = setInterval(() => setFocusSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [focusActive]);

  useEffect(() => { if (focusSeconds === 0) setFocusActive(false); }, [focusSeconds]);

  useEffect(() => { void loadServerUrl().then(setServer); }, []);

  async function authenticate() {
    setBusy(true); setError("");
    try {
      setServer(await saveServerUrl(server));
      const route = registerMode ? "/auth/register" : "/auth/login";
      const result = await request<Row>(route, "", "POST", registerMode ? { email, password, full_name: name } : { email, password });
      setToken(result.access_token); setUser(result.user || {}); setTab("Home");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in"); if (reason instanceof Error && reason.message.startsWith("Can't reach")) setShowServer(true); }
    finally { setBusy(false); }
  }

  async function saveCapture() {
    if (!captureText.trim()) return;
    setBusy(true);
    try { await request("/capture", token, "POST", { text: captureText.trim() }); setCaptureText(""); setNotice("Added to your inbox for review."); await loadTab("Capture"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Capture failed"); }
    finally { setBusy(false); }
  }

  async function confirmCapture(id: string) {
    try { await request(`/capture/${id}/confirm`, token, "POST", {}); setNotice("Capture saved"); await loadTab("Capture"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not process capture"); }
  }

  async function sendMessage() {
    if (!chatText.trim()) return;
    setBusy(true);
    try { const answer = await request<Row>("/chat", token, "POST", { message: chatText.trim() }); setChatReply(answer.reply); setChatText(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Assistant is unavailable"); }
    finally { setBusy(false); }
  }

  async function generatePlan() {
    setBusy(true);
    try { setPlan(await request<Row>("/planner/generate", token, "POST", { scope: "day" })); setNotice("Today’s plan is ready"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate a plan"); }
    finally { setBusy(false); }
  }

  async function connectHealth() {
    setBusy(true); setError("");
    try {
      const connected = await connectHealthConnect();
      if (!connected) throw new Error("Step access was not granted. You can connect later from this screen.");
      const result = await readTodayHealth(); setTodayHealth(result); setNotice("Health Connect is connected. Available Mi Band health data was read from your device.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect Health Connect"); }
    finally { setBusy(false); }
  }

  async function syncHealth() {
    setBusy(true); setError("");
    try {
      const result = await readTodayHealth();
      const records: Row[] = Array.isArray(health.records) ? health.records : [];
      const alreadySavedToday = (metric: string, value: number) => records.some(record => record.metric === metric && record.source === "health_connect" && Number(record.value) === value && new Date(record.recorded_at).toDateString() === new Date().toDateString());
      let saved = 0;
      if (result.steps && !alreadySavedToday("steps", result.steps.value)) {
        await request("/health/records", token, "POST", { metric: "steps", value: result.steps.value, unit: "steps", recorded_at: result.steps.recordedAt, source: "health_connect" }); saved++;
      }
      if (result.heartRate && !alreadySavedToday("heart_rate", result.heartRate.value)) {
        await request("/health/records", token, "POST", { metric: "heart_rate", value: result.heartRate.value, unit: "bpm", recorded_at: result.heartRate.recordedAt, source: "health_connect" }); saved++;
      }
      const savedSleep: Row[] = Array.isArray(health.sleep) ? health.sleep : [];
      if (result.sleep && !savedSleep.some(row => row.source === "health_connect" && new Date(row.start_at).getTime() === new Date(result.sleep!.startAt).getTime())) {
        await request("/health/sleep", token, "POST", { start_at: result.sleep.startAt, end_at: result.sleep.endAt, stages: { stage_codes: result.sleep.stages }, source: "health_connect" }); saved++;
      }
      setTodayHealth(result); await loadTab("Home"); setNotice(saved ? `${saved} available health record${saved === 1 ? "" : "s"} synced to Sakuna.` : "These Health Connect records are already saved, or no new Mi Band data is available yet.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sync health data"); }
    finally { setBusy(false); }
  }

  async function completeTask(id: string) {
    try { await request(`/tasks/${id}/complete`, token, "PATCH"); await loadTab("Home"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the task"); }
  }

  function signOut() { setToken(""); setUser({}); setDashboard({}); setPassword(""); setTab("Home"); }

  if (!token) return <SafeAreaView style={styles.safe}><StatusBar barStyle="light-content"/><KeyboardAvoidingView style={styles.auth} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <Text style={styles.logo}>S</Text><Text style={styles.kicker}>PERSONAL LIFE OPERATING SYSTEM</Text><Text style={styles.title}>{registerMode ? "Create your space" : "Welcome back"}</Text><Text style={styles.subtitle}>A calmer place to organize what matters.</Text>
    {registerMode && <TextInput placeholder="Your name" placeholderTextColor="#75877c" value={name} onChangeText={setName} style={styles.input}/>}
    <TextInput autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#75877c" value={email} onChangeText={setEmail} style={styles.input}/>
    <TextInput secureTextEntry placeholder="Password · at least 8 characters" placeholderTextColor="#75877c" value={password} onChangeText={setPassword} style={styles.input}/>
    {showServer ? <TextInput autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="Server address, e.g. https://xyz.trycloudflare.com" placeholderTextColor="#75877c" value={server} onChangeText={setServer} style={styles.input}/>
      : <TouchableOpacity onPress={() => setShowServer(true)}><Text style={styles.link}>Server: {server.replace(/^https?:\/\//, "")} · Change</Text></TouchableOpacity>}
    <TouchableOpacity style={styles.primary} onPress={authenticate} disabled={busy}><Text style={styles.primaryText}>{busy ? "Please wait…" : registerMode ? "Create account" : "Sign in"}</Text></TouchableOpacity>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <TouchableOpacity onPress={() => { setRegisterMode(!registerMode); setError(""); }}><Text style={styles.link}>{registerMode ? "Already have an account? Sign in" : "New to Sakuna? Create an account"}</Text></TouchableOpacity>
  </KeyboardAvoidingView></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><StatusBar barStyle="light-content"/><View style={styles.app}>
    <View style={styles.topbar}><View><Text style={styles.kicker}>SAKUNA AI</Text><Text style={styles.topTitle}>{tab === "Home" ? "Your day, in focus." : tab}</Text></View><TouchableOpacity onPress={() => void loadTab(tab)}><Text style={styles.refresh}>Refresh ↻</Text></TouchableOpacity></View>
    {!!error && <Text style={styles.errorBox}>{error}</Text>}{!!notice && <TouchableOpacity onPress={() => setNotice("")}><Text style={styles.notice}>{notice}  ×</Text></TouchableOpacity>}
    <View style={styles.screen}>
      {tab === "Home" && <HomeScreen dashboard={dashboard} finance={finance} health={health} onComplete={completeTask} onOpenPlan={() => setTab("Plan")}/>}
      {tab === "Plan" && <PlanScreen plan={plan} busy={busy} generate={generatePlan}/>}
      {tab === "Capture" && <CaptureScreen captures={captures} text={captureText} setText={setCaptureText} save={saveCapture} confirm={confirmCapture} busy={busy}/>}
      {tab === "AI" && <AiScreen text={chatText} setText={setChatText} reply={chatReply} send={sendMessage} busy={busy}/>}
      {tab === "Health" && <HealthScreen health={health} todayHealth={todayHealth} busy={busy} connect={connectHealth} sync={syncHealth}/>}
      {tab === "Focus" && <FocusScreen seconds={focusSeconds} active={focusActive} setActive={setFocusActive} setSeconds={setFocusSeconds}/>}
      {tab === "Profile" && <ProfileScreen user={user} signOut={signOut} onHealth={() => setTab("Health")}/>}
    </View>
    <View style={styles.tabbar}>{(["Home", "Plan", "Capture", "AI", "Health", "Focus", "Profile"] as Tab[]).map(item => <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setNotice(""); }}><Text style={[styles.tabIcon, tab === item && styles.tabIconActive]}>{({ Home: "⌂", Plan: "▦", Capture: "＋", AI: "✳", Health: "♡", Focus: "◷", Profile: "◉" } as Record<Tab, string>)[item]}</Text><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></TouchableOpacity>)}</View>
  </View></SafeAreaView>;
}

function HomeScreen({ dashboard, finance, health, onComplete, onOpenPlan }: { dashboard: Row; finance: Row; health: Row; onComplete: (id: string) => void; onOpenPlan: () => void }) {
  const tasks: Row[] = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  const goals: Row[] = Array.isArray(dashboard.goals) ? dashboard.goals : [];
  const steps = (Array.isArray(health.records) ? health.records : []).find((record: Row) => record.metric === "steps");
  return <ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statLabel}>OPEN TASKS</Text><Text style={styles.statValue}>{tasks.length}</Text></View><View style={styles.stat}><Text style={styles.statLabel}>ACTIVE GOALS</Text><Text style={styles.statValue}>{goals.length}</Text></View></View>
    <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statLabel}>NET WORTH</Text><Text style={styles.statValueSmall}>{finance.currency || "USD"} {finance.net_worth ?? "0.00"}</Text></View><View style={styles.stat}><Text style={styles.statLabel}>STEPS · RECENT</Text><Text style={styles.statValueSmall}>{steps ? `${steps.value} ${steps.unit}` : "—"}</Text></View></View>
    <View style={styles.headingRow}><Text style={styles.sectionTitle}>Today’s tasks</Text><TouchableOpacity onPress={onOpenPlan}><Text style={styles.linkSmall}>Daily plan →</Text></TouchableOpacity></View>
    {tasks.length ? tasks.map(task => <View key={task.id} style={styles.task}><TouchableOpacity style={styles.check} onPress={() => onComplete(task.id)}><Text style={styles.checkText}>✓</Text></TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.muted}>{task.priority} priority{task.due_at ? ` · ${new Date(task.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</Text></View></View>) : <Text style={styles.empty}>Nothing on your task list. Add tasks in the web dashboard or use Capture.</Text>}
    <Text style={styles.sectionTitle}>Goals</Text>{goals.length ? goals.slice(0, 4).map(goal => <View key={goal.id} style={styles.goal}><Text style={styles.taskTitle}>{goal.title}</Text><Text style={styles.muted}>{goal.current_value || 0} / {goal.target_value ?? "—"} {goal.unit || ""}</Text></View>) : <Text style={styles.empty}>Your active goals will appear here.</Text>}
    <Text style={styles.disclaimer}>Health and finance values show recorded data only. Sakuna does not provide medical or guaranteed financial advice.</Text>
  </ScrollView>;
}

function PlanScreen({ plan, busy, generate }: { plan: Row; busy: boolean; generate: () => void }) {
  const items: Row[] = Array.isArray(plan.items) ? plan.items : [];
  return <ScrollView contentContainerStyle={styles.scroll}><View style={styles.card}><Text style={styles.kicker}>DAILY PLANNER</Text><Text style={styles.sectionTitle}>{plan.plan_date || "Your day"}</Text><Text style={styles.muted}>{plan.summary || "Build a plan around your routine and open tasks."}</Text><TouchableOpacity style={styles.primary} onPress={generate} disabled={busy}><Text style={styles.primaryText}>{busy ? "Planning…" : "Build today’s plan"}</Text></TouchableOpacity></View>{items.length ? items.map(item => <View key={item.id} style={styles.planItem}><Text style={styles.time}>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text><View style={styles.planBlock}><Text style={styles.taskTitle}>{item.title}</Text><Text style={styles.muted}>{item.kind} · {new Date(item.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></View></View>) : <Text style={styles.empty}>Generate a plan to see today’s time blocks.</Text>}{Array.isArray(plan.unscheduled) && plan.unscheduled.length > 0 && <Text style={styles.warning}>Could not schedule: {plan.unscheduled.join(", ")}</Text>}</ScrollView>;
}

function CaptureScreen({ captures, text, setText, save, confirm, busy }: { captures: Row[]; text: string; setText: (value: string) => void; save: () => void; confirm: (id: string) => void; busy: boolean }) {
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll}><View style={styles.card}><Text style={styles.kicker}>QUICK CAPTURE</Text><TextInput multiline placeholder="A thought, task, idea, or note…" placeholderTextColor="#75877c" value={text} onChangeText={setText} style={[styles.input, styles.multiline]}/><TouchableOpacity style={styles.primary} onPress={save} disabled={busy}><Text style={styles.primaryText}>{busy ? "Saving…" : "Add to inbox"}</Text></TouchableOpacity><Text style={styles.muted}>Items that need clarification wait for your review.</Text></View><Text style={styles.sectionTitle}>Inbox · {captures.length}</Text>{captures.map(item => <View key={item.id} style={styles.card}><Text style={styles.badge}>{String(item.classified_type).replaceAll("_", " " )} · {String(item.status).replaceAll("_", " ")}</Text><Text style={styles.taskTitle}>{item.raw_text}</Text>{["pending", "needs_confirmation"].includes(item.status) && <TouchableOpacity style={styles.outlineButton} onPress={() => confirm(item.id)}><Text style={styles.outlineText}>Review & save</Text></TouchableOpacity>}</View>)}{!captures.length && <Text style={styles.empty}>Your quick captures will show up here.</Text>}</ScrollView></KeyboardAvoidingView>;
}

function AiScreen({ text, setText, reply, send, busy }: { text: string; setText: (value: string) => void; reply: string; send: () => void; busy: boolean }) {
  return <KeyboardAvoidingView style={styles.aiScreen} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll}><View style={styles.aiIntro}><Text style={styles.logoSmall}>✳</Text><Text style={styles.kicker}>SAKUNA ASSISTANT</Text><Text style={styles.sectionTitle}>How can I help?</Text><Text style={styles.muted}>Ask about your tasks, goals, finances, or plan for the day.</Text></View>{reply ? <View style={styles.answer}><Text style={styles.kicker}>SAKUNA</Text><Text style={styles.answerText}>{reply}</Text></View> : <View style={styles.prompts}>{["What should I focus on today?", "How are my goals going?", "Help me plan tomorrow"].map(prompt => <Text key={prompt} style={styles.prompt}>{prompt}</Text>)}</View>}</ScrollView><View style={styles.composer}><TextInput value={text} onChangeText={setText} placeholder="Message Sakuna…" placeholderTextColor="#75877c" style={[styles.input, { flex: 1, marginBottom: 0 }]}/><TouchableOpacity style={styles.send} onPress={send} disabled={busy}><Text style={styles.primaryText}>{busy ? "…" : "↑"}</Text></TouchableOpacity></View></KeyboardAvoidingView>;
}

function HealthScreen({ health, todayHealth, busy, connect, sync }: { health: Row; todayHealth: TodayHealth; busy: boolean; connect: () => void; sync: () => void }) {
  const [status, setStatus] = useState("Checking Health Connect…");
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    void getHealthConnectStatus().then(result => {
      if (!active) return;
      setStatus(result.reason); setConnected(result.connected);
    });
    return () => { active = false; };
  }, []);
  const savedRecords: Row[] = Array.isArray(health.records) ? health.records : [];
  const savedSteps = savedRecords.find((record: Row) => record.metric === "steps" && record.source === "health_connect");
  const savedHeartRate = savedRecords.find((record: Row) => record.metric === "heart_rate" && record.source === "health_connect");
  const savedSleep: Row[] = Array.isArray(health.sleep) ? health.sleep.filter((record: Row) => record.source === "health_connect") : [];
  async function onConnect() {
    await connect();
    const result = await getHealthConnectStatus(); setStatus(result.reason); setConnected(result.connected);
  }
  return <ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.card}><Text style={styles.kicker}>MI BAND · ANDROID HEALTH CONNECT</Text><Text style={styles.sectionTitle}>Device health</Text><Text style={styles.muted}>Mi Fitness syncs supported band data into Health Connect. Sakuna can read steps, heart-rate samples, and sleep sessions. Nothing is sent to the backend until you tap Sync.</Text><View style={styles.healthStatus}><View style={[styles.statusDot, connected && styles.statusDotOn]}/><Text style={styles.taskTitle}>{status}</Text></View>
      <TouchableOpacity style={styles.primary} onPress={() => void onConnect()} disabled={busy}><Text style={styles.primaryText}>{busy ? "Connecting…" : connected ? "Refresh connection" : "Connect Health Connect"}</Text></TouchableOpacity>
      {connected && <TouchableOpacity style={styles.outlineButton} onPress={sync} disabled={busy}><Text style={styles.outlineText}>{busy ? "Syncing…" : "Sync available Mi Band data to Sakuna"}</Text></TouchableOpacity>}
    </View>
    <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statLabel}>TODAY’S STEPS</Text><Text style={styles.statValue}>{todayHealth.steps ? todayHealth.steps.value.toLocaleString() : "—"}</Text><Text style={styles.muted}>Health Connect total</Text></View><View style={styles.stat}><Text style={styles.statLabel}>LATEST HEART RATE</Text><Text style={styles.statValue}>{todayHealth.heartRate ? `${todayHealth.heartRate.value}` : "—"}</Text><Text style={styles.muted}>{todayHealth.heartRate ? "beats per minute" : "No sample today"}</Text></View></View>
    <View style={[styles.card, { marginTop: 2 }]}><Text style={styles.kicker}>MOST RECENT SLEEP</Text><Text style={styles.taskTitle}>{todayHealth.sleep ? `${(todayHealth.sleep.minutes / 60).toFixed(1)} hours` : "No recent sleep session available"}</Text>{!!todayHealth.sleep && <Text style={styles.muted}>{new Date(todayHealth.sleep.startAt).toLocaleString()} – {new Date(todayHealth.sleep.endAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>}</View>
    <View style={[styles.card, { marginTop: 0 }]}><Text style={styles.kicker}>SAVED IN SAKUNA</Text><Text style={styles.taskTitle}>Steps: {savedSteps ? `${Number(savedSteps.value).toLocaleString()} ${savedSteps.unit || "steps"}` : "—"}</Text><Text style={styles.taskTitle}>Heart rate: {savedHeartRate ? `${savedHeartRate.value} ${savedHeartRate.unit || "bpm"}` : "—"}</Text><Text style={styles.taskTitle}>Sleep sessions: {savedSleep.length}</Text><Text style={styles.muted}>Manage saved records in the Sakuna web workspace. Revoke app access in Android Health Connect settings.</Text></View>
    <Text style={styles.disclaimer}>Health data stays on your phone until you choose to sync it. Available measurements depend on Mi Fitness, Health Connect, and your device. This wellness view is not medical advice. Health Connect requires Android 9+ and Google Play services; Android 13 and below may need the Health Connect app.</Text>
  </ScrollView>;
}

function FocusScreen({ seconds, active, setActive, setSeconds }: { seconds: number; active: boolean; setActive: (value: boolean) => void; setSeconds: (value: number) => void }) {
  const [minutes, setMinutes] = useState(25);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  function chooseMinutes(value: number) {
    if (active) return;
    setMinutes(value); setSeconds(value * 60);
  }
  function toggleFocus() {
    if (!active && seconds === 0) setSeconds(minutes * 60);
    setActive(!active);
  }
  return <ScrollView contentContainerStyle={styles.scroll}>
    <View style={styles.card}><Text style={styles.kicker}>FOCUS SESSION</Text><Text style={styles.sectionTitle}>Make room for deep work</Text><Text style={styles.muted}>A simple on-device timer that keeps running while Sakuna stays open.</Text><Text style={styles.timer}>{time}</Text><View style={styles.durationRow}>{[25, 45, 60].map(value => <TouchableOpacity key={value} style={[styles.duration, minutes === value && styles.durationSelected]} onPress={() => chooseMinutes(value)}><Text style={[styles.durationText, minutes === value && styles.durationTextSelected]}>{value} min</Text></TouchableOpacity>)}</View><TouchableOpacity style={styles.primary} onPress={toggleFocus}><Text style={styles.primaryText}>{active ? "Pause focus" : seconds === 0 ? "Start another session" : "Start focus session"}</Text></TouchableOpacity><TouchableOpacity style={styles.outlineButton} onPress={() => { setActive(false); setSeconds(minutes * 60); }}><Text style={styles.outlineText}>Reset timer</Text></TouchableOpacity></View>
    <View style={styles.card}><Text style={styles.kicker}>APP BLOCKING</Text><Text style={styles.taskTitle}>Android system blocking is not active in this build</Text><Text style={styles.muted}>This timer does not pause or block other apps. Reliable Android app blocking needs a native usage monitor and an explicit system permission; website blocking needs a user-approved VPN service. The current app will not imply that apps are blocked.</Text></View>
    <Text style={styles.disclaimer}>Keep Sakuna open during a focus session. The timer pauses when the app process stops, and it is not an emergency or safety control.</Text>
  </ScrollView>;
}

function ProfileScreen({ user, signOut, onHealth }: { user: Row; signOut: () => void; onHealth: () => void }) {
  return <ScrollView contentContainerStyle={styles.scroll}><View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{String(user.full_name || user.email || "S").slice(0, 1).toUpperCase()}</Text></View><Text style={styles.sectionTitle}>{user.full_name || "Your profile"}</Text><Text style={styles.muted}>{user.email || ""}</Text></View><View style={styles.card}><Text style={styles.kicker}>YOUR SPACE</Text><Text style={styles.taskTitle}>Privacy and control</Text><Text style={styles.muted}>Review saved memories, profile preferences, finance records, and approvals in the web workspace.</Text></View><TouchableOpacity style={styles.rowButton} onPress={onHealth}><Text style={styles.taskTitle}>Health Connect</Text><Text style={styles.linkSmall}>Manage →</Text></TouchableOpacity><TouchableOpacity style={styles.signout} onPress={signOut}><Text style={styles.signoutText}>Sign out</Text></TouchableOpacity></ScrollView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d1110" }, app: { flex: 1, backgroundColor: "#0d1110" },
  auth: { flex: 1, justifyContent: "center", padding: 25 }, logo: { color: "#082316", backgroundColor: "#39d98a", width: 52, height: 52, textAlign: "center", textAlignVertical: "center", overflow: "hidden", borderRadius: 16, fontSize: 30, fontWeight: "800", marginBottom: 24 },
  logoSmall: { color: "#39d98a", fontSize: 27, marginBottom: 12 }, kicker: { color: "#8b9a91", fontSize: 10, letterSpacing: 1.4, marginBottom: 8, fontWeight: "700" }, title: { color: "#edf4ef", fontSize: 28, fontWeight: "800", marginBottom: 5 }, subtitle: { color: "#8b9a91", fontSize: 13, marginBottom: 20 }, topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 19, paddingTop: 15, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: "#27312d" }, topTitle: { color: "#edf4ef", fontSize: 20, fontWeight: "800" }, refresh: { color: "#39d98a", fontSize: 11 }, screen: { flex: 1 }, scroll: { padding: 16, paddingBottom: 25 },
  input: { color: "#edf4ef", backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 9, padding: 13, marginBottom: 10, fontSize: 13 }, multiline: { minHeight: 100, textAlignVertical: "top" }, primary: { backgroundColor: "#39d98a", borderRadius: 9, alignItems: "center", padding: 13, marginVertical: 7 }, primaryText: { color: "#092216", fontSize: 13, fontWeight: "800" }, link: { textAlign: "center", color: "#39d98a", padding: 15, fontSize: 12 }, linkSmall: { color: "#39d98a", fontSize: 11 }, error: { color: "#ff9292", marginTop: 12, fontSize: 12 }, errorBox: { color: "#ffb0a4", backgroundColor: "#321f1d", padding: 10, marginHorizontal: 15, marginTop: 10, borderRadius: 8, fontSize: 11 }, notice: { color: "#9ee1b7", backgroundColor: "#193022", marginHorizontal: 15, marginTop: 8, padding: 9, borderRadius: 8, fontSize: 11 },
  statRow: { flexDirection: "row", gap: 9, marginBottom: 9 }, stat: { flex: 1, minHeight: 82, backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 12, padding: 13 }, statLabel: { color: "#8b9a91", fontSize: 9, letterSpacing: 1, fontWeight: "700" }, statValue: { color: "#edf4ef", fontSize: 24, fontWeight: "800", marginTop: 6 }, statValueSmall: { color: "#edf4ef", fontSize: 15, fontWeight: "700", marginTop: 9 }, headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 }, sectionTitle: { color: "#edf4ef", fontSize: 17, fontWeight: "700", marginVertical: 8 }, card: { backgroundColor: "#141b18", borderWidth: 1, borderColor: "#27312d", borderRadius: 12, padding: 15, marginBottom: 11 }, task: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#141b18", padding: 13, borderRadius: 10, marginBottom: 7 }, taskTitle: { color: "#edf4ef", fontSize: 12, fontWeight: "600", marginBottom: 4 }, muted: { color: "#8b9a91", fontSize: 10, lineHeight: 16 }, check: { width: 21, height: 21, borderWidth: 1, borderColor: "#476051", borderRadius: 6, alignItems: "center", justifyContent: "center" }, checkText: { color: "#39d98a", fontSize: 12 }, empty: { color: "#8b9a91", fontSize: 11, paddingVertical: 17, lineHeight: 18 }, goal: { padding: 12, backgroundColor: "#141b18", borderRadius: 9, marginBottom: 7 }, disclaimer: { color: "#75877c", fontSize: 9, lineHeight: 15, marginTop: 14 },
  tabbar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#27312d", backgroundColor: "#101613", paddingTop: 9, paddingBottom: Platform.OS === "ios" ? 7 : 10 }, tab: { alignItems: "center", flex: 1, minWidth: 0 }, tabIcon: { color: "#75877c", fontSize: 18 }, tabIconActive: { color: "#39d98a" }, tabText: { color: "#75877c", fontSize: 8, marginTop: 3 }, tabTextActive: { color: "#39d98a" },
  planItem: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginBottom: 9 }, time: { color: "#b5c2b9", fontSize: 10, width: 56, paddingTop: 12 }, planBlock: { flex: 1, backgroundColor: "#17211b", borderLeftWidth: 2, borderLeftColor: "#39d98a", borderRadius: 7, padding: 11 }, warning: { color: "#f2b768", fontSize: 10, marginTop: 12 }, badge: { color: "#a5e3be", backgroundColor: "#203128", borderRadius: 20, overflow: "hidden", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, marginBottom: 8 }, outlineButton: { borderColor: "#304139", borderWidth: 1, borderRadius: 8, padding: 10, alignItems: "center", marginTop: 8 }, outlineText: { color: "#39d98a", fontSize: 11, fontWeight: "700" }, healthStatus: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 4 }, statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#75877c" }, statusDotOn: { backgroundColor: "#39d98a" }, timer: { color: "#edf4ef", fontSize: 50, fontWeight: "800", textAlign: "center", marginVertical: 22, fontVariant: ["tabular-nums"] }, durationRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 10 }, duration: { borderWidth: 1, borderColor: "#304139", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 }, durationSelected: { backgroundColor: "#193a2a", borderColor: "#39d98a" }, durationText: { color: "#a8b8ad", fontSize: 11 }, durationTextSelected: { color: "#39d98a", fontWeight: "700" },
  aiScreen: { flex: 1 }, aiIntro: { paddingVertical: 20 }, prompts: { gap: 8, marginTop: 10 }, prompt: { color: "#bdc9c1", backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 11 }, answer: { padding: 14, borderRadius: 10, backgroundColor: "#141b18", marginTop: 15 }, answerText: { color: "#d1ddd4", fontSize: 12, lineHeight: 19, marginTop: 7 }, composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#27312d" }, send: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#39d98a" }, profileCard: { alignItems: "center", backgroundColor: "#141b18", borderRadius: 12, padding: 20, marginBottom: 12 }, avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#244333", alignItems: "center", justifyContent: "center", marginBottom: 8 }, avatarText: { color: "#39d98a", fontSize: 22, fontWeight: "800" }, rowButton: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomColor: "#27312d", borderBottomWidth: 1 }, signout: { marginTop: 22, borderWidth: 1, borderColor: "#654039", alignItems: "center", padding: 12, borderRadius: 9 }, signoutText: { color: "#ff9b8c", fontWeight: "700", fontSize: 12 },
});
