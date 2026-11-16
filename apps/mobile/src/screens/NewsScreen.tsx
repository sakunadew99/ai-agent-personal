import React, { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";
import { Hero, Ring, SplitBar } from "../charts";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const SECTIONS: [string, string][] = [["lanka", "🇱🇰 Sri Lanka and CSE markets"], ["tech", "🤖 AI and tech"], ["learn", "💡 Worth learning"]];
const TOPICS = ["ai", "tech", "sri_lanka", "markets", "learning", "other"] as const;
const ago = (iso: string) => { const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000)); return h < 1 ? "just now" : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };
const open = (url: string) => { if (/^https?:\/\//.test(url)) void Linking.openURL(url); };

/** Daily news digest: public feeds ranked by your interests (plain code); optional AI "why it matters". */
export function NewsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(() => peek("/news"));
  const [busy, setBusy] = useState(false);
  const [interest, setInterest] = useState("");
  const [feed, setFeed] = useState({ name: "", url: "", topic: "tech" as (typeof TOPICS)[number] });
  const [showFeeds, setShowFeeds] = useState(false);
  const [find, setFind] = useState("");
  const load = useCallback(() => { api<Row>("/news").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading your news…</Empty></Screen>;
  const d = v.digest;

  async function refresh() {
    setBusy(true);
    try { const out = await api<Row>("/news/refresh", "POST"); onNotice(`${out.added} new stor${out.added === 1 ? "y" : "ies"}${out.errors.length ? ` · ${out.errors.length} feed(s) didn't answer` : ""}`); load(); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  const act = (id: string, action: "save" | "task" | "dismiss") => api<Row>(`/news/items/${id}/${action}`, "POST")
    .then(() => { onNotice(action === "save" ? "Saved to your second brain 🧠" : action === "task" ? "Added as a learning task 📚" : "Hidden"); load(); })
    .catch(e => onError(msg(e)));
  const setInterests = (list: string[]) => api<Row>("/news/interests", "PUT", { interests: list }).then(() => load()).catch(e => onError(msg(e)));

  return <Screen onRefresh={load}>
    <Hero kicker={`TODAY'S DIGEST${d ? ` · ${new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "long" }).toUpperCase()}` : ""}${d?.used_ai ? " · ✨ AI" : ""}`}
      title="News that" accent="matters to you" sub={d?.intro || "No digest yet. Tap Refresh."}
      right={<Ring value={Math.min(100, ((v.items as Row[]).length / 60) * 100)} size={86} label={`${(v.items as Row[]).length}`} sub="STORIES"/>}/>
    {(v.items as Row[]).length > 0 && <Card><Kicker>WHERE TODAY'S STORIES COME FROM</Kicker>
      <SplitBar parts={Object.entries((v.items as Row[]).reduce((acc: Record<string, number>, i) => { const k = i.source || "other"; acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
        .sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))} format={n => `${n}`}/></Card>}
    <Card>
      {v.refreshing && <Muted small>Fetching fresh stories in the background… pull down in a minute.</Muted>}
      <Btn title={busy ? "Refreshing feeds…" : "↻ Refresh now"} onPress={() => void refresh()} busy={busy}/>
    </Card>

    {d && SECTIONS.map(([key, title]) => { const part = (d.items as Row[]).filter(e => e.section === key); if (!part.length) return null;
      return <Card key={key}>
        <Kicker>{title.toUpperCase()}</Kicker>
        {part.map(e => <View key={e.id} style={s.item}>
          <TouchableOpacity onPress={() => open(e.url)}><Text style={s.title}>{e.title}</Text></TouchableOpacity>
          <Muted small>{e.source}</Muted>
          {!!e.why && <Text style={s.why}>→ {e.why}</Text>}
          <View style={s.actions}>
            <TouchableOpacity onPress={() => open(e.url)}><Text style={s.action}>Open</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => void act(e.id, "save")}><Text style={s.action}>🧠 Save</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => void act(e.id, "task")}><Text style={s.action}>📚 Learn</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => void act(e.id, "dismiss")}><Text style={[s.action, { color: C.muted }]}>Hide</Text></TouchableOpacity>
          </View>
        </View>)}
        {key === "lanka" && <Muted small>Market stories are news, not buy or sell advice.</Muted>}
      </Card>; })}

    <Card>
      <Kicker>MORE STORIES (RANKED FOR YOU)</Kicker>
      <TextInput style={s.input} value={find} onChangeText={setFind} placeholder="🔎 Search stories" placeholderTextColor={C.muted}/>
      {(v.items as Row[]).filter(i => !(d?.items as Row[] || []).some(e => e.id === i.id)).filter(i => !find.trim() || `${i.title} ${i.source}`.toLowerCase().includes(find.trim().toLowerCase())).slice(0, find.trim() ? 40 : 15).map(i => <View key={i.id} style={s.row}>
        <TouchableOpacity style={{ flex: 1 }} onPress={() => open(i.url)}><Text style={s.rowTitle} numberOfLines={2}>{i.title}</Text>
          <Muted small>{`${i.source || ""} · ${ago(i.published_at)}${i.status === "saved" ? " · saved" : ""}`}</Muted></TouchableOpacity>
        <TouchableOpacity onPress={() => void act(i.id, "save")}><Text style={s.icon}>🧠</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => void act(i.id, "dismiss")}><Text style={[s.icon, { color: C.muted }]}>✕</Text></TouchableOpacity>
      </View>)}
      {!(v.items as Row[]).length && <Muted>No stories yet. Tap Refresh.</Muted>}
    </Card>

    <Card>
      <Kicker>YOUR INTERESTS</Kicker>
      <View style={s.chips}>{(v.interests as string[]).map(t => <TouchableOpacity key={t} style={s.chip} onPress={() => void setInterests((v.interests as string[]).filter(x => x !== t))}>
        <Text style={s.chipText}>{t} ✕</Text></TouchableOpacity>)}</View>
      <Line><TextInput style={[s.input, { flex: 1 }]} value={interest} onChangeText={setInterest} placeholder="Add a topic, e.g. Flutter" placeholderTextColor={C.muted} maxLength={40}/>
        <Btn title="Add" onPress={() => { if (interest.trim().length >= 2) { void setInterests([...(v.interests as string[]), interest.trim()]); setInterest(""); } }}/></Line>
      <Muted small>Stories mentioning your topics rank higher; CSE and market news always gets a boost because you invest.</Muted>
    </Card>

    <Card>
      <Line><Kicker>{`FEEDS · ${(v.sources as Row[]).filter(x => x.active).length} ON`}</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title={showFeeds ? "Hide" : "Manage"} onPress={() => setShowFeeds(!showFeeds)}/></Line>
      {showFeeds && <>
        {(v.sources as Row[]).map(src => <View key={src.id} style={s.row}>
          <View style={{ flex: 1 }}><Text style={s.rowTitle}>{src.name}</Text>
            <Muted small>{src.last_error ? `⚠ ${src.last_error}` : src.last_fetched_at ? `updated ${ago(src.last_fetched_at)}` : "not fetched yet"}</Muted></View>
          <Switch value={src.active} onValueChange={on => void api(`/news/sources/${src.id}`, "PATCH", { active: on }).then(load).catch(e => onError(msg(e)))}
            trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/>
        </View>)}
        <Text style={s.label}>Add a feed (https RSS or Atom link)</Text>
        <TextInput style={s.input} value={feed.name} onChangeText={name => setFeed({ ...feed, name })} placeholder="Name" placeholderTextColor={C.muted}/>
        <TextInput style={s.input} value={feed.url} onChangeText={url => setFeed({ ...feed, url })} placeholder="https://…/feed" placeholderTextColor={C.muted} autoCapitalize="none" keyboardType="url"/>
        <View style={s.chips}>{TOPICS.map(t => <TouchableOpacity key={t} style={[s.chip, feed.topic === t && s.chipOn]} onPress={() => setFeed({ ...feed, topic: t })}>
          <Text style={[s.chipText, feed.topic === t && { color: C.green }]}>{t.replace("_", " ")}</Text></TouchableOpacity>)}</View>
        <Btn title="Add feed" onPress={() => void api("/news/sources", "POST", feed).then(() => { setFeed({ name: "", url: "", topic: "tech" }); onNotice("Feed added"); load(); }).catch(e => onError(msg(e)))}/>
      </>}
    </Card>
  </Screen>;
}

const s = StyleSheet.create({
  intro: { color: C.text, fontSize: 15, lineHeight: 22 },
  item: { gap: 4, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { color: C.text, fontSize: 15, fontWeight: "700", lineHeight: 21 },
  why: { color: "#a5e3be", fontSize: 13, lineHeight: 19 },
  actions: { flexDirection: "row", gap: 16, marginTop: 2 },
  action: { color: C.green, fontWeight: "700", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  icon: { fontSize: 18, color: C.text, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 12 },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  label: { color: "#aab8af", fontSize: 12, fontWeight: "700", marginTop: 6 },
});
