/**
 * Never just close: a JS error shows a readable screen (with Copy and Restart) instead of crashing, and a fatal error is
 * saved so the next launch can show what happened. No data leaves the phone unless you copy it yourself.
 */
import * as SecureStore from "expo-secure-store";
import React from "react";
import { ScrollView, Share, Text, TouchableOpacity, View } from "react-native";

const KEY = "sakuna.lastCrash";
type EU = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}\n${(e.stack || "").split("\n").slice(0, 8).join("\n")}` : String(e));

/** Save fatal errors before the default handler closes the app. */
export function installCrashRecorder() {
  const eu = (globalThis as unknown as { ErrorUtils?: EU }).ErrorUtils;
  if (!eu) return;
  const prev = eu.getGlobalHandler();
  eu.setGlobalHandler((e, fatal) => {
    if (fatal) { try { void SecureStore.setItemAsync(KEY, `${new Date().toISOString()}\n${describe(e)}`.slice(0, 1800)); } catch { /* ignore */ } }
    prev(e, fatal);
  });
}

function ErrorView({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <View style={{ flex: 1, backgroundColor: "#070b09", padding: 22, paddingTop: 60, gap: 14 }}>
    <Text style={{ color: "#f5b65b", fontSize: 12, fontWeight: "800", letterSpacing: 1.4 }}>SOMETHING BROKE</Text>
    <Text style={{ color: "#eef6f1", fontSize: 22, fontWeight: "900" }}>Sakuna hit an error</Text>
    <Text style={{ color: "#8a9b92" }}>Your data is safe. Tap Share and send this text to fix it, then Try again.</Text>
    <ScrollView style={{ flex: 1, backgroundColor: "#0f1613", borderRadius: 14, padding: 12 }}><Text selectable style={{ color: "#ffb1a0", fontFamily: "monospace", fontSize: 12 }}>{text}</Text></ScrollView>
    <View style={{ flexDirection: "row", gap: 10 }}>
      <TouchableOpacity onPress={() => void Share.share({ message: text }).catch(() => undefined)} style={{ flex: 1, borderWidth: 1, borderColor: "#3ee08f", borderRadius: 12, padding: 14, alignItems: "center" }}><Text style={{ color: "#3ee08f", fontWeight: "800" }}>Share / copy</Text></TouchableOpacity>
      <TouchableOpacity onPress={onRetry} style={{ flex: 1, backgroundColor: "#3ee08f", borderRadius: 12, padding: 14, alignItems: "center" }}><Text style={{ color: "#04170d", fontWeight: "900" }}>Try again</Text></TouchableOpacity>
    </View>
  </View>;
}

export class CrashGuard extends React.Component<{ children: React.ReactNode }, { error: string; last: string }> {
  state = { error: "", last: "" };
  static getDerivedStateFromError(e: unknown) { return { error: describe(e) }; }
  componentDidMount() {
    SecureStore.getItemAsync(KEY).then(v => { if (v) { this.setState({ last: v }); void SecureStore.deleteItemAsync(KEY); } }).catch(() => undefined);
  }
  render() {
    if (this.state.error) return <ErrorView text={this.state.error} onRetry={() => this.setState({ error: "" })}/>;
    if (this.state.last) return <ErrorView text={`Last time Sakuna closed because of:\n\n${this.state.last}`} onRetry={() => this.setState({ last: "" })}/>;
    return this.props.children;
  }
}
