/**
 * Themes: mode (system / dark / light / AMOLED black) + accent colour. Read synchronously at start-up so every screen and
 * every StyleSheet is built with the saved theme; switching later re-colours the shared palette `C`, re-colours the
 * StyleSheets already created (registry below) and asks the app to redraw.
 */
import { Appearance, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";

export type Mode = "system" | "dark" | "light" | "amoled";
export type Accent = "green" | "blue" | "purple" | "orange" | "pink" | "teal" | "red" | "gold";
export type Palette = {
  bg: string; panel: string; panel2: string; line: string; text: string; text2: string; muted: string;
  green: string; greenDark: string; greenSoft: string; amber: string; red: string; field: string; blue: string; dark: boolean;
};

export const ACCENTS: Record<Accent, { name: string; dark: string; light: string }> = {
  green: { name: "Emerald", dark: "#3ee08f", light: "#12a862" },
  blue: { name: "Ocean", dark: "#5aa8ff", light: "#2f7fe0" },
  purple: { name: "Violet", dark: "#b48cff", light: "#7c4ddb" },
  orange: { name: "Sunset", dark: "#ff9f5a", light: "#d86b1f" },
  pink: { name: "Rose", dark: "#ff7ab6", light: "#d6336c" },
  teal: { name: "Lagoon", dark: "#4fd1c5", light: "#1a9e93" },
  red: { name: "Ruby", dark: "#ff6b6b", light: "#d43d55" },
  gold: { name: "Gold", dark: "#f5c542", light: "#b8860b" },
};
export const MODES: Record<Mode, string> = { system: "📱 System", dark: "🌙 Dark", light: "☀️ Light", amoled: "⚫ AMOLED black" };

const BASE = {
  dark: { bg: "#070b09", panel: "#0f1613", panel2: "#141d19", line: "#1d2a24", text: "#eef6f1", text2: "#d1ddd4", muted: "#8a9b92", field: "#0b110e",
          amber: "#f5b65b", red: "#ff7a8a", blue: "#5aa8ff" },
  amoled: { bg: "#000000", panel: "#0b0b0b", panel2: "#141414", line: "#222222", text: "#f2f2f2", text2: "#d6d6d6", muted: "#8f8f8f", field: "#060606",
            amber: "#f5b65b", red: "#ff7a8a", blue: "#5aa8ff" },
  light: { bg: "#f3f6f4", panel: "#ffffff", panel2: "#eef3f0", line: "#d9e3dd", text: "#10201a", text2: "#2f4038", muted: "#5d6f66", field: "#ffffff",
           amber: "#b9770e", red: "#d43d55", blue: "#2f7fe0" },
};

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export function resolveMode(mode: Mode): "dark" | "light" | "amoled" {
  if (mode !== "system") return mode;
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
}

export function build(mode: Mode, accent: Accent): Palette {
  const m = resolveMode(mode);
  const b = BASE[m];
  const light = m === "light";
  const a = light ? ACCENTS[accent].light : ACCENTS[accent].dark;
  return { ...b, green: a, greenDark: light ? "#ffffff" : mix(a, "#000000", 0.88), greenSoft: mix(b.panel, a, light ? 0.14 : 0.18), dark: !light };
}

const KEY = "sakuna.theme";
export type Saved = { mode: Mode; accent: Accent };
export function loadSaved(): Saved {
  try {
    const v = JSON.parse(SecureStore.getItem(KEY) || "{}");
    return { mode: (v.mode in MODES ? v.mode : "dark") as Mode, accent: (v.accent in ACCENTS ? v.accent : "green") as Accent };
  } catch { return { mode: "dark", accent: "green" }; }
}

// ---- StyleSheet registry: sheets created at module load are re-coloured in place when the theme changes.
const sheets: Record<string, Record<string, unknown>>[] = [];
const create = StyleSheet.create.bind(StyleSheet);
try {
  (StyleSheet as unknown as { create: unknown }).create = (obj: Record<string, unknown>) => { const r = create(obj as never); sheets.push(r as never); return r; };
} catch { /* read-only on some engines: sheets then refresh on the next app start */ }

function recolor(from: Palette, to: Palette) {
  const map = new Map<string, string>();
  (Object.keys(from) as (keyof Palette)[]).forEach(k => { const f = from[k], t = to[k]; if (typeof f === "string" && typeof t === "string" && f !== t) map.set(f.toLowerCase(), t); });
  if (!map.size) return;
  for (const sheet of sheets) for (const style of Object.values(sheet)) {
    if (!style || typeof style !== "object") continue;
    for (const [prop, val] of Object.entries(style as Record<string, unknown>)) {
      if (typeof val === "string" && map.has(val.toLowerCase())) { try { (style as Record<string, unknown>)[prop] = map.get(val.toLowerCase()); } catch { /* frozen */ } }
    }
  }
}

// ---- live state
let current: Saved = loadSaved();
let palette: Palette = build(current.mode, current.accent);
const listeners = new Set<() => void>();
let target: Palette | null = null;

/** ui.tsx hands over its `C` object once; every later switch mutates it in place. */
export function bind(c: Palette) { target = c; Object.assign(c, palette); }
export function initial(): Palette { return palette; }
export function theme(): Saved & { resolved: "dark" | "light" | "amoled" } { return { ...current, resolved: resolveMode(current.mode) }; }
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function setTheme(next: Partial<Saved>) {
  current = { ...current, ...next };
  const old = palette;
  palette = build(current.mode, current.accent);
  if (target) Object.assign(target, palette);
  recolor(old, palette);
  void SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach(f => f());
}

// following the phone's light/dark setting while in "system" mode
Appearance.addChangeListener(() => { if (current.mode === "system") setTheme({}); });

/** A soft tinted background for coloured cards: deep in dark mode, pale in light mode. */
export function tint(color: string, amount = 0.16): string {
  try { return mix(palette.panel, color.length === 7 ? color : "#7c4dff", amount); } catch { return palette.panel2; }
}
