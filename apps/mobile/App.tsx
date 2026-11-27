import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiRequest as request, apiUpload, loadHome, clearScreenCache, flushQueue, loadQueue, loadScreenCache, loadServerUrl, peek, prefetchScreens, setAccessToken, setRefresher, type ApiRecord as Row } from "./src/api";
import { clearSession, endSession, hasSession, onSessionExpired, refreshAccess, saveSession, storedUser } from "./src/session";
import { LoginScreen, SplashScreen } from "./src/screens/LoginScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { BrainCard } from "./src/screens/BrainCard";
import { LifeScreen } from "./src/screens/LifeScreen";
import { ApprovalsScreen, FinanceScreen, MemoryScreen } from "./src/screens/MoneyMemoryScreens";
import { HealthScreen, ReviewScreen, type MoreTarget } from "./src/screens/HealthReviewScreens";
import { ExploreScreen, GROUPS, HubTabs, PinnedLaunch, QuickLaunch, rememberScreen } from "./src/screens/Explore";
import { WeeklyHealthCard } from "./src/screens/WeeklyHealthCard";
import { notifyStockAlerts, syncMedicineReminders } from "./src/notify";
import { CrashGuard, installCrashRecorder } from "./src/crash";
import { KbScroll, useKeyboard } from "./src/keyboard";
installCrashRecorder();
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
import { ScheduleScreen } from "./src/screens/ScheduleScreen";
import { SpeakingScreen } from "./src/screens/SpeakingScreen";
import { MedicinesScreen, SkillsScreen } from "./src/screens/WellbeingScreens";
import { SkinScreen } from "./src/screens/SkinScreen";
import { CoachTabs } from "./src/screens/CoachTabs";
import { QuickAdd, RitualCard } from "./src/screens/Rituals";
import { DrillScreen } from "./src/screens/DrillScreen";
import { CompanionCard, DreamsScreen } from "./src/screens/DreamsScreen";
import { RolePlayScreen } from "./src/screens/RolePlayScreen";
import { WealthScreen } from "./src/screens/WealthScreen";
import { FitnessGuideScreen } from "./src/screens/FitnessGuide";
import { ContentScreen, TravelScreen } from "./src/screens/CreateScreens";
import { ResourceScreen } from "./src/screens/ResourceScreen";
import { ReadingScreen } from "./src/screens/ReadingScreen";
import { KegelScreen, NotesScreen } from "./src/screens/NotesKegel";
import { DisciplineScreen } from "./src/screens/DisciplineScreen";
import { AskScreen } from "./src/screens/AskScreen";
import { EnglishScreen, FreelanceScreen, SportsScreen } from "./src/screens/PathwaysScreens";
import { BodyScreen } from "./src/screens/BodyScreen";
import { LearnFeedScreen } from "./src/screens/LearnFeedScreen";
import { ReelsScreen } from "./src/screens/ReelsScreen";
import { HubScreen } from "./src/screens/HubScreen";
import { SleepScreen, uploadSleep } from "./src/screens/SleepDayScreens";
import { MindsetScreen, WaterScreen } from "./src/screens/MindsetScreens";
import { BoardScreen, BodyOverview, TodayScreen } from "./src/screens/TodayBoardScreens";
import { AppearanceScreen } from "./src/screens/AppearanceScreen";
import { Onboarding, SettingsScreen } from "./src/screens/SettingsScreen";
import { applyNotificationPrefs, notifyApprovals, savedNotifyPrefs, scheduleWaterSmart } from "./src/notify";
import { InAppNudges } from "./src/InAppNudges";
import { logError } from "./src/errors";
import { subscribe as onThemeChange } from "./src/theme";
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
import { C } from "./src/ui";

type Tab = "Home" | "Plan" | "Capture" | "Focus" | "More";
const SUB_TITLES: Record<MoreTarget, string> = { Appearance: "Appearance", Today: "Today", Board: "Life board", Water: "Water", Mindset: "Mindset studio", Sleep: "Sleep", Hub: "Learning hub", Reels: "Learning reels", LearnFeed: "Learning feed", Body: "Body measurements", Sports: "Martial arts & swimming", English: "English check", Freelance: "Freelancing kit", Ask: "Ask Sakuna", Discipline: "Self-control", Notes: "Notes", Kegel: "Pelvic floor", Reading: "Reading", Resources: "Learn anything", Content: "Content studio", Travel: "Travel guide", Fitness: "Fitness guide", Wealth: "$1M journey & ideas", Roleplay: "Role-play coach", Dreams: "Dreams & goals", Skin: "Skin & glow", Meds: "Medicines", Skills: "Skills & trainers", Speak: "Speaking coach", Schedule: "My schedule", Videos: "My videos", Day: "Day tracker", Gym: "Gym", Brain: "Brain gym", Assistant: "Assistant", Journal: "Journal", Invest: "Invest (CSE)", News: "News digest", You: "About you", Team: "AI team", Exams: "Exam coach", Life: "My life", Learning: "Learning", Jobs: "Job tracker", Money: "Money hub", Rewards: "Rewards", AI: "AI usage & privacy", Study: "Study abroad", Balance: "Life balance", Vault: "Documents", Finance: "Finance", Health: "Health & Mi Band", Memory: "Memory", Review: "Weekly review", Approvals: "Approvals", Profile: "Settings & profile" };

export default function Root() {
  return <CrashGuard><App/></CrashGuard>;
}

function App() {
  const [booting, setBooting] = useState(true);       // restoring the saved session
  const [bootProblem, setBootProblem] = useState("");
  const [authNote, setAuthNote] = useState("");
  const [token, setToken] = useState("");
  // Fast start: with a saved session and saved screens, the app opens at once ("warm") while the sign-in is renewed.
  const [warm, setWarm] = useState(false);
  const waiting = useRef<((t: string) => void)[]>([]);
  const [user, setUser] = useState<Row>({});
  const [tab, setTab] = useState<Tab>("Home");
  const [themeV, setThemeV] = useState(0);
  const [prefs, setPrefs] = useState<Row | null>(null);
  const [onboard, setOnboard] = useState(false);
  const prefsRef = useRef<Row | null>(null); prefsRef.current = prefs;
  useEffect(() => onThemeChange(() => setThemeV(v => v + 1)), []);
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
  const keyboard = useKeyboard();          // tab bar hides while typing
  const [quick, setQuick] = useState(false);   // long-press ＋ = quick add
  // One API helper for all screens (adds the signed-in token). While warm, calls wait for the renewed token.
  const api = useCallback(<T = Row,>(path: string, method = "GET", body?: unknown): Promise<T> => token
    ? request<T>(path, token, method, body)
    : new Promise<string>(resolve => { waiting.current.push(resolve); }).then(t => request<T>(path, t, method, body)), [token]);
  useEffect(() => { if (token) waiting.current.splice(0).forEach(resolve => resolve(token)); }, [token]);
  const showError = useCallback((message: string) => { setNotice(""); setError(message); void logError(message, "app"); }, []);
  const showNotice = useCallback((message: string) => { setError(""); setNotice(message); }, []);

  const loadTab = useCallback(async (selected: Tab, currentToken = token) => {
    if (!currentToken) return;
    setError("");
    try {
      if (selected === "Home") {
        // One request for all of Home (cards read their part from it). Older servers without /home: the four separate calls.
        const home = await loadHome<Row>(currentToken).catch(() => null);
        const [dash, money, activity, overview] = home ? [home["/dashboard"], home["/finance/summary"], home["/health/summary"], home["/life/overview"]]
          : await Promise.all([request<Row>("/dashboard", currentToken), request<Row>("/finance/summary", currentToken), request<Row>("/health/summary", currentToken),
            request<Row>("/life/overview", currentToken).catch(() => ({}))]);
        setDashboard(dash || {}); setFinance(money || {}); setHealth(activity || {}); setLife(overview || {});
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
    const sub = AppState.addEventListener("change", st => { if (st === "active") { void autoSyncHealth(api); void notifyStockAlerts(api); void uploadSleep(api);
      if (prefsRef.current?.notifications?.approvals?.on !== false) void notifyApprovals(api);
      if (prefsRef.current?.notifications?.water?.on) void scheduleWaterSmart(api); } });
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
      else if (data.kind === "task") {
        const id = String(data.taskId), a = resp.actionIdentifier;
        if (a === "task_done") void api(`/tasks/${id}/complete`, "PATCH").then(() => showNotice("✓ Task done")).catch(() => undefined);
        else if (a === "task_snooze") void api(`/tasks/${id}`, "PATCH", { due_at: new Date(Date.now() + 3600_000).toISOString() }).then(() => showNotice("⏰ Moved 1 hour later")).catch(() => undefined);
        else { setTab("Plan"); setPlanView("life"); }
      } else if (data.kind === "habit") {
        if (resp.actionIdentifier === "habit_done") void api(`/habits/${String(data.habitId)}/logs`, "POST", {}).then(() => showNotice("✓ Habit done")).catch(() => undefined);
        else { setTab("Home"); setSub(null); }
      } else if (data.kind === "approval") {
        const a = resp.actionIdentifier;
        if (a === "approve" || a === "reject") void api(`/approvals/${String(data.approvalId)}/${a}`, "POST").then(() => showNotice(a === "approve" ? "✓ Approved and done" : "✕ Rejected")).catch(() => undefined);
        else { setTab("More"); setSub("Approvals"); }
      } else if (data.kind === "brief") { setTab("Home"); setSub(null); }
      else if (data.kind === "report_week") { setTab("More"); setSub("Review"); }
      else if (data.kind === "backup") { setTab("More"); setSub("Profile"); }
      else if (data.kind === "water") {
        const ml = resp.actionIdentifier === "water500" ? 500 : resp.actionIdentifier === "water250" ? 250 : 0;
        if (ml) void api("/water", "POST", { ml }).then(() => showNotice(`💧 +${ml} ml logged`)).catch(() => undefined); else { setTab("More"); setSub("Water"); }
      }
    });
    return () => sub.remove();
  }, [token, api, showNotice]);

  // Phone reminders for tasks due in the next 7 days (local notifications, quiet hours applied by the API).
  useEffect(() => {
    if (!token) return;
    void loadQueue().then(() => flushQueue(token)).then(n => { if (n) showNotice(`Sent ${n} item${n === 1 ? "" : "s"} saved while offline`); });
    void autoSyncHealth(api); void notifyStockAlerts(api);
    void api<Row>("/settings").then(r => {
      setPrefs(r.prefs); if (!r.prefs.onboarding_done) setOnboard(true);
      void applyNotificationPrefs(api, r.prefs.notifications);
      if (r.prefs.notifications?.approvals?.on !== false) void notifyApprovals(api);
    }).catch(() => void savedNotifyPrefs().then(async n => { if (n) await applyNotificationPrefs(api, n); else await Promise.all([syncReminders(api), syncHabitReminders(api), syncMedicineReminders(api)]); }));
    void uploadUsage(api); void uploadUsage(api, new Date(Date.now() - 86400000));   // phone screen time for today and yesterday's report
    void uploadSleep(api);                                                            // last night's sleep from phone use
  }, [token, api, showNotice]);

  // Stay signed in: restore the saved session on start; renew the access token whenever it expires.
  const restore = useCallback(async () => {
    setBootProblem("");
    await loadServerUrl();
    if (!(await hasSession())) { setBooting(false); return; }
    const saved = await storedUser();
    await loadScreenCache(String(saved.id || ""));
    setDashboard(peek("/dashboard") || {}); setFinance(peek("/finance/summary") || {}); setHealth(peek("/health/summary") || {}); setPlan(peek("/planner/daily") || {});
    const quick = !!peek("/dashboard");
    if (quick) { setUser(saved); setWarm(true); setBooting(false); }      // show saved screens now; no waiting for a sleeping server
    const access = await refreshAccess();
    if (access) { setUser(saved); setToken(access); setWarm(false); setBooting(false); prefetchScreens(access); return; }
    if (await hasSession()) {
      if (quick) { setNotice("Showing saved data: the server is waking up or you're offline. Tap ↻ to retry."); setTimeout(() => void restore(), 20000); return; }
      setBootProblem("Can't reach your server right now. You're still signed in; try again in a moment."); return;
    }
    setWarm(false); setBooting(false); // the session had ended on the server
  }, []);
  useEffect(() => {
    setRefresher(refreshAccess);
    onSessionExpired(() => { setToken(""); setWarm(false); setAuthNote("Your session ended. Please sign in again."); });
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
    else if (target === "Capture") { setTab("Capture"); setSub(null); }
    else if (GROUPS.some(g => g.items.some(i => i.key === target))) { void rememberScreen(target); setTab("More"); setSub(target as MoreTarget); }
    else setTab("Home");
  }
  async function signOut() {
    await endSession();
    clearScreenCache();
    setToken(""); setWarm(false); setUser({}); setDashboard({}); setSub(null); setTab("Home"); setAuthNote("");
  }

  if (booting) return <SplashScreen problem={bootProblem} onRetry={() => void restore()}
    onSignInAgain={() => { void clearSession(); setBootProblem(""); setBooting(false); }}/>;
  if (!token && !warm) return <LoginScreen onSignedIn={onSignedIn} initialError={authNote}/>;

  return <LockGate>{onboard && <Onboarding api={api} onDone={() => { setOnboard(false); void api<Row>("/settings").then(r => setPrefs(r.prefs)).catch(() => undefined); }}/>}<SafeAreaView key={themeV} style={[styles.safe, { backgroundColor: C.bg }]}><StatusBar barStyle={C.dark ? "light-content" : "dark-content"}/>{!!token && <InAppNudges api={api} onNotice={showNotice} onOpen={t => { if (t === "Today") { setTab("Home"); setSub(null); } else if (t === "Plan") { setTab("Plan"); } else openTarget(t); }}/>}<KeyboardAvoidingView behavior="padding" style={styles.app}>
    <View style={styles.topbar}>{tab === "More" && sub
      ? <TouchableOpacity onPress={() => setSub(null)}><Text style={styles.kicker}>‹ ALL APPS</Text><Text style={styles.topTitle}>{SUB_TITLES[sub]}</Text></TouchableOpacity>
      : <View><Text style={styles.kicker}>SAKUNA AI</Text><Text style={styles.topTitle}>{tab === "Home" ? "Your day, in focus." : tab === "More" ? "Hubs" : tab}</Text></View>}
      {!token && <Text style={{ color: C.muted, fontSize: 11 }}>connecting…</Text>}{!(tab === "More" && sub) && <TouchableOpacity onPress={() => void (token ? loadTab(tab) : restore())}><View style={styles.refreshBtn}><Text style={styles.refresh}>↻</Text></View></TouchableOpacity>}</View>
    {!!error && <Text style={styles.errorBox}>{error}</Text>}{!!notice && <TouchableOpacity onPress={() => setNotice("")}><Text style={styles.notice}>{notice}  ×</Text></TouchableOpacity>}
    <View style={[styles.screen, tab === "More" && sub === "Assistant" && keyboard === 0 && { marginBottom: 84 }]}>
      {tab === "Home" && <TodayScreen api={api} onError={showError} onNotice={showNotice} onOpen={t => openTarget(t)}
        pinnedBar={<PinnedLaunch pinned={(prefs?.pinned as string[]) || []} open={t => openTarget(t)}/>}
        extra={<HomeScreen name={String(user.full_name || "").split(" ")[0]} life={life} dashboard={dashboard} finance={finance} health={health} onOpen={openTarget} onComplete={completeTask} onOpenPlan={() => setTab("Plan")}
        quick={<QuickLaunch open={openTarget} onSearch={() => { setTab("More"); setSub(null); }}/>}
        top={<><RitualCard api={api} onError={showError} onNotice={showNotice}/><CompanionCard api={api} onOpen={openTarget}/><NudgeBanner api={api} onOpen={openTarget}/><TodayPlanCard api={api} onOpen={openTarget}/>
        <NowRoutineCard api={api} onOpen={() => { setPlanView("day"); setTab("Plan"); }}/><WeeklyHealthCard api={api} onOpen={() => openTarget("Health")}/></>}
        extra={<CoachTabs tabs={[
          { key: "team", label: "🤖 AI team", node: <TeamTodayCard api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/> },
          { key: "coach", label: "💬 Coach", node: <CoachCardMobile api={api} onError={showError}/> },
          { key: "compass", label: "🧭 Compass", node: <LifeCompass api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/> },
          { key: "brain", label: "🧠 Brain", node: <BrainCard api={api}/> }]}/>}/>}/>}
      {tab === "Plan" && planView === "day" && <PlanScreen plan={plan} busy={busy} generate={generatePlan}
        top={<><PlanSwitch value={planView} onChange={setPlanView}/><TodayRoutines api={api} onError={showError} onNotice={showNotice}/><Text style={styles.sectionTitle}>Time plan</Text></>}
        extra={<TimeCard api={api}/>}/>}
      {tab === "Plan" && planView === "week" && <KbScroll contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><WeekPlan api={api} onError={showError} onNotice={showNotice}/></KbScroll>}
      {tab === "Plan" && planView === "board" && <KbScroll contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><PlanSwitch value={planView} onChange={setPlanView}/><PlanBoard api={api} onError={showError} onNotice={showNotice}/></KbScroll>}
      {tab === "Plan" && planView === "life" && <BoardScreen api={api} onError={showError} onNotice={showNotice} onOpen={t => openTarget(t)}/>}
      {tab === "Plan" && planView === "month" && <KbScroll contentContainerStyle={styles.scroll}><PlanSwitch value={planView} onChange={setPlanView}/><MonthRoutines api={api} onError={showError}/><Text style={styles.sectionTitle}>Tasks and deadlines</Text><MonthAgenda api={api}/></KbScroll>}
      {tab === "Capture" && <InboxScreen api={api} onError={showError} onNotice={showNotice} top={<CommandCard api={api} onError={showError}/>}/>}
      {tab === "Focus" && <KbScroll contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <FocusEngine api={api} onError={showError} onNotice={showNotice}/>
        <View style={{ height: 14 }}/><ShieldPanel/>
        <Text style={styles.disclaimer}>The focus timer runs from the session's end time, so it keeps going if you switch tabs or close Sakuna; a phone alarm rings at the end. It is not an emergency or safety control.</Text>
      </KbScroll>}
      {tab === "More" && !sub && <ExploreScreen api={api} openAny={openTarget} pinned={(prefs?.pinned as string[]) || []} open={target => { setError(""); setNotice(""); setSub(target); }}
        bodyOverview={<BodyOverview api={api} onOpen={t => openTarget(t)}/>}
        onPin={k => { const cur: string[] = (prefs?.pinned as string[]) || []; const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k].slice(-8);
          void api<Row>("/settings/prefs", "PATCH", { pinned: next }).then(r => { setPrefs(r); showNotice(cur.includes(k) ? "Unpinned" : "📌 Pinned to Today"); }).catch(e => showError(e instanceof Error ? e.message : "Could not pin")); }}/>}
      {tab === "More" && sub && sub !== "Reels" && <HubTabs current={sub} open={t => setSub(t)}/>}
      {tab === "More" && sub === "Assistant" && <ChatScreen api={api}/>}
      {tab === "More" && sub === "Life" && <LifeScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && (sub === "Learning" || sub === "Exams" || sub === "Speak") && <Switcher key={sub} initial={sub === "Exams" ? "exams" : sub === "Speak" ? "speak" : "lang"} options={["lang", "say", "study", "speak", "exams", "radar", "progress"] as const} labels={{ lang: "🗣 Lang", say: "🎯 Say it", study: "🎓 Cards", speak: "🎙 Speak", exams: "📝 Exams", radar: "📡 Radar", progress: "📈 Track" }} render={v => v === "say" ? <DrillScreen api={api} onError={showError}/> : v === "exams" ? <ExamScreen api={api} onError={showError} onNotice={showNotice}/> : v === "speak" ? <SpeakingScreen api={api} upload={(path, file, fields) => apiUpload<Row>(path, token, file, fields)} onError={showError} onNotice={showNotice}/> : v === "radar" ? <RadarScreen api={api} onError={showError} onNotice={showNotice}/> : v === "lang" ? <LanguageScreen api={api} onError={showError} onNotice={showNotice}/> : v === "progress" ? <ProgressScreen api={api} onError={showError} onNotice={showNotice}/> : <LearningScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Jobs" && <Switcher options={["find", "track"] as const} labels={{ find: "🔎 Find jobs", track: "📋 My tracker" }} render={v => v === "find" ? <JobFinderScreen api={api} onError={showError} onNotice={showNotice}/> : <JobsScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Balance" && <BalanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Journal" && <JournalScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Invest" && <InvestScreen api={api} upload={(path, file) => apiUpload<Row>(path, token, file)} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && (sub === "News" || sub === "Brain") && <Switcher key={sub} initial={sub === "Brain" ? "brain" : "news"} options={["news", "watch", "brain"] as const} labels={{ news: "📰 News", watch: "▶ Watch", brain: "🧠 Brain gym" }} render={v => v === "brain" ? <BrainGymScreen api={api} onError={showError} onNotice={showNotice}/> : v === "news" ? <NewsScreen api={api} onError={showError} onNotice={showNotice}/> : <WatchScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Day" && <DayTrackerScreen key={`day-${checkinHour ?? "x"}`} api={api} onError={showError} onNotice={showNotice} initialHour={checkinHour}/>}
      {tab === "More" && sub === "Gym" && <GymScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Videos" && <VideosScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Schedule" && <ScheduleScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Meds" && <MedicinesScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Dreams" && <DreamsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Roleplay" && <RolePlayScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Wealth" && <WealthScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Fitness" && <FitnessGuideScreen api={api} onError={showError} onOpen={openTarget}/>}
      {tab === "More" && sub === "Content" && <ContentScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Travel" && <TravelScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Resources" && <ResourceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Reading" && <ReadingScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Notes" && <NotesScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Kegel" && <KegelScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Discipline" && <DisciplineScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Ask" && <AskScreen api={api} onError={showError} onNotice={showNotice} onOpenApprovals={() => setSub("Approvals")}/>}
      {tab === "More" && sub === "Sports" && <SportsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Body" && <BodyScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "LearnFeed" && <LearnFeedScreen api={api} onError={showError} onNotice={showNotice} onOpenReels={() => setSub("Reels")}/>}
      {tab === "More" && sub === "Reels" && <ReelsScreen api={api} onError={showError} onNotice={showNotice} onClose={() => setSub("LearnFeed")}/>}
      {tab === "More" && sub === "Hub" && <HubScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Sleep" && <SleepScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Water" && <WaterScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Appearance" && <AppearanceScreen/>}
      {tab === "More" && sub === "Today" && <TodayScreen api={api} onError={showError} onNotice={showNotice} onOpen={t => setSub(t as MoreTarget)}/>}
      {tab === "More" && sub === "Board" && <BoardScreen api={api} onError={showError} onNotice={showNotice} onOpen={t => setSub(t as MoreTarget)}/>}
      {tab === "More" && sub === "Mindset" && <MindsetScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "English" && <EnglishScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Freelance" && <FreelanceScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Skin" && <SkinScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Skills" && <SkillsScreen api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/>}
      {tab === "More" && sub === "Team" && <AiTeamScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Study" && <StudyScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "AI" && <AiScreen api={api} onError={showError}/>}
      {tab === "More" && sub === "Rewards" && <Switcher options={["game", "manage"] as const} labels={{ game: "🎮 Game", manage: "⚙️ Manage" }} render={v => v === "game" ? <RewardsGameScreen api={api}/> : <RewardsScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && (sub === "Money" || sub === "Finance" || sub === "Vault") && <Switcher key={sub} initial={sub === "Vault" ? "renewals" : sub === "Money" ? "lists" : "spend"} options={["spend", "lists", "renewals", "docs"] as const} labels={{ spend: "💳 Spending", lists: "👛 Lists", renewals: "🔁 Renewals", docs: "🪪 Docs" }} render={v => v === "spend" ? <FinanceScreen api={api} onError={showError} onNotice={showNotice}/> : v === "lists" ? <MoneyListsScreen api={api} onError={showError} onNotice={showNotice}/> : v === "renewals" ? <SubscriptionsScreen api={api} onError={showError} onNotice={showNotice}/> : <VaultScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Health" && <HealthScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Memory" && <MemoryScreen api={api} onError={showError}/>}
      {tab === "More" && (sub === "Review" || sub === "You") && <Switcher key={sub} initial={sub === "You" ? "you" : "week"} options={["week", "you"] as const} labels={{ week: "🗓 Week", you: "🪞 About you" }} render={v => v === "you" ? <AboutYouScreen api={api} onError={showError} onNotice={showNotice} onOpen={openTarget}/> : <ReviewScreen api={api} onError={showError} onNotice={showNotice}/>}/>}
      {tab === "More" && sub === "Approvals" && <ApprovalsScreen api={api} onError={showError} onNotice={showNotice}/>}
      {tab === "More" && sub === "Profile" && <SettingsScreen api={api} onError={showError} onNotice={showNotice} onOpen={t => openTarget(t)} signOut={() => void signOut()}/>}
    </View>
    <BrowserHost api={api} onNotice={showNotice}/>
    {keyboard === 0 && <View style={styles.tabbarWrap}><View style={styles.tabbar}>{(["Home", "Plan", "Capture", "Focus", "More"] as Tab[]).map(item => item === "Capture"
      ? <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setSub(null); setNotice(""); setError(""); }} onLongPress={() => setQuick(true)} accessibilityLabel="Capture (hold for quick add)"><View style={[styles.fab, tab === item && styles.fabOn]}><Text style={styles.fabIcon}>＋</Text></View></TouchableOpacity>
      : <TouchableOpacity key={item} style={styles.tab} onPress={() => { setTab(item); setSub(null); setNotice(""); setError(""); }}><View style={[styles.tabPill, tab === item && styles.tabPillOn]}><Text style={[styles.tabIcon, tab === item && styles.tabIconActive]}>{({ Home: "🏠", Plan: "🗓", Capture: "＋", Focus: "🎯", More: "🧭" } as Record<Tab, string>)[item]}</Text></View><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{({ Home: "Today", Plan: "Plan", Capture: "Add", Focus: "Focus", More: "Hubs" } as Record<Tab, string>)[item]}</Text></TouchableOpacity>)}</View></View>}
    {quick && <QuickAdd api={api} onClose={() => setQuick(false)} onOpen={openTarget} onNotice={showNotice} onError={showError}/>}
  </KeyboardAvoidingView></SafeAreaView></LockGate>;
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
  const PRIORITY: Record<string, string> = { high: C.red, medium: C.amber, low: C.green };
  return <KbScroll contentContainerStyle={[styles.scroll, { gap: 12 }]}>
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
    {tasks.length ? tasks.map(task => <View key={task.id} style={styles.task}><TouchableOpacity style={styles.check} onPress={() => onComplete(task.id)}><Text style={styles.checkText}>✓</Text></TouchableOpacity><View style={{ flex: 1 }}><Text style={styles.taskTitle}>{task.title}</Text><Text style={styles.muted}>{task.due_at ? new Date(task.due_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "any time"}</Text></View><View style={[styles.prio, { borderColor: PRIORITY[task.priority] || C.muted }]}><Text style={[styles.prioText, { color: PRIORITY[task.priority] || C.muted }]}>{task.priority}</Text></View></View>) : <Text style={styles.empty}>Nothing on your task list. Add tasks in My life or use Capture.</Text>}
    {extra && <TouchableOpacity onPress={() => setMore(m => !m)} style={styles.moreToggle}><Text style={styles.moreToggleText}>{more ? "Hide coach ▲" : "✨ Today's coach ▼"}</Text></TouchableOpacity>}
    {more && extra}
    <Text style={styles.disclaimer}>Health and finance values show recorded data only. Sakuna does not provide medical or guaranteed financial advice.</Text>
  </KbScroll>;
}

function PlanScreen({ plan, busy, generate, extra, top }: { plan: Row; busy: boolean; generate: () => void; extra?: React.ReactNode; top?: React.ReactNode }) {
  const items: Row[] = Array.isArray(plan.items) ? plan.items : [];
  return <KbScroll contentContainerStyle={styles.scroll}>{top}<View style={styles.card}><Text style={styles.kicker}>DAILY PLANNER</Text><Text style={styles.sectionTitle}>{plan.plan_date || "Your day"}</Text><Text style={styles.muted}>{plan.summary || "Build a plan around your routine and open tasks."}</Text><TouchableOpacity style={styles.primary} onPress={generate} disabled={busy}><Text style={styles.primaryText}>{busy ? "Planning…" : "Build today’s plan"}</Text></TouchableOpacity></View>{items.length ? items.map(item => <View key={item.id} style={styles.planItem}><Text style={styles.time}>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text><View style={styles.planBlock}><Text style={styles.taskTitle}>{item.title}</Text><Text style={styles.muted}>{item.kind} · {new Date(item.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text></View></View>) : <Text style={styles.empty}>Generate a plan to see today’s time blocks.</Text>}{Array.isArray(plan.unscheduled) && plan.unscheduled.length > 0 && <Text style={styles.warning}>Could not schedule: {plan.unscheduled.join(", ")}</Text>}{extra}</KbScroll>;
}


const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg }, app: { flex: 1, backgroundColor: C.bg },
  auth: { flex: 1, justifyContent: "center", padding: 25 }, logo: { color: "#082316", backgroundColor: C.green, width: 52, height: 52, textAlign: "center", textAlignVertical: "center", overflow: "hidden", borderRadius: 16, fontSize: 30, fontWeight: "800", marginBottom: 24 },
  logoSmall: { color: C.green, fontSize: 27, marginBottom: 12 }, kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.4, marginBottom: 8, fontWeight: "700" }, title: { color: C.text, fontSize: 28, fontWeight: "800", marginBottom: 5 }, subtitle: { color: C.muted, fontSize: 13, marginBottom: 20 }, topbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 19, paddingTop: 15, paddingBottom: 10 }, topTitle: { color: C.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.6 }, refresh: { color: C.green, fontSize: 18, fontWeight: "900" }, refreshBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.panel, borderWidth: 1, borderColor: "#1f3a2c", alignItems: "center", justifyContent: "center" }, screen: { flex: 1 }, scroll: { padding: 16, paddingBottom: 110 },
  input: { color: C.text, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 9, padding: 13, marginBottom: 10, fontSize: 13 }, multiline: { minHeight: 100, textAlignVertical: "top" }, primary: { backgroundColor: C.green, borderRadius: 9, alignItems: "center", padding: 13, marginVertical: 7 }, primaryText: { color: "#092216", fontSize: 13, fontWeight: "800" }, link: { textAlign: "center", color: C.green, padding: 15, fontSize: 12 }, linkSmall: { color: C.green, fontSize: 11 }, error: { color: "#ff9292", marginTop: 12, fontSize: 12 }, errorBox: { color: "#ffb0a4", backgroundColor: "#321f1d", padding: 10, marginHorizontal: 15, marginTop: 10, borderRadius: 8, fontSize: 11 }, notice: { color: "#9ee1b7", backgroundColor: C.greenSoft, marginHorizontal: 15, marginTop: 8, padding: 9, borderRadius: 8, fontSize: 11 },
  statRow: { flexDirection: "row", gap: 9, marginBottom: 9 }, stat: { flex: 1, minHeight: 82, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 13 }, statLabel: { color: C.muted, fontSize: 9, letterSpacing: 1, fontWeight: "700" }, statValue: { color: C.text, fontSize: 24, fontWeight: "800", marginTop: 6 }, statValueSmall: { color: C.text, fontSize: 15, fontWeight: "700", marginTop: 9 }, headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 8 }, sectionTitle: { color: C.text, fontSize: 17, fontWeight: "700", marginVertical: 8 }, card: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 16, marginBottom: 11, gap: 10 }, task: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, padding: 14, borderRadius: 18, marginBottom: 8 }, taskTitle: { color: C.text, fontSize: 14, fontWeight: "700", marginBottom: 2 }, muted: { color: C.muted, fontSize: 11, lineHeight: 16 }, check: { width: 21, height: 21, borderWidth: 1, borderColor: "#476051", borderRadius: 6, alignItems: "center", justifyContent: "center" }, checkText: { color: C.green, fontSize: 12 }, empty: { color: C.muted, fontSize: 11, paddingVertical: 17, lineHeight: 18 }, goal: { padding: 12, backgroundColor: C.panel, borderRadius: 9, marginBottom: 7 }, disclaimer: { color: "#75877c", fontSize: 9, lineHeight: 15, marginTop: 14 },
  tabbarWrap: { position: "absolute", left: 12, right: 12, bottom: Platform.OS === "ios" ? 18 : 12 },
  tabbar: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderWidth: 1, borderColor: "#1f3a2c", backgroundColor: C.panel, borderRadius: 30, paddingVertical: 8, elevation: 12, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  tab: { alignItems: "center", flex: 1, minWidth: 0 }, tabPill: { width: 44, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }, tabPillOn: { backgroundColor: C.greenSoft },
  tabIcon: { color: "#75877c", fontSize: 18 }, tabIconActive: { color: C.green }, tabText: { color: "#75877c", fontSize: 9, marginTop: 2, fontWeight: "600" }, tabTextActive: { color: C.green },
  fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.green, alignItems: "center", justifyContent: "center", marginTop: -26, borderWidth: 4, borderColor: C.bg }, fabOn: { backgroundColor: "#7af0b5" }, fabIcon: { color: C.greenDark, fontSize: 26, fontWeight: "900", marginTop: -2 },
  moreToggle: { alignSelf: "center", borderWidth: 1, borderColor: "#2a6b4a", backgroundColor: C.panel, borderRadius: 99, paddingHorizontal: 16, paddingVertical: 10, marginTop: 6 },
  moreToggleText: { color: C.green, fontWeight: "800", fontSize: 12 },
  prio: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 3 }, prioText: { fontSize: 10, fontWeight: "800", textTransform: "capitalize" },
  planItem: { flexDirection: "row", alignItems: "flex-start", gap: 11, marginBottom: 9 }, time: { color: C.text2, fontSize: 10, width: 56, paddingTop: 12 }, planBlock: { flex: 1, backgroundColor: C.panel2, borderLeftWidth: 2, borderLeftColor: C.green, borderRadius: 7, padding: 11 }, warning: { color: "#f2b768", fontSize: 10, marginTop: 12 }, badge: { color: "#a5e3be", backgroundColor: C.line, borderRadius: 20, overflow: "hidden", alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, marginBottom: 8 }, outlineButton: { borderColor: "#304139", borderWidth: 1, borderRadius: 8, padding: 10, alignItems: "center", marginTop: 8 }, outlineText: { color: C.green, fontSize: 11, fontWeight: "700" }, healthStatus: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, marginBottom: 4 }, statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#75877c" }, statusDotOn: { backgroundColor: C.green }, timer: { color: C.text, fontSize: 50, fontWeight: "800", textAlign: "center", marginVertical: 22, fontVariant: ["tabular-nums"] }, durationRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 10 }, duration: { borderWidth: 1, borderColor: "#304139", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 }, durationSelected: { backgroundColor: "#193a2a", borderColor: C.green }, durationText: { color: "#a8b8ad", fontSize: 11 }, durationTextSelected: { color: C.green, fontWeight: "700" },
  aiScreen: { flex: 1 }, aiIntro: { paddingVertical: 20 }, prompts: { gap: 8, marginTop: 10 }, prompt: { color: "#bdc9c1", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 9, padding: 12, fontSize: 11 }, answer: { padding: 14, borderRadius: 10, backgroundColor: C.panel, marginTop: 15 }, answerText: { color: C.text2, fontSize: 12, lineHeight: 19, marginTop: 7 }, composer: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line }, send: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: C.green }, profileCard: { alignItems: "center", backgroundColor: C.panel, borderRadius: 12, padding: 20, marginBottom: 12 }, avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: "#244333", alignItems: "center", justifyContent: "center", marginBottom: 8 }, avatarText: { color: C.green, fontSize: 22, fontWeight: "800" }, rowButton: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomColor: C.line, borderBottomWidth: 1 }, signout: { marginTop: 22, borderWidth: 1, borderColor: "#654039", alignItems: "center", padding: 12, borderRadius: 9 }, signoutText: { color: "#ff9b8c", fontWeight: "700", fontSize: 12 },
});
