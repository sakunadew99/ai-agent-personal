import React, { useCallback, useEffect, useState } from "react";
import { Alert, Image, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Hero, PALETTE, Ring } from "../charts";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");

/** Your own videos (Google Drive, YouTube or any link), in folders, played inside Sakuna; minutes watched are counted. */
export function VideosScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [url, setUrl] = useState(""); const [title, setTitle] = useState(""); const [folder, setFolder] = useState("My videos");
  const [shown, setShown] = useState("All");
  const load = useCallback(() => { api<Row>("/media").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading your videos…</Empty></Screen>;
  const add = () => void api<Row>("/media", "POST", { url: url.trim(), title: title.trim() || undefined, folder: folder.trim() || "My videos" })
    .then(() => { setUrl(""); setTitle(""); onNotice("Saved to your library"); load(); }).catch(e => onError(msg(e)));
  const play = (m: Row) => { openInApp(m.play_url, m.title, { category: "study", note: `Video: ${m.title}`, mediaId: String(m.id) }); setTimeout(load, 1500); };
  const items: Row[] = (v.items as Row[]).filter(i => shown === "All" || i.folder === shown);
  return <Screen onRefresh={load}>
    <Hero kicker="MY VIDEOS · DRIVE & YOUTUBE" title="Your own" accent="library" sub="Paste a Google Drive or YouTube link. Videos play right here; minutes are added to your day."
      right={<Ring value={Math.min(100, (v.minutes_total / 600) * 100)} size={88} label={`${v.minutes_total}`} sub="MIN WATCHED"/>}>
      <Field value={url} onChangeText={setUrl} placeholder="https://drive.google.com/file/d/…/view" autoCapitalize="none"/>
      <Line><View style={{ flex: 1 }}><Field value={title} onChangeText={setTitle} placeholder="Title (optional)"/></View>
        <View style={{ flex: 1 }}><Field value={folder} onChangeText={setFolder} placeholder="Folder"/></View></Line>
      <Btn title="＋ Add video" disabled={url.trim().length < 8} onPress={add}/>
      <Muted small>{v.tip}</Muted>
    </Hero>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{["All", ...(v.folders as string[])].map((f, k) => <TouchableOpacity key={f} onPress={() => setShown(f)}
      style={{ borderWidth: 1, borderColor: shown === f ? PALETTE[k % PALETTE.length] : C.line, backgroundColor: shown === f ? `${PALETTE[k % PALETTE.length]}33` : "transparent", borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 }}>
      <Text style={{ color: C.text, fontWeight: "700" }}>{`📁 ${f}`}</Text></TouchableOpacity>)}</View>
    {items.map(m => <Card key={m.id} style={{ padding: 10 }}>
      <TouchableOpacity onPress={() => play(m)}><Line style={{ alignItems: "flex-start" }}>
        {m.thumb ? <Image source={{ uri: m.thumb }} style={{ width: 132, height: 74, borderRadius: 12, backgroundColor: C.panel2 }}/>
          : <View style={{ width: 132, height: 74, borderRadius: 12, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 28 }}>{m.is_folder ? "📁" : "▶"}</Text></View>}
        <View style={{ flex: 1, gap: 2 }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={2}>{m.title}</Text>
          <Muted small>{`${m.provider === "drive" ? "Google Drive" : m.provider === "youtube" ? "YouTube" : "Web"} · ${m.folder}${m.minutes_watched ? ` · ${m.minutes_watched} min watched` : ""}`}</Muted>
          <Text style={{ color: C.green, fontWeight: "800" }}>{m.is_folder ? "Open folder ›" : "▶ Play"}</Text></View></Line></TouchableOpacity>
      <Line><View style={{ flex: 1 }}/><Btn kind="link" title="Delete" onPress={() => Alert.alert("Remove from library?", m.title, [{ text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void api(`/media/${m.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}/></Line>
    </Card>)}
    {!items.length && <Empty>No videos yet. In Google Drive: Share → “Anyone with the link” → Copy link, then paste it above.</Empty>}
    <Card><Kicker>HOW TO ADD A WHOLE DRIVE FOLDER</Kicker><Muted small>Paste the folder link to open it here, then copy each video's link (⋮ → Share → Copy link) and add it. Sakuna stores only links; your files stay in your Drive.</Muted></Card>
  </Screen>;
}
