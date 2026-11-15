import React, { ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextInputProps, TouchableOpacity, View, ViewStyle } from "react-native";

import { appendSpeech, MicButton } from "./voice";

/** Shared look for all mobile screens (matches the web app's dark theme). */
export const C = {
  bg: "#070b09", panel: "#0f1613", panel2: "#141d19", line: "#1d2a24", text: "#eef6f1", muted: "#8a9b92",
  green: "#3ee08f", greenDark: "#04170d", greenSoft: "#123222", amber: "#f5b65b", red: "#ff7a8a", field: "#0b110e", blue: "#5aa8ff",
};

export function Screen({ children, onRefresh }: { children: ReactNode; onRefresh?: () => void }) {
  return <ScrollView contentContainerStyle={u.scroll} keyboardShouldPersistTaps="handled">{children}{onRefresh && <View style={{ height: 8 }}/>}</ScrollView>;
}
export function Card({ children, style, accent }: { children: ReactNode; style?: StyleProp<ViewStyle>; accent?: boolean }) {
  return <View style={[u.card, accent && u.cardAccent, style]}>{children}</View>;
}
export const Kicker = ({ children }: { children: ReactNode }) => <Text style={u.kicker}>{children}</Text>;
export const H1 = ({ children }: { children: ReactNode }) => <Text style={u.h1}>{children}</Text>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={u.h2}>{children}</Text>;
export const Muted = ({ children, small }: { children: ReactNode; small?: boolean }) => <Text style={small ? u.small : u.muted}>{children}</Text>;
export const Empty = ({ children }: { children: ReactNode }) => <View style={u.empty}><Text style={u.muted}>{children}</Text></View>;

export function Btn({ title, onPress, kind = "primary", disabled, busy, style }: { title: string; onPress: () => void; kind?: "primary" | "outline" | "danger" | "link"; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle> }) {
  const s = kind === "primary" ? u.btnPrimary : kind === "outline" ? u.btnOutline : kind === "danger" ? u.btnDanger : u.btnLink;
  const t = kind === "primary" ? u.btnPrimaryText : kind === "danger" ? u.btnDangerText : kind === "link" ? u.btnLinkText : u.btnOutlineText;
  return <TouchableOpacity style={[s, (disabled || busy) && { opacity: 0.55 }, style]} onPress={onPress} disabled={disabled || busy} accessibilityRole="button">
    {busy ? <ActivityIndicator color={kind === "primary" ? C.greenDark : C.text}/> : <Text style={t}>{title}</Text>}
  </TouchableOpacity>;
}

/** Text input. `voice` adds a mic button: speak instead of typing (free, uses the phone's speech recognizer). */
export function Field(props: TextInputProps & { label?: string; voice?: boolean }) {
  const { label, style, voice, ...rest } = props;
  const input = <TextInput placeholderTextColor={C.muted} {...rest} style={[u.input, rest.multiline && { minHeight: 80, textAlignVertical: "top" }, voice && { flex: 1 }, style]}/>;
  return <View style={{ gap: 6 }}>{label && <Text style={u.label}>{label}</Text>}
    {voice && rest.onChangeText
      ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{input}<MicButton onText={spoken => rest.onChangeText?.(appendSpeech(String(rest.value ?? ""), spoken))}/></View>
      : input}</View>;
}

export function Chips<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return <View style={u.chips}>{options.map(o => <TouchableOpacity key={o} style={[u.chip, value === o && u.chipOn]} onPress={() => onChange(o)}>
    <Text style={[u.chipText, value === o && u.chipTextOn]}>{labels?.[o] ?? o.replaceAll("_", " ")}</Text></TouchableOpacity>)}</View>;
}

export function Progress({ value }: { value: number }) {
  return <View style={u.track}><View style={[u.fill, { width: `${Math.max(0, Math.min(100, value))}%` }]}/></View>;
}

export function Badge({ children, tone = "green" }: { children: ReactNode; tone?: "green" | "amber" | "red" | "muted" }) {
  const bg = { green: "#203128", amber: "#3a2f1d", red: "#3a2222", muted: "#222b26" }[tone];
  const fg = { green: "#a5e3be", amber: "#ffd38a", red: "#ffb1a0", muted: C.muted }[tone];
  return <Text style={[u.badge, { backgroundColor: bg, color: fg }]}>{children}</Text>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[u.row, style]}>{children}</View>;
}

export function niceDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export function money(value: unknown, currency = "USD") {
  const n = Number(value || 0);
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n); } catch { return `${currency} ${n.toFixed(2)}`; }
}

export const u = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 120, gap: 14 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 16, gap: 10 },
  cardAccent: { borderColor: "#2a6b4a", backgroundColor: "#0f1a15" },
  kicker: { color: C.green, fontSize: 10, letterSpacing: 1.6, fontWeight: "800", opacity: 0.9 },
  h1: { color: C.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.8 },
  h2: { color: C.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  small: { color: C.muted, fontSize: 11, lineHeight: 16 },
  label: { color: "#aab8af", fontSize: 11 },
  empty: { borderColor: C.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 12, padding: 16, alignItems: "center" },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 14, color: C.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  btnPrimary: { backgroundColor: C.green, borderRadius: 99, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" },
  btnPrimaryText: { color: C.greenDark, fontWeight: "800", fontSize: 14 },
  btnOutline: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  btnOutlineText: { color: C.text, fontWeight: "600", fontSize: 14 },
  btnDanger: { borderColor: "#593a34", borderWidth: 1, borderRadius: 99, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center" },
  btnDangerText: { color: "#ff9b8c", fontWeight: "600" },
  btnLink: { paddingVertical: 6 },
  btnLinkText: { color: C.green, fontWeight: "700", fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 13, textTransform: "capitalize" },
  chipTextOn: { color: C.green },
  track: { height: 8, backgroundColor: "#1d2924", borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, backgroundColor: C.green, borderRadius: 4 },
  badge: { fontSize: 10, fontWeight: "700", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: "hidden", textTransform: "capitalize" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
});
