import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { C } from "../ui";
import type { MoreTarget } from "./HealthReviewScreens";

/** Every screen, grouped, with search words, so the app is easy to find your way around. */
type Item = { key: MoreTarget; icon: string; title: string; hint: string; words?: string };
type Group = { name: string; emoji: string; color: string; items: Item[] };

export const GROUPS: Group[] = [
  { name: "Money", emoji: "💰", color: "#5aa8ff", items: [
    { key: "Wealth", icon: "🚀", title: "$1M journey & ideas", hint: "Projections and income ideas", words: "million financial freedom net worth projection savings scenario income ideas opportunities side hustle business freelancing" },
    { key: "Invest", icon: "📈", title: "Invest (CSE)", hint: "Portfolio, review, alerts", words: "shares stock cse aspi atrad dividend portfolio" },
    { key: "Finance", icon: "👛", title: "Money", hint: "Spending, lists, renewals, documents", words: "wallet net worth savings expense income budget finance passport visa bills subscriptions documents renewals buy list wishes" },
  ] },
  { name: "Body", emoji: "💪", color: "#3ee08f", items: [
    { key: "Health", icon: "❤️", title: "Health & Mi Band", hint: "Steps, sleep, heart rate", words: "mi fitness steps sleep heart health connect" },
    { key: "Fitness", icon: "🥗", title: "Fitness guide", hint: "Workouts, exercise how-to, meal plans", words: "workout plan exercise technique muscles meal plan diet nutrition protein calories food rice dhal shopping list belly fat" },
    { key: "Gym", icon: "🏋️", title: "Gym", hint: "Sets, kg × reps, records", words: "workout exercise weights" },
    { key: "Skin", icon: "✨", title: "Skin & glow", hint: "Daily face scan, glow score", words: "face skin glow pimple acne spots redness beauty selfie" },
    { key: "Kegel", icon: "🧘", title: "Pelvic floor", hint: "Guided Kegel trainer", words: "kegel pelvic floor exercises bladder wellness men women physio squeeze" },
    { key: "Meds", icon: "💊", title: "Medicines", hint: "Doses, reminders, refills", words: "medicine pills tablets vitamins supplements doctor reminder" },
    { key: "Day", icon: "⏱", title: "Day tracker", hint: "Hour by hour report", words: "time hours check-in" },
    { key: "Balance", icon: "☀️", title: "Life balance", hint: "Target vs actual", words: "areas wheel" },
  ] },
  { name: "Learning", emoji: "🎓", color: "#b18cff", items: [
    { key: "Learning", icon: "📚", title: "Learning", hint: "Languages, cards, exams, speaking", words: "german english words leetcode course ielts goethe exam speaking speech presentation pronunciation" },
    { key: "Reading", icon: "📖", title: "Reading", hint: "Books, progress, highlights, yearly goal", words: "book books read reading novel pages library highlights quotes kindle audiobook" },
    { key: "Resources", icon: "🔎", title: "Learn anything", hint: "Best videos, posts and free resources", words: "learn resource video tutorial article course free wikipedia how to study topic" },
    { key: "Roleplay", icon: "🎭", title: "Role-play coach", hint: "Negotiation, leadership, interviews", words: "soft skills negotiation salary client leadership conflict delegate interview feedback say no pitch sales communication confidence" },
    { key: "Skills", icon: "🎯", title: "Skills & trainers", hint: "Yoga, singing, guitar, boxing, leadership", words: "yoga singing vocal guitar music kickboxing fighting swimming leadership soft skills hard skills pose pitch tuner practice" },
    { key: "Speak", icon: "🎙", title: "Speaking coach", hint: "Public speaking, English & German", words: "speech talk presentation pronunciation fluency confidence communication whisper" },


    { key: "Videos", icon: "🎬", title: "My videos", hint: "Drive & YouTube in-app", words: "google drive youtube lectures" },
    { key: "News", icon: "📰", title: "Feed", hint: "News, videos, brain games", words: "news youtube watch brain gym games puzzle memory" },
    { key: "Study", icon: "✈️", title: "Study abroad", hint: "DAAD, programs, checklist", words: "germany daad masters university" },
  ] },
  { name: "Life", emoji: "🌱", color: "#f5b65b", items: [
    { key: "Dreams", icon: "🌟", title: "Dreams & goals", hint: "Today to 10 years, dream to plan", words: "dream goal vision future plan milestone why success 10 years million germany" },
    { key: "Schedule", icon: "⏰", title: "My schedule", hint: "Office, gym, sleep times", words: "office work time gym time wake sleep routine shift hours" },
    { key: "Travel", icon: "🗺", title: "Travel guide", hint: "Where to go, plans, LKR budgets", words: "travel trip holiday ella kandy sigiriya beach japan germany itinerary budget map wishlist visit" },
    { key: "Content", icon: "🎬", title: "Content studio", hint: "Ideas, scripts, posting plan", words: "content youtube tiktok instagram linkedin post video script creator personal brand social media" },
    { key: "Life", icon: "🎯", title: "My life", hint: "Tasks, goals, habits", words: "todo goals habits" },
    { key: "Notes", icon: "📝", title: "Notes", hint: "Notebook, checklists, tags", words: "note notes notebook checklist list ideas write memo todo keep" },
    { key: "Journal", icon: "✍️", title: "Journal", hint: "Day, gratitude, lessons", words: "diary notes" },
    { key: "Jobs", icon: "💼", title: "Jobs", hint: "Find jobs, tracker", words: "linkedin topjobs career cv" },
    { key: "Rewards", icon: "🎮", title: "Rewards game", hint: "Level, badges, missions", words: "points streak" },
    { key: "Review", icon: "🗓", title: "Review", hint: "Weekly review & about you", words: "week insights patterns about you reflect" },
  ] },
  { name: "AI & settings", emoji: "✨", color: "#ff7a8a", items: [
    { key: "Assistant", icon: "💬", title: "Assistant", hint: "Chat with Sakuna", words: "chat ask ai" },
    { key: "Team", icon: "✨", title: "AI team", hint: "Coach, focus guard, reviewer", words: "agents" },
    { key: "Approvals", icon: "✅", title: "Approvals", hint: "AI proposals to confirm", words: "confirm" },
    { key: "Memory", icon: "🧩", title: "Memory", hint: "What Sakuna remembers", words: "facts" },
    { key: "AI", icon: "🔐", title: "AI & privacy", hint: "Usage, off switch", words: "privacy key usage" },
    { key: "Profile", icon: "👤", title: "Profile", hint: "Account & sign out", words: "logout account" },
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

function Tile({ item, color, open, wide }: { item: Item; color: string; open: (k: MoreTarget) => void; wide?: boolean }) {
  return <TouchableOpacity onPress={() => open(item.key)} activeOpacity={0.8} accessibilityLabel={item.title}
    style={{ width: wide ? "100%" : "48%", backgroundColor: C.panel, borderRadius: 20, padding: 14, gap: 8, borderWidth: 1, borderColor: `${color}33`, overflow: "hidden", flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "flex-start" }}>
    <View style={{ position: "absolute", right: -18, top: -18, width: 70, height: 70, borderRadius: 35, backgroundColor: `${color}1f` }}/>
    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: `${color}26`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 21 }}>{item.icon}</Text></View>
    <View style={{ flex: wide ? 1 : undefined, gap: 2 }}>
      <Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{item.title}</Text>
      <Text style={{ color: C.muted, fontSize: 11.5 }} numberOfLines={2}>{item.hint}</Text></View>
  </TouchableOpacity>;
}

/** The "More" tab: search box, recently used, then colourful groups. */
export function ExploreScreen({ open, api, openAny }: { open: (t: MoreTarget) => void; api?: <T = Row>(path: string) => Promise<T>; openAny?: (screen: string) => void }) {
  const [q, setQ] = useState("");
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
      {GROUPS.map(g => <View key={g.name} style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 6, height: 20, borderRadius: 3, backgroundColor: g.color }}/>
          <Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{`${g.emoji}  ${g.name}`}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{g.items.length}</Text></View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10, justifyContent: "space-between" }}>{g.items.map(i => <Tile key={i.key} item={i} color={g.color} open={go}/>)}</View>
      </View>)}
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
