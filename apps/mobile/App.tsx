import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiRequest as request, getServerUrl, loadServerUrl, saveServerUrl, type ApiRecord as Row } from "./src/api";
import { ChatScreen } from "./src/screens/ChatScreen";
import { BrainCard } from "./src/screens/BrainCard";
import { LifeScreen } from "./src/screens/LifeScreen";
import { ApprovalsScreen, FinanceScreen, MemoryScreen } from "./src/screens/MoneyMemoryScreens";
import { HealthScreen, MoreScreen, ReviewScreen, type MoreTarget } from "./src/screens/HealthReviewScreens";
import { ShieldPanel } from "./src/ShieldPanel";
import { MonthAgenda } from "./src/screens/PlanExtras";
import { JobsScreen, LearningScreen } from "./src/screens/LearningScreens";
import { MoneyListsScreen, TimeCard } from "./src/screens/MoneyListsScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { AiScreen, CommandCard } from "./src/screens/CommandAiScreens";
import { CoachCardMobile, StudyScreen } from "./src/screens/StudyCoachScreens";
import { BalanceScreen, VaultScreen } from "./src/screens/BalanceVaultScreens";
import { syncReminders } from "./src/notify";
import { FocusEngine } from "./src/screens/FocusEngine";
import { MonthRoutines, NowRoutineCard, PlanSwitch, TodayRoutines, WeekPlan } from "./src/screens/MyDayScreens";
import { appendSpeech, MicButton } from "./src/voice";

type Tab = "Home" | "Plan" | "Capture" | "Focus" | "More";
const SUB_TITLES: Record<MoreTarget, string> = { Assistant: "Assistant", Life: "My life", Learning: "Learning", Jobs: "Job tracker", Money: "Money hub", Rewards: "Rewards", AI: "AI usage & privacy", Study: "Study abroad", Balance: "Life balance", Vault: "Documents", Finance: "Finance", Health: "Health & Mi Band", Memory: "Memory", Review: "Weekly review", Approvals: "Approvals", Profile: "Profile" };

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
  const [planView, setPlanView] = useState<"day" | "week" | "month">("day");
  const [dashboard, setDashboard] = useState<Row>({});
  const [plan, setPlan] = useState<Row>({});
  const [captures, setCaptures] = useState<Row[]>([]);
  const [finance, setFinance] = useState<Row>({});
  const [health, setHealth] = useState<Row>({});
  const [captureText, setCaptureText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState<MoreTarget | null>(null);
  // One API helper for all screens (adds the signed-in token).
  const api = useCallback(<T = Row,>(path: string, method = "GET", body?: unknown) => request<T>(path, token, method, body), [token]);
  const showError = useCallback((message: string) => { setNotice(""); setError(message); }, []);
  const showNotice = useCallback((message: string) => { setError(""); setNotice(message); }, []);

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
      } else if (selected === "More") {
        const me = await request<Row>("/me", currentToken); setUser(me.user || {});
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load your data"); }
  }, [token]);

  useEffect(() => { if (token) void loadTab(tab); }, [token, tab, loadTab]);

  // Phone reminders for tasks due in the next 7 days (local notifications, quiet hours applied by the API).
  useEffect(() => { if (token) void syncReminders(api); }, [token, api]);

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


  async function generatePlan() {
    setBusy(true);
    try { setPlan(await request<Row>("/planner/generate", token, "POST", { scope: "day" })); setNotice("Today’s plan is ready"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate a plan"); }
    finally { setBusy(false); }
  }



  async function completeTask(id: string) {
    try { await request(`/tasks/${id}/complete`, token, "PATCH"); await loadTab("Home"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the task"); }
  }

  function signOut() { setToken(""); setUser({}); setDashboard({}); setPassword(""); setSub(null); setTab("Home"); }

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
    <View style={styles.topbar}>{tab === "More" && sub
      ? <TouchableOpacity onPress={() => setSub(null)}><Text style={styles.kicker}>‹ MORE</Text><Text style={styles.topTitle}>{SUB_TITLES[sub]}</Text></TouchableOpacity>
      : <View><Text style={styles.kicker}>SAKUNA AI</Text><Text style={styles.topTitle}>{tab === "Home" ? "Your day, in focus." : tab}</Text></View>}
      {!(tab === "More" && sub) && <TouchableOpacity onPress={() => void loadTab(tab)}><Text style={styles.refresh}>Refresh ↻</Text></TouchableOpacity>}</View>
    {!!error && <Text style={styles.errorBox}>{error}</Text>}{!!notice && <TouchableOpacity onPress={() => setNotice("")}><Text style={styles.notice}>{notice}  ×</Text></TouchableOpacity>}
    <View style={styles.screen}>
      {tab === "Home" && <HomeScreen dashboard={dashboard} finance={finance} health={health} onComplete={completeTask} onOpenPlan={() => setTab("Plan")} top={<><NowRoutineCard api={api} onOpen={() => { setPlanView("day"); setTab("Plan"); }}/><CoachCardMobile api={api} onError={showError}/><BrainCard api={api}/></>}/>}
      {tab === "Plan" && planView === "day" && <PlanScreen plan={plan} busy={busy} generate={generatePlan}
        top={<><PlanSwitch value={planView} onChange={setPlanView}/><TodayRoutines api={api} onError={showError} onNotice={showNotice}/><Text style={styles.sectionTitle}>Time plan</Text></>}
        extra={<TimeCard api={api}/>}/>}
      {tab === "Plan" && planView === "week" && <ScrollView contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><WeekPlan api={api} onError={showError} onNotice={showNotice}/></ScrollView>}
      {tab === "Plan" && planView === "month" && <ScrollView contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><MonthRoutines api={api} onError={showError}/><Text style={styles.sectionTitle}>Tasks and deadlines</Text><MonthAgenda api={api}/></ScrollView>}
      {tab === "Capture" && <CaptureScreen captures={captures} text={captureText} setText={setCaptureText} save={saveCapture} confirm={confirmCapture} busy={busy} top={<CommandCard api={api} onError={showError}/>}/>}
      {tab === "Focus" && <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FocusEngine api={api} onError={showError} onNotice={showNotice}/>
        <View style={{ height: 14 }}/><ShieldPanel/>
        <Text style={styles.disclaimer}>The focus timer runs from the session's end time, so it keeps going if you switch tabs or close Sakuna; a phone alarm rings at the end. It is not an emergency or safety control.</Text>
      </ScrollView>}
      {tab === "More" && !sub && <MoreScreen open={target => { setError(""); setNotice(""); setSub(target); }}/>}
      {tab === "More" && sub === "Assistant" && <ChatScreen api={api}/>}
      {tab === "More" && sub === "Life" && <LifeScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Learning" && <LearningScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Jobs" && <JobsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Balance" && <BalanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Vault" && <VaultScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Study" && <StudyScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "AI" && <AiScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Rewards" && <RewardsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Money" && <MoneyListsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Finance" && <FinanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Health" && <HealthScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Memory" && <MemoryScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Review" && <ReviewScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Approvals" && <ApprovalsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Profile" && <ProfileScreen user={user} signOut={signOut} onHealth={() => setSub("Health")}/>}
    </View>
    <View style={styles.tabbar}>{(["Home", "Plan", "Capture", "Focus", "More"] as Tab[]).map(item => <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setSub(null); setNotice(""); setError(""); }}><Text style={[styles.tabIcon, tab === item && styles.tabIconActive]}>{({ Home: "⌂", Plan: "▦", Capture: "＋", Focus: "◷", More: "☰" } as Record<Tab, string>)[item]}</Text><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></TouchableOpacity>)}</View>
  </View></SafeAreaView>;
}

function HomeScreen({ dashboard, finance, health, onComplete, onOpenPlan, top }: { dashboard: Row; finance: Row; health: Row; onComplete: (id: string) => void; onOpenPlan: () => void; top?: React.ReactNode }) {
  const tasks: Row[] = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  const goals: Row[] = Array.isArray(dashboard.goals) ? dashboard.goals : [];
  const steps = (Array.isArray(health.records) ? health.records : []).find((record: Row) => record.metric === "steps");
  return <ScrollView contentContainerStyle={styles.scroll}>{top}
    <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statLabel}>OPEN TASKS</Text><Text style={styles.statValue}>{tasks.length}</Text></View><View style={styles.stat}><Text style={styles.statLabel}>ACTIVE GOALS</Text><Text style={styles.statValue}>{goals.length}</Text></View></View>
    <View style={styles.statRow}><View style={styles.stat}><Text style={styles.statLabel}>NET WORTH</Text><Text style={styles.statValueSmall}>{finance.currency || "USD"} {finance.net_worth ?? "0.00"}</Text></View><View style={styles.stat}><Text style={styles.statLabel}>STEPS · RECENT</Text><Text style={styles.statValueSmall}>{steps ? `${steps.value} ${steps.unit}` : "—"}</Text></View></View>
    <View style={styles.headingRow}><Text style={styles.sectionTitle}>Today’s tasks</Text><TouchableOpacity onPress={onOpenPlan}><Text style={styles.linkSmall}>Daily plan →</Text></TouchableOpacity></View>
    {tasks.length ? tasks.map(task => <View key={task.id} style={styles.task}><TouchableOpacity style={styles.check} onPress={() => onComplete(task.id)}><Text style={styles.checkText}>✓</Text></TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.muted}>{task.priority} priority{task.due_at ? ` · ${new Date(task.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</Text></View></View>) : <Text style={styles.empty}>Nothing on your task list. Add tasks in the web dashboard or use Capture.</Text>}
    <Text style={styles.sectionTitle}>Goals</Text>{goals.length ? goals.slice(0, 4).map(goal => <View key={goal.id} style={styles.goal}><Text style={styles.taskTitle}>{goal.title}</Text><Text style={styles.muted}>{goal.current_value || 0} / {goal.target_value ?? "—"} {goal.unit || ""}</Text></View>) : <Text style={styles.empty}>Your active goals will appear here.</Text>}
    <Text style={styles.disclaimer}>Health and finance values show recorded data only. Sakuna does not provide medical or guaranteed financial advice.</Text>
  </ScrollView>;
}

function PlanScreen({ plan, busy, generate, extra, top }: { plan: Row; busy: boolean; generate: () => void; extra?: React.ReactNode; top?: React.ReactNode }) {
  const items: Row[] = Array.isArray(plan.items) ? plan.items : [];
  return <ScrollView contentContainerStyle={styles.scroll}>{top}<View style={styles.card}><Text style={styles.kicker}>DAILY PLANNER</Text><Text style={styles.sectionTitle}>{plan.plan_date || "Your day"}</Text><Text style={styles.muted}>{plan.summary || "Build a plan around your routine and open tasks."}</Text><TouchableOpacity style={styles.primary} onPress={generate} disabled={busy}><Text style={styles.primaryText}>{busy ? "Planning…" : "Build today’s plan"}</Text></TouchableOpacity></View>{items.length ? items.map(item => <View key={item.id} style={styles.planItem}><Text style={styles.time}>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text><View style={styles.planBlock}><Text style={styles.taskTitle}>{item.title}</Text><Text style={styles.muted}>{item.kind} · {new Date(item.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></View></View>) : <Text style={styles.empty}>Generate a plan to see today’s time blocks.</Text>}{Array.isArray(plan.unscheduled) && plan.unscheduled.length > 0 && <Text style={styles.warning}>Could not schedule: {plan.unscheduled.join(", ")}</Text>}{extra}</ScrollView>;
}

function CaptureScreen({ captures, text, setText, save, confirm, busy, top }: { captures: Row[]; text: string; setText: (value: string) => void; save: () => void; confirm: (id: string) => void; busy: boolean; top?: React.ReactNode }) {
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.scroll}>{top}<View style={styles.card}><Text style={styles.kicker}>QUICK CAPTURE</Text><View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}><TextInput multiline placeholder="Type or tap 🎙 and say it: “call bank tomorrow 5pm”, “spent 1500 on lunch”…" placeholderTextColor="#75877c" value={text} onChangeText={setText} style={[styles.input, styles.multiline, { flex: 1 }]}/><MicButton size={46} onText={spoken => setText(appendSpeech(text, spoken))}/></View><TouchableOpacity style={styles.primary} onPress={save} disabled={busy}><Text style={styles.primaryText}>{busy ? "Saving…" : "Add to inbox"}</Text></TouchableOpacity><Text style={styles.muted}>Items that need clarification wait for your review.</Text></View><Text style={styles.sectionTitle}>Inbox · {captures.length}</Text>{captures.map(item => <View key={item.id} style={styles.card}><Text style={styles.badge}>{String(item.classified_type).replaceAll("_", " " )} · {String(item.status).replaceAll("_", " ")}</Text><Text style={styles.taskTitle}>{item.raw_text}</Text>{["pending", "needs_confirmation"].includes(item.status) && <TouchableOpacity style={styles.outlineButton} onPress={() => confirm(item.id)}><Text style={styles.outlineText}>Review & save</Text></TouchableOpacity>}</View>)}{!captures.length && <Text style={styles.empty}>Your quick captures will show up here.</Text>}</ScrollView></KeyboardAvoidingView>;
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
