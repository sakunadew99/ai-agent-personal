import React, { ReactNode, useState } from "react";
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { C } from "./ui";

/**
 * Charts and dashboard pieces made only of Views (no native chart library, so they work in every build).
 * Colours: green = good/primary, blue = info, amber = attention, red = over/negative, violet = extra series.
 */
export const PALETTE = [C.green, C.blue, C.amber, "#b48cff", C.red, "#4fd1c5", "#e6e15a", "#ff9f5a"];
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 0));

/** A ring of dots that fills clockwise to `value` (0-100), with text in the middle. */
export function Ring({ value, size = 120, color = C.green, label, sub, dots = 44, thickness }: {
  value: number; size?: number; color?: string; label?: ReactNode; sub?: string; dots?: number; thickness?: number;
}) {
  const v = clamp(value);
  const dot = thickness ?? Math.max(4, Math.round(size / 17));
  const r = size / 2 - dot;
  const lit = Math.round((v / 100) * dots);
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${Math.round(v)} percent`}>
    {Array.from({ length: dots }, (_, i) => {
      const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
      const on = i < lit;
      return <View key={i} style={{
        position: "absolute", width: dot, height: dot, borderRadius: dot / 2,
        left: size / 2 + r * Math.cos(a) - dot / 2, top: size / 2 + r * Math.sin(a) - dot / 2,
        backgroundColor: on ? color : C.line, opacity: on ? 0.55 + 0.45 * (i / Math.max(1, lit)) : 1,
      }}/>;
    })}
    <View style={{ alignItems: "center" }}>
      {typeof label === "string" || typeof label === "number" ? <Text style={[k.ringLabel, { fontSize: size / 4.4 }]}>{label}</Text> : label}
      {!!sub && <Text style={k.ringSub}>{sub}</Text>}
    </View>
  </View>;
}

/** Thin progress bar with an optional label row. */
export function Meter({ value, color = C.green, label, right, height = 8 }: { value: number; color?: string; label?: string; right?: string; height?: number }) {
  return <View style={{ gap: 6 }}>
    {(label || right) && <View style={k.between}><Text style={k.meterLabel}>{label}</Text><Text style={[k.meterRight, { color }]}>{right}</Text></View>}
    <View style={[k.track, { height, borderRadius: height / 2 }]}><View style={{ width: `${clamp(value)}%`, height, borderRadius: height / 2, backgroundColor: color }}/></View>
  </View>;
}

export type BarDatum = { label: string; value: number; color?: string; highlight?: boolean; note?: string };

/** Vertical bars. Tap a bar to see its value. `goal` draws a dashed line. */
export function Bars({ data, height = 130, format = (n: number) => String(Math.round(n)), goal, color = C.green }: {
  data: BarDatum[]; height?: number; format?: (n: number) => string; goal?: number; color?: string;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, goal || 0, ...data.map(d => d.value));
  const shown = picked ?? data.findIndex(d => d.highlight);
  return <View>
    <View style={{ height, flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
      {goal ? <View style={[k.goalLine, { bottom: (goal / max) * (height - 18) }]}/> : null}
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 4 : 2, (d.value / max) * (height - 18));
        const on = i === shown;
        return <TouchableOpacity key={`${d.label}-${i}`} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height }} onPress={() => setPicked(on ? null : i)} accessibilityLabel={`${d.label} ${format(d.value)}`}>
          {on && <Text style={k.barValue} numberOfLines={1}>{format(d.value)}</Text>}
          <View style={{ width: "72%", maxWidth: 30, height: h, borderRadius: 8, backgroundColor: d.color || color, opacity: shown >= 0 && !on ? 0.45 : 1 }}/>
        </TouchableOpacity>;
      })}
    </View>
    <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>{data.map((d, i) => <Text key={i} style={[k.axis, { flex: 1 }, i === shown && { color: C.text }]} numberOfLines={1}>{d.label}</Text>)}</View>
  </View>;
}

/** Line chart with dots and a soft area under the line. Several series share one scale. */
export function LineChart({ series, labels, height = 140, format = (n: number) => String(Math.round(n)) }: {
  series: { values: (number | null)[]; color?: string; name?: string }[]; labels?: string[]; height?: number; format?: (n: number) => string;
}) {
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const all = series.flatMap(s => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const n = Math.max(...series.map(s => s.values.length), 0);
  if (!all.length || n === 0) return <View style={{ height, alignItems: "center", justifyContent: "center" }}><Text style={k.axis}>No data yet</Text></View>;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
  const pad = 10;
  const x = (i: number) => (n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2);
  const at = picked ?? n - 1;
  return <View>
    <View style={{ height }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {[0, 0.5, 1].map(f => <View key={f} style={[k.grid, { top: pad + f * (height - pad * 2) }]}/>)}
      {width > 0 && series.map((s, si) => {
        const color = s.color || PALETTE[si % PALETTE.length];
        const pts = s.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : { x: x(i), y: y(v), v }));
        return <React.Fragment key={si}>
          {si === 0 && pts.map((p, i) => p && <View key={`a${i}`} style={{ position: "absolute", left: p.x - (width / n) / 2, width: width / n, top: p.y, bottom: 0, backgroundColor: color, opacity: 0.07 }}/>)}
          {pts.map((p, i) => {
            const q = pts[i + 1];
            if (!p || !q) return null;
            const dx = q.x - p.x, dy = q.y - p.y, len = Math.sqrt(dx * dx + dy * dy);
            return <View key={`s${i}`} style={{ position: "absolute", left: (p.x + q.x) / 2 - len / 2, top: (p.y + q.y) / 2 - 1.5, width: len, height: 3, borderRadius: 2,
              backgroundColor: color, transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }}/>;
          })}
          {pts.map((p, i) => p && (i === at || n <= 14) && <View key={`d${i}`} style={{ position: "absolute", left: p.x - (i === at ? 6 : 3), top: p.y - (i === at ? 6 : 3),
            width: i === at ? 12 : 6, height: i === at ? 12 : 6, borderRadius: 6, backgroundColor: i === at ? C.bg : color, borderWidth: i === at ? 3 : 0, borderColor: color }}/>)}
        </React.Fragment>;
      })}
      {width > 0 && <View style={StyleSheet.absoluteFill}>{Array.from({ length: n }, (_, i) =>
        <TouchableOpacity key={i} onPress={() => setPicked(i)} style={{ position: "absolute", left: x(i) - width / n / 2, width: width / n, top: 0, bottom: 0 }}/>)}</View>}
    </View>
    <View style={[k.between, { marginTop: 6 }]}>
      <Text style={k.axis}>{labels?.[0] ?? ""}</Text>
      <Text style={[k.axis, { color: C.text }]}>{`${labels?.[at] ?? ""}  ${series.map(s => (s.values[at] === null || s.values[at] === undefined ? "—" : format(Number(s.values[at])))).join(" · ")}`}</Text>
      <Text style={k.axis}>{labels?.[n - 1] ?? ""}</Text>
    </View>
  </View>;
}

/** One bar split into coloured parts (e.g. spending by category), with a legend below. */
export function SplitBar({ parts, format = (n: number) => String(Math.round(n)), legend = true }: {
  parts: { label: string; value: number; color?: string }[]; format?: (n: number) => string; legend?: boolean;
}) {
  const clean = parts.filter(p => p.value > 0);
  const total = clean.reduce((a, p) => a + p.value, 0);
  if (!total) return <Text style={k.axis}>Nothing recorded yet</Text>;
  return <View style={{ gap: 10 }}>
    <View style={{ flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden", gap: 2 }}>
      {clean.map((p, i) => <View key={p.label} style={{ flex: p.value, backgroundColor: p.color || PALETTE[i % PALETTE.length] }}/>)}
    </View>
    {legend && clean.map((p, i) => <View key={p.label} style={k.legendRow}>
      <View style={[k.legendDot, { backgroundColor: p.color || PALETTE[i % PALETTE.length] }]}/>
      <Text style={k.legendLabel} numberOfLines={1}>{p.label}</Text>
      <Text style={k.legendPct}>{`${Math.round((p.value / total) * 100)}%`}</Text>
      <Text style={k.legendValue}>{format(p.value)}</Text>
    </View>)}
  </View>;
}

/** Small stat card: label, big value, a hint line and an optional trend arrow. */
export function StatTile({ label, value, hint, tone = "plain", icon, onPress, style, trend }: {
  label: string; value: ReactNode; hint?: string; tone?: "plain" | "green" | "blue" | "amber" | "red" | "violet"; icon?: string;
  onPress?: () => void; style?: StyleProp<ViewStyle>; trend?: number | null;
}) {
  const accent = { plain: C.text, green: C.green, blue: C.blue, amber: C.amber, red: C.red, violet: "#b48cff" }[tone];
  const solid = tone === "green";
  const body = <View style={[k.tile, solid && k.tileSolid, style]}>
    <View style={k.between}>
      <Text style={[k.tileLabel, solid && { color: "#0b2a19" }]} numberOfLines={1}>{label}</Text>
      {!!icon && <Text style={k.tileIcon}>{icon}</Text>}
    </View>
    {typeof value === "string" || typeof value === "number"
      ? <Text style={[k.tileValue, { color: solid ? C.greenDark : accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text> : value}
    {(hint || (trend !== undefined && trend !== null)) && <Text style={[k.tileHint, solid && { color: "#124a2c" }]} numberOfLines={2}>
      {trend !== undefined && trend !== null ? <Text style={{ color: solid ? C.greenDark : trend >= 0 ? C.green : C.red, fontWeight: "800" }}>{`${trend >= 0 ? "↑" : "↓"} ${Math.abs(Math.round(trend))}%  `}</Text> : null}
      {hint}
    </Text>}
  </View>;
  return onPress ? <TouchableOpacity onPress={onPress} style={{ flex: 1 }}>{body}</TouchableOpacity> : <View style={{ flex: 1 }}>{body}</View>;
}

/** Two or more tiles in a row. */
export const TileRow = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>;

/** Habit-style week grid: one row per item, seven circles (Mon-Sun). */
export function WeekDots({ rows, days = ["M", "T", "W", "T", "F", "S", "S"], today }: { rows: { label: string; done: boolean[]; onToggle?: (i: number) => void }[]; days?: string[]; today?: number }) {
  return <View style={{ gap: 10 }}>
    <View style={k.dotRow}><View style={{ flex: 1 }}/>{days.map((d, i) => <Text key={i} style={[k.dotHead, i === today && { color: C.green }]}>{d}</Text>)}</View>
    {rows.map(r => <View key={r.label} style={k.dotRow}>
      <Text style={k.dotLabel} numberOfLines={1}>{r.label}</Text>
      {r.done.map((on, i) => <TouchableOpacity key={i} disabled={!r.onToggle} onPress={() => r.onToggle?.(i)} style={[k.dot, on && k.dotOn, i === today && !on && { borderColor: C.green }]}/>)}
    </View>)}
  </View>;
}

/** Glowing hero card for the top of a screen. */
export function Hero({ kicker, title, accent, sub, right, children, color = C.green }: {
  kicker?: string; title: string; accent?: string; sub?: string; right?: ReactNode; children?: ReactNode; color?: string;
}) {
  return <View style={k.hero}>
    <View style={[k.glow, { backgroundColor: color, top: -70, right: -50 }]}/>
    <View style={[k.glow, { backgroundColor: color, bottom: -90, left: -60, opacity: 0.06 }]}/>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1, gap: 4 }}>
        {!!kicker && <Text style={k.heroKicker}>{kicker}</Text>}
        <Text style={k.heroTitle}>{title}{accent ? <Text style={{ color }}>{` ${accent}`}</Text> : null}</Text>
        {!!sub && <Text style={k.heroSub}>{sub}</Text>}
      </View>
      {right}
    </View>
    {children}
  </View>;
}

/** Section title with an optional action on the right. */
export function Section({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={[k.between, { marginTop: 6 }]}>
    <Text style={k.sectionTitle}>{title}</Text>
    {!!action && <TouchableOpacity onPress={onAction}><Text style={k.sectionAction}>{action}</Text></TouchableOpacity>}
  </View>;
}

/** Segmented control (pill tabs). */
export function Segments<T extends string>({ options, value, onChange, labels }: { options: readonly T[]; value: T; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return <View style={k.seg}>{options.map(o => <TouchableOpacity key={o} style={[k.segItem, value === o && k.segOn]} onPress={() => onChange(o)}>
    <Text style={[k.segText, value === o && k.segTextOn]} numberOfLines={1}>{labels?.[o] ?? o}</Text></TouchableOpacity>)}</View>;
}

/** Ring sized to share a row with text, for compact "score" cards. */
export function ScoreCard({ title, value, sub, color = C.green, children }: { title: string; value: number; sub?: string; color?: string; children?: ReactNode }) {
  return <View style={[k.tile, { flexDirection: "row", alignItems: "center", gap: 14 }]}>
    <Ring value={value} size={84} color={color} label={`${Math.round(value)}`} sub="%"/>
    <View style={{ flex: 1, gap: 4 }}><Text style={k.sectionTitle}>{title}</Text>{!!sub && <Text style={k.tileHint}>{sub}</Text>}{children}</View>
  </View>;
}

const k = StyleSheet.create({
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  ringLabel: { color: C.text, fontWeight: "900", letterSpacing: -1 },
  ringSub: { color: C.muted, fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginTop: -2 },
  track: { backgroundColor: C.line, overflow: "hidden" },
  meterLabel: { color: C.text, fontSize: 13, fontWeight: "600", flex: 1 },
  meterRight: { fontSize: 12, fontWeight: "800" },
  goalLine: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: "#6b7d73" },
  barValue: { color: C.text, fontSize: 10, fontWeight: "800", marginBottom: 4 },
  axis: { color: C.muted, fontSize: 10, textAlign: "center" },
  grid: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: C.panel2 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 3 },
  legendLabel: { color: C.text, fontSize: 13, flex: 1, textTransform: "capitalize" },
  legendPct: { color: C.muted, fontSize: 12, width: 38, textAlign: "right" },
  legendValue: { color: C.text, fontSize: 13, fontWeight: "700", minWidth: 70, textAlign: "right" },
  tile: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 20, padding: 14, gap: 6, minHeight: 92 },
  tileSolid: { backgroundColor: C.green, borderColor: C.green },
  tileLabel: { color: C.muted, fontSize: 10, letterSpacing: 1.2, fontWeight: "800", textTransform: "uppercase", flex: 1 },
  tileIcon: { fontSize: 16 },
  tileValue: { fontSize: 24, fontWeight: "900", letterSpacing: -0.6 },
  tileHint: { color: C.muted, fontSize: 11, lineHeight: 16 },
  dotRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dotHead: { width: 24, textAlign: "center", color: C.muted, fontSize: 10, fontWeight: "800" },
  dotLabel: { flex: 1, color: C.text, fontSize: 13 },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: C.line },
  dotOn: { backgroundColor: C.green, borderColor: C.green },
  hero: { backgroundColor: C.panel, borderColor: "#1f3a2c", borderWidth: 1, borderRadius: 26, padding: 18, gap: 14, overflow: "hidden" },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, opacity: 0.1 },
  heroKicker: { color: C.green, fontSize: 10, letterSpacing: 1.6, fontWeight: "800" },
  heroTitle: { color: C.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.8, lineHeight: 31 },
  heroSub: { color: C.muted, fontSize: 13, lineHeight: 19 },
  sectionTitle: { color: C.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  sectionAction: { color: C.green, fontSize: 12, fontWeight: "700" },
  seg: { flexDirection: "row", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 99, padding: 4, gap: 4 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 99, alignItems: "center" },
  segOn: { backgroundColor: C.green },
  segText: { color: C.muted, fontWeight: "700", fontSize: 13, textTransform: "capitalize" },
  segTextOn: { color: C.greenDark },
});
