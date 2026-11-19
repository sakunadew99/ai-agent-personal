import * as SecureStore from "expo-secure-store";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { C } from "../ui";
import type { MoreTarget } from "./HealthReviewScreens";

/** Every screen, grouped, with search words, so the app is easy to find your way around. */
type Item = { key: MoreTarget; icon: string; title: string; hint: string; words?: string };
type Group = { name: string; emoji: string; color: string; items: Item[] };

export const GROUPS: Group[] = [
  { name: "Money", emoji: "💰", color: "#5aa8ff", items: [
    { key: "Invest", icon: "📈", title: "Invest (CSE)", hint: "Portfolio, review, alerts", words: "shares stock cse aspi atrad dividend portfolio" },
    { key: "Money", icon: "👛", title: "Money hub", hint: "Balance, wishes, buy list", words: "wallet net worth savings" },
    { key: "Finance", icon: "💳", title: "Spending", hint: "Spending & income", words: "expense income budget finance" },
    { key: "Vault", icon: "🗂", title: "Renewals & docs", hint: "Subscriptions, bills, expiry", words: "passport visa bills subscriptions documents" },
  ] },
  { name: "Body", emoji: "💪", color: "#3ee08f", items: [
    { key: "Health", icon: "❤️", title: "Health & Mi Band", hint: "Steps, sleep, heart rate", words: "mi fitness steps sleep heart health connect" },
    { key: "Gym", icon: "🏋️", title: "Gym", hint: "Sets, kg × reps, records", words: "workout exercise weights" },
    { key: "Day", icon: "⏱", title: "Day tracker", hint: "Hour by hour report", words: "time hours check-in" },
    { key: "Balance", icon: "☀️", title: "Life balance", hint: "Target vs actual", words: "areas wheel" },
  ] },
  { name: "Learning", emoji: "🎓", color: "#b18cff", items: [
    { key: "Learning", icon: "📚", title: "Learning", hint: "Languages, flashcards, tracker", words: "german english words leetcode course" },
    { key: "Exams", icon: "📝", title: "Exam coach", hint: "IELTS & Goethe plan", words: "ielts goethe exam" },
    { key: "Brain", icon: "🧠", title: "Brain gym", hint: "Daily brain games", words: "games puzzle memory" },
    { key: "Videos", icon: "🎬", title: "My videos", hint: "Drive & YouTube in-app", words: "google drive youtube lectures" },
    { key: "News", icon: "📰", title: "News & watch", hint: "Digest + must-watch", words: "news youtube" },
    { key: "Study", icon: "✈️", title: "Study abroad", hint: "DAAD, programs, checklist", words: "germany daad masters university" },
  ] },
  { name: "Life", emoji: "🌱", color: "#f5b65b", items: [
    { key: "Life", icon: "🎯", title: "My life", hint: "Tasks, goals, habits", words: "todo goals habits" },
    { key: "Journal", icon: "✍️", title: "Journal", hint: "Day, gratitude, lessons", words: "diary notes" },
    { key: "Jobs", icon: "💼", title: "Jobs", hint: "Find jobs, tracker", words: "linkedin topjobs career cv" },
    { key: "Rewards", icon: "🎮", title: "Rewards game", hint: "Level, badges, missions", words: "points streak" },
    { key: "Review", icon: "🗓", title: "Weekly review", hint: "Plan vs actual", words: "week insights" },
    { key: "You", icon: "🪞", title: "About you", hint: "Patterns & one change", words: "insights habits" },
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
    style={{ width: wide ? "100%" : "48.5%", backgroundColor: C.panel, borderRadius: 20, padding: 14, gap: 8, borderWidth: 1, borderColor: `${color}33`, overflow: "hidden", flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "flex-start" }}>
    <View style={{ position: "absolute", right: -18, top: -18, width: 70, height: 70, borderRadius: 35, backgroundColor: `${color}1f` }}/>
    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: `${color}26`, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 21 }}>{item.icon}</Text></View>
    <View style={{ flex: wide ? 1 : undefined, gap: 2 }}>
      <Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }} numberOfLines={1}>{item.title}</Text>
      <Text style={{ color: C.muted, fontSize: 11.5 }} numberOfLines={2}>{item.hint}</Text></View>
  </TouchableOpacity>;
}

/** The "More" tab: search box, recently used, then colourful groups. */
export function ExploreScreen({ open }: { open: (t: MoreTarget) => void }) {
  const [q, setQ] = useState("");
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
      <TextInput value={q} onChangeText={setQ} placeholder="Search: gym, shares, German, videos…" placeholderTextColor={C.muted} style={{ flex: 1, color: C.text, paddingVertical: 13, fontSize: 15 }} autoCorrect={false}/>
      {!!q && <TouchableOpacity onPress={() => setQ("")}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></TouchableOpacity>}
    </View>
    {q ? <View style={{ gap: 10 }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>{hits.length ? `${hits.length} found` : "Nothing found. Try another word."}</Text>
      {hits.map(i => <Tile key={i.key} item={i} color={i.color} open={go} wide/>)}
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>{g.items.map(i => <Tile key={i.key} item={i} color={g.color} open={go}/>)}</View>
      </View>)}
    </>}
  </ScrollView>;
}

/** Home: a search pill plus six big shortcuts. */
export function QuickLaunch({ open, onSearch }: { open: (t: MoreTarget) => void; onSearch: () => void }) {
  const picks: MoreTarget[] = ["Invest", "Health", "Gym", "Learning", "Videos", "Journal"];
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
