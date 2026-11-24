import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Image, Modal, Share, StatusBar, Text, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import { WebView as RNWebView } from "react-native-webview";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { C } from "../ui";

// Same typing workaround as browser.tsx (react-native-webview 14 props collapse to `never` with RN 0.88 types).
const WebView = RNWebView as unknown as React.ComponentType<{ source: { uri: string } | { html: string; baseUrl?: string }; style?: object;
  onMessage?: (e: { nativeEvent: { data: string } }) => void; [key: string]: unknown }>;

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const CH_KEY = "sakuna.watchChannels";
const TINT: Record<string, string> = { technology: "#4fd1c5", educational: "#5aa8ff", motivational: "#f5b65b", psychology: "#b48cff" };
const LABEL: Record<string, string> = { technology: "💻 Technology", educational: "📚 Educational", motivational: "🔥 Motivation", psychology: "🧠 Psychology" };
// YouTube embeds can refuse to play (e.g. "Error 153") without a real web origin/Referer, so the player page uses the app's own API origin.
const ORIGIN = (process.env.EXPO_PUBLIC_API_URL || "https://ai-agent-personal.onrender.com").replace(/\/+$/, "");

/** YouTube IFrame player that autoplays and reports ended / errors back to the app. */
function ytHtml(id: string) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{position:absolute;inset:0;width:100%;height:100%}</style></head>
<body><div id="p"></div><script>
function post(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m))}
var t=document.createElement('script');t.src='https://www.youtube.com/iframe_api';document.head.appendChild(t);
function onYouTubeIframeAPIReady(){new YT.Player('p',{videoId:${JSON.stringify(id)},playerVars:{autoplay:1,playsinline:1,rel:0,modestbranding:1,controls:1},
events:{onReady:function(e){e.target.playVideo()},onStateChange:function(e){post({state:e.data})},onError:function(e){post({error:e.data})}}})}
</script></body></html>`;
}

function Player({ item, onEnded, onBroken }: { item: Row; onEnded: () => void; onBroken: () => void }) {
  if (item.kind === "youtube") {
    return <WebView source={{ html: ytHtml(item.id), baseUrl: ORIGIN }} style={{ flex: 1, backgroundColor: "#000" }} javaScriptEnabled domStorageEnabled
      allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} allowsFullscreenVideo originWhitelist={["*"]} setSupportMultipleWindows={false}
      onMessage={e => { try { const m = JSON.parse(e.nativeEvent.data); if (m.state === 0) onEnded(); if (m.error) onBroken(); } catch { /* ignore */ } }}/>;
  }
  if (item.embed) {
    return <WebView source={{ uri: item.embed }} style={{ flex: 1, backgroundColor: "#000" }} javaScriptEnabled domStorageEnabled allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false} allowsFullscreenVideo setSupportMultipleWindows={false}/>;
  }
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }}>
    <Text style={{ color: "#fff", textAlign: "center", marginBottom: 14 }}>This clip can't play here.</Text>
    <TouchableOpacity onPress={() => openInApp(item.url, item.title, { category: "study", note: "Reels" })} style={{ padding: 12, borderRadius: 14, backgroundColor: "#ffffff22" }}>
      <Text style={{ color: "#fff", fontWeight: "800" }}>Open it ↗</Text></TouchableOpacity></View>;
}

function Side({ icon, label, on, onPress }: { icon: string; label: string; on?: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={{ alignItems: "center", gap: 2 }}>
    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: on ? "#ff4d6d" : "#00000066", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 22 }}>{icon}</Text></View>
    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{label}</Text></TouchableOpacity>;
}

/** Full-screen learning reels: swipe up for the next one. Only learning content; ranked "For you". Plays inside Sakuna (Shield-safe). */
export function ReelsScreen({ api, onError, onNotice, onClose, first }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onClose: () => void; first?: Row | null }) {
  const { height, width } = Dimensions.get("window");
  const [items, setItems] = useState<Row[]>([]); const [index, setIndex] = useState(0); const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Row | null>(null); const [liked, setLiked] = useState<Record<string, boolean>>({}); const [why, setWhy] = useState(false);
  const channels = useRef<string>(""); const startedAt = useRef<number>(Date.now()); const active = useRef<Row | null>(null); const ended = useRef(false);
  const list = useRef<FlatList<Row>>(null);

  const send = useCallback((it: Row, action: string, seconds = 0) => {
    if (!it) return;
    void api("/reels/events", "POST", { events: [{ video_id: it.id, channel_id: it.channel_id || undefined, category: it.category, title: it.title, action, seconds: Math.round(seconds) }] })
      .catch(() => undefined);
  }, [api]);
  const startWith = first;
  const fetchMore = useCallback(async (initial = false) => {
    try {
      const r = await api<Row>(`/reels?channels=${encodeURIComponent(channels.current)}`);
      setStats(r.stats);
      setItems(prev => { const have = new Set(prev.map(p => p.id)); const add = (r.items as Row[]).filter(i => !have.has(i.id) && i.id !== startWith?.id); return initial ? (startWith ? [startWith, ...add] : add) : [...prev, ...add]; });
      setLiked(prev => ({ ...Object.fromEntries((r.items as Row[]).filter(i => i.liked).map(i => [i.id, true])), ...prev }));
    } catch (e) { onError(msg(e)); } finally { setLoading(false); }
  }, [api, onError, startWith]);
  useEffect(() => {
    void SecureStore.getItemAsync(CH_KEY).then(v => { channels.current = (v ? JSON.parse(v) as Row[] : []).map(c => c.channel_id).join(","); })
      .catch(() => undefined).finally(() => void fetchMore(true));
  }, [fetchMore]);
  // close out the reel you're leaving: a long watch is a "view", a quick flick is a "skip"
  const leave = useCallback(() => {
    const it = active.current; if (!it) return;
    const secs = (Date.now() - startedAt.current) / 1000;
    if (!ended.current) send(it, secs < 4 ? "skip" : "view", secs);
    else send(it, "view", secs);
  }, [send]);
  useEffect(() => () => leave(), [leave]);
  const onViewable = useRef(({ viewableItems }: { viewableItems: { isViewable: boolean; index?: number | null; item: unknown }[] }) => {
    const v = viewableItems.find(x => x.isViewable);
    if (v && v.index != null && (v.item as Row)?.id !== active.current?.id) {
      leaveRef.current(); active.current = v.item as Row; startedAt.current = Date.now(); ended.current = false; setIndex(v.index); setWhy(false);
    }
  }).current;
  const leaveRef = useRef(leave); leaveRef.current = leave;
  useEffect(() => { if (items.length && !active.current) { active.current = items[0]; startedAt.current = Date.now(); } }, [items]);
  useEffect(() => { if (items.length && index >= items.length - 3) void fetchMore(); }, [index, items.length, fetchMore]);

  const next = () => { if (index + 1 < items.length) list.current?.scrollToIndex({ index: index + 1, animated: true }); };
  const like = (it: Row) => { const on = !liked[it.id]; setLiked(l => ({ ...l, [it.id]: on })); send(it, on ? "like" : "unlike"); };
  const save = (it: Row) => {
    send(it, "save");
    if (it.kind === "youtube") void api("/media", "POST", { url: it.url, title: it.title.slice(0, 200), folder: { technology: "Learning · Technology", educational: "Learning · Educational", motivational: "Learning · Motivation", psychology: "Learning · Psychology" }[it.category as string] || "Learning · Other" })
      .then(() => onNotice("Saved to My videos")).catch(e => onError(msg(e)));
    else onNotice("Already in your saved clips");
  };
  const hide = (it: Row) => { send(it, "hide"); active.current = null; setItems(prev => prev.filter(p => p.id !== it.id)); onNotice("Got it, fewer like this"); };

  return <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
    <StatusBar barStyle="light-content"/>
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#fff"/><Text style={{ color: "#aaa", marginTop: 10 }}>Picking learning reels for you…</Text></View>
        : !items.length ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }}><Text style={{ color: "#fff", textAlign: "center" }}>You've seen everything new. Come back later, or add channels in Learning feed.</Text></View>
        : <FlatList ref={list} data={items} keyExtractor={i => i.id} pagingEnabled showsVerticalScrollIndicator={false} decelerationRate="fast"
          getItemLayout={(_, i) => ({ length: height, offset: height * i, index: i })} onViewableItemsChanged={onViewable} viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
          windowSize={3} initialNumToRender={2} maxToRenderPerBatch={2} removeClippedSubviews
          renderItem={({ item, index: i }) => <View style={{ height, width, backgroundColor: "#000" }}>
            {i === index ? <Player item={item} onEnded={() => { ended.current = true; send(item, "complete", (Date.now() - startedAt.current) / 1000); next(); }} onBroken={() => onNotice("This video can't play inside apps; swipe for the next")}/>
              : item.thumb ? <Image source={{ uri: item.thumb }} style={{ flex: 1 }} resizeMode="contain"/> : <View style={{ flex: 1 }}/>}
            <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 74, bottom: 40, padding: 16, gap: 6 }}>
              <Text style={{ color: TINT[item.category] || "#fff", fontWeight: "900", fontSize: 12 }}>{`${LABEL[item.category] || ""} · ${item.channel}`}</Text>
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16, lineHeight: 22 }} numberOfLines={3}>{item.title}</Text>
              <TouchableOpacity onPress={() => setWhy(w => !w)}><Text style={{ color: "#ddd", fontSize: 12 }}>{`✨ ${item.reason}${why ? "" : "  ·  why?"}`}</Text></TouchableOpacity>
              {why && i === index && <Text style={{ color: "#bbb", fontSize: 11, lineHeight: 16 }}>Ranked by what you finish, like and skip, your goals, freshness and popularity. Only learning content is ever shown.</Text>}
            </View>
            <View style={{ position: "absolute", right: 12, bottom: 70, gap: 18 }}>
              <Side icon={liked[item.id] ? "❤️" : "🤍"} label="Like" on={liked[item.id]} onPress={() => like(item)}/>
              <Side icon="🔖" label="Save" onPress={() => save(item)}/>
              <Side icon="👎" label="Less" onPress={() => hide(item)}/>
              <Side icon="↗" label="Share" onPress={() => void Share.share({ message: `${item.title}\n${item.url}` })}/>
            </View>
          </View>}/>}
      <View style={{ position: "absolute", top: 40, left: 12, right: 12, flexDirection: "row", alignItems: "center" }}>
        <TouchableOpacity onPress={onClose} style={{ padding: 8 }}><Text style={{ color: "#fff", fontSize: 22, fontWeight: "900" }}>✕</Text></TouchableOpacity>
        <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16, flex: 1, textAlign: "center" }}>For you · Learning</Text>
        <Text style={{ color: C.green, fontWeight: "800", fontSize: 12, padding: 8 }}>{stats ? `${stats.minutes_week} min this week` : ""}</Text>
      </View>
    </View>
  </Modal>;
}
