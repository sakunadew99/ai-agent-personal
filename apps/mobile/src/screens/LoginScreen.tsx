import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { apiRequest, getServerUrl, saveServerUrl, type ApiRecord as Row } from "../api";
import { C } from "../ui";

const FEATURES = ["☀️ Routines", "🎯 Focus", "🎓 IELTS & German", "✨ AI team", "📈 CSE"];

/** Sign in / create account. On success the parent saves the session so the app stays signed in until Sign out. */
export function LoginScreen({ onSignedIn, initialError = "" }: { onSignedIn: (pair: Row) => Promise<void>; initialError?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [server, setServer] = useState(getServerUrl());
  const [editServer, setEditServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [focus, setFocus] = useState<string | null>(null);

  async function submit() {
    if (!email.trim() || password.length < 8 || (mode === "register" && !name.trim())) {
      setError(mode === "register" ? "Add your name, email and a password of at least 8 characters." : "Enter your email and password (8+ characters).");
      return;
    }
    setBusy(true); setError("");
    try {
      setServer(await saveServerUrl(server));
      const route = mode === "register" ? "/auth/register" : "/auth/login";
      const pair = await apiRequest<Row>(route, "", "POST", mode === "register" ? { email: email.trim(), password, full_name: name.trim() } : { email: email.trim(), password });
      await onSignedIn(pair);
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : "Could not sign in";
      setError(text);
      if (text.startsWith("Can't reach")) setEditServer(true);
    } finally { setBusy(false); }
  }

  const field = (key: string) => [s.input, focus === key && s.inputFocus];
  return <View style={s.root}>
    <StatusBar barStyle="light-content"/>
    <View style={[s.glow, s.glowGreen]}/><View style={[s.glow, s.glowBlue]}/>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.brandRow}><View style={s.logo}><Text style={s.logoText}>S</Text></View>
          <Text style={s.brand}>Sakuna<Text style={{ color: C.green }}> AI</Text></Text></View>
        <Text style={s.headline}>Your whole day,{"\n"}in one calm place.</Text>
        <View style={s.features}>{FEATURES.map(f => <Text key={f} style={s.feature}>{f}</Text>)}</View>

        <View style={s.card}>
          <View style={s.tabs}>{(["login", "register"] as const).map(m => <TouchableOpacity key={m} style={[s.tab, mode === m && s.tabOn]} onPress={() => { setMode(m); setError(""); }}>
            <Text style={[s.tabText, mode === m && s.tabTextOn]}>{m === "login" ? "Sign in" : "Create account"}</Text></TouchableOpacity>)}</View>
          <Text style={s.title}>{mode === "login" ? "Welcome back" : "Create your space"}</Text>
          <Text style={s.sub}>{mode === "login" ? "Pick up right where you left off." : "Takes a minute. Everything stays private."}</Text>

          {mode === "register" && <><Text style={s.label}>Your name</Text>
            <TextInput style={field("name")} value={name} onChangeText={setName} placeholder="e.g. Sakuna" placeholderTextColor="#62746a" onFocus={() => setFocus("name")} onBlur={() => setFocus(null)} autoComplete="name"/></>}
          <Text style={s.label}>Email</Text>
          <TextInput style={field("email")} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#62746a" autoCapitalize="none" keyboardType="email-address"
            autoComplete="email" onFocus={() => setFocus("email")} onBlur={() => setFocus(null)}/>
          <Text style={s.label}>Password</Text>
          <View>
            <TextInput style={[...field("password"), { paddingRight: 70 }]} value={password} onChangeText={setPassword} secureTextEntry={!show} placeholder="At least 8 characters"
              placeholderTextColor="#62746a" autoComplete={mode === "login" ? "password" : "password-new"} onFocus={() => setFocus("password")} onBlur={() => setFocus(null)} onSubmitEditing={() => void submit()}/>
            <TouchableOpacity style={s.eye} onPress={() => setShow(!show)} accessibilityLabel={show ? "Hide password" : "Show password"}><Text style={s.eyeText}>{show ? "Hide" : "Show"}</Text></TouchableOpacity>
          </View>

          <TouchableOpacity style={[s.primary, busy && { opacity: 0.7 }]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color={C.greenDark}/> : <Text style={s.primaryText}>{mode === "login" ? "Sign in" : "Create account"}</Text>}
          </TouchableOpacity>
          {!!error && <Text style={s.error}>{error}</Text>}
          <Text style={s.stay}>🔐 You'll stay signed in on this phone until you sign out.</Text>
        </View>

        {editServer ? <View style={{ gap: 6 }}><Text style={s.label}>Server address</Text>
          <TextInput style={s.input} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://your-server.onrender.com" placeholderTextColor="#62746a"/></View>
          : <TouchableOpacity onPress={() => setEditServer(true)}><Text style={s.server}>Server · {server.replace(/^https?:\/\//, "")} · Change</Text></TouchableOpacity>}
      </ScrollView>
    </KeyboardAvoidingView>
  </View>;
}

/** Shown while the saved session is restored (or when the server can't be reached yet). */
export function SplashScreen({ problem, onRetry, onSignInAgain }: { problem?: string; onRetry: () => void; onSignInAgain: () => void }) {
  return <View style={[s.root, { justifyContent: "center", alignItems: "center", padding: 28 }]}>
    <StatusBar barStyle="light-content"/>
    <View style={[s.glow, s.glowGreen]}/><View style={[s.glow, s.glowBlue]}/>
    <View style={[s.logo, s.logoBig]}><Text style={[s.logoText, { fontSize: 46 }]}>S</Text></View>
    <Text style={[s.brand, { marginTop: 18 }]}>Sakuna<Text style={{ color: C.green }}> AI</Text></Text>
    {problem ? <>
      <Text style={s.splashText}>{problem}</Text>
      <TouchableOpacity style={[s.primary, { alignSelf: "stretch" }]} onPress={onRetry}><Text style={s.primaryText}>Try again</Text></TouchableOpacity>
      <TouchableOpacity onPress={onSignInAgain}><Text style={s.server}>Use a different account or server</Text></TouchableOpacity>
    </> : <><ActivityIndicator color={C.green} style={{ marginTop: 26 }}/><Text style={s.splashText}>Opening your day…</Text></>}
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, overflow: "hidden" },
  glow: { position: "absolute", borderRadius: 999 },
  glowGreen: { width: 380, height: 380, top: -150, left: -130, backgroundColor: C.green, opacity: 0.13 },
  glowBlue: { width: 320, height: 320, bottom: -140, right: -120, backgroundColor: "#3b82f6", opacity: 0.1 },
  scroll: { padding: 24, paddingTop: 64, paddingBottom: 40, gap: 18 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.green, alignItems: "center", justifyContent: "center",
    shadowColor: C.green, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  logoBig: { width: 92, height: 92, borderRadius: 30 },
  logoText: { color: C.greenDark, fontSize: 28, fontWeight: "900" },
  brand: { color: C.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.6 },
  headline: { color: C.text, fontSize: 34, fontWeight: "900", lineHeight: 40, letterSpacing: -1 },
  features: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  feature: { color: C.text2, fontSize: 12, fontWeight: "700", borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 6,
    backgroundColor: "rgba(20,27,24,0.7)", overflow: "hidden" },
  card: { backgroundColor: "rgba(20,27,24,0.92)", borderColor: C.line, borderWidth: 1, borderRadius: 24, padding: 20, gap: 8,
    shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 8 },
  tabs: { flexDirection: "row", backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 4, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  tabOn: { backgroundColor: C.green },
  tabText: { color: C.muted, fontWeight: "800", fontSize: 13 },
  tabTextOn: { color: C.greenDark },
  title: { color: C.text, fontSize: 24, fontWeight: "900", letterSpacing: -0.5 },
  sub: { color: C.muted, fontSize: 13, marginBottom: 6 },
  label: { color: "#aab8af", fontSize: 12, fontWeight: "800", marginTop: 6 },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 14, color: C.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  inputFocus: { borderColor: C.green, backgroundColor: C.panel },
  eye: { position: "absolute", right: 8, top: 8, bottom: 8, justifyContent: "center", paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.panel2 },
  eyeText: { color: C.text, fontWeight: "800", fontSize: 12 },
  primary: { backgroundColor: C.green, borderRadius: 16, paddingVertical: 16, alignItems: "center", marginTop: 14,
    shadowColor: C.green, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  primaryText: { color: C.greenDark, fontWeight: "900", fontSize: 16 },
  error: { color: "#ffb0a4", backgroundColor: "#321f1d", borderRadius: 10, padding: 10, fontSize: 13, overflow: "hidden", marginTop: 6 },
  stay: { color: C.muted, fontSize: 12, textAlign: "center", marginTop: 8 },
  server: { color: C.muted, fontSize: 12, textAlign: "center", padding: 10 },
  splashText: { color: C.muted, fontSize: 14, marginTop: 14, textAlign: "center", marginBottom: 18 },
});
