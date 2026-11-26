import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, Share, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Btn, C, Card, Empty, Field, Muted, Screen } from "../ui";
import { ReelsScreen } from "./ReelsScreen";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const CH_KEY = "sakuna.watchChannels";
const TINT: Record<string, string> = { technology: "#4fd1c5", educational: C.blue, motivational: C.amber, psychology: "#b48cff" };
const TABS: [string, string][] = [["", "✨ For you"], ["technology", "💻 Tech"], ["educational", "📚 Learn"], ["motivational", "🔥 Motivation"], ["psychology", "🧠 Mind"]];
const ago = (d?: string) => { if (!d) return ""; const n = Math.round((Date.now() - new Date(d).getTime()) / 86400000); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`; };

function Action({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={{ flex: 1, alignItems: "center", paddingVertical: 8 }}>
    <Text style={{ color: on ? "#ff6b81" : C.muted, fontWeight: "700", fontSize: 13 }}>{label}</Text></TouchableOpacity>;
}

/** Learning hub: a Facebook-style feed of only technology, educational, motivation and psychology posts and videos, ranked for you. */
export function HubScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [tab, setTab] = useState<string>(""); const [items, setItems] = useState<Row[]>([]); const [reels, setReels] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Row | null>(null); const [busy, setBusy] = useState(true); const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [reel, setReel] = useState<Row | null | undefined>(undefined); const [compose, setCompose] = useState(false);
  const [link, setLink] = useState<string>(""); const [note, setNote] = useState<string>(""); const channels = useRef<string>("");
  const send = useCallback((it: Row, action: string, seconds = 0) => void api("/reels/events", "POST", { events: [{ video_id: it.id, channel_id: it.channel_id || undefined,
    category: it.category, title: it.title, action, seconds }] }).catch(() => undefined), [api]);
  const load = useCallback(async (t: string, more = false, shown: Row[] = []) => {
    setBusy(true);
    try {
      const ex = more ? shown.map(i => i.id).slice(-120).join(",") : "";
      const r = await api<Row>(`/hub?channels=${encodeURIComponent(channels.current)}${t ? `&only=${t}` : ""}${ex ? `&exclude=${encodeURIComponent(ex)}` : ""}`);
      setMeta(r); if (!more) setReels(r.reels);
      setItems(prev => { const base = more ? prev : []; const have = new Set(base.map(p => p.id)); return [...base, ...(r.items as Row[]).filter(i => !have.has(i.id))]; });
    } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }, [api, onError]);
  useEffect(() => { void SecureStore.getItemAsync(CH_KEY).then(v => { channels.current = (v ? JSON.parse(v) as Row[] : []).map(c => c.channel_id).join(","); })
    .catch(() => undefined).finally(() => void load("")); }, [load]);
  const pickTab = (t: string) => { setTab(t); void load(t); };
  const open = (it: Row) => {
    if (it.kind === "youtube") { setReel(it); return; }
    send(it, "view", 30);
    openInApp(it.embed || it.url, it.title, { category: "study", note: `Learning hub · ${it.category}`, ...(it.media_id ? { mediaId: it.media_id } : {}) });
  };
  const like = (it: Row) => { const on = !liked[it.id]; setLiked(l => ({ ...l, [it.id]: on })); send(it, on ? "like" : "unlike"); };
  const save = (it: Row) => { send(it, "save");
    void api("/media", "POST", { url: it.url, title: it.title.slice(0, 200), folder: it.kind === "post" ? "Saved posts" : `Learning · ${{ technology: "Technology", educational: "Educational", motivational: "Motivation", psychology: "Psychology" }[it.category as string] || "Other"}` })
      .then(() => onNotice(it.kind === "post" ? "Saved to My videos → Saved posts" : "Saved")).catch(e => onError(msg(e))); };
  const less = (it: Row) => { send(it, "hide"); setItems(prev => prev.filter(p => p.id !== it.id)); onNotice("Fewer posts like this"); };
  const share = () => void api<Row>("/learn-feed/link", "POST", { url: link.trim(), title: note.trim() }).then(r => {
    if (r.saved) { onNotice(`Added to your hub (${r.folder})`); setLink(""); setNote(""); setCompose(false); void load(tab); }
    else onError(`${r.why}. ${r.hint || ""}`); }).catch(e => onError(msg(e)));

  const card = (it: Row) => {
    const tint = TINT[it.category] || C.green;
    return <Card key={it.id} style={{ padding: 0, overflow: "hidden" }}>
      <TouchableOpacity activeOpacity={0.9} onPress={() => open(it)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: tint + "33", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tint, fontWeight: "900" }}>{String(it.channel || "?").replace(/^Saved from /, "").slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>{it.channel}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{[ago(it.published), meta?.categories?.[it.category], it.kind === "youtube" ? "▶ video" : it.kind !== "post" ? `🔗 ${it.kind}` : null].filter(Boolean).join(" · ")}</Text></View>
        </View>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: "800", lineHeight: 22, paddingHorizontal: 12 }}>{it.title}</Text>
        {!!it.excerpt && <Text style={{ color: C.muted, lineHeight: 20, paddingHorizontal: 12, paddingTop: 4 }} numberOfLines={3}>{it.excerpt}</Text>}
        {!!it.thumb && <View style={{ marginTop: 10 }}><Image source={{ uri: it.thumb }} style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: C.panel2 }} resizeMode="cover"/>
          {it.kind === "youtube" && <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
            <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: "#000a", alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 24 }}>▶</Text></View></View>}</View>}
        <Text style={{ color: tint, fontSize: 11, paddingHorizontal: 12, paddingTop: 8 }}>{`✨ ${it.reason}`}</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.line, marginTop: 8 }}>
        <Action label={liked[it.id] ? "❤️ Liked" : "🤍 Like"} on={liked[it.id]} onPress={() => like(it)}/>
        <Action label="🔖 Save" onPress={() => save(it)}/><Action label="👎 Less" onPress={() => less(it)}/>
        <Action label="↗ Share" onPress={() => void Share.share({ message: `${it.title}\n${it.url}` })}/>
      </View>
    </Card>;
  };

  return <Screen onRefresh={() => void load(tab)}>
    <TouchableOpacity onPress={() => setCompose(c => !c)}><Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Text style={{ fontSize: 22 }}>🔗</Text><Text style={{ color: C.muted, flex: 1 }}>Share something you learned: LinkedIn, TikTok, Facebook, TED…</Text></Card></TouchableOpacity>
    {compose && <Card style={{ gap: 8 }}>
      <Field value={link} onChangeText={setLink} placeholder="https://www.linkedin.com/posts/…" autoCapitalize="none"/>
      <Field value={note} onChangeText={setNote} placeholder="What it teaches (e.g. Python tips for data analysis)"/>
      <Btn title="Add to my hub" onPress={share} disabled={link.trim().length < 8 || note.trim().length < 3}/>
      <Muted small>Only learning content is added. LinkedIn, TikTok and Facebook posts play with their official embeds when the post is public.</Muted></Card>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TABS.map(([k, l]) => <TouchableOpacity key={k} onPress={() => pickTab(k)}
      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: tab === k ? C.green : C.panel2 }}>
      <Text style={{ color: tab === k ? C.greenDark : C.text, fontWeight: "800" }}>{l}</Text></TouchableOpacity>)}</View>
    {reels.length > 0 && <View style={{ gap: 6 }}>
      <Text style={{ color: C.text, fontWeight: "900" }}>🎬 Reels for you</Text>
      <FlatList horizontal data={reels} keyExtractor={r => r.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}
        renderItem={({ item }) => <TouchableOpacity onPress={() => setReel(item)} style={{ width: 120, height: 200, borderRadius: 14, overflow: "hidden", backgroundColor: "#000" }}>
          {!!item.thumb && <Image source={{ uri: item.thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover"/>}
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 6, backgroundColor: "#000a" }}>
            <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }} numberOfLines={3}>{item.title}</Text></View></TouchableOpacity>}/>
    </View>}
    {(meta?.errors as string[] | undefined)?.map(e => <Muted key={e} small>{e}</Muted>)}
    {busy && !items.length ? <View style={{ padding: 30, alignItems: "center" }}><ActivityIndicator color={C.green}/><Muted small>Gathering learning posts…</Muted></View>
      : items.length ? items.map(card) : <Empty>Nothing new here right now.</Empty>}
    {items.length > 0 && <Btn kind="outline" title={busy ? "Loading…" : "Load more"} onPress={() => void load(tab, true, items)} disabled={busy}/>}
    {meta && <Card style={{ gap: 6 }}>
      <Text style={{ color: C.text, fontWeight: "900" }}>💼 LinkedIn learning posts</Text>
      <Muted small>LinkedIn has no public feed, so these open LinkedIn's own search for your goals and topics. Share good posts above.</Muted>
      {(meta.linkedin as Row[]).map(l => <TouchableOpacity key={l.url} onPress={() => openInApp(l.url, l.title, { category: "study", note: "LinkedIn learning" })}>
        <Text style={{ color: C.blue, paddingVertical: 3 }}>{`→ ${l.title}`}</Text></TouchableOpacity>)}
      <Muted small>{`🚫 ${meta.hidden_count} non-learning items hidden. ${meta.how}`}</Muted></Card>}
    {reel !== undefined && <ReelsScreen api={api} onError={onError} onNotice={onNotice} first={reel} onClose={() => setReel(undefined)}/>}
  </Screen>;
}
