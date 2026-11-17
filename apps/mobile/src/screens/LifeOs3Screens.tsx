import React, { useCallback, useEffect, useState } from "react";
import { Image, Linking, ScrollView, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { openInApp, type Track } from "../browser";
import { Hero, PALETTE, Ring, Segments, WeekDots } from "../charts";
import { Badge, Btn, C, Card, Empty, Field, H2, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const open = (url?: string, title?: string, track?: Track) => openInApp(url, title, track);
const SKILL_COLOR: Record<string, string> = { Memory: "#f5b65b", Concentration: "#5aa8ff", Logic: "#ff7a8a", Speed: "#3ee08f", Perception: "#b48cff" };

/** Brain gym: today's 5-game workout (one per skill), all 33 BrainGymmer games by skill, and a streak. */
export function BrainGymScreen({ api, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(null);
  const [skill, setSkill] = useState("Memory");
  const load = useCallback(() => { api<Row>("/brain").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Warming up…</Empty></Screen>;
  const played = () => void api<Row>("/brain/played", "POST").then(x => { setV(x); onNotice("🧠 Brain workout logged · streak and points updated"); }).catch(e => onError(msg(e)));
  const group = (v.skills as Row[]).find(s => s.skill === skill);
  return <Screen onRefresh={load}>
    <View style={{ borderRadius: 26, padding: 18, gap: 10, backgroundColor: "#151a33", borderWidth: 1, borderColor: "#3a4a8a", overflow: "hidden" }}>
      <View style={{ position: "absolute", width: 220, height: 220, borderRadius: 110, right: -80, top: -90, backgroundColor: "#5aa8ff", opacity: 0.18 }}/>
      <View style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, left: -70, bottom: -90, backgroundColor: "#b48cff", opacity: 0.16 }}/>
      <Line><View style={{ flex: 1, gap: 4 }}><Text style={{ color: C.blue, fontWeight: "800", fontSize: 11, letterSpacing: 1.5 }}>BRAIN GYM</Text>
        <Text style={{ color: C.text, fontSize: 26, fontWeight: "900" }}>Train your <Text style={{ color: C.blue }}>brain</Text></Text>
        <Muted small>10 minutes a day: one game per skill. Games open on BrainGymmer.</Muted></View>
        <Ring value={Math.min(100, (v.days_30 / 30) * 100)} size={92} color={C.blue} label={`${v.streak}🔥`} sub="STREAK"/></Line>
      <WeekDots today={(new Date().getDay() + 6) % 7} rows={[{ label: "Played", done: v.week as boolean[] }]}/>
      {v.played_today ? <Badge>✓ workout done today</Badge> : <Btn title="✓ I played today" onPress={played}/>}
    </View>
    <Card accent><Kicker>TODAY'S WORKOUT · 5 GAMES</Kicker>
      {(v.workout as Row[]).map(g => <TouchableOpacity key={g.slug} onPress={() => open(g.url, g.name, { category: "study", note: `Brain game: ${g.name}`, brain: true })}>
        <Line style={{ paddingVertical: 6 }}><View style={{ width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: `${SKILL_COLOR[g.skill]}33` }}><Text style={{ fontSize: 22 }}>{g.icon}</Text></View>
          <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800", fontSize: 15 }}>{g.name}</Text><Muted small>{g.skill}</Muted></View><Text style={{ color: SKILL_COLOR[g.skill], fontWeight: "800" }}>Play ▶</Text></Line>
      </TouchableOpacity>)}
      <Muted small>Tip: play them in order, then tap “I played today”.</Muted>
    </Card>
    <Segments options={Object.keys(SKILL_COLOR)} value={skill} onChange={setSkill} labels={{ Memory: "🧠", Concentration: "🎯", Logic: "🧩", Speed: "⚡", Perception: "👁" }}/>
    {group && <Card style={{ borderTopWidth: 3, borderTopColor: SKILL_COLOR[skill] }}><Kicker>{`${skill.toUpperCase()} · ${(group.games as Row[]).length} GAMES`}</Kicker><Muted small>{group.why}</Muted>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(group.games as Row[]).map(g => <TouchableOpacity key={g.slug} onPress={() => open(g.url, g.name, { category: "study", note: `Brain game: ${g.name}`, brain: true })}
        style={{ width: "47%", padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 }}>
        <Text style={{ fontSize: 20 }}>{g.icon}</Text><Text style={{ color: C.text, fontWeight: "800" }}>{g.name}</Text><Text style={{ color: SKILL_COLOR[skill], fontSize: 12 }}>Play ▶</Text></TouchableOpacity>)}</View>
    </Card>}
    <Muted small>{v.source}</Muted>
  </Screen>;
}

const CH_KEY = "sakuna.watchChannels";
/** Watch: latest technology, AI and motivation videos, with must-watch picks; add your own channels. */
export function WatchScreen({ api, onError, onNotice }: Props) {
  const [res, setRes] = useState<Row | null>(null);
  const [mine, setMine] = useState<Row[]>([]);
  const [shelf, setShelf] = useState("all");
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (list: Row[]) => {
    setBusy(true);
    try { setRes(await api<Row>(`/watch?channels=${encodeURIComponent(list.map(c => c.channel_id).join(","))}`)); } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }, [api, onError]);
  useEffect(() => { void SecureStore.getItemAsync(CH_KEY).then(v => { const list = v ? JSON.parse(v) : []; setMine(list); void load(list); }).catch(() => void load([])); }, [load]);
  async function addChannel() {
    try { const c = await api<Row>(`/watch/channel?q=${encodeURIComponent(add.trim())}`); const next = [...mine.filter(x => x.channel_id !== c.channel_id), c].slice(0, 15);
      setMine(next); setAdd(""); void SecureStore.setItemAsync(CH_KEY, JSON.stringify(next)).catch(() => undefined); onNotice(`Added ${c.name}`); void load(next); } catch (e) { onError(msg(e)); }
  }
  const later = (vid: Row) => void api("/tasks", "POST", { title: `Watch: ${vid.title}`.slice(0, 200), category: "learning", priority: "low", duration_minutes: 20, notes: vid.url }).then(() => onNotice("Added to your tasks")).catch(e => onError(msg(e)));
  const shelves: Row[] = res?.shelves || [];
  const shown = shelves.filter(s => shelf === "all" || s.key === shelf);
  return <Screen>
    <Hero kicker="WATCH · WORTH YOUR TIME" title="Learn, grow," accent="get inspired" sub="New videos from technology, AI and motivation channels. Shorts are hidden.">
      <Line><View style={{ flex: 1 }}><Field value={add} onChangeText={setAdd} placeholder="Add a channel: @handle or link"/></View><Btn kind="outline" title="Add" onPress={() => void addChannel()} disabled={add.trim().length < 2}/></Line>
      {busy && <Muted small>Loading videos…</Muted>}
    </Hero>
    {(res?.must_watch || []).length > 0 && <><H2>🔥 Must watch this week</H2>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>{(res!.must_watch as Row[]).map(v => <TouchableOpacity key={v.id} onPress={() => open(v.url, v.title, { category: "study", note: `Video: ${v.title}` })} style={{ width: 240 }}>
        <Image source={{ uri: v.thumb }} style={{ width: 240, height: 135, borderRadius: 16, backgroundColor: C.panel2 }}/>
        <Text style={{ color: C.text, fontWeight: "800", marginTop: 6 }} numberOfLines={2}>{v.title}</Text><Muted small>{`${v.channel} · ${Number(v.views).toLocaleString()} views`}</Muted></TouchableOpacity>)}</ScrollView></>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{[{ key: "all", title: "All" }, ...shelves].map(s => <TouchableOpacity key={s.key} onPress={() => setShelf(s.key)}
      style={{ borderWidth: 1, borderColor: shelf === s.key ? C.green : C.line, backgroundColor: shelf === s.key ? C.greenSoft : "transparent", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 }}>
      <Text style={{ color: C.text, fontWeight: "700" }}>{s.title}</Text></TouchableOpacity>)}</ScrollView>
    {(res?.errors || []).length > 0 && <Muted small>{(res!.errors as string[]).join(" ")}</Muted>}
    {shown.map((s, k) => <View key={s.key} style={{ gap: 10 }}>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: "800" }}>{s.title}</Text>
      {(s.videos as Row[]).slice(0, 8).map(v => <Card key={v.id} style={{ padding: 10 }}>
        <TouchableOpacity onPress={() => open(v.url, v.title, { category: s.key === "motivation" ? "rest" : "study", note: `Video: ${v.title}` })}><Line style={{ alignItems: "flex-start" }}>
          <Image source={{ uri: v.thumb }} style={{ width: 128, height: 72, borderRadius: 10, backgroundColor: C.panel2 }}/>
          <View style={{ flex: 1, gap: 2 }}><Text style={{ color: C.text, fontWeight: "700" }} numberOfLines={3}>{v.title}</Text><Muted small>{`${v.channel} · ${v.published}`}</Muted></View></Line></TouchableOpacity>
        <Btn kind="link" title="⏰ Watch later" onPress={() => later(v)}/>
      </Card>)}
      {!(s.videos as Row[]).length && <Muted small>No new videos loaded right now.</Muted>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{(s.channels as Row[]).map(c => <TouchableOpacity key={c.channel_id} onPress={() => open(c.url)}
        style={{ borderWidth: 1, borderColor: PALETTE[k % PALETTE.length], borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 }}><Text style={{ color: C.text, fontSize: 12 }}>{`▶ ${c.name}`}</Text></TouchableOpacity>)}</ScrollView>
    </View>)}
    {mine.length > 0 && <Card><Kicker>YOUR CHANNELS</Kicker>{mine.map(c => <Line key={c.channel_id}><Text style={{ color: C.text, flex: 1 }}>{c.name}</Text>
      <Btn kind="link" title="Remove" onPress={() => { const next = mine.filter(x => x.channel_id !== c.channel_id); setMine(next); void SecureStore.setItemAsync(CH_KEY, JSON.stringify(next)).catch(() => undefined); void load(next); }}/></Line>)}</Card>}
    <Muted small>{res?.source}</Muted>
  </Screen>;
}

/** LinkedIn: ready-made searches for new posts, hiring posts and fresh jobs (LinkedIn doesn't allow scraping). */
export function LinkedInCard({ api, q }: { api: Api; q: string }) {
  const [links, setLinks] = useState<Row[]>([]);
  useEffect(() => { if (q.trim().length >= 2) api<Row>(`/career/linkedin?q=${encodeURIComponent(q)}`).then(r => setLinks(r.links || [])).catch(() => setLinks([])); }, [api, q]);
  if (!links.length) return null;
  return <Card style={{ borderColor: "#2d64a8" }}><Kicker>LINKEDIN · NEWEST FIRST</Kicker>
    {links.map(l => <TouchableOpacity key={l.name} onPress={() => open(l.url)}><Line style={{ paddingVertical: 5 }}><Text style={{ fontSize: 16 }}>in</Text>
      <Text style={{ color: C.text, flex: 1, fontWeight: "700" }}>{l.name}</Text><Text style={{ color: C.blue }}>Open ↗</Text></Line></TouchableOpacity>)}
    <Muted small>Opens LinkedIn already filtered to the newest posts and jobs for your keywords. LinkedIn doesn't allow other apps to read it.</Muted>
  </Card>;
}

