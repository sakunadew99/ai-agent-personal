import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiRequest as request, apiUpload, clearScreenCache, flushQueue, loadQueue, loadScreenCache, loadServerUrl, peek, prefetchScreens, setAccessToken, setRefresher, type ApiRecord as Row } from "./src/api";
import { clearSession, endSession, hasSession, onSessionExpired, refreshAccess, saveSession, storedUser } from "./src/session";
import { LoginScreen, SplashScreen } from "./src/screens/LoginScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { BrainCard } from "./src/screens/BrainCard";
import { LifeScreen } from "./src/screens/LifeScreen";
import { ApprovalsScreen, FinanceScreen, MemoryScreen } from "./src/screens/MoneyMemoryScreens";
import { HealthScreen, ReviewScreen, type MoreTarget } from "./src/screens/HealthReviewScreens";
import { ExploreScreen, GROUPS, QuickLaunch, rememberScreen } from "./src/screens/Explore";
import { WeeklyHealthCard } from "./src/screens/WeeklyHealthCard";
import { notifyStockAlerts } from "./src/notify";
import { CrashGuard, installCrashRecorder } from "./src/crash";
installCrashRecorder();
import { enableBackgroundSync } from "./src/health/background";   // defines the task at load; every native call inside is guarded
import { ShieldPanel } from "./src/ShieldPanel";
import { MonthAgenda } from "./src/screens/PlanExtras";
import { JobsScreen, LearningScreen } from "./src/screens/LearningScreens";
import { MoneyListsScreen, TimeCard } from "./src/screens/MoneyListsScreen";
import { RewardsScreen } from "./src/screens/RewardsScreen";
import { AiScreen, CommandCard } from "./src/screens/CommandAiScreens";
import { CoachCardMobile, StudyScreen } from "./src/screens/StudyCoachScreens";
import { BalanceScreen, VaultScreen } from "./src/screens/BalanceVaultScreens";
import { syncHabitReminders, syncReminders } from "./src/notify";
import { FocusEngine } from "./src/screens/FocusEngine";
import { ExamScreen } from "./src/screens/ExamScreens";
import { AiTeamScreen, TeamTodayCard } from "./src/screens/AiTeamScreens";
import { AboutYouScreen } from "./src/screens/AboutYouScreen";
import { NewsScreen } from "./src/screens/NewsScreen";
import { InvestScreen } from "./src/screens/InvestScreen";
import { LifeCompass } from "./src/screens/LifeCompass";
import { JournalScreen } from "./src/screens/JournalScreen";
import { MonthRoutines, NowRoutineCard, PlanSwitch, TodayRoutines, WeekPlan, type PlanView } from "./src/screens/MyDayScreens";
import { InboxScreen, JobFinderScreen, PlanBoard, RadarScreen, RewardsGameScreen, SubscriptionsScreen, Switcher } from "./src/screens/LifeOs2Screens";
import { BrainGymScreen, WatchScreen } from "./src/screens/LifeOs3Screens";
import { VideosScreen } from "./src/screens/VideosScreen";
import { DayTrackerScreen, GymScreen, LanguageScreen, ProgressScreen, uploadUsage } from "./src/screens/LifeOs4Screens";
import { BrowserHost } from "./src/browser";
import { LockGate } from "./src/lock";
import { NudgeBanner, TodayPlanCard } from "./src/screens/SmartCards";
import { autoSyncHealth } from "./src/health/autosync";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { CHECKIN_ACTIONS } from "./src/notify";
import { appendSpeech, MicButton } from "./src/voice";
import { Hero, Ring, StatTile, TileRow, WeekDots } from "./src/charts";

type Tab = "Home" | "Plan" | "Capture" | "Focus" | "More";
const SUB_TITLES: Record<MoreTarget, string> = { Videos: "My videos", Day: "Day tracker", Gym: "Gym", Brain: "Brain gym", Assistant: "Assistant", Journal: "Journal", Invest: "Invest (CSE)", News: "News digest", You: "About you", Team: "AI team", Exams: "Exam coach", Life: "My life", Learning: "Learning", Jobs: "Job tracker", Money: "Money hub", Rewards: "Rewards", AI: "AI usage & privacy", Study: "Study abroad", Balance: "Life balance", Vault: "Documents", Finance: "Finance", Health: "Health & Mi Band", Memory: "Memory", Review: "Weekly review", Approvals: "Approvals", Profile: "Profile" };

export default function Root() {
  return <CrashGuard><App/></CrashGuard>;
}

function App() {
  const [booting, setBooting] = useState(true);       // restoring the saved session
  const [bootProblem, setBootProblem] = useState("");
  const [authNote, setAuthNote] = useState("");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<Row>({});
  const [tab, setTab] = useState<Tab>("Home");
  const [planView, setPlanView] = useState<PlanView>("day");
  const [dashboard, setDashboard] = useState<Row>(() => peek("/dashboard") || {});
  const [plan, setPlan] = useState<Row>(() => peek("/planner/daily") || {});
  const [finance, setFinance] = useState<Row>(() => peek("/finance/summary") || {});
  const [health, setHealth] = useState<Row>(() => peek("/health/summary") || {});
  const [life, setLife] = useState<Row>(() => peek("/life/overview") || {});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState<MoreTarget | null>(null);
  const [checkinHour, setCheckinHour] = useState<number | null>(null);
  // One API helper for all screens (adds the signed-in token).
  const api = useCallback(<T = Row,>(path: string, method = "GET", body?: unknown) => request<T>(path, token, method, body), [token]);
  const showError = useCallback((message: string) => { setNotice(""); setError(message); }, []);
  const showNotice = useCallback((message: string) => { setError(""); setNotice(message); }, []);

  const loadTab = useCallback(async (selected: Tab, currentToken = token) => {
    if (!currentToken) return;
    setError("");
    try {
      if (selected === "Home") {
        const [dash, money, activity, overview] = await Promise.all([
          request<Row>("/dashboard", currentToken), request<Row>("/finance/summary", currentToken), request<Row>("/health/summary", currentToken),
          request<Row>("/life/overview", currentToken).catch(() => ({})),
        ]);
        setDashboard(dash); setFinance(money); setHealth(activity); setLife(overview);
      } else if (selected === "Plan") {
        setPlan(await request<Row>("/planner/daily", currentToken));
      } else if (selected === "More") {
        const me = await request<Row>("/me", currentToken); setUser(me.user || {});
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load your data"); }
  }, [token]);

  useEffect(() => { if (token) void loadTab(tab); }, [token, tab, loadTab]);

  // Mi Band data every time the app comes back to the screen (at most every 30 minutes), not only on the Health screen.
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", st => { if (st === "active") { void autoSyncHealth(api); void notifyStockAlerts(api); } });
    return () => sub.remove();
  }, [token, api]);

  // Hourly check-in answers (from the notification buttons) and taps on the day report open the Day tracker.
  useEffect(() => {
    if (!token) return;
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      const data = (resp.notification.request.content.data || {}) as Row;
      if (data.kind === "checkin") {
        const h = Number(data.hour), action = resp.actionIdentifier;
        if (CHECKIN_ACTIONS.some(([id]) => id === action)) {
          void api("/day/entries", "POST", { local_date: today(), start_time: `${String(h).padStart(2, "0")}:00`, end_time: `${String(h).padStart(2, "0")}:59`, category: action, source: "prompt" })
            .then(() => showNotice(`Logged ${String(h).padStart(2, "0")}:00 as ${action}`)).catch(() => undefined);
        } else { setCheckinHour(h); setTab("More"); setSub("Day"); }
      } else if (data.kind === "report") { setCheckinHour(null); setTab("More"); setSub("Day"); void uploadUsage(api); }
    });
    return () => sub.remove();
  }, [token, api, showNotice]);

  // Phone reminders for tasks due in the next 7 days (local notifications, quiet hours applied by the API).
  useEffect(() => {
    if (!token) return;
    void loadQueue().then(() => flushQueue(token)).then(n => { if (n) showNotice(`Sent ${n} item${n === 1 ? "" : "s"} saved while offline`); });
    void syncReminders(api); void syncHabitReminders(api); void autoSyncHealth(api); void notifyStockAlerts(api);
    // Background health sync: loaded after the app is on screen, so it can never stop the app from starting.
    const bg = setTimeout(() => { void enableBackgroundSync(); }, 4000);
    void uploadUsage(api); void uploadUsage(api, new Date(Date.now() - 86400000));   // phone screen time for today and yesterday's report
    return () => clearTimeout(bg);
  }, [token, api, showNotice]);

  // Stay signed in: restore the saved session on start; renew the access token whenever it expires.
  const restore = useCallback(async () => {
    setBootProblem("");
    await loadServerUrl();
    if (!(await hasSession())) { setBooting(false); return; }
    const saved = await storedUser();
    await loadScreenCache(String(saved.id || ""));
    setDashboard(peek("/dashboard") || {}); setFinance(peek("/finance/summary") || {}); setHealth(peek("/health/summary") || {}); setPlan(peek("/planner/daily") || {});
    const access = await refreshAccess();
    if (access) { setUser(saved); setToken(access); setBooting(false); prefetchScreens(access); return; }
    if (await hasSession()) { setBootProblem("Can't reach your server right now. You're still signed in; try again in a moment."); return; }
    setBooting(false); // the session had ended on the server
  }, []);
  useEffect(() => {
    setRefresher(refreshAccess);
    onSessionExpired(() => { setToken(""); setAuthNote("Your session ended. Please sign in again."); });
    void restore();
    return () => { setRefresher(null); onSessionExpired(null); };
  }, [restore]);

  async function onSignedIn(pair: Row) {
    setAccessToken(pair.access_token);
    await saveSession(pair.refresh_token, pair.user);
    await loadScreenCache(String(pair.user?.id || ""));
    prefetchScreens(pair.access_token);
    setUser(pair.user || {}); setTab("Home"); setAuthNote(""); setError("");
    setToken(pair.access_token);
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

  /** Where a worker note or the "About you" change sends you. */
  function openTarget(target: string) {
    if (target === "Plan") { setPlanView("day"); setTab("Plan"); setSub(null); }
    else if (target === "Focus") { setTab("Focus"); setSub(null); }
    else if (GROUPS.some(g => g.items.some(i => i.key === target))) { void rememberScreen(target); setTab("More"); setSub(target as MoreTarget); }
    else setTab("Home");
  }
  async function signOut() {
    await endSession();
    clearScreenCache();
    setToken(""); setUser({}); setDashboard({}); setSub(null); setTab("Home"); setAuthNote("");
  }

  if (booting) return <SplashScreen problem={bootProblem} onRetry={() => void restore()}
    onSignInAgain={() => { void clearSession(); setBootProblem(""); setBooting(false); }}/>;
  if (!token) return <LoginScreen onSignedIn={onSignedIn} initialError={authNote}/>;

  return <LockGate><SafeAreaView style={styles.safe}><StatusBar barStyle="light-content"/><View style={styles.app}>
    <View style={styles.topbar}>{tab === "More" && sub
      ? <TouchableOpacity onPress={() => setSub(null)}><Text style={styles.kicker}>‹ ALL APPS</Text><Text style={styles.topTitle}>{SUB_TITLES[sub]}</Text></TouchableOpacity>
      : <View><Text style={styles.kicker}>SAKUNA AI</Text><Text style={styles.topTitle}>{tab === "Home" ? "Your day, in focus." : tab === "More" ? "All apps" : tab}</Text></View>}
      {!(tab === "More" && sub) && <TouchableOpacity onPress={() => void loadTab(tab)}><View style={styles.refreshBtn}><Text style={styles.refresh}>↻</Text></View></TouchableOpacity>}</View>
    {!!error && <Text style={styles.errorBox}>{error}</Text>}{!!notice && <TouchableOpacity onPress={() => setNotice("")}><Text style={styles.notice}>{notice}  ×</Text></TouchableOpacity>}
    <View style={[styles.screen, tab === "More" && sub === "Assistant" && { marginBottom: 84 }]}>
      {tab === "Home" && <HomeScreen name={String(user.full_name || "").split(" ")[0]} life={life} dashboard={dashboard} finance={finance} health={health} onOpen={openTarget} onComplete={completeTask} onOpenPlan={() => setTab("Plan")}
        quick={<QuickLaunch open={openTarget} onSearch={() => { setTab("More"); setSub(null); }}/>}
        top={<><NudgeBanner api={api} onOpen={openTarget}/><TodayPlanCard api={api} onOpen={openTarget}/>
        <NowRoutineCard api={api} onOpen={() => { setPlanView("day"); setTab("Plan"); }}/><WeeklyHealthCard api={api} onOpen={() => openTarget("Health")}/></>}
        extra={<><TeamTodayCard api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/><LifeCompass api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/>
        <CoachCardMobile api={api} onError={showError}/><BrainCard api={api}/></>}/>}
      {tab === "Plan" && planView === "day" && <PlanScreen plan={plan} busy={busy} generate={generatePlan}
        top={<><PlanSwitch value={planView} onChange={setPlanView}/><TodayRoutines api={api} onError={showError} onNotice={showNotice}/><Text style={styles.sectionTitle}>Time plan</Text></>}
        extra={<TimeCard api={api}/>}/>}
      {tab === "Plan" && planView === "week" && <ScrollView contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><WeekPlan api={api} onError={showError} onNotice={showNotice}/></ScrollView>}
      {tab === "Plan" && planView === "board" && <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><PlanSwitch value={planView} onChange={setPlanView}/><PlanBoard api={api} onError={showError} onNotice={showNotice}/></ScrollView>}
      {tab === "Plan" && planView === "month" && <ScrollView contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><MonthRoutines api={api} onError={showError}/><Text style={styles.sectionTitle}>Tasks and deadlines</Text><MonthAgenda api={api}/></ScrollView>}
      {tab === "Capture" && <InboxScreen api={api} onError={showError} onNotice={showNotice} top={<CommandCard api={api} onError={showError}/>}/>}
      {tab === "Focus" && <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FocusEngine api={api} onError={showError} onNotice={showNotice}/>
        <View style={{ height: 14 }}/><ShieldPanel/>
        <Text style={styles.disclaimer}>The focus timer runs from the session's end time, so it keeps going if you switch tabs or close Sakuna; a phone alarm rings at the end. It is not an emergency or safety control.</Text>
      </ScrollView>}
      {tab === "More" && !sub && <ExploreScreen open={target => { setError(""); setNotice(""); setSub(target); }}/>}
      {tab === "More" && sub === "Assistant" && <ChatScreen api={api}/>}
      {tab === "More" && sub === "Life" && <LifeScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Learning" && <Switcher options={["lang", "radar", "progress", "study"] as const} labels={{ lang: "🗣 Lang", radar: "📡 Radar", progress: "📈 Track", study: "🎓 Cards" }} render={v => v === "radar" ? <RadarScreen api={api} onError={showError} onNotice={showNotice}/> : v === "lang" ? <LanguageScreen api={api} onError={showError} onNotice={showNotice}/> : v === "progress" ? <ProgressScreen api={api} onError={showError} onNotice={showNotice}/> : <LearningScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Jobs" && <Switcher options={["find", "track"] as const} labels={{ find: "🔎 Find jobs", track: "📋 My tracker" }} render={v => v === "find" ? <JobFinderScreen api={api} onError={showError} onNotice={showNotice}/> : <JobsScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Balance" && <BalanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Vault" && <Switcher options={["renewals", "docs"] as const} labels={{ renewals: "💳 Renewals", docs: "🪪 Documents" }} render={v => v === "renewals" ? <SubscriptionsScreen api={api} onError={showError} onNotice={showNotice}/> : <VaultScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Journal" && <JournalScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Invest" && <InvestScreen api={api} upload={(path, file) => apiUpload<Row>(path, token, file)} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "News" && <Switcher options={["news", "watch"] as const} labels={{ news: "📰 News", watch: "▶ Watch" }} render={v => v === "news" ? <NewsScreen api={api} onError={showError} onNotice={showNotice}/> : <WatchScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Brain" && <BrainGymScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Day" && <DayTrackerScreen key={`day-${checkinHour ?? "x"}`} api={api} onError={showError} onNotice={showNotice} initialHour={checkinHour}/>}
      {tab === "More" && sub === "Gym" && <GymScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Videos" && <VideosScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "You" && <AboutYouScreen api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/>}
      {tab === "More" && sub === "Team" && <AiTeamScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Exams" && <ExamScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Study" && <StudyScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "AI" && <AiScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Rewards" && <Switcher options={["game", "manage"] as const} labels={{ game: "🎮 Game", manage: "⚙️ Manage" }} render={v => v === "game" ? <RewardsGameScreen api={api}/> : <RewardsScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Money" && <MoneyListsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Finance" && <FinanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Health" && <HealthScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Memory" && <MemoryScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Review" && <ReviewScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Approvals" && <ApprovalsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Profile" && <ProfileScreen user={user} signOut={() => void signOut()} onHealth={() => setSub("Health")}/>}
    </View>
    <BrowserHost api={api} onNotice={showNotice}/>
    <View style={styles.tabbarWrap}><View style={styles.tabbar}>{(["Home", "Plan", "Capture", "Focus", "More"] as Tab[]).map(item => item === "Capture"
      ? <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setSub(null); setNotice(""); setError(""); }} accessibilityLabel="Capture"><View style={[styles.fab, tab === item && styles.fabOn]}><Text style={styles.fabIcon}>＋</Text></View></TouchableOpacity>
      : <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setSub(null); setNotice(""); setError(""); }}><View style={[styles.tabPill, tab === item && styles.tabPillOn]}><Text style={[styles.tabIcon, tab === item && styles.tabIconActive]}>{({ Home: "🏠", Plan: "🗓", Capture: "＋", Focus: "🎯", More: "🧭" } as Record<Tab, string>)[item]}</Text></View><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></TouchableOpacity>)}</View></View>
  </View></SafeAreaView></LockGate>;
}

function HomeScreen({ name, life, dashboard, finance, health, onComplete, onOpenPlan, onOpen, top, quick, extra }: { name: string; life: Row; dashboard: Row; finance: Row; health: Row; onComplete: (id: string) => void; onOpenPlan: () => void; onOpen: (target: string) => void; top?: React.ReactNode; quick?: React.ReactNode; extra?: React.ReactNode }) {
  const [more, setMore] = useState(false);
  const tasks: Row[] = Array.isArray(dashboard.tasks) ? dashboard.tasks : [];
  const goals: Row[] = Array.isArray(dashboard.goals) ? dashboard.goals : [];
  const steps = (Array.isArray(health.records) ? health.records : []).find((record: Row) => record.metric === "steps");
  const habits: Row[] = Array.isArray(life.habits) ? life.habits : [];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const short = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
  const PRIORITY: Record<string, string> = { high: "#ff7a8a", medium: "#f5b65b", low: "#3ee08f" };
  return <ScrollView contentContainerStyle={[styles.scroll, { gap: 12 }]}>
    <Hero kicker={new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }).toUpperCase()} title={`${greet},`} accent={name ? `${name}.` : ""}
      sub={life.tasks ? `${life.tasks.due_today ?? 0} due today · ${life.tasks.done_this_week ?? 0} done this week${life.tasks.overdue ? ` · ${life.tasks.overdue} overdue` : ""}` : "Let's build momentum today."}
      right={<Ring value={Number(life.score ?? 0)} size={96} label={`${life.score ?? "—"}`} sub="DAY SCORE"/>}/>
    {quick}
    <TileRow>
      <StatTile label="Tasks" icon="☑" tone="green" value={`${tasks.length}`} hint="open today" onPress={onOpenPlan}/>
      <StatTile label="Goals" icon="🎯" tone="violet" value={`${goals.length}`} hint="active" onPress={() => onOpen("Life")}/>
    </TileRow>
    <TileRow>
      <StatTile label="Net worth" icon="💰" tone="blue" value={short(Number(finance.net_worth || 0))} hint={finance.currency || "USD"} onPress={() => onOpen("Money")}/>
      <StatTile label="Steps" icon="👟" tone="amber" value={steps ? Number(steps.value).toLocaleString() : "—"} hint="latest sync"/>
    </TileRow>
    {top}
    {habits.length > 0 && <View style={styles.card}><View style={styles.headingRow}><Text style={styles.kicker}>WEEKLY HABITS</Text><TouchableOpacity onPress={() => onOpen("Life")}><Text style={styles.linkSmall}>Open →</Text></TouchableOpacity></View>
      <WeekDots today={Number(life.weekday ?? 0)} rows={habits.slice(0, 5).map(h => ({ label: h.name, done: h.week as boolean[] }))}/></View>}
    <View style={styles.headingRow}><Text style={styles.sectionTitle}>Today’s priorities</Text><TouchableOpacity onPress={onOpenPlan}><Text style={styles.linkSmall}>Daily plan →</Text></TouchableOpacity></View>
    {tasks.length ? tasks.map(task => <View key={task.id} style={styles.task}><TouchableOpacity style={styles.check} onPress={() => onComplete(task.id)}><Text style={styles.checkText}>✓</Text></TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.muted}>{task.due_at ? new Date(task.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "any time"}</Text></View><View style={[styles.prio, { borderColor: PRIORITY[task.priority] || "#8a9b92" }]}><Text style={[styles.prioText, { color: PRIORITY[task.priority] || "#8a9b92" }]}>{task.priority}</Text></View></View>) : <Text style={styles.empty}>Nothing on your task list. Add tasks in My life or use Capture.</Text>}
    {extra && <TouchableOpacity onPress={() => setMore(m => !m)} style={styles.moreToggle}><Text style={styles.moreToggleText}>{more ? "Hide extra cards ▲" : "✨ AI team, coach & brain cards ▼"}</Text></TouchableOpacity>}
    {more && extra}
    <Text style={styles.disclaimer}>Health and finance values show recorded data only. Sakuna does not provide medical or guaranteed financial advice.</Text>
  </ScrollView>;
}

function PlanScreen({ plan, busy, generate, extra, top }: { plan: Row; busy: boolean; generate: () => void; extra?: React.ReactNode; top?: React.ReactNode }) {
  const items: Row[] = Array.isArray(plan.items) ? plan.items : [];
  return <ScrollView contentContainerStyle={styles.scroll}>{top}<View style={styles.card}><Text style={styles.kicker}>DAILY PLANNER</Text><Text style={styles.sectionTitle}>{plan.plan_date || "Your day"}</Text><Text style={styles.muted}>{plan.summary || "Build a plan around your routine and open tasks."}</Text><TouchableOpacity style={styles.primary} onPress={generate} disabled={busy}><Text style={styles.primaryText}>{busy ? "Planning…" : "Build today’s plan"}</Text></TouchableOpacity></View>{items.length ? items.map(item => <View key={item.id} style={styles.planItem}><Text style={styles.time}>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text><View style={styles.planBlock}><Text style={styles.taskTitle}>{item.title}</Text><Text style={styles.muted}>{item.kind} · {new Date(item.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></View></View>) : <Text style={styles.empty}>Generate a plan to see today’s time blocks.</Text>}{Array.isArray(plan.unscheduled) && plan.unscheduled.length > 0 && <Text style={styles.warning}>Could not schedule: {plan.unscheduled.join(", ")}</Text>}{extra}</ScrollView>;
}


function ProfileScreen({ user, signOut, onHealth }: { user: Row; signOut: () => void; onHealth: () => void }) {
  return <ScrollView contentContainerStyle={styles.scroll}><View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{String(user.full_name || user.email || "S").slice(0, 1).toUpperCase()}</Text></View><Text style={styles.sectionTitle}>{user.full_name || "Your profile"}</Text><Text style={styles.muted}>{user.email || ""}</Text></View><View style={styles.card}><Text style={styles.kicker}>YOUR SPACE</Text><Text style={styles.taskTitle}>Privacy and control</Text><Text style={styles.muted}>Review saved memories, profile preferences, finance records, and approvals in the web workspace.</Text></View><TouchableOpacity style={styles.rowButton} onPress={onHealth}><Text style={styles.taskTitle}>Health Connect</Text><Text style={styles.linkSmall}>Manage →</Text></TouchableOpacity><TouchableOpacity style={styles.signout} onPress={signOut}><Text style={styles.signoutText}>Sign out</Text></TouchableOpacity></ScrollView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#070b09" }, app: { flex: 1, backgroundColor: "#070b09" },
  auth: { flex: 1, justifyContent: "center", padding: 25 }, logo: { color: "#082316", backgroundColor: "#39d98a", width: 52, height: 52, textAlign: "center", textAlignVertical: "center", overflow: "hidden", borderRadius: 16, fontSize: 30, fontWeight: "800", marginBottom: 24 },
  logoSmall: { color: "#39d98a", fontSize: 27, marginBottom: 12 }, kicker: { color: "#8b9a91", fontSize: 10, letterSpacing: 1.4, marginBottom: 8, fontWeight: "700" }, title: { color: "#edf4ef", fontSize: 28, fontWeight: "800", marginBottom: 5 }, subtitle: { color: "#8b9a91", fontSize: 13, marginBottom: 20 }, topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 19, paddingTop: 15, paddingBottom: 10 }, topTitle: { color: "#edf4ef", fontSize: 24, fontWeight: "900", letterSpacing: -0.6 }, refresh: { color: "#3ee08f", fontSize: 18, fontWeight: "900" }, refreshBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#0f1a15", borderWidth: 1, borderColor: "#1f3a2c", alignItems: "center", justifyContent: "center" }, screen: { flex: 1 }, scroll: { padding: 16, paddingBottom: 110 },
  input: { color: "#edf4ef", backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 9, padding: 13, marginBottom: 10, fontSize: 13 }, multiline: { minHeight: 100, textAlignVertical: "top" }, primary: { backgroundColor: "#39d98a", borderRadius: 9, alignItems: "center", padding: 13, marginVertical: 7 }, primaryText: { color: "#092216", fontSize: 13, fontWeight: "800" }, link: { textAlign: "center", color: "#39d98a", padding: 15, fontSize: 12 }, linkSmall: { color: "#39d98a", fontSize: 11 }, error: { color: "#ff9292", marginTop: 12, fontSize: 12 }, errorBox: { color: "#ffb0a4", backgroundColor: "#321f1d", padding: 10, marginHorizontal: 15, marginTop: 10, borderRadius: 8, fontSize: 11 }, notice: { color: "#9ee1b7", backgroundColor: "#193022", marginHorizontal: 15, marginTop: 8, padding: 9, borderRadius: 8, fontSize: 11 },
  statRow: { flexDirection: "row", gap: 9, marginBottom: 9 }, stat: { flex: 1, minHeight: 82, backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 12, padding: 13 }, statLabel: { color: "#8b9a91", fontSize: 9, letterSpacing: 1, fontWeight: "700" }, statValue: { color: "#edf4ef", fontSize: 24, fontWeight: "800", marginTop: 6 }, statValueSmall: { color: "#edf4ef", fontSize: 15, fontWeight: "700", marginTop: 9 }, headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 }, sectionTitle: { color: "#edf4ef", fontSize: 17, fontWeight: "700", marginVertical: 8 }, card: { backgroundColor: "#0f1613", borderWidth: 1, borderColor: "#1d2a24", borderRadius: 22, padding: 16, marginBottom: 11, gap: 10 }, task: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#0f1613", borderWidth: 1, borderColor: "#1d2a24", padding: 14, borderRadius: 18, marginBottom: 8 }, taskTitle: { color: "#eef6f1", fontSize: 14, fontWeight: "700", marginBottom: 2 }, muted: { color: "#8a9b92", fontSize: 11, lineHeight: 16 }, check: { width: 21, height: 21, borderWidth: 1, borderColor: "#476051", borderRadius: 6, alignItems: "center", justifyContent: "center" }, checkText: { color: "#39d98a", fontSize: 12 }, empty: { color: "#8b9a91", fontSize: 11, paddingVertical: 17, lineHeight: 18 }, goal: { padding: 12, backgroundColor: "#141b18", borderRadius: 9, marginBottom: 7 }, disclaimer: { color: "#75877c", fontSize: 9, lineHeight: 15, marginTop: 14 },
  tabbarWrap: { position: "absolute", left: 12, right: 12, bottom: Platform.OS === "ios" ? 18 : 12 },
  tabbar: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderWidth: 1, borderColor: "#1f3a2c", backgroundColor: "#0d1512", borderRadius: 30, paddingVertical: 8, elevation: 12, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  tab: { alignItems: "center", flex: 1, minWidth: 0 }, tabPill: { width: 44, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }, tabPillOn: { backgroundColor: "#143524" },
  tabIcon: { color: "#75877c", fontSize: 18 }, tabIconActive: { color: "#3ee08f" }, tabText: { color: "#75877c", fontSize: 9, marginTop: 2, fontWeight: "600" }, tabTextActive: { color: "#3ee08f" },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: "#3ee08f", alignItems: "center", justifyContent: "center", marginTop: -26, borderWidth: 4, borderColor: "#070b09" }, fabOn: { backgroundColor: "#7af0b5" }, fabIcon: { color: "#04170d", fontSize: 26, fontWeight: "900", marginTop: -2 },
  moreToggle: { alignSelf: "center", borderWidth: 1, borderColor: "#2a6b4a", backgroundColor: "#0f1a15", borderRadius: 99, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  moreToggleText: { color: "#3ee08f", fontWeight: "800", fontSize: 12 },
  prio: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }, prioText: { fontSize: 10, fontWeight: "800", textTransform: "capitalize" },
  planItem: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginBottom: 9 }, time: { color: "#b5c2b9", fontSize: 10, width: 56, paddingTop: 12 }, planBlock: { flex: 1, backgroundColor: "#17211b", borderLeftWidth: 2, borderLeftColor: "#39d98a", borderRadius: 7, padding: 11 }, warning: { color: "#f2b768", fontSize: 10, marginTop: 12 }, badge: { color: "#a5e3be", backgroundColor: "#203128", borderRadius: 20, overflow: "hidden", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, marginBottom: 8 }, outlineButton: { borderColor: "#304139", borderWidth: 1, borderRadius: 8, padding: 10, alignItems: "center", marginTop: 8 }, outlineText: { color: "#39d98a", fontSize: 11, fontWeight: "700" }, healthStatus: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 4 }, statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#75877c" }, statusDotOn: { backgroundColor: "#39d98a" }, timer: { color: "#edf4ef", fontSize: 50, fontWeight: "800", textAlign: "center", marginVertical: 22, fontVariant: ["tabular-nums"] }, durationRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 10 }, duration: { borderWidth: 1, borderColor: "#304139", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 }, durationSelected: { backgroundColor: "#193a2a", borderColor: "#39d98a" }, durationText: { color: "#a8b8ad", fontSize: 11 }, durationTextSelected: { color: "#39d98a", fontWeight: "700" },
  aiScreen: { flex: 1 }, aiIntro: { paddingVertical: 20 }, prompts: { gap: 8, marginTop: 10 }, prompt: { color: "#bdc9c1", backgroundColor: "#141b18", borderColor: "#27312d", borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 11 }, answer: { padding: 14, borderRadius: 10, backgroundColor: "#141b18", marginTop: 15 }, answerText: { color: "#d1ddd4", fontSize: 12, lineHeight: 19, marginTop: 7 }, composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: "#27312d" }, send: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#39d98a" }, profileCard: { alignItems: "center", backgroundColor: "#141b18", borderRadius: 12, padding: 20, marginBottom: 12 }, avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#244333", alignItems: "center", justifyContent: "center", marginBottom: 8 }, avatarText: { color: "#39d98a", fontSize: 22, fontWeight: "800" }, rowButton: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomColor: "#27312d", borderBottomWidth: 1 }, signout: { marginTop: 22, borderWidth: 1, borderColor: "#654039", alignItems: "center", padding: 12, borderRadius: 9 }, signoutText: { color: "#ff9b8c", fontWeight: "700", fontSize: 12 },
});
