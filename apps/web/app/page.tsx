"use client";

import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { apiRequest as call, type JsonRecord, patchJson as patch, postJson as json } from "@/lib/api";
import { BrandMark, BrandName } from "@/components/BrandMark";
import { Icon } from "@/components/Icon";
import { FocusProvider, formatClock, useFocus } from "@/components/FocusContext";
import { FocusPage } from "@/components/FocusPage";
import { WeeklyReview } from "@/components/WeeklyReview";
import { CommandPalette, type PaletteAction } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatPage } from "@/components/ChatPage";
import { SecondBrainCard } from "@/components/SecondBrainCard";
import { Milestones } from "@/components/Milestones";
import { MonthView } from "@/components/MonthView";
import { LearningPage } from "@/components/LearningPage";
import { JobTracker } from "@/components/JobTracker";
import { MoneyHub } from "@/components/MoneyHub";
import { GoalForecast } from "@/components/GoalForecast";
import { RewardsPage } from "@/components/RewardsPage";
import { CommandBar } from "@/components/CommandBar";
import { AiControls } from "@/components/AiControls";
import { StudyPage } from "@/components/StudyPage";
import { CoachCard } from "@/components/CoachCard";
import { LifeCompassCard } from "@/components/LifeCompassCard";
import { BalancePage } from "@/components/BalancePage";
import { VaultPage } from "@/components/VaultPage";
import { GoogleConnect, TaskCalendarButton } from "@/components/GoogleConnect";
import { TimeEngine } from "@/components/TimeEngine";
import { appendSpeech, VoiceButton, VoiceLanguageSelect } from "@/components/VoiceButton";
import "./home.css";
import "./upgrade.css";
import "./polish.css";
import "./dash.css";
import { FinanceDashboard, HealthDashboard, LifeDashboard } from "@/components/Dashboards";
import { AboutYouPage, AiTeamPage, ExamsPage, InvestPage, JournalPage, MyDayPage, NewsPage } from "@/components/LifeOsPages";
import { HabitManager, InboxPage, JobFinder, LearnRadar, PlannerBoard, RewardsGame, SubscriptionsPanel } from "@/components/LifeOsPages2";
import { BrainGymPage, NewsAndWatch } from "@/components/LifeOsPages3";
import { SearchPage, VideosPage } from "@/components/LifeOsPages5";
import { SchedulePage, SpeakingPage } from "@/components/LifeOsPages6";
import { FitnessGuidePage, RolePlayPage, WealthPage } from "@/components/LifeOsPages8";
import { DreamsPage, DrillPage, HealthAdvicePanel, MedicinesPage, ReceiptPage, RitualsPage, SkillsPage, SkinPage } from "@/components/LifeOsPages7";
import { DayPage, GymPage, LanguagesPage, ProgressPage } from "@/components/LifeOsPages4";
import { NudgeBanner, TodayPlanCard } from "@/components/SmartCards";

const API = process.env.NEXT_PUBLIC_API_URL || "";
type Row = JsonRecord;
type Field = { name: string; label: string; type?: string; required?: boolean; options?: string[]; placeholder?: string };

const navigation = [
  { label: "Home", icon: "home", group: "TODAY", hint: "Your day at a glance" },
  { label: "Focus", icon: "timer", hint: "30 / 60-minute blocks with a break" },
  { label: "Planner", icon: "calendar", hint: "Time blocks for today and the week" },
  { label: "My day", icon: "sun", hint: "Routines, food diary, week and month view" },
  { label: "Day tracker", icon: "timer", hint: "Hour by hour, phone time and end-of-day report" },
  { label: "Capture inbox", icon: "inbox", hint: "Thoughts waiting to be sorted" },
  { label: "Assistant", icon: "sparkle", hint: "Ask about your plans, goals and records" },
  { label: "AI team", icon: "bolt", hint: "Daily notes from your helpers and their schedule" },
  { label: "My life", icon: "life", group: "LIFE AREAS", hint: "Tasks, goals and habits" },
  { label: "Finance", icon: "wallet", hint: "Income, spending and net worth" },
  { label: "Invest", icon: "chart", hint: "CSE portfolio, watchlist and your rules" },
  { label: "Health", icon: "heart", hint: "Sleep, steps, workouts" },
  { label: "Career", icon: "briefcase", hint: "Skills, job tracker, freelance work" },
  { label: "Learning", icon: "book", hint: "Flashcards, German & English, mistake notebook" },
  { label: "Exam coach", icon: "check", hint: "IELTS and Goethe German plans and feedback" },
  { label: "Languages", icon: "book", hint: "Today's German & English plan and new words" },
  { label: "Progress", icon: "chart", hint: "Courses, LeetCode, HackerRank, GitHub" },
  { label: "Gym", icon: "heart", hint: "Workouts, sets, kg × reps, records" },
  { label: "News", icon: "bell", hint: "Daily digest and must-watch videos" },
  { label: "Brain gym", icon: "brain", hint: "Daily brain games workout" },
  { label: "My videos", icon: "book", hint: "Google Drive & YouTube library" },
  { label: "Search", icon: "compass", hint: "Find anything you saved, by words or meaning" },
  { label: "Speaking coach", icon: "brain", hint: "Public speaking, English & German: pace, fillers, tips" },
  { label: "My schedule", icon: "check", hint: "Office, gym, sleep times (detected from your logs)" },
  { label: "Dreams & goals", icon: "flame", hint: "Today to 10 years: dream to plan, with your approval" },
  { label: "Fitness guide", icon: "heart", hint: "Workouts with technique and a Sri Lankan meal planner" },
  { label: "Medicines", icon: "heart", hint: "Doses, reminders, refills" },
  { label: "$1M journey", icon: "chart", hint: "Projections to $1M and income ideas ranked for you" },
  { label: "Scan receipt", icon: "copy", hint: "Receipt photo to expense (free on-device OCR)" },
  { label: "Say it", icon: "book", hint: "Pronunciation drill: German & English" },
  { label: "Role-play coach", icon: "brain", hint: "Negotiation, leadership, interviews: practise and get scored" },
  { label: "Morning & evening", icon: "sun", hint: "2-minute start and close of your day" },
  { label: "Skin & glow", icon: "heart", hint: "Daily face scan and glow score" },
  { label: "Skills & trainers", icon: "flame", hint: "Yoga, singing, guitar, boxing: pitch trainer and pose coach" },
  { label: "Rewards", icon: "flame", hint: "Points, streak, quests and treats" },
  { label: "Study abroad", icon: "arrow", hint: "Programs, checklist, costs, scholarships" },
  { label: "Documents", icon: "copy", hint: "Passport, visas, IDs and expiry reminders" },
  { label: "Experiences", icon: "compass", hint: "Places, events and moments" },
  { label: "Life balance", icon: "sun", group: "REFLECT", hint: "Target vs actual per life area" },
  { label: "Journal", icon: "review", hint: "Mood, wins, gratitude and lessons" },
  { label: "About you", icon: "brain", hint: "Patterns from your own data and the weekly report" },
  { label: "Weekly review", icon: "review", hint: "Plan vs actual, three changes" },
  { label: "Insights", icon: "chart", hint: "Snapshot of priorities and goals" },
  { label: "Memory", icon: "brain", hint: "What Sakuna remembers about you" },
  { label: "Approvals", icon: "shield", group: "CONTROL", hint: "AI proposals waiting for your yes" },
  { label: "Settings", icon: "settings", hint: "Profile, routine and check-ins" },
];
const slugOf = (label: string) => label.toLowerCase().replaceAll(" ", "-");
const pageFromHash = () => {
  if (typeof window === "undefined") return "Home";
  const slug = window.location.hash.replace(/^#/, "");
  return navigation.find(item => slugOf(item.label) === slug)?.label || "Home";
};
const MOBILE_TABS = ["Home", "Planner", "Focus"];

/** Small pill in the header that shows a running focus block on every page. */
function HeaderTimer({ onOpen }: { onOpen: () => void }) {
  const { state, remaining } = useFocus();
  if (!state) return null;
  const label = state.phase === "ended" ? "Time's up" : state.phase === "break" ? `Break ${formatClock(remaining)}` : formatClock(remaining);
  return <button className={`header-timer ${state.phase}`} onClick={onOpen} title="Open focus timer"><Icon name="timer" size={15}/>{label}</button>;
}

/** One-tap starters on Home. */
function QuickStart({ onNavigate, onCapture, openTasks }: { onNavigate: (page: string) => void; onCapture: () => void; openTasks: number }) {
  const { state, start, busy } = useFocus();
  return <div className="quick-row">
    <button className="quick-card accent" disabled={busy || !!state} onClick={() => { void start({ minutes: 30, breakMinutes: 5 }); onNavigate("Focus"); }}>
      <Icon name="play" size={18}/><span><b>{state ? "Focus running" : "Start 30-min focus"}</b><small>{state ? "Open the timer" : "Then a 5-min break"}</small></span></button>
    <button className="quick-card" onClick={onCapture}><Icon name="plus" size={18}/><span><b>Quick capture</b><small>Ctrl + K anywhere</small></span></button>
    <button className="quick-card" onClick={() => onNavigate("Planner")}><Icon name="calendar" size={18}/><span><b>Plan today</b><small>{openTasks} open task{openTasks === 1 ? "" : "s"}</small></span></button>
    <button className="quick-card" onClick={() => onNavigate("Weekly review")}><Icon name="review" size={18}/><span><b>Weekly review</b><small>10 minutes on Sunday</small></span></button>
  </div>;
}

// Repeat choices -> rule text understood by the API (backend/app/services/recurrence.py).
const REPEAT_RULES: Record<string, string> = {
  daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY",
  every_2_weeks: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY",
};
function repeatLabel(rule: unknown) {
  const found = Object.entries(REPEAT_RULES).find(([, value]) => value === rule);
  return rule ? `↻ ${found ? found[0].replaceAll("_", " ") : "repeats"}` : "";
}
function toList(data: unknown): Row[] { return Array.isArray(data) ? data as Row[] : []; }
function money(value: unknown, currency = "USD") {
  const amount = Number(value || 0);
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}
function niceDate(value: unknown) {
  if (!value) return "Not scheduled";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
// Same groups as the phone's "All apps"; anything not listed lands in MORE so a new page is never hidden.
const NAV_GROUPS: [string, string[]][] = [
  ["TODAY", ["Home", "Morning & evening", "Focus", "Planner", "My day", "Day tracker", "My schedule", "Capture inbox", "Search"]],
  ["💰 MONEY", ["Finance", "$1M journey", "Scan receipt", "Invest", "Documents"]],
  ["💪 BODY", ["Health", "Fitness guide", "Gym", "Medicines", "Skin & glow", "Skills & trainers"]],
  ["🎓 LEARNING", ["Learning", "Languages", "Say it", "Role-play coach", "Exam coach", "Speaking coach", "Progress", "Study abroad", "Career", "My videos", "News", "Brain gym"]],
  ["🌱 LIFE", ["Dreams & goals", "My life", "Journal", "Life balance", "Experiences", "Rewards", "Weekly review", "About you", "Insights"]],
  ["✨ AI & SETTINGS", ["Assistant", "AI team", "Memory", "Approvals", "Settings"]],
];
function groupNavigation(query = "") {
  const q = query.trim().toLowerCase();
  const byLabel = new Map(navigation.map(item => [item.label, item]));
  const used = new Set<string>();
  const groups = NAV_GROUPS.map(([title, labels]) => ({ title, items: labels.map(l => { used.add(l); return byLabel.get(l); }).filter(Boolean) as typeof navigation }));
  const rest = navigation.filter(item => !used.has(item.label));
  if (rest.length) groups.push({ title: "MORE", items: rest });
  return groups.map(g => ({ ...g, items: g.items.filter(item => !q || `${item.label} ${item.hint || ""}`.toLowerCase().includes(q)) })).filter(g => g.items.length);
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{children}</section>;
}
function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return <div className="panel-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div>{action}</div>;
}
function Empty({ children = "Nothing here yet." }: { children?: ReactNode }) { return <div className="empty-state">{children}</div>; }
function ErrorNotice({ children }: { children: ReactNode }) { return <div className="error-banner" role="alert">{children}</div>; }
// Text fields where dictation makes sense (not numbers, dates, links, codes or settings).
const NO_VOICE = new Set(["timezone", "currency", "url", "email", "unit", "source"]);
function speakable(field: Field) { return (!field.type || field.type === "text") && !NO_VOICE.has(field.name); }
function Form({ fields, submit, button = "Save", compact = false }: { fields: Field[]; submit: (values: Row) => Promise<void>; button?: string; compact?: boolean }) {
  const [values, setValues] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload: Row = {};
    fields.forEach(field => {
      const value = form.get(field.name);
      if (value === null || String(value).trim() === "") return;
      payload[field.name] = field.type === "datetime-local" ? new Date(String(value)).toISOString() : value;
    });
    try { await submit(payload); setValues({}); formElement.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this item"); }
    finally { setBusy(false); }
  }
  return <form className={compact ? "data-form compact-form" : "data-form"} onSubmit={onSubmit}>
    <div className="form-fields">{fields.map(field => <label key={field.name} className={field.type === "textarea" ? "wide-field" : ""}>
      <span>{field.label}</span>
      {field.options ? <select name={field.name} required={field.required} value={values[field.name] || ""} onChange={e => setValues({ ...values, [field.name]: e.target.value })}><option value="">Choose…</option>{field.options.map(option => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select> : field.type === "textarea" ? <span className="with-mic"><textarea name={field.name} placeholder={field.placeholder} required={field.required} value={values[field.name] || ""} onChange={e => setValues({ ...values, [field.name]: e.target.value })} rows={3}/><VoiceButton onText={spoken => setValues(v => ({ ...v, [field.name]: appendSpeech(String(v[field.name] || ""), spoken) }))}/></span> : (speakable(field) ? <span className="with-mic"><input name={field.name} type={field.type || "text"} placeholder={field.placeholder} required={field.required} step={field.type === "number" ? "any" : undefined} value={values[field.name] || ""} onChange={e => setValues({ ...values, [field.name]: e.target.value })}/><VoiceButton onText={spoken => setValues(v => ({ ...v, [field.name]: appendSpeech(String(v[field.name] || ""), spoken) }))}/></span> : <input name={field.name} type={field.type || "text"} placeholder={field.placeholder} required={field.required} step={field.type === "number" ? "any" : undefined} value={values[field.name] || ""} onChange={e => setValues({ ...values, [field.name]: e.target.value })}/>)}
    </label>)}</div>
    <div className="form-footer">{error && <span className="inline-error">{error}</span>}<button className="primary" disabled={busy}>{busy ? "Saving…" : button}</button></div>
  </form>;
}
function DataRows({ rows, columns, empty = "No records yet.", rowAction }: { rows: Row[]; columns: { key: string; label: string; format?: (value: any, row: Row) => ReactNode }[]; empty?: string; rowAction?: (row: Row) => ReactNode }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return <div className="table-wrap"><table><thead><tr>{columns.map(col => <th key={col.key}>{col.label}</th>)}{rowAction && <th aria-label="Actions"/>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || index)}>{columns.map(col => <td key={col.key}>{col.format ? col.format(row[col.key], row) : String(row[col.key] ?? "—")}</td>)}{rowAction && <td className="actions-cell">{rowAction(row)}</td>}</tr>)}</tbody></table></div>;
}
function ListCards({ rows, titleKey = "title", subtitle }: { rows: Row[]; titleKey?: string; subtitle?: (row: Row) => string }) {
  if (!rows.length) return <Empty>No records yet.</Empty>;
  return <div className="record-list">{rows.map((row, i) => <div className="record-row" key={row.id || i}><span className="record-icon">✳</span><div className="record-copy"><b>{String(row[titleKey] || row.name || row.activity || "Record")}</b><small>{subtitle ? subtitle(row) : ""}</small></div>{row.status && <span className="badge">{String(row.status).replaceAll("_", " ")}</span>}</div>)}</div>;
}

export default function Home() {
  const [token, setToken] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [page, setPage] = useState("Home");
  const [data, setData] = useState<Row>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [chatText, setChatText] = useState("");
  const [chatReply, setChatReply] = useState<Row | null>(null);
  const [askingAssistant, setAskingAssistant] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [memoryQuery, setMemoryQuery] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [me, setMe] = useState<Row>({});
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [navQuery, setNavQuery] = useState("");

  useEffect(() => { setToken(localStorage.getItem("sakuna-access") || ""); setPage(pageFromHash()); }, []);
  // Hash routing: pages are bookmarkable (#focus) and browser back/forward works.
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((target: string) => {
    setMoreOpen(false);
    const hash = target === "Home" ? "" : `#${slugOf(target)}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash || window.location.pathname);
    setPage(target);
  }, []);
  // Ctrl/⌘+K opens quick capture from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(open => !open); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Account name and the approvals badge are global, not tied to the page being viewed.
  useEffect(() => {
    if (!token) return;
    call<Row>("/me", token).then(setMe).catch(() => undefined);
  }, [token]);
  useEffect(() => {
    if (!token) return;
    call<Row[]>("/approvals", token).then(rows => setPendingApprovals(toList(rows).filter(row => row.status === "pending").length)).catch(() => undefined);
  }, [token, page]);
  useEffect(() => {
    const expire = () => { setToken(""); setData({}); setAuthError("Your session expired. Please sign in again."); };
    window.addEventListener("sakuna:session-expired", expire);
    return () => window.removeEventListener("sakuna:session-expired", expire);
  }, []);
  const fetchPage = useCallback(async (target = page, currentToken = token) => {
    if (!currentToken) return;
    setLoading(true); setError("");
    try {
      let result: Row = {};
      switch (target) {
        case "Home": result = { dashboard: await call("/dashboard", currentToken) }; break;
        case "My life": {
          const [tasks, goals, habits] = await Promise.all([call("/tasks", currentToken), call("/goals", currentToken), call("/habits", currentToken)]);
          result = { tasks, goals, habits }; break;
        }
        case "Planner": result = { plan: await call("/planner/daily", currentToken), week: await call("/planner/weekly", currentToken) }; break;
        case "Finance": result = { summary: await call(`/finance/summary?month=${month}`, currentToken) }; break;
        case "Career": {
          const [profile, projects] = await Promise.all([call("/career/profile", currentToken), call("/career/projects", currentToken)]);
          result = { profile, projects }; break;
        }
        case "Health": result = await call("/health/summary", currentToken); break;
        case "Focus": {
          const [sessions, tasks] = await Promise.all([call("/focus/sessions", currentToken), call("/tasks", currentToken)]);
          result = { sessions, tasks }; break;
        }
        case "Weekly review": {
          const [tasks, sessions, dashboard, memories] = await Promise.all([call("/tasks", currentToken), call("/focus/sessions", currentToken), call("/dashboard", currentToken), call("/memories", currentToken)]);
          result = { tasks, sessions, dashboard, reviews: toList(memories).filter(row => String(row.content || "").startsWith("Weekly review (")) }; break;
        }
        case "Experiences": result = { entries: await call("/life", currentToken) }; break;
        case "Memory": result = { memories: await call("/memories", currentToken) }; break;
        case "Insights": result = await call("/insights", currentToken); break;
        case "Approvals": result = { approvals: await call("/approvals", currentToken) }; break;
        case "Settings": {
          const [me, checkins] = await Promise.all([call("/me", currentToken), call("/checkins/settings", currentToken)]);
          result = { ...me, checkins }; break;
        }
        case "Capture inbox": result = { captures: await call("/capture", currentToken) }; break;
        case "Assistant": result = { conversations: await call("/conversations", currentToken) }; break;
      }
      setData(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this page");
    } finally { setLoading(false); }
  }, [page, token, month]);

  useEffect(() => { if (token) { localStorage.setItem("sakuna-access", token); void fetchPage(page, token); } }, [token, page, month, fetchPage]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 3200); return () => window.clearTimeout(timer); }, [toast]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthError(""); setAuthBusy(true);
    try {
      const endpoint = authMode === "login" ? "/auth/login" : "/auth/register";
      const body = authMode === "login" ? { email, password } : { email, password, full_name: fullName };
      const response = await fetch(`${API}/api/v1${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || "Authentication failed");
      localStorage.setItem("sakuna-access", payload.access_token);
      localStorage.setItem("sakuna-refresh", payload.refresh_token);
      setToken(payload.access_token);
    } catch (reason) { setAuthError(reason instanceof Error ? reason.message : "Sign in failed"); }
    finally { setAuthBusy(false); }
  }
  async function submit(path: string, body: Row, options: RequestInit = {}) {
    await call(path, token, { ...json(body), ...options });
    setToast("Saved successfully");
    await fetchPage(page, token);
  }
  async function signOut() {
    const refresh = localStorage.getItem("sakuna-refresh");
    if (refresh && token) await call("/auth/logout", token, json({ refresh_token: refresh })).catch(() => undefined);
    localStorage.removeItem("sakuna-access"); localStorage.removeItem("sakuna-refresh"); setToken(""); setData({}); setMe({}); navigate("Home");
  }
  async function capture(text: string) {
    await call("/capture", token, json({ text }));
    setToast("Captured to your inbox");
    if (page === "Capture inbox" || page === "Home") await fetchPage(page, token);
  }
  async function askAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!chatText.trim() || askingAssistant) return;
    setAskingAssistant(true); setError("");
    try { const answer = await call<Row>("/chat", token, json({ message: chatText.trim(), conversation_id: chatConversationId })); setChatReply(answer); setChatConversationId(answer.conversation_id); setChatText(""); await fetchPage(page, token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Message failed"); }
    finally { setAskingAssistant(false); }
  }
  async function searchMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const memories = await call<Row[]>("/memories/search", token, json({ query: memoryQuery })); setData(current => ({ ...current, memories })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Memory search failed"); }
  }
  async function approve(id: string, action: "approve" | "reject") {
    try { await call(`/approvals/${id}/${action}`, token, { method: "POST" }); setToast(action === "approve" ? "Approved action executed" : "Proposal rejected"); await fetchPage("Approvals", token); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not resolve approval"); }
  }

  if (!token) return <main className="auth">
    <div className="auth-theme"><ThemeToggle compact/></div>
    <div className="auth-split">
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-hero-brand"><BrandMark/><span className="auth-hero-name">Sakuna<span className="brand-ai"> AI</span></span></div>
        <h2>Your whole day,<br/>in one calm place.</h2>
        <p className="auth-hero-sub">Routines, focus, exams, money and news, with an AI team that knows your day and never acts without you.</p>
        <ul className="auth-features">
          <li><span>☀️</span><div><b>Routines and day plan</b><small>Morning to night, the short version on busy days</small></div></li>
          <li><span>🎯</span><div><b>One hour, one task</b><small>Focus blocks with distractions blocked</small></div></li>
          <li><span>🎓</span><div><b>IELTS and German coach</b><small>A plan that adjusts and keeps you honest</small></div></li>
          <li><span>✨</span><div><b>Your AI team</b><small>Morning coach, study coach, night reviewer</small></div></li>
          <li><span>📈</span><div><b>CSE portfolio and news</b><small>Signals from your own rules, never advice</small></div></li>
        </ul>
        <p className="auth-private">🔐 Private: your data stays in your own account.</p>
      </section>
      <form className="auth-card auth-card-v2" onSubmit={authenticate}>
        <div className="auth-mobile-brand"><BrandMark/><span className="auth-hero-name">Sakuna<span className="brand-ai"> AI</span></span></div>
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={authMode === "login"} className={authMode === "login" ? "on" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Sign in</button>
          <button type="button" role="tab" aria-selected={authMode === "register"} className={authMode === "register" ? "on" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>Create account</button>
        </div>
        <h1>{authMode === "login" ? "Welcome back" : "Create your space"}</h1>
        <p className="muted">{authMode === "login" ? "Pick up right where you left off." : "Takes a minute. Everything stays private."}</p>
        {authMode === "register" && <label className="auth-field"><span>Your name</span><input required autoComplete="name" placeholder="e.g. Sakuna" value={fullName} onChange={event => setFullName(event.target.value)} /></label>}
        <label className="auth-field"><span>Email</span><input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="auth-field"><span>Password</span>
          <div className="auth-password">
            <input required type={showPassword ? "text" : "password"} minLength={8} autoComplete={authMode === "login" ? "current-password" : "new-password"}
              placeholder="At least 8 characters" value={password} onChange={event => setPassword(event.target.value)} />
            <button type="button" className="auth-eye" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? "Hide" : "Show"}</button>
          </div>
        </label>
        <button className="primary auth-submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button>
        {authError && <p className="inline-error">{authError}</p>}
        <p className="auth-stay">You stay signed in on this device until you sign out.</p>
      </form>
    </div>
  </main>;

  const user = (me.user || data.user || {}) as Row;
  const dashboard = data.dashboard || {};
  const profile = data.profile || {};
  const tasks = toList(data.tasks || dashboard.tasks);
  const goals = toList(data.goals || dashboard.goals);
  const navGroups = groupNavigation(navQuery);
  const current = navigation.find(item => item.label === page) || navigation[0];
  const displayName = String(user.full_name || user.email || "Your account");
  const paletteActions: PaletteAction[] = navigation.map(item => ({ id: `go-${item.label}`, label: item.label, hint: item.hint, icon: item.icon, run: () => navigate(item.label) }));

  return <FocusProvider token={token} onChange={() => { if (["Focus", "Home", "Weekly review"].includes(page)) void fetchPage(page, token); }}><div className="shell">
    <aside className={`sidebar ${moreOpen ? "open" : ""}`}>
      <div className="brand"><BrandMark small/><BrandName/><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMoreOpen(false)}><Icon name="close"/></button></div>
      <button className="capture-launch" onClick={() => { setMoreOpen(false); setPaletteOpen(true); }}><Icon name="plus" size={16}/>Quick capture<kbd>Ctrl K</kbd></button>
      <input className="nav-search" aria-label="Find a page" placeholder="🔍 Find a page…" value={navQuery} onChange={e => setNavQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && navGroups[0]?.items[0]) { navigate(navGroups[0].items[0].label); setNavQuery(""); } if (e.key === "Escape") setNavQuery(""); }}/>
      <nav aria-label="Main navigation">{navGroups.map(group => <div key={group.title} className="nav-group"><p className="eyebrow nav-title">{group.title}</p>{group.items.map(item => <button key={item.label} aria-current={page === item.label ? "page" : undefined} className={`nav-item ${page === item.label ? "active" : ""}`} onClick={() => navigate(item.label)}><span className="nav-dot"><Icon name={item.icon} size={17}/></span>{item.label}{item.label === "Approvals" && pendingApprovals > 0 && <span className="nav-count">{pendingApprovals}</span>}</button>)}</div>)}</nav>
      <div className="side-bottom"><div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div><div className="user-label"><b>{displayName}</b><button onClick={signOut}>Sign out</button></div></div>
    </aside>
    {moreOpen && <div className="sidebar-scrim" onClick={() => setMoreOpen(false)}/>}
    <main className="content">
      <header className={page === "Home" ? "home-header" : ""}><div>{page === "Home" ? <p className="eyebrow">SAKUNA AI · LIFE OS</p> : <><p className="eyebrow">{current.hint.toUpperCase()}</p><h1>{page}</h1></>}</div>
        <div className="header-actions"><HeaderTimer onOpen={() => navigate("Focus")}/><span className="sync-state">{loading ? "Syncing…" : "● Connected"}</span>
          <button className="outline search-button" onClick={() => setPaletteOpen(true)}><Icon name="search" size={15}/><span className="refresh-label">Capture or jump</span><kbd>Ctrl K</kbd></button>
          <ThemeToggle compact/><button className="outline icon-only" aria-label="Refresh" title="Refresh" onClick={() => void fetchPage()}><Icon name="refresh" size={15}/></button></div></header>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
      {loading && !Object.keys(data).length ? <Panel><div className="loading"><span className="spinner"/>Loading your data…</div></Panel> : <div className="page-enter" key={page}>{renderPage()}</div>}
    </main>
    <nav className="mobile-tabs" aria-label="Quick navigation">
      {MOBILE_TABS.slice(0, 2).map(label => { const item = navigation.find(n => n.label === label)!; return <button key={label} className={page === label ? "active" : ""} onClick={() => navigate(label)}><Icon name={item.icon} size={20}/><span>{label}</span></button>; })}
      <button className="mobile-capture" aria-label="Quick capture" onClick={() => setPaletteOpen(true)}><Icon name="plus" size={24}/></button>
      <button className={page === "Focus" ? "active" : ""} onClick={() => navigate("Focus")}><Icon name="timer" size={20}/><span>Focus</span></button>
      <button className={moreOpen ? "active" : ""} onClick={() => setMoreOpen(true)}><Icon name="menu" size={20}/><span>More{pendingApprovals > 0 ? ` · ${pendingApprovals}` : ""}</span></button>
    </nav>
    <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} actions={paletteActions} onCapture={capture}/>
  </div></FocusProvider>;

  function renderPage(): ReactNode {
    switch (page) {
      case "Home": return <><Overview dashboard={dashboard} onNavigate={navigate} reply={chatReply} text={chatText} setText={setChatText} ask={askAssistant} pending={askingAssistant} onCompleteTask={async id => { await call(`/tasks/${id}/complete`, token, { method: "PATCH" }); setToast("Task completed"); await fetchPage("Home", token); }} quickStart={<><NudgeBanner token={token}/><TodayPlanCard token={token} onOpen={page => navigate(page as Parameters<typeof navigate>[0])}/><LifeCompassCard token={token} onNavigate={page => navigate(page as Parameters<typeof navigate>[0])}/><CommandBar token={token} onChanged={() => void fetchPage("Home", token)}/><CoachCard token={token} onNavigate={navigate} onChanged={() => void fetchPage("Home", token)}/><QuickStart onNavigate={navigate} onCapture={() => setPaletteOpen(true)} openTasks={Number(dashboard.task_counts?.open ?? tasks.length)}/><SecondBrainCard token={token} onChanged={() => { call<Row[]>("/approvals", token).then(rows => setPendingApprovals(toList(rows).filter(row => row.status === "pending").length)).catch(() => undefined); }}/></>} /></>;
      case "Weekly review": return <WeeklyReview tasks={toList(data.tasks)} sessions={toList(data.sessions)} dashboard={data.dashboard || {}} reviews={toList(data.reviews)} save={async content => { await submit("/memories", { content, category: "decision" }); }} />;
      case "My life": return <MyLife tasks={tasks} goals={goals} habits={toList(data.habits)} token={token} refresh={() => fetchPage()} submit={submit} />;
      case "Assistant": return <ChatPage token={token} conversations={toList(data.conversations)} onChanged={() => { call<Row[]>("/conversations", token).then(rows => setData(current => ({ ...current, conversations: rows }))).catch(() => undefined); }} />;
      case "Capture inbox": return <InboxPage token={token} />;
      case "Planner": return <><PlannerBoard token={token} /><Planner plan={data.plan || {}} week={toList(data.week)} submit={submit} token={token} /></>;
      case "Finance": return <Finance summary={data.summary || {}} month={month} setMonth={setMonth} submit={submit} token={token} />;
      case "Career": return <><JobFinder token={token} /><Career profile={data.profile || {}} projects={toList(data.projects)} submit={submit} token={token} /></>;
      case "Learning": return <><LearnRadar token={token} /><LearningPage token={token} /></>;
      case "My day": return <MyDayPage token={token} />;
      case "AI team": return <AiTeamPage token={token} />;
      case "Invest": return <InvestPage token={token} />;
      case "Exam coach": return <ExamsPage token={token} />;
      case "News": return <NewsAndWatch token={token} news={<NewsPage token={token} />} />;
      case "Brain gym": return <BrainGymPage token={token} />;
      case "My videos": return <VideosPage token={token} />;
      case "Search": return <SearchPage token={token} />;
      case "Speaking coach": return <SpeakingPage token={token} />;
      case "My schedule": return <SchedulePage token={token} />;
      case "Dreams & goals": return <DreamsPage token={token} />;
      case "Fitness guide": return <FitnessGuidePage token={token} />;
      case "Medicines": return <MedicinesPage token={token} />;
      case "Scan receipt": return <ReceiptPage token={token} />;
      case "$1M journey": return <WealthPage token={token} />;
      case "Say it": return <DrillPage token={token} />;
      case "Role-play coach": return <RolePlayPage token={token} />;
      case "Morning & evening": return <RitualsPage token={token} />;
      case "Skin & glow": return <SkinPage token={token} />;
      case "Skills & trainers": return <SkillsPage token={token} />;
      case "Day tracker": return <DayPage token={token} />;
      case "Languages": return <LanguagesPage token={token} />;
      case "Progress": return <ProgressPage token={token} />;
      case "Gym": return <GymPage token={token} />;
      case "Journal": return <JournalPage token={token} />;
      case "About you": return <AboutYouPage token={token} />;
      case "Rewards": return <><RewardsGame token={token} /><RewardsPage token={token} /></>;
      case "Study abroad": return <StudyPage token={token} />;
      case "Documents": return <><SubscriptionsPanel token={token} /><VaultPage token={token} /></>;
      case "Life balance": return <BalancePage token={token} />;
      case "Health": return <><HealthAdvicePanel token={token}/><Health records={toList(data.records)} workouts={toList(data.workouts)} sleep={toList(data.sleep)} submit={submit} token={token} /></>;
      case "Focus": return <FocusPage sessions={toList(data.sessions)} tasks={toList(data.tasks)} />;
      case "Experiences": return <Experiences entries={toList(data.entries)} submit={submit} />;
      case "Memory": return <Memory memories={toList(data.memories)} query={memoryQuery} setQuery={setMemoryQuery} search={searchMemory} submit={submit} token={token} refresh={() => fetchPage()} />;
      case "Insights": return <Insights insights={data} />;
      case "Approvals": return <Approvals rows={toList(data.approvals)} onResolve={approve} />;
      case "Settings": return <Settings profile={profile} user={user} settings={data.checkins || {}} submit={submit} token={token} signOut={signOut} />;
      default: return <Empty />;
    }
  }
}

function Overview({ dashboard, onNavigate, reply, text, setText, ask, pending, onCompleteTask, quickStart }: { dashboard: Row; onNavigate: (page: string) => void; reply: Row | null; text: string; setText: (value: string) => void; ask: (event: FormEvent<HTMLFormElement>) => void; pending: boolean; onCompleteTask: (id: string) => Promise<void>; quickStart?: ReactNode }) {
  const tasks = toList(dashboard.tasks);
  const goals = toList(dashboard.goals);
  const habits = toList(dashboard.habits);
  const logs = toList(dashboard.habit_logs);
  const records = toList(dashboard.health_records);
  const sleep = toList(dashboard.sleep);
  const today = new Date().toLocaleDateString("en-CA");
  const weekDays = Array.from({ length: 7 }, (_, index) => { const day = new Date(); day.setDate(day.getDate() - (6 - index)); return day; });
  const completedToday = Number(dashboard.task_counts?.completed_today || 0);
  const activeHabitIds = new Set(habits.map(habit => habit.id));
  const habitsDoneToday = logs.filter(log => activeHabitIds.has(log.habit_id) && String(log.logged_on).slice(0, 10) === today).length;
  const openTasks = Number(dashboard.task_counts?.open ?? tasks.length);
  const taskProgress = openTasks + completedToday ? completedToday / (openTasks + completedToday) : null;
  const habitProgress = habits.length ? habitsDoneToday / habits.length : null;
  const scoreParts = [taskProgress, habitProgress].filter((value): value is number => value !== null);
  const dailyScore = scoreParts.length ? Math.round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length * 100) : null;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const priorities = [...tasks].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority as "high" | "medium" | "low"] ?? 1) - ({ high: 0, medium: 1, low: 2 }[b.priority as "high" | "medium" | "low"] ?? 1) || String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"))).slice(0, 4);
  const latest = (metric: string) => records.find(record => record.metric === metric);
  const heartRate = latest("heart_rate");
  const steps = latest("steps");
  const wellness = [
    { label: "Heart rate", value: heartRate ? `${heartRate.value} ${heartRate.unit}` : "No data", icon: "♡", hint: heartRate ? niceDate(heartRate.recorded_at) : "Connect or add a record", color: "mint" },
    { label: "Sleep", value: sleep[0] ? `${(Number(sleep[0].duration_minutes) / 60).toFixed(1)} hr` : "No data", icon: "☾", hint: sleep[0] ? niceDate(sleep[0].start_at) : "Connect or add a record", color: "blue" },
    { label: "Steps", value: steps ? `${Number(steps.value).toLocaleString()} ${steps.unit}` : "No data", icon: "⌁", hint: steps ? niceDate(steps.recorded_at) : "Connect or add a record", color: "violet" },
  ];
  return <div className="home-dashboard">
    <div className="home-hero"><div><p className="eyebrow">YOUR DAY · {dayLabel.toUpperCase()}</p><h2>{greeting}, <span>{dashboard.full_name || "there"}.</span></h2><p className="home-motto">Small, steady actions add up. Choose one meaningful next step and leave room to rest.</p></div><div className="daily-score" style={{ "--score": `${dailyScore || 0}%` } as CSSProperties}><div><strong>{dailyScore === null ? "—" : `${dailyScore}%`}</strong><small>Daily score</small></div></div></div>
    {quickStart}
    <div className="home-grid">
      <div className="home-column"><Panel className="home-card"><SectionHeading eyebrow="MAKE TODAY COUNT" title="Today’s priorities" action={<button className="text-button" onClick={() => onNavigate("My life")}>All tasks →</button>}/>{priorities.length ? <div className="home-priorities">{priorities.map(task => <div className="home-priority" key={task.id}><button className="home-check" aria-label={`Complete ${task.title}`} onClick={() => void onCompleteTask(task.id)}>✓</button><div className="task-copy"><b>{task.title}</b><small>{task.due_at ? niceDate(task.due_at) : `${task.category || "Personal"} · ${task.duration_minutes || 30} min`}</small></div><span className={`priority-pill ${task.priority || "medium"}`}>{task.priority || "medium"}</span></div>)}</div> : <Empty>You’re clear for now. Add a task to set today’s priorities.</Empty>}</Panel>
        <Panel className="home-card"><SectionHeading eyebrow="YOUR DIRECTION" title="Goal progress" action={<button className="text-button" onClick={() => onNavigate("My life")}>Manage →</button>}/>{goals.length ? <div className="vision-grid">{goals.slice(0, 4).map(goal => { const pct = goal.target_value ? Math.min(100, Math.round(Number(goal.current_value || 0) / Number(goal.target_value) * 100)) : 0; return <div className="vision-goal" key={goal.id}><div className="vision-title"><b>{goal.title}</b><span>{pct}%</span></div><div className="progress"><span style={{ width: `${pct}%` }}/></div><small>{goal.category || "Personal goal"}</small></div>; })}</div> : <Empty>Create a goal to see progress here.</Empty>}</Panel>
      </div>
      <Panel className="home-assistant" aria-busy={pending}><div className="home-ai-mark">✳</div><p className="eyebrow">SAKUNA AI</p><h2>Your personal assistant</h2><p className="muted">Ask about your priorities, plans, goals, habits, or anything you’re working through.</p><div className="home-chat-area">{reply ? <div className="home-chat-answer"><small>SAKUNA · JUST NOW</small><p>{reply.reply}</p>{reply.actions_proposed?.length > 0 && <span className="proposal-note">Waiting for your approval</span>}</div> : <div className="home-chat-prompt">What should I focus on today?</div>}</div><div className="home-chat-suggestions">{[["Suggest my focus", "What should I focus on today?"], ["Plan tomorrow", "Help me plan tomorrow"], ["Goal check-in", "How am I doing on my goals?"], ["Break it down", "Break my top task into small steps"]].map(([label, prompt]) => <button type="button" key={label} onClick={() => setText(prompt)}>{label}</button>)}</div><form className="home-chat-form" onSubmit={ask}><input value={text} onChange={event => setText(event.target.value)} placeholder="Ask Sakuna anything…" aria-label="Ask Sakuna anything"/><button className="primary" disabled={pending || !text.trim()}>{pending ? "…" : "Send ↗"}</button></form><button className="text-button home-full-assistant" onClick={() => onNavigate("Assistant")}>Open full assistant →</button></Panel>
      <div className="home-column"><Panel className="home-card wellness-card"><SectionHeading eyebrow="YOUR WELLNESS" title="Wellness dashboard" action={<button className="text-button" onClick={() => onNavigate("Health")}>Details →</button>}/><div className="wellness-list">{wellness.map(item => <div className="wellness-row" key={item.label}><span className={`wellness-icon ${item.color}`}>{item.icon}</span><div><b>{item.label}</b><small>{item.hint}</small></div><strong>{item.value}</strong></div>)}</div>{!records.length && !sleep.length && <button className="health-connect-hint" onClick={() => onNavigate("Health")}>Connect a health source or add a record in Health →</button>}</Panel>
        <Panel className="home-card habits-card"><SectionHeading eyebrow="BUILD CONSISTENCY" title="Weekly habits" action={<button className="text-button" onClick={() => { onNavigate("My life"); }}>Manage →</button>}/>{habits.length ? <div className="habit-week"><div className="habit-days"><span/>{weekDays.map(day => <span key={day.toISOString()}>{new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(day)}</span>)}</div>{habits.slice(0, 5).map(habit => <div className="habit-week-row" key={habit.id}><b>{habit.name}</b>{weekDays.map(day => { const dayKey = day.toLocaleDateString("en-CA"); const done = logs.some(log => log.habit_id === habit.id && String(log.logged_on).slice(0, 10) === dayKey); return <span key={`${habit.id}-${dayKey}`} className={`habit-dot ${done ? "done" : ""}`} title={`${habit.name} · ${dayKey}${done ? " · complete" : " · not logged"}`}/>; })}</div>)}</div> : <div className="home-habit-empty"><p>No habits set up yet.</p><button className="outline" onClick={() => onNavigate("My life")}>Create a habit</button></div>}</Panel>
      </div>
    </div>
  </div>;
}

function MyLife({ tasks, goals, habits, token, refresh, submit }: { tasks: Row[]; goals: Row[]; habits: Row[]; token: string; refresh: () => void; submit: (path: string, body: Row, options?: RequestInit) => Promise<void> }) {
  const [tab, setTab] = useState("Tasks");
  // 📅 is shown only when Google Calendar is connected with permission to add events.
  const [canAddEvents, setCanAddEvents] = useState(false);
  const [calendarNote, setCalendarNote] = useState("");
  useEffect(() => { call<Row>("/integrations", token).then(r => setCanAddEvents(!!r.calendar?.connection?.can_add_events && r.calendar.connection.status === "connected")).catch(() => setCanAddEvents(false)); }, [token]);
  async function complete(id: string) { await call(`/tasks/${id}/complete`, token, { method: "PATCH" }); refresh(); }
  async function removeTask(id: string) { if (!window.confirm("Delete this task?")) return; try { await call(`/tasks/${id}`, token, { method: "DELETE" }); refresh(); } catch { /* The page error is refreshed by the next load. */ } }
  async function goalProgress(goal: Row) { try { await call(`/goals/${goal.id}`, token, patch({ current_value: Number(goal.current_value || 0) + 1 })); refresh(); } catch { /* Keep the current list visible if the request fails. */ } }
  async function removeGoal(id: string) { if (!window.confirm("Delete this goal? Its linked tasks will be kept.")) return; try { await call(`/goals/${id}`, token, { method: "DELETE" }); refresh(); } catch { /* Keep the current list visible if the request fails. */ } }
  async function logHabit(id: string) { await call(`/habits/${id}/logs`, token, json({ completed: true })); refresh(); }
  const version = tasks.length * 10000 + goals.reduce((n, g) => n + Number(g.current_value || 0), 0) * 7 + habits.length;
  return <><LifeDashboard token={token} version={version} onChanged={refresh}/><div className="tab-bar">{["Tasks", "Goals", "Habits"].map(item => <button className={tab === item ? "selected" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    {tab === "Tasks" && <div className="grid main-grid"><Panel><SectionHeading eyebrow="CAPTURE YOUR NEXT STEP" title="Add a task"/><Form compact fields={[{ name: "title", label: "Task", required: true, placeholder: "What needs doing?" }, { name: "priority", label: "Priority", options: ["low", "medium", "high"] }, { name: "category", label: "Category", options: ["personal", "work", "learning", "health", "business"] }, { name: "due_at", label: "Due date and time", type: "datetime-local" }, { name: "duration_minutes", label: "Minutes", type: "number" }, { name: "repeat", label: "Repeat", options: Object.keys(REPEAT_RULES) }]} submit={({ repeat, ...body }) => submit("/tasks", { priority: "medium", category: "personal", duration_minutes: 30, ...body, ...(repeat ? { recurrence: REPEAT_RULES[String(repeat)] } : {}) })}/><p className="muted small-copy">Repeating tasks: when you finish one, the next is created automatically at the same local time.</p></Panel><Panel><SectionHeading eyebrow="MAKE IT HAPPEN" title={`${tasks.length} open tasks`}/>{tasks.length ? <div className="task-list">{tasks.map(task => <div className="task" key={task.id}><button className="check" aria-label={`Complete ${task.title}`} onClick={() => void complete(task.id)}>✓</button><div className="task-copy"><b>{task.title}</b><small>{task.priority} · {niceDate(task.due_at)}{task.recurrence ? ` · ${repeatLabel(task.recurrence)}` : ""}</small></div><TaskCalendarButton token={token} task={task} canAdd={canAddEvents} onDone={note => { setCalendarNote(note); refresh(); }}/><button className="danger-link" aria-label={`Delete ${task.title}`} onClick={() => void removeTask(task.id)}>Delete</button></div>)}</div> : <Empty>All clear. Add a task when something comes to mind.</Empty>}{calendarNote && <p className="muted small-copy">{calendarNote}</p>}</Panel></div>}
    {tab === "Goals" && <div className="grid main-grid"><Panel><SectionHeading eyebrow="CHOOSE YOUR DIRECTION" title="Create a goal"/><Form fields={[{ name: "title", label: "Goal name", required: true }, { name: "category", label: "Area", options: ["personal", "career", "finance", "health", "learning"] }, { name: "target_value", label: "Target value", type: "number" }, { name: "current_value", label: "Current progress", type: "number" }, { name: "unit", label: "Unit", placeholder: "hours, books, USD…" }, { name: "due_date", label: "Target date", type: "date" }, { name: "metric", label: "Progress comes from", options: ["manual", "savings_balance", "all_accounts", "income_since_start", "focus_hours", "tasks_done", "milestones_done"] }, { name: "metric_currency", label: "Currency (money goals)", placeholder: "LKR" }, { name: "description", label: "Notes", type: "textarea" }]} submit={body => submit("/goals", body)}/><p className="muted small-copy">Automatic sources update themselves from your accounts, income, focus time, linked tasks or milestones. Set floor / realistic / stretch levels on the goal card.</p></Panel><Panel><SectionHeading eyebrow="YOUR LONGER VIEW" title="Goals"/>{goals.length ? goals.map(goal => <GoalCard key={goal.id} goal={goal} extra={<><GoalForecast token={token} goalId={goal.id}/><Milestones token={token} goalId={goal.id}/></>} actions={<><button className="text-button" onClick={() => void goalProgress(goal)}>Progress +1</button><button className="danger-link" onClick={() => void removeGoal(goal.id)}>Delete</button></>}/>) : <Empty>Your active goals will appear here.</Empty>}</Panel></div>}
    {tab === "Habits" && <HabitManager token={token} onChanged={refresh}/>}
  </>;
}
function GoalCard({ goal, actions, extra }: { goal: Row; actions?: ReactNode; extra?: ReactNode }) { const pct = goal.target_value ? Math.min(100, Number(goal.current_value || 0) / Number(goal.target_value) * 100) : 0; return <div className="goal"><div className="goal-title"><b>{goal.title}</b><span>{goal.status}</span></div><p className="muted small-copy">{goal.description || `${goal.current_value || 0} / ${goal.target_value ?? "—"} ${goal.unit || ""}`}</p><div className="progress"><span style={{ width: `${pct}%` }}/></div>{extra}{actions && <div className="goal-actions">{actions}</div>}</div>; }

function Capture({ captures, submit }: { captures: Row[]; submit: (path: string, body: Row, options?: RequestInit) => Promise<void> }) {
  const [text, setText] = useState("");
  return <div className="grid main-grid"><Panel><SectionHeading eyebrow="GET IT OUT OF YOUR HEAD" title="Quick capture"/><form onSubmit={async event => { event.preventDefault(); if (!text.trim()) return; await submit("/capture", { text }); setText(""); }}><textarea className="capture-input" rows={5} placeholder="A thought, task, idea, link, or note…" value={text} onChange={event => setText(event.target.value)}/><div className="form-footer"><span className="muted">Ambiguous items wait for your review.</span><button className="primary">Add to inbox</button></div></form><div className="capture-examples"><span>“Study German for 30 minutes tomorrow”</span><span>“Idea: make a portfolio site”</span></div></Panel><Panel><SectionHeading eyebrow="SORT WHEN YOU’RE READY" title={`Inbox · ${captures.length}`}/>{captures.length ? <div className="record-list">{captures.map(item => <div className="capture-row" key={item.id}><div className="capture-meta"><span className="badge">{String(item.classified_type).replaceAll("_", " ")}</span><span className={`status-dot ${item.status === "needs_confirmation" ? "warning" : ""}`}>{String(item.status).replaceAll("_", " ")}</span></div><p>{item.raw_text}</p>{item.status === "pending" || item.status === "needs_confirmation" ? <button className="outline" onClick={() => void submit(`/capture/${item.id}/confirm`, {}, { method: "POST" })}>Review & save</button> : null}</div>)}</div> : <Empty>Your quick captures will appear here.</Empty>}</Panel></div>;
}

function Planner({ plan, week, submit, token }: { plan: Row; week: Row[]; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string }) {
  const items = toList(plan.items);
  return <><Panel className="planner-summary"><div><p className="eyebrow">TODAY’S PLAN · {String(plan.plan_date || new Date().toISOString().slice(0, 10))}</p><h2>{plan.summary || "Give your day a little structure."}</h2><p className="muted">Your work hours and routine are used to place open tasks into available time.</p></div><button className="primary" onClick={() => void submit("/planner/generate", { scope: "day" })}>↻ Build today’s plan</button></Panel><div className="grid planner-grid"><Panel><SectionHeading eyebrow="TIME BLOCKS" title="Your day"/>{items.length ? <div className="timeline">{items.map(item => <div className="timeline-item" key={item.id}><time>{new Date(item.starts_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}<small>{new Date(item.ends_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small></time><div className={`timeline-block ${item.kind === "task" ? "task-block" : ""}`}><b>{item.title}</b><span>{item.kind}</span></div></div>)}</div> : <Empty>Build a plan to arrange today’s tasks around your routine.</Empty>}{toList(plan.unscheduled).length > 0 && <p className="warning-copy">Unscheduled: {toList(plan.unscheduled).join(", ")}</p>}</Panel><Panel><SectionHeading eyebrow="NEXT SEVEN DAYS" title="Weekly view"/>{week.length ? <div className="week-list">{week.map(day => <div className="week-day" key={day.plan_date}><div><b>{new Date(`${day.plan_date}T12:00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</b><small>{day.summary || "No plan yet"}</small></div><span>{toList(day.items).length} blocks</span></div>)}</div> : <Empty>Your upcoming week will appear here.</Empty>}</Panel></div><Panel className="month-panel"><SectionHeading eyebrow="TIME ENGINE" title="Capacity, load and your top 3"/><TimeEngine token={token}/></Panel><Panel className="month-panel"><SectionHeading eyebrow="THE BIGGER PICTURE" title="Month plan"/><MonthView token={token}/></Panel></>;
}

function Finance({ summary, month, setMonth, submit, token }: { summary: Row; month: string; setMonth: (value: string) => void; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string }) {
  const metrics = [["Income", summary.total_income], ["Expenses", summary.total_expenses], ["Net income", summary.net_income], ["Net worth", summary.net_worth], ["Savings", summary.total_savings], ["Business profit", summary.business_profit]];
  const categories = Object.entries(summary.expense_by_category || {}) as [string, unknown][];
  return <><FinanceDashboard token={token} version={Number(summary.total_expenses || 0) + Number(summary.total_income || 0) * 3}/><Panel className="finance-toolbar"><div><p className="eyebrow">MONEY, WITH CLARITY</p><p className="muted">Actuals, estimates, and projections stay distinct. Values in other currencies are excluded.</p></div><label className="month-field">Month<input type="month" value={month} onChange={event => setMonth(event.target.value)}/></label></Panel><div className="grid finance-metrics">{metrics.map(([label, value]) => <Panel className="metric" key={String(label)}><p className="muted">{label}</p><h2>{money(value, summary.currency || "USD")}</h2><span className="trend">{String(summary.currency || "USD")} · {summary.savings_basis === "explicit" ? "recorded" : "calculated"}</span></Panel>)}</div><div className="grid main-grid"><Panel><SectionHeading eyebrow="TRACK YOUR CASH FLOW" title="Add income or expense"/><div className="form-section"><h3>Income</h3><Form compact fields={[{ name: "amount", label: "Amount", type: "number", required: true }, { name: "currency", label: "Currency", placeholder: "USD" }, { name: "source", label: "Source", options: ["salary", "freelance", "business", "other"], required: true }, { name: "record_kind", label: "Record type", options: ["actual", "estimated", "projected"] }, { name: "received_at", label: "Date and time", type: "datetime-local" }, { name: "notes", label: "Notes" }]} submit={body => submit("/finance/income", { currency: "USD", record_kind: "actual", ...body })}/></div><div className="form-section"><h3>Expense</h3><Form compact fields={[{ name: "amount", label: "Amount", type: "number", required: true }, { name: "currency", label: "Currency", placeholder: "USD" }, { name: "category", label: "Category", options: ["food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "savings", "other"], required: true }, { name: "scope", label: "Scope", options: ["personal", "business"] }, { name: "record_kind", label: "Record type", options: ["actual", "estimated", "projected"] }, { name: "merchant", label: "Merchant" }, { name: "spent_at", label: "Date and time", type: "datetime-local" }, { name: "notes", label: "Notes" }]} submit={body => submit("/finance/expenses", { currency: "USD", scope: "personal", record_kind: "actual", ...body })}/></div></Panel><Panel><SectionHeading eyebrow="SPENDING BREAKDOWN" title="By category"/>{categories.length ? categories.map(([name, amount]) => <div className="category-row" key={name}><span>{name.replaceAll("_", " ")}</span><b>{money(amount, summary.currency || "USD")}</b></div>) : <Empty>Log expenses to see your spending categories.</Empty>}<div className="notice-card"><b>Goal tracker</b><p>{summary.target_amount ? `${money(summary.net_worth, summary.currency)} toward ${money(summary.target_amount, summary.currency)} (${summary.target_progress_percent ?? 0}%). This is recorded progress, not a forecast.` : "Add a financial target in Settings to track recorded net worth progress."}</p></div><div className="form-section"><h3>Record an asset</h3><Form compact fields={[{ name: "name", label: "Asset", required: true }, { name: "amount", label: "Value", type: "number", required: true }, { name: "currency", label: "Currency" }, { name: "category", label: "Type" }]} submit={body => submit("/finance/assets", { currency: "USD", ...body })}/></div><div className="form-section"><h3>Record a liability</h3><Form compact fields={[{ name: "name", label: "Liability", required: true }, { name: "amount", label: "Balance", type: "number", required: true }, { name: "currency", label: "Currency" }, { name: "category", label: "Type" }]} submit={body => submit("/finance/liabilities", { currency: "USD", ...body })}/></div></Panel></div><MoneyHub token={token} defaultCurrency={String(summary.currency || "LKR")}/><SubscriptionsPanel token={token}/></>;
}

function Career({ profile, projects, submit, token }: { profile: Row; projects: Row[]; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string }) {
  return <><Panel><SectionHeading eyebrow="CAREER PROFILE" title="Skills and direction"/><Form fields={[{ name: "headline", label: "Headline", placeholder: "What you do" }, { name: "summary", label: "Professional summary", type: "textarea" }, { name: "skills", label: "Skills · comma separated", placeholder: "Python, design, writing" }]} submit={body => submit("/career/profile", { ...body, skills: typeof body.skills === "string" ? body.skills.split(",").map((item: string) => item.trim()).filter(Boolean) : body.skills }, { method: "PUT" })}/><p className="muted">{profile.headline || "Add a headline to describe your direction."}{profile.skills?.length ? ` · ${profile.skills.join(" · ")}` : ""}</p></Panel><JobTracker token={token}/><div className="grid main-grid"><Panel className="span-all"><SectionHeading eyebrow="INDEPENDENT WORK" title="Freelance projects"/><Form compact fields={[{ name: "client_name", label: "Client", required: true }, { name: "title", label: "Project", required: true }, { name: "status", label: "Status", options: ["lead", "proposal", "active", "completed", "cancelled"] }, { name: "deadline", label: "Deadline", type: "date" }, { name: "value", label: "Value", type: "number" }, { name: "paid_amount", label: "Paid", type: "number" }, { name: "currency", label: "Currency" }, { name: "notes", label: "Notes" }]} submit={body => submit("/career/projects", { value: 0, paid_amount: 0, currency: "USD", ...body })}/><DataRows rows={projects} columns={[{ key: "title", label: "Project" }, { key: "client_name", label: "Client" }, { key: "status", label: "Status" }, { key: "deadline", label: "Deadline", format: value => value || "—" }]} empty="Add freelance work to track deadlines and payments."/></Panel></div></>;
}

function Health({ records, workouts, sleep, submit, token }: { records: Row[]; workouts: Row[]; sleep: Row[]; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string }) {
  return <><HealthDashboard token={token} version={records.length + workouts.length * 100 + sleep.length * 10000}/><div className="notice-card wide-notice"><b>Health data and privacy</b><p>Health entries are personal records, not medical advice. Wearable metrics depend on device permissions and Health Connect compatibility.</p></div><div className="grid main-grid"><Panel><SectionHeading eyebrow="ACTIVITY AND VITALS" title="Add a health record"/><Form fields={[{ name: "metric", label: "Metric", options: ["steps", "heart_rate", "calories", "activity", "other"], required: true }, { name: "value", label: "Value", type: "number", required: true }, { name: "unit", label: "Unit", required: true, placeholder: "steps, bpm, kcal" }, { name: "recorded_at", label: "Date and time", type: "datetime-local" }, { name: "source", label: "Source", placeholder: "manual or Health Connect" }]} submit={body => submit("/health/records", { source: "manual", ...body })}/><div className="form-section"><h3>Log a workout</h3><Form compact fields={[{ name: "activity", label: "Activity", required: true }, { name: "duration_minutes", label: "Minutes", type: "number", required: true }, { name: "calories", label: "Calories", type: "number" }, { name: "started_at", label: "Started", type: "datetime-local" }, { name: "notes", label: "Notes" }]} submit={body => submit("/health/workouts", { ...body, source: "manual" })}/></div><div className="form-section"><h3>Log sleep</h3><Form compact fields={[{ name: "start_at", label: "Sleep start", type: "datetime-local", required: true }, { name: "end_at", label: "Wake time", type: "datetime-local", required: true }, { name: "source", label: "Source" }]} submit={body => submit("/health/sleep", { source: "manual", ...body })}/></div></Panel><Panel><SectionHeading eyebrow="YOUR HEALTH LOG" title="Recent records"/><DataRows rows={records.slice(0, 12)} columns={[{ key: "metric", label: "Metric" }, { key: "value", label: "Value", format: (value, row) => `${value} ${row.unit}` }, { key: "recorded_at", label: "When", format: niceDate }, { key: "source", label: "Source" }]}/><div className="form-section"><h3>Workouts</h3><ListCards rows={workouts.slice(0, 8)} subtitle={row => `${row.duration_minutes} min · ${niceDate(row.started_at)}`}/></div><div className="form-section"><h3>Sleep</h3><ListCards rows={sleep.slice(0, 8)} titleKey="start_at" subtitle={row => `${Math.floor(Number(row.duration_minutes || 0) / 60)}h ${Number(row.duration_minutes || 0) % 60}m`}/></div></Panel></div></>;
}

function Experiences({ entries, submit }: { entries: Row[]; submit: (path: string, body: Row, options?: RequestInit) => Promise<void> }) {
  return <div className="grid main-grid"><Panel><SectionHeading eyebrow="MAKE ROOM FOR LIFE" title="Save an experience"/><Form fields={[{ name: "entry_type", label: "Type", options: ["travel", "place", "event", "hobby", "social", "date", "journal", "experience"], required: true }, { name: "title", label: "Title", required: true }, { name: "occurred_on", label: "Date", type: "date" }, { name: "details", label: "Details", type: "textarea" }]} submit={body => submit("/life", body)}/></Panel><Panel><SectionHeading eyebrow="YOUR PERSONAL LIFE" title="Experiences"/>{entries.length ? <div className="experience-grid">{entries.map((entry, index) => <article className="experience-card" key={entry.id || index}><span className="badge">{entry.entry_type}</span><h3>{entry.title}</h3><p>{entry.details || ""}</p><small>{entry.occurred_on || "Date not set"}</small></article>)}</div> : <Empty>Keep a record of places, events, hobbies, and moments you want to remember.</Empty>}</Panel></div>;
}

function Memory({ memories, query, setQuery, search, submit, token, refresh }: { memories: Row[]; query: string; setQuery: (value: string) => void; search: (event: FormEvent<HTMLFormElement>) => void; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string; refresh: () => void }) {
  const [allowSensitive, setAllowSensitive] = useState(false);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  async function remove(id: string) { if (!window.confirm("Delete this memory?")) return; await call(`/memories/${id}`, token, { method: "DELETE" }); refresh(); }
  async function edit(memory: Row) { const content = window.prompt("Edit this memory", memory.content); if (content === null || !content.trim()) return; try { await call(`/memories/${memory.id}`, token, patch({ content })); refresh(); } catch { /* The next page refresh will report any API error. */ } }
  return <div className="grid main-grid"><Panel><SectionHeading eyebrow="SAVE USEFUL CONTEXT" title="Add a memory"/><Form fields={[{ name: "content", label: "What should Sakuna remember?", type: "textarea", required: true }, { name: "category", label: "Category", options: ["profile", "preference", "career", "education", "goal", "habit", "project", "decision", "routine", "note"] }, { name: "intent_type", label: "Type (auto-detected if empty)", options: ["fact", "preference", "interest", "intention", "commitment"] }]} submit={async body => { await submit("/memories", { category: "note", allow_sensitive: allowSensitive, allow_duplicate: allowDuplicate, ...body }); setAllowDuplicate(false); }}/><label className="check-label"><input type="checkbox" checked={allowSensitive} onChange={event => setAllowSensitive(event.target.checked)}/> I explicitly want to store sensitive information</label><label className="check-label"><input type="checkbox" checked={allowDuplicate} onChange={event => setAllowDuplicate(event.target.checked)}/> Save even if a similar memory exists</label><div className="notice-card"><b>You control memory</b><p>Edit and delete saved memories at any time. Sensitive details are blocked unless you confirm above.</p></div></Panel><Panel><SectionHeading eyebrow="YOUR PERSONAL KNOWLEDGE" title={`Memories · ${memories.length}`}/><form className="memory-search" onSubmit={search}><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your memories…"/><button className="outline">Search</button></form>{memories.length ? <div className="record-list">{memories.map(memory => <div className="memory-card" key={memory.id}><div className="capture-meta"><span className="badge">{memory.category}</span>{memory.intent_type && memory.intent_type !== "fact" && <span className={`badge intent-${memory.intent_type}`}>{memory.intent_type}{memory.topic ? ` · ${memory.topic}` : ""}</span>}{memory.sensitivity === "sensitive" && <span className="badge sensitive">Sensitive</span>}</div><p>{memory.content}</p><div className="memory-actions"><small>Updated {niceDate(memory.updated_at)}</small><div><button className="text-button" onClick={() => void edit(memory)}>Edit</button><button className="danger-link" onClick={() => void remove(memory.id)}>Delete</button></div></div></div>)}</div> : <Empty>No memories yet. Save context you want Sakuna to remember.</Empty>}</Panel></div>;
}

function Insights({ insights }: { insights: Row }) {
  const tasks = toList(insights.open_tasks); const goals = toList(insights.active_goals);
  return <><div className="grid metrics"><Panel className="metric"><p className="muted">Open priorities</p><h2>{tasks.length}</h2><span className="trend">Tasks in progress</span></Panel><Panel className="metric"><p className="muted">Active goals</p><h2>{goals.length}</h2><span className="trend">Current direction</span></Panel><Panel className="metric"><p className="muted">High priority</p><h2>{tasks.filter(task => task.priority === "high").length}</h2><span className="trend">Worth protecting time for</span></Panel><Panel className="metric"><p className="muted">Due soon</p><h2>{tasks.filter(task => task.due_at && new Date(task.due_at).getTime() < Date.now() + 86400000).length}</h2><span className="trend">Next 24 hours</span></Panel></div><div className="grid main-grid"><Panel><SectionHeading eyebrow="PRODUCTIVITY SNAPSHOT" title="Tasks to consider"/><ListCards rows={tasks} subtitle={row => `${row.priority} priority${row.due_at ? ` · ${niceDate(row.due_at)}` : ""}`}/></Panel><Panel><SectionHeading eyebrow="LONG-TERM PROGRESS" title="Goals"/>{goals.map(goal => <GoalCard key={goal.title} goal={goal}/>)}{!goals.length && <Empty>Set a goal to track progress here.</Empty>}<div className="notice-card"><b>Recommendations improve with your data</b><p>Log tasks and habits consistently. Sakuna summarizes actual records and avoids treating plans as completed work.</p></div></Panel></div></>;
}

function Approvals({ rows, onResolve }: { rows: Row[]; onResolve: (id: string, action: "approve" | "reject") => Promise<void> }) {
  const pending = rows.filter(row => row.status === "pending");
  return <Panel><SectionHeading eyebrow="YOU STAY IN CONTROL" title="Pending approvals" action={<span className="count">{pending.length} waiting</span>}/>{pending.length ? <div className="approval-list">{pending.map(row => <article className="approval-card" key={row.id}><div className="capture-meta"><span className="badge">{String(row.tool_name).replaceAll("_", " ")}</span><small>{niceDate(row.created_at)}</small></div><pre>{JSON.stringify(row.payload?.body || row.payload, null, 2)}</pre><div className="approval-actions"><button className="outline danger-button" onClick={() => void onResolve(row.id, "reject")}>Reject</button><button className="primary" onClick={() => void onResolve(row.id, "approve")}>Approve & run</button></div></article>)}</div> : <Empty>No actions are waiting for your approval.</Empty>}</Panel>;
}

function Settings({ profile, user, settings, submit, token, signOut }: { profile: Row; user: Row; settings: Row; submit: (path: string, body: Row, options?: RequestInit) => Promise<void>; token: string; signOut: () => void }) {
  async function updateProfile(body: Row) {
    await submit("/profile", body, { method: "PATCH", body: JSON.stringify(body) });
  }
  return <div className="grid main-grid"><Panel><SectionHeading eyebrow="YOUR PERSONAL DEFAULTS" title="Profile and preferences"/><p className="muted">Signed in as {user.email}</p><VoiceLanguageSelect/><Form fields={[{ name: "full_name", label: "Name" }, { name: "timezone", label: "Timezone", placeholder: "Asia/Colombo" }, { name: "currency", label: "Display currency", placeholder: "USD" }, { name: "wake_time", label: "Wake time", type: "time" }, { name: "sleep_time", label: "Sleep time", type: "time" }, { name: "work_start", label: "Work starts", type: "time" }, { name: "work_end", label: "Work ends", type: "time" }, { name: "gym_time", label: "Gym time", type: "time" }, { name: "financial_target_amount", label: "Financial target", type: "number" }, { name: "financial_target_currency", label: "Target currency", placeholder: "USD" }, { name: "financial_target_date", label: "Target date", type: "date" }, { name: "automation_policy", label: "Automation policy", options: ["confirm", "auto"] }, { name: "bio", label: "About you", type: "textarea" }, { name: "location", label: "Location" }]} submit={updateProfile} button="Save profile"/><p className="muted small-copy">Current timezone: {profile.timezone || "Asia/Colombo"} · Currency: {profile.currency || "USD"} · Policy: {profile.automation_policy || "confirm"}</p></Panel><Panel><SectionHeading eyebrow="GENTLE REMINDERS" title="Check-in settings"/><Form fields={[{ name: "interval_minutes", label: "Interval in minutes", type: "number" }, { name: "enabled", label: "Enabled", options: ["true", "false"] }, { name: "quiet_start", label: "Quiet hours start", type: "time" }, { name: "quiet_end", label: "Quiet hours end", type: "time" }]} submit={body => submit("/checkins/settings", { ...body, interval_minutes: body.interval_minutes ?? 30, enabled: body.enabled === "false" ? false : body.enabled === "true" ? true : settings.enabled ?? true })} button="Save check-ins"/><p className="muted small-copy">Current: {settings.enabled === false ? "Off" : `${settings.interval_minutes || 30} minute intervals`} · quiet hours {settings.quiet_start || "not set"}–{settings.quiet_end || "not set"}</p><div className="form-section"><h3>AI</h3><AiControls token={token}/></div><div className="form-section"><h3>Connected accounts</h3><div className="connect-list"><GoogleConnect token={token} provider="calendar"/><GoogleConnect token={token} provider="gmail"/></div></div><div className="privacy-note">Your account data is private to your account. Keep your password and access tokens secure.</div><button className="outline danger-button" onClick={signOut}>Sign out of Sakuna</button></Panel></div>;
}
