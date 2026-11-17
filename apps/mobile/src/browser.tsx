import React, { useEffect, useRef, useState } from "react";
import { Linking, Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView as RNWebView, type WebViewNavigation } from "react-native-webview";

type WebHandle = { goBack: () => void; reload: () => void };
// react-native-webview 14 types intersect iOS/Android/Windows props, which collapse to `never` with React Native 0.88's types.
// The runtime component is fine; this keeps type checking on the props we actually use.
const WebView = RNWebView as unknown as React.ComponentType<{ ref?: React.Ref<WebHandle>; source: { uri: string }; style?: object;
  onNavigationStateChange?: (n: WebViewNavigation) => void; onLoadProgress?: (e: { nativeEvent: { progress: number } }) => void;
  onShouldStartLoadWithRequest?: (r: { url: string }) => boolean; [key: string]: unknown }>;
import type { ApiRecord as Row } from "./api";
import { C } from "./ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
/** What to log when the page is closed (time is measured from opening to closing). */
export type Track = { category: "study" | "rest" | "entertainment" | "exercise" | "work"; note: string; brain?: boolean };
type Open = { url: string; title?: string; track?: Track };

let listener: ((o: Open | null) => void) | null = null;
/** Open a web page inside Sakuna (games, videos, job posts, courses). Falls back to the phone browser for non-http links. */
export function openInApp(url?: string | null, title?: string, track?: Track) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (listener) listener({ url, title, track }); else void Linking.openURL(url);
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Mount once near the root. Shows the in-app browser and logs tracked time when it closes. */
export function BrowserHost({ api, onNotice }: { api: Api; onNotice: (m: string) => void }) {
  const [page, setPage] = useState<Open | null>(null);
  const [nav, setNav] = useState<{ canGoBack: boolean; title: string; url: string }>({ canGoBack: false, title: "", url: "" });
  const [progress, setProgress] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const web = useRef<WebHandle>(null);
  const opened = useRef<number>(0);
  useEffect(() => { listener = o => { setPage(o); setProgress(0); setSeconds(0); opened.current = Date.now(); }; return () => { listener = null; }; }, []);
  useEffect(() => { if (!page) return; const t = setInterval(() => setSeconds(Math.round((Date.now() - opened.current) / 1000)), 1000); return () => clearInterval(t); }, [page]);

  async function close() {
    const p = page, secs = Math.round((Date.now() - opened.current) / 1000);
    setPage(null);
    if (!p?.track || secs < 60) return;
    const end = new Date(), start = new Date(end.getTime() - secs * 1000);
    if (iso(start) !== iso(end)) return;
    try {
      await api("/day/entries", "POST", { local_date: iso(end), start_time: hhmm(start), end_time: hhmm(end) === hhmm(start) ? hhmm(new Date(end.getTime() + 60000)) : hhmm(end),
        category: p.track.category, note: `${p.track.note} (${Math.round(secs / 60)} min)`.slice(0, 300), source: "manual" });
      if (p.track.brain) await api("/brain/played", "POST");
      onNotice(`⏱ ${Math.round(secs / 60)} min logged to today: ${p.track.note}`);
    } catch { /* tracking is best-effort */ }
  }
  const host = (() => { try { return new URL(nav.url || page?.url || "").host.replace(/^www\./, ""); } catch { return ""; } })();
  const mm = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <Modal visible={!!page} animationType="slide" onRequestClose={() => { if (nav.canGoBack) web.current?.goBack(); else void close(); }}>
    <SafeAreaView style={s.wrap}>
      <View style={s.bar}>
        <TouchableOpacity style={s.btn} onPress={() => void close()} accessibilityLabel="Close"><Text style={s.btnText}>✕</Text></TouchableOpacity>
        <TouchableOpacity style={[s.btn, !nav.canGoBack && { opacity: 0.35 }]} disabled={!nav.canGoBack} onPress={() => web.current?.goBack()}><Text style={s.btnText}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1, paddingHorizontal: 6 }}>
          <Text style={s.title} numberOfLines={1}>{page?.title || nav.title || "Loading…"}</Text>
          <Text style={s.host} numberOfLines={1}>{`🔒 ${host}${page?.track ? `  ·  ⏱ ${mm}` : ""}`}</Text>
        </View>
        <TouchableOpacity style={s.btn} onPress={() => web.current?.reload()}><Text style={s.btnText}>⟳</Text></TouchableOpacity>
        <TouchableOpacity style={s.btn} onPress={() => void Linking.openURL(nav.url || page!.url)} accessibilityLabel="Open in browser"><Text style={s.btnText}>↗</Text></TouchableOpacity>
      </View>
      {progress < 1 && <View style={s.track}><View style={[s.fill, { width: `${Math.max(5, progress * 100)}%` }]}/></View>}
      {page && <WebView ref={web} source={{ uri: page.url }} style={{ flex: 1, backgroundColor: "#000" }}
        onNavigationStateChange={(n: WebViewNavigation) => setNav({ canGoBack: n.canGoBack, title: n.title, url: n.url })}
        onLoadProgress={e => setProgress(e.nativeEvent.progress)} allowsFullscreenVideo mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false} pullToRefreshEnabled
        originWhitelist={["http://*", "https://*"]}
        onShouldStartLoadWithRequest={r => /^https?:/i.test(r.url) || (void Linking.openURL(r.url).catch(() => undefined), false)}/>}
      {page?.track && <View style={s.footer}><Text style={s.footerText}>{`⏱ ${mm} · closes into your day tracker as “${page.track.note}”`}</Text></View>}
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  bar: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 8, backgroundColor: "#0d1512", borderBottomColor: C.line, borderBottomWidth: 1 },
  btn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.panel2 },
  btnText: { color: C.text, fontSize: 18, fontWeight: "800" },
  title: { color: C.text, fontWeight: "800", fontSize: 14 },
  host: { color: C.muted, fontSize: 11 },
  track: { height: 3, backgroundColor: C.line },
  fill: { height: 3, backgroundColor: C.green },
  footer: { paddingVertical: 6, alignItems: "center", backgroundColor: "#0d1512" },
  footerText: { color: C.green, fontSize: 11, fontWeight: "700" },
});
