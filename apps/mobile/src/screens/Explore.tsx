import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { C } from "../ui";
import { SectionNav } from "../SectionNav";
import type { MoreTarget } from "./HealthReviewScreens";

/** Every screen, grouped, with search words, so the app is easy to find your way around. */
type Item = { key: MoreTarget; icon: string; title: string; hint: string; words?: string };
type Group = { name: string; emoji: string; color: string; hint?: string; items: Item[] };

export const GROUPS: Group[] = [
  { name: "Today & plan", emoji: "🌞", color: "#00c853", hint: "Your day, plan, schedule and reviews", items: [
    { key: "Today", icon: "⭕", title: "Today", hint: "24-hour ring, sleep, water, habits, top task", words: "today day ring timeline clock schedule hours sleep water habits week review" },
    { key: "Board", icon: "🗂", title: "Life board", hint: "Tasks Now/Next/Later, habit strength, goals", words: "board tasks todo to-do habits goals kanban now next later lists strength" },
    { key: "Day", icon: "⏱", title: "Day tracker", hint: "Hour by hour report", words: "time hours check-in" },
    { key: "Schedule", icon: "⏰", title: "My schedule", hint: "Office, gym, sleep times", words: "office work time gym time wake sleep routine shift hours" },
    { key: "Review", icon: "🗓", title: "Review", hint: "Weekly review & about you", words: "week insights patterns about you reflect" },
    { key: "Life", icon: "🎯", title: "My life", hint: "Tasks, goals, habits", words: "todo goals habits" },
    { key: "Balance", icon: "☀️", title: "Life balance", hint: "Target vs actual", words: "areas wheel" },
    { key: "Ask", icon: "💬", title: "Ask Sakuna", hint: "Today, top task, week, neglected, next", words: "ask question today important priority focus next week progress neglect plan check overdue what should i do" },
  ] },
  { name: "Body", emoji: "💪", color: C.green, hint: "Health, gym, food, sleep, water and care", items: [
    { key: "Health", icon: "❤️", title: "Health & Mi Band", hint: "Steps, sleep, heart rate", words: "mi fitness steps sleep heart health connect" },
    { key: "Gym", icon: "🏋️", title: "Gym", hint: "Sets, kg × reps, records", words: "workout exercise weights" },
    { key: "Fitness", icon: "🥗", title: "Fitness guide", hint: "Workouts, exercise how-to, meal plans", words: "workout plan exercise technique muscles meal plan diet nutrition protein calories food rice dhal shopping list belly fat" },
    { key: "Body", icon: "📏", title: "Body measurements", hint: "Weight, waist, body fat and trends", words: "body measurements weight waist chest hips arm thigh neck body fat bmi tape progress" },
    { key: "Sleep", icon: "😴", title: "Sleep", hint: "Bedtime and wake time from phone use + Mi Band", words: "sleep bedtime wake night phone last used first used insomnia rest tired debt" },
    { key: "Water", icon: "💧", title: "Water", hint: "Daily target from your weight, reminders", words: "water drink hydration glass bottle litre reminder thirsty" },
    { key: "Sports", icon: "🥋", title: "Martial arts & swimming", hint: "Pathways, gear costs, safety, clubs near you", words: "karate kickboxing muay thai boxing swimming martial arts sport dojo pool lessons self defence fight" },
    { key: "Skin", icon: "✨", title: "Skin & glow", hint: "Daily face scan, glow score", words: "face skin glow pimple acne spots redness beauty selfie" },
    { key: "Kegel", icon: "🧘", title: "Pelvic floor", hint: "Guided Kegel trainer", words: "kegel pelvic floor exercises bladder wellness men women physio squeeze" },
    { key: "Meds", icon: "💊", title: "Medicines", hint: "Doses, reminders, refills", words: "medicine pills tablets vitamins supplements doctor reminder" },
  ] },
  { name: "Grow", emoji: "🎓", color: "#b18cff", hint: "Learning, reading, languages and skills", items: [
    { key: "Learning", icon: "📚", title: "Learning", hint: "Languages, cards, exams, speaking", words: "german english words leetcode course ielts goethe exam speaking speech presentation pronunciation" },
    { key: "Reading", icon: "📖", title: "Reading", hint: "Books, progress, highlights, yearly goal", words: "book books read reading novel pages library highlights quotes kindle audiobook" },
    { key: "Resources", icon: "🔎", title: "Learn anything", hint: "Best videos, posts and free resources", words: "learn resource video tutorial article course free wikipedia how to study topic" },
    { key: "Skills", icon: "🎯", title: "Skills & trainers", hint: "Yoga, singing, guitar, boxing, leadership", words: "yoga singing vocal guitar music kickboxing fighting swimming leadership soft skills hard skills pose pitch tuner practice" },
    { key: "Speak", icon: "🎙", title: "Speaking coach", hint: "Public speaking, English & German", words: "speech talk presentation pronunciation fluency confidence communication whisper" },
    { key: "English", icon: "✍️", title: "English check", hint: "Grammar corrections for what you write or say", words: "english grammar correction spelling writing conversation languagetool soft skills" },
    { key: "Roleplay", icon: "🎭", title: "Role-play coach", hint: "Negotiation, leadership, interviews", words: "soft skills negotiation salary client leadership conflict delegate interview feedback say no pitch sales communication confidence" },
    { key: "Study", icon: "✈️", title: "Study abroad", hint: "DAAD, programs, checklist", words: "germany daad masters university" },
  ] },
  { name: "Discover", emoji: "📺", color: "#4fd1c5", hint: "Learning feed, reels, videos and news", items: [
    { key: "Hub", icon: "📰", title: "Learning hub", hint: "Facebook-style feed: tech, learning, motivation, psychology", words: "hub feed posts news technology tech ai linkedin facebook articles educational motivation psychology reels for you scroll" },
    { key: "Reels", icon: "🎬", title: "Learning reels", hint: "Swipe-up reels: only learning, ranked for you", words: "reels shorts tiktok swipe scroll for you feed videos learning motivation psychology educational facebook youtube" },
    { key: "LearnFeed", icon: "🎓", title: "Learning feed", hint: "Only educational, motivational & psychology videos", words: "youtube tiktok facebook instagram learning feed educational motivational motivation psychology filter videos watch shorts reels" },
    { key: "Videos", icon: "🎬", title: "My videos", hint: "Drive & YouTube in-app", words: "google drive youtube lectures" },
    { key: "News", icon: "📰", title: "Feed", hint: "News, videos, brain games", words: "news youtube watch brain gym games puzzle memory" },
  ] },
  { name: "Mind", emoji: "🌅", color: C.amber, hint: "Mindset, journal, notes, self-control, dreams", items: [
    { key: "Mindset", icon: "🌅", title: "Mindset studio", hint: "Affirmations, scripting, 55x5, WOOP, gratitude", words: "affirmation affirmations scripting manifest law of attraction positive thinking gratitude woop 55x5 mindset motivation journal" },
    { key: "Journal", icon: "✍️", title: "Journal", hint: "Day, gratitude, lessons", words: "diary notes" },
    { key: "Notes", icon: "📝", title: "Notes", hint: "Notebook, checklists, tags", words: "note notes notebook checklist list ideas write memo todo keep" },
    { key: "Discipline", icon: "🛡", title: "Self-control", hint: "Streaks, urges, triggers, blocking", words: "discipline self control porn free nofap no fap urge trigger habit streak quit addiction blocking digital wellbeing reset" },
    { key: "Dreams", icon: "🌟", title: "Dreams & goals", hint: "Today to 10 years, dream to plan", words: "dream goal vision future plan milestone why success 10 years million germany" },
    { key: "Rewards", icon: "🎮", title: "Rewards game", hint: "Level, badges, missions", words: "points streak" },
  ] },
  { name: "Money & career", emoji: "💰", color: C.blue, hint: "Money, investing, $1M plan, jobs, freelancing", items: [
    { key: "Finance", icon: "👛", title: "Money", hint: "Spending, lists, renewals, documents", words: "wallet net worth savings expense income budget finance passport visa bills subscriptions documents renewals buy list wishes" },
    { key: "Wealth", icon: "🚀", title: "$1M journey & ideas", hint: "Projections and income ideas", words: "million financial freedom net worth projection savings scenario income ideas opportunities side hustle business freelancing" },
    { key: "Invest", icon: "📈", title: "Invest (CSE)", hint: "Portfolio, review, alerts", words: "shares stock cse aspi atrad dividend portfolio" },
    { key: "Jobs", icon: "💼", title: "Jobs", hint: "Find jobs, tracker", words: "linkedin topjobs career cv" },
    { key: "Freelance", icon: "🧑‍💻", title: "Freelancing kit", hint: "Price estimator and proposal drafts", words: "freelance freelancing fiverr upwork proposal gig price estimate client side income" },
    { key: "Content", icon: "🎬", title: "Content studio", hint: "Ideas, scripts, posting plan", words: "content youtube tiktok instagram linkedin post video script creator personal brand social media" },
    { key: "Travel", icon: "🗺", title: "Travel guide", hint: "Where to go, plans, LKR budgets", words: "travel trip holiday ella kandy sigiriya beach japan germany itinerary budget map wishlist visit" },
  ] },
  { name: "Sakuna AI", emoji: "✨", color: C.red, hint: "Assistant, AI team, approvals and memory", items: [
    { key: "Assistant", icon: "💬", title: "Assistant", hint: "Chat with Sakuna", words: "chat ask ai" },
    { key: "Team", icon: "✨", title: "AI team", hint: "Coach, focus guard, reviewer", words: "agents" },
    { key: "Approvals", icon: "✅", title: "Approvals", hint: "AI proposals to confirm", words: "confirm" },
    { key: "Memory", icon: "🧩", title: "Memory", hint: "What Sakuna remembers", words: "facts" },
    { key: "AI", icon: "🔐", title: "AI & privacy", hint: "Usage, off switch", words: "privacy key usage" },
  ] },
  { name: "Settings", emoji: "⚙️", color: C.muted, hint: "Profile, notifications, appearance, privacy", items: [
    { key: "Profile", icon: "⚙️", title: "Settings & profile", hint: "Account & sign out", words: "logout account" },
    { key: "Appearance", icon: "🎨", title: "Appearance", hint: "Light, dark, AMOLED and accent colours", words: "theme themes colour color dark mode light mode amoled black accent appearance design" },
  ] },
];
const ALL = GROUPS.flatMap(g => g.items.map(i => ({ ...i, color: g.color, group: g.name })));
const RECENT_KEY = "sakuna.recentScreens";

export async function rememberScreen(key: string) {
  try {
    const cur: string[] = JSON.parse((await SecureStore.getItemAsync(RECENT_KEY)) || "[]");
    await SecureStore.setItemAsync(RECENT_KEY, JSON.stringify([key, ...cur.filter(k => k !== key)].slice(0, 6)));
  } catch { /* recents are a convenience */ }
}

function Tile({ item, color, open, wide, onPin, pinned }: { item: Item; color: string; open: (k: MoreTarget) => void; wide?: boolean; onPin?: (k: string) => void; pinned?: boolean }) {
  return <TouchableOpacity onPress={() => open(item.key)} onLongPress={() => onPin?.(item.key)} activeOpacity={0.8} accessibilityLabel={item.title}
    style={{ width: wide ? "100%" : "48%", backgroundColor: C.panel, borderRadius: 20, padding: 14, gap: 8, borderWidth: 1, borderColor: `${color}33`, overflow: "hidden", flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "flex-start" }}>
    <View style={{ position: "absolute", right: -18, top: -18, width: 70, height: 70, borderRadius: 35, backgroundColor: `${color}1f` }}/>
    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: `${color}26`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 21 }}>{item.icon}</Text></View>
    <View style={{ flex: wide ? 1 : undefined, gap: 2 }}>
      <Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{`${pinned ? "📌 " : ""}${item.title}`}</Text>
      <Text style={{ color: C.muted, fontSize: 11.5 }} numberOfLines={2}>{item.hint}</Text></View>
  </TouchableOpacity>;
}

/** The "More" tab: search box, recently used, then colourful groups. */
export function ExploreScreen({ open, api, openAny, pinned = [], onPin, bodyOverview }: { open: (t: MoreTarget) => void; api?: <T = Row>(path: string) => Promise<T>; openAny?: (screen: string) => void;
  pinned?: string[]; onPin?: (k: string) => void; bodyOverview?: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [hub, setHub] = useState<Group | null>(null);
  const pins = pinned.map(k => ALL.find(i => i.key === k)).filter(Boolean) as typeof ALL;
  const [found, setFound] = useState<Row | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (!api || s.length < 2) { setFound(null); return; }
    const t = setTimeout(() => { api<Row>(`/search?q=${encodeURIComponent(s)}`).then(setFound).catch(() => setFound(null)); }, 450);
    return () => clearTimeout(t);
  }, [q, api]);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { SecureStore.getItemAsync(RECENT_KEY).then(v => setRecent(JSON.parse(v || "[]"))).catch(() => undefined); }, []);
  const go = (k: MoreTarget) => { void rememberScreen(k); open(k); };
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return ALL.filter(i => `${i.title} ${i.hint} ${i.words || ""} ${i.group}`.toLowerCase().includes(s));
  }, [q]);
  const recents = recent.map(k => ALL.find(i => i.key === k)).filter(Boolean) as typeof ALL;
  return <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }} keyboardShouldPersistTaps="handled">
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.panel2, borderRadius: 18, paddingHorizontal: 14, borderWidth: 1, borderColor: q ? C.green : C.line }}>
      <Text style={{ fontSize: 16 }}>🔍</Text>
      <TextInput value={q} onChangeText={setQ} placeholder="Search apps and everything you saved…" placeholderTextColor={C.muted} style={{ flex: 1, color: C.text, paddingVertical: 13, fontSize: 15 }} autoCorrect={false}/>
      {!!q && <TouchableOpacity onPress={() => setQ("")}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></TouchableOpacity>}
    </View>
    {q ? <View style={{ gap: 10 }}>
      {hits.length > 0 && <Text style={{ color: C.text, fontWeight: "900", fontSize: 15 }}>{`🧭 Apps · ${hits.length}`}</Text>}
      {hits.map(i => <Tile key={i.key} item={i} color={i.color} open={go} wide/>)}
      <Text style={{ color: C.text, fontWeight: "900", fontSize: 15, marginTop: 6 }}>{`🔎 In your stuff${found ? ` · ${found.count}` : ""}`}</Text>
      {found?.mode === "meaning" && <Text style={{ color: "#b48cff", fontSize: 11 }}>✨ Searching by meaning too (Hugging Face MiniLM)</Text>}
      {!found ? <Text style={{ color: C.muted, fontSize: 12 }}>{q.trim().length < 2 ? "Type 2+ letters" : "Searching…"}</Text>
        : !found.results.length ? <Text style={{ color: C.muted, fontSize: 12 }}>Nothing in your tasks, notes, journal, videos or news.</Text>
        : (found.results as Row[]).map(r => <TouchableOpacity key={`${r.kind}-${r.id}`} activeOpacity={0.8}
          onPress={() => { if (r.url) openInApp(r.url, r.title); else openAny?.(r.screen); }}
          style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: C.panel, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.line }}>
          <Text style={{ fontSize: 20 }}>{r.icon}</Text>
          <View style={{ flex: 1, gap: 2 }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>{r.title}</Text>
            {!!r.snippet && <Text style={{ color: C.muted, fontSize: 12 }} numberOfLines={1}>{r.snippet}</Text>}
            <Text style={{ color: r.why === "similar meaning" ? "#b48cff" : C.green, fontSize: 10.5, fontWeight: "700" }}>{`${r.label}${r.why ? ` · ${r.why}` : ""}`}</Text></View>
          <Text style={{ color: C.muted }}>›</Text></TouchableOpacity>)}
      {!!found?.note && <Text style={{ color: C.muted, fontSize: 11 }}>{found.note}</Text>}
    </View> : <>
      {recents.length > 0 && <View style={{ gap: 10 }}>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>🕘 Recently used</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>{recents.map(i =>
          <TouchableOpacity key={i.key} onPress={() => go(i.key)} style={{ alignItems: "center", gap: 6, width: 74 }}>
            <View style={{ width: 58, height: 58, borderRadius: 20, backgroundColor: `${i.color}26`, borderWidth: 1, borderColor: `${i.color}66`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 26 }}>{i.icon}</Text></View>
            <Text style={{ color: C.text, fontSize: 11, fontWeight: "700", textAlign: "center" }} numberOfLines={1}>{i.title}</Text></TouchableOpacity>)}</ScrollView>
      </View>}
      {pins.length > 0 && <View style={{ gap: 10 }}>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>📌 Pinned</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10, justifyContent: "space-between" }}>{pins.map(i => <Tile key={i.key} item={i} color={i.color} open={go}/>)}</View></View>}
      {hub ? <View style={{ gap: 10 }}>
        <TouchableOpacity onPress={() => setHub(null)}><Text style={{ color: C.green, fontWeight: "800" }}>‹ All hubs</Text></TouchableOpacity>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 22 }}>{`${hub.emoji}  ${hub.name}`}</Text><Text style={{ color: C.muted }}>{hub.hint}</Text>
        {hub.name === "Body" && bodyOverview}
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10, justifyContent: "space-between" }}>{hub.items.map(i => <Tile key={i.key} item={i} color={hub.color} open={go} onPin={onPin} pinned={pinned.includes(i.key)}/>)}</View>
        <Text style={{ color: C.muted, fontSize: 11 }}>Long-press a screen to pin it to Today and the top of Hubs.</Text>
      </View> : <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 12, justifyContent: "space-between" }}>{GROUPS.map(g =>
        <TouchableOpacity key={g.name} onPress={() => setHub(g)} activeOpacity={0.85} style={{ width: "48%", minHeight: 132, borderRadius: 24, padding: 16, gap: 6, backgroundColor: C.panel,
          borderWidth: 1, borderColor: `${g.color}55`, overflow: "hidden" }}>
          <View style={{ position: "absolute", right: -26, bottom: -26, width: 100, height: 100, borderRadius: 50, backgroundColor: `${g.color}22` }}/>
          <Text style={{ fontSize: 30 }}>{g.emoji}</Text>
          <Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{g.name}</Text>
          <Text style={{ color: C.muted, fontSize: 11.5 }} numberOfLines={2}>{g.hint}</Text>
          <Text style={{ color: g.color, fontSize: 11, fontWeight: "800" }}>{`${g.items.length} screens ›`}</Text>
        </TouchableOpacity>)}</View>}
    </>}
  </ScrollView>;
}

/** Home: a search pill plus six big shortcuts. */
export function QuickLaunch({ open, onSearch }: { open: (t: MoreTarget) => void; onSearch: () => void }) {
  const picks: MoreTarget[] = ["Dreams", "Invest", "Health", "Skills", "Learning", "Meds"];
  const items = picks.map(k => ALL.find(i => i.key === k)!);
  return <View style={{ gap: 12 }}>
    <TouchableOpacity onPress={onSearch} activeOpacity={0.8} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.panel2, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, borderWidth: 1, borderColor: C.line }}>
      <Text style={{ fontSize: 15 }}>🔍</Text><Text style={{ color: C.muted, fontSize: 14, flex: 1 }}>Search Sakuna…</Text><Text style={{ color: C.green, fontWeight: "800", fontSize: 12 }}>All apps ›</Text></TouchableOpacity>
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 }}>{items.map(i =>
      <TouchableOpacity key={i.key} onPress={() => { void rememberScreen(i.key); open(i.key); }} style={{ width: "31.5%", alignItems: "center", gap: 6, backgroundColor: C.panel, borderRadius: 20, paddingVertical: 14, borderWidth: 1, borderColor: `${i.color}33` }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: `${i.color}26`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 24 }}>{i.icon}</Text></View>
        <Text style={{ color: C.text, fontSize: 12, fontWeight: "800" }} numberOfLines={1}>{i.title.replace(" (CSE)", "").replace(" & Mi Band", "")}</Text></TouchableOpacity>)}</View>
  </View>;
}


/** The hub a screen belongs to (for the chip bar that links sibling screens). */
export function hubOf(key: string): Group | null {
  return GROUPS.find(g => g.items.some(i => i.key === key)) || null;
}

/** Chips across the top of a screen: the other screens in the same hub, so related screens feel like tabs. */
export function HubTabs({ current, open }: { current: string; open: (t: MoreTarget) => void }) {
  const g = hubOf(current);
  if (!g || g.items.length < 2) return null;
  return <SectionNav color={g.color} value={current} onChange={k => { void rememberScreen(k); open(k as MoreTarget); }}
    items={g.items.map(i => ({ key: i.key, icon: i.icon, label: i.title.replace(" & Mi Band", "").replace(" (CSE)", "") }))}/>;
}

/** Your pinned screens (or a starter set) as big shortcuts. */
export function PinnedLaunch({ pinned, open }: { pinned: string[]; open: (t: MoreTarget) => void }) {
  const items = (pinned.length ? pinned : ["Water", "Mindset", "Reels", "Gym"]).map(k => ALL.find(i => i.key === k)).filter(Boolean) as typeof ALL;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 }}>{items.slice(0, 8).map(i =>
    <TouchableOpacity key={i.key} onPress={() => { void rememberScreen(i.key); open(i.key); }} style={{ width: "23.5%", alignItems: "center", gap: 4, backgroundColor: C.panel, borderRadius: 18, paddingVertical: 10 }}>
      <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: `${i.color}26`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 21 }}>{i.icon}</Text></View>
      <Text style={{ color: C.text, fontSize: 10.5, fontWeight: "800" }} numberOfLines={1}>{i.title.split(" ")[0]}</Text></TouchableOpacity>)}</View>;
}

export const ALL_SCREENS = ALL;
