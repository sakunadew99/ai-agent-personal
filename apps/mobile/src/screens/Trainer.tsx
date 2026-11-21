import React from "react";
import { Modal, SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import { KARAOKE_HTML, POSE_HTML, PITCH_HTML, SKIN_HTML } from "../trainers/html";
import { C } from "../ui";

// Same typed wrapper as the in-app browser (react-native-webview props collapse to `never` with RN 0.88 types).
const WebView = RNWebView as unknown as React.ComponentType<{ source: { html: string; baseUrl?: string }; style?: object; [key: string]: unknown }>;

export type TrainerKind = "pitch" | "pose" | "skin" | "karaoke";
export type TrainerResult = { kind: TrainerKind; minutes?: number; [k: string]: unknown };

/** Pitch trainer (tuner + singing scale) or pose coach (MediaPipe) inside the app. Results come back when you tap Finish. */
export function Trainer({ kind, onClose, onResult }: { kind: TrainerKind; onClose: () => void; onResult: (r: TrainerResult) => void }) {
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
        <TouchableOpacity onPress={onClose} style={{ paddingHorizontal: 10 }}><Text style={{ color: C.text, fontSize: 20 }}>✕</Text></TouchableOpacity>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{kind === "pitch" ? "🎤 Pitch trainer" : kind === "skin" ? "✨ Skin & glow check" : kind === "karaoke" ? "🎶 Sing-along" : "🧘 Pose coach"}</Text></View>
      <WebView source={{ html: kind === "pitch" ? PITCH_HTML : kind === "skin" ? SKIN_HTML : kind === "karaoke" ? KARAOKE_HTML : POSE_HTML, baseUrl: "https://trainer.sakuna.app/" }} style={{ flex: 1, backgroundColor: C.bg }}
        javaScriptEnabled domStorageEnabled originWhitelist={["*"]} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant" allowFileAccess={false}
        onMessage={(e: { nativeEvent: { data: string } }) => { try { const r = JSON.parse(e.nativeEvent.data); if (r && r.kind === kind) onResult(r); } catch { /* ignore */ } }}/>
    </SafeAreaView>
  </Modal>;
}
