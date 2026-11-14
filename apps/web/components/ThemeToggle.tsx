"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Mode = "system" | "light" | "dark";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "System theme", light: "Light theme", dark: "Dark theme" };
const ICON: Record<Mode, string> = { system: "monitor", light: "sun", dark: "moon" };

function apply(mode: Mode) {
  const root = document.documentElement;
  if (mode === "system") delete root.dataset.theme; else root.dataset.theme = mode;
  try { if (mode === "system") localStorage.removeItem("sakuna-theme"); else localStorage.setItem("sakuna-theme", mode); } catch { /* private mode */ }
}

/** Cycles System → Light → Dark. "System" follows the device setting. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try { const saved = localStorage.getItem("sakuna-theme"); if (saved === "light" || saved === "dark") setMode(saved); } catch { /* ignore */ }
  }, []);
  const next = NEXT[mode];
  return <button type="button" className={compact ? "outline icon-only" : "theme-toggle"} title={`${LABEL[mode]} · switch to ${LABEL[next].toLowerCase()}`}
    aria-label={`${LABEL[mode]}. Switch to ${LABEL[next].toLowerCase()}`} onClick={() => { apply(next); setMode(next); }}>
    <Icon name={ICON[mode]} size={compact ? 15 : 16}/>{!compact && <span>{LABEL[mode]}</span>}
  </button>;
}
