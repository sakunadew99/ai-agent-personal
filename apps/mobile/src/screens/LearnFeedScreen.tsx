import React, { useCallback, useEffect, useState } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const CH_KEY = "sakuna.watchChannels";            // shared with Watch, so your channels appear in both
const OPT_KEY = "sakuna.learnFeedOpts";
const TINT: Record<string, string> = { educational: "#5aa8ff", motivational: "#f5b65b", psychology: "#b48cff" };
const LABEL: Record<string, string> = { all: "All", educational: "📚 Educational", motivational: "🔥 Motivation", psychology: "🧠 Psychology" };

function Chip({ label, on, onPress, color = C.green }: { label: string; on?: boolean; onPress: () => void; color?: string }) {
  return <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1,
    borderColor: on ? color : C.line, backgroundColor: on ? color + "22" : "transparent" }}><Text style={{ color: on ? C.text : C.muted, fontWeight: "700" }}>{label}</Text></TouchableOpacity>;
}

function VideoCard({ v, big }: { v: Row; big?: boolean }) {
  const play = () => openInApp(v.url, v.title, { category: "study", note: `Learning feed · ${v.category}` });
  return <TouchableOpacity activeOpacity={0.85} onPress={play}>
    <Card style={{ padding: 0, overflow: "hidden", borderColor: TINT[v.category] + "55" }}>
      {!!v.thumb && <Image source={{ uri: v.thumb }} style={{ width: "100%", height: big ? 190 : 150 }} resizeMode="cover"/>}
      <View style={{ padding: 12, gap: 4 }}>
        <Text style={{ color: TINT[v.category], fontSize: 11, fontWeight: "900" }}>{`${LABEL[v.category].toUpperCase()} · ${v.channel}`}</Text>
        <Text style={{ color: C.text, fontWeight: "800", lineHeight: 20 }}>{v.title}</Text>
        <Muted small>{`${v.published}${v.views ? ` · ${Number(v.views).toLocaleString()} views` : ""} · ${v.why}`}</Muted>
      </View>
    </Card>
  </TouchableOpacity>;
}

/** Learning feed: only educational, motivational and psychology videos, auto-selected; plus TikTok / Facebook links you save. */
export function LearnFeedScreen({ api, onError, onNotice, onOpenReels }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpenReels?: () => void }) {
  const [res, setRes] = useState<Row | null>(null); const [cat, setCat] = useState<string>("all");
  const [mine, setMine] = useState<Row[]>([]); const [ai, setAi] = useState(false); const [shorts, setShorts] = useState(false);
  const [busy, setBusy] = useState(false); const [showHidden, setShowHidden] = useState(false); const [add, setAdd] = useState<string>("");
  const [link, setLink] = useState<string>(""); const [cap, setCap] = useState<string>(""); const [linkRes, setLinkRes] = useState<Row | null>(null);
  const [saved, setSaved] = useState<Row[]>([]);
  const load = useCallback(async (list: Row[], useAi: boolean, useShorts: boolean) => {
    setBusy(true);
    try { setRes(await api<Row>(`/learn-feed?channels=${encodeURIComponent(list.map(c => c.channel_id).join(","))}&ai=${useAi}&shorts=${useShorts}`)); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }, [api, onError]);
  const loadSaved = useCallback(() => { api<Row>("/media").then(m => setSaved((m.items as Row[]).filter(i => String(i.folder).startsWith("Learning")))).catch(() => undefined); }, [api]);
  useEffect(() => {
    void Promise.all([SecureStore.getItemAsync(CH_KEY), SecureStore.getItemAsync(OPT_KEY)]).then(([c, o]) => {
      const list = c ? JSON.parse(c) : []; const opts = o ? JSON.parse(o) : {};
      setMine(list); setAi(!!opts.ai); setShorts(!!opts.shorts); void load(list, !!opts.ai, !!opts.shorts);
    }).catch(() => void load([], false, false));
    loadSaved();
  }, [load, loadSaved]);
  const setOpt = (nextAi: boolean, nextShorts: boolean) => { setAi(nextAi); setShorts(nextShorts);
    void SecureStore.setItemAsync(OPT_KEY, JSON.stringify({ ai: nextAi, shorts: nextShorts })).catch(() => undefined); void load(mine, nextAi, nextShorts); };
  async function addChannel() {
    try { const c = await api<Row>(`/watch/channel?q=${encodeURIComponent(add.trim())}`); const next = [...mine.filter(x => x.channel_id !== c.channel_id), c].slice(0, 15);
      setMine(next); setAdd(""); void SecureStore.setItemAsync(CH_KEY, JSON.stringify(next)).catch(() => undefined); onNotice(`Added ${c.name}; only its learning videos will show`); void load(next, ai, shorts); }
    catch (e) { onError(msg(e)); }
  }
  const removeChannel = (id: string) => { const next = mine.filter(x => x.channel_id !== id); setMine(next);
    void SecureStore.setItemAsync(CH_KEY, JSON.stringify(next)).catch(() => undefined); void load(next, ai, shorts); };
  const saveLink = (anyway = false) => void api<Row>("/learn-feed/link", "POST", { url: link.trim(), title: cap.trim(), ai, save_anyway: anyway }).then(r => {
    setLinkRes(r); if (r.saved) { setLink(""); setCap(""); onNotice(`Saved to ${r.folder}`); loadSaved(); } }).catch(e => onError(msg(e)));
  const videos = ((res?.videos || []) as Row[]).filter(v => cat === "all" || v.category === cat);
  return <Screen onRefresh={() => void load(mine, ai, shorts)}>
    {onOpenReels && <TouchableOpacity activeOpacity={0.85} onPress={onOpenReels}><Card style={{ backgroundColor: "#1a1030", borderColor: "#b48cff", gap: 4 }}>
      <Text style={{ color: "#fff", fontSize: 20, fontWeight: "900" }}>▶ Watch reels</Text>
      <Muted small>Swipe up like TikTok or Facebook Reels: only learning videos, ranked for you. Plays inside Sakuna, so Shield can block the other apps.</Muted>
    </Card></TouchableOpacity>}
    <Card style={{ gap: 8 }}>
      <Kicker>ONLY LEARNING CONTENT · AUTO-SELECTED</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.keys(LABEL).map(k => <Chip key={k} label={`${LABEL[k]}${k !== "all" && res ? ` ${res.counts[k]}` : ""}`}
        on={cat === k} color={TINT[k] || C.green} onPress={() => setCat(k)}/>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip label={ai ? "🤖 AI check on" : "🤖 AI check off"} on={ai} onPress={() => setOpt(!ai, shorts)}/>
        <Chip label={shorts ? "Shorts shown" : "No shorts"} on={!shorts} onPress={() => setOpt(ai, !shorts)}/>
      </View>
      {busy && <Muted small>Finding learning videos…</Muted>}
    </Card>
    {!res ? <Empty>Loading your learning feed…</Empty> : <>
      {(res.picks as Row[]).length > 0 && cat === "all" && <><Kicker>⭐ TODAY'S PICKS</Kicker>{(res.picks as Row[]).map(v => <VideoCard key={v.id} v={v} big/>)}</>}
      {(res.errors as string[]).map(e => <Muted key={e} small>{e}</Muted>)}
      <TouchableOpacity onPress={() => setShowHidden(x => !x)}><Card style={{ gap: 4 }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{`🚫 ${res.hidden_count} hidden (not learning content) ${showHidden ? "▲" : "▼"}`}</Text>
        {showHidden && (res.hidden as Row[]).map((h, i) => <Muted key={i} small>{`${h.title} · ${h.channel} — ${h.why}`}</Muted>)}
        {showHidden && <Muted small>{res.how}</Muted>}</Card></TouchableOpacity>
      {videos.length ? videos.slice(0, 40).map(v => <VideoCard key={v.id} v={v}/>) : <Empty>No videos in this category right now.</Empty>}
    </>}
    <Card style={{ gap: 8 }}><Kicker>📱 SAVE FROM TIKTOK / FACEBOOK / INSTAGRAM</Kicker>
      <Muted small>Those apps don't share their feed, so paste a link and a few words about it. Only learning content is saved.</Muted>
      <Field value={link} onChangeText={setLink} placeholder="https://www.tiktok.com/@…/video/…" autoCapitalize="none"/>
      <Field value={cap} onChangeText={setCap} placeholder="What it's about (e.g. how to stop overthinking)"/>
      <Btn title="Check & save" onPress={() => saveLink(false)} disabled={link.trim().length < 8 || cap.trim().length < 3}/>
      {linkRes && !linkRes.saved && <View style={{ gap: 4 }}><Text style={{ color: C.amber }}>{`${linkRes.why}. ${linkRes.hint || ""}`}</Text>
        {!String(linkRes.why).startsWith("Hidden") && <Btn kind="link" title="Save anyway" onPress={() => saveLink(true)}/>}</View>}
      {saved.slice(0, 10).map(s => <TouchableOpacity key={s.id} onPress={() => openInApp(s.url, s.title, { category: "study", note: s.folder, mediaId: s.id })}>
        <Text style={{ color: C.text, paddingVertical: 4 }}>{`▶ ${s.title}`}</Text><Muted small>{s.folder}</Muted></TouchableOpacity>)}
    </Card>
    <Card style={{ gap: 8 }}><Kicker>YOUR CHANNELS (ONLY THEIR LEARNING VIDEOS SHOW)</Kicker>
      <Line><Field value={add} onChangeText={setAdd} placeholder="YouTube channel link or @handle" autoCapitalize="none" style={{ flex: 1 }}/><Btn title="Add" onPress={() => void addChannel()} disabled={!add.trim()}/></Line>
      {mine.map(c => <Line key={c.channel_id}><Text style={{ color: C.text, flex: 1 }}>{c.name}</Text><Btn kind="link" title="Remove" onPress={() => removeChannel(c.channel_id)}/></Line>)}
      <Muted small>{`Plus ${(res?.channels as Row[] | undefined)?.length ?? 15} trusted channels (Kurzgesagt, TED-Ed, CrashCourse, Psych2Go, The School of Life…).`}</Muted>
    </Card>
    <Card style={{ gap: 4 }}><Kicker>MAKE THE REAL APPS CALMER</Kicker>
      <Text style={{ color: C.text }}>• Focus → Shield: block TikTok / Facebook at the hours you choose.</Text>
      <Text style={{ color: C.text }}>• YouTube: pause watch history (Settings → Manage all history) to empty the home feed; use “Don't recommend channel”.</Text>
      <Text style={{ color: C.text }}>• TikTok: Settings → Content preferences → manage topics and filter keywords.</Text>
      <Text style={{ color: C.text }}>• Facebook: use the Feeds tab → Favorites, and unfollow pages you don't want.</Text>
      <Muted small>Menu names can change with app updates.</Muted></Card>
  </Screen>;
}
