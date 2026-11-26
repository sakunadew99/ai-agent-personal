"use client";

import { useEffect, useRef, useState } from "react";

const ACCENTS: [string, string, string][] = [["green", "Emerald", "#3ee08f"], ["blue", "Ocean", "#5aa8ff"], ["purple", "Violet", "#b48cff"], ["orange", "Sunset", "#ff9f5a"],
  ["pink", "Rose", "#ff7ab6"], ["teal", "Lagoon", "#4fd1c5"], ["red", "Ruby", "#ff6b6b"], ["gold", "Gold", "#f5c542"]];

const SIZES: [string, string][] = [["small", "A−"], ["normal", "A"], ["large", "A+"], ["xlarge", "A++"]];
function applyText(t: string) {
  const root = document.documentElement;
  if (t === "normal") delete root.dataset.text; else root.dataset.text = t;
  try { if (t === "normal") localStorage.removeItem("sakuna-text"); else localStorage.setItem("sakuna-text", t); } catch { /* private mode */ }
}

export function applyAccent(a: string) {
  const root = document.documentElement;
  if (a === "green") delete root.dataset.accent; else root.dataset.accent = a;
  try { if (a === "green") localStorage.removeItem("sakuna-accent"); else localStorage.setItem("sakuna-accent", a); } catch { /* private mode */ }
}

/** Accent colour picker (works with the light / dark / system toggle). */
export function AccentPicker() {
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState("green");
  const [text, setText] = useState("normal");
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => { try { setAccent(localStorage.getItem("sakuna-accent") || "green"); setText(localStorage.getItem("sakuna-text") || "normal"); } catch { /* ignore */ } }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const cur = ACCENTS.find(a => a[0] === accent) || ACCENTS[0];
  return <div ref={box} style={{ position: "relative" }}>
    <button type="button" className="outline icon-only" title="Accent colour" aria-label="Accent colour" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 7, background: cur[2], verticalAlign: "middle" }}/>
    </button>
    {open && <div role="menu" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30, background: "var(--panel)", border: "1px solid var(--line)",
      borderRadius: 14, padding: 10, display: "grid", gridTemplateColumns: "repeat(4, 56px)", gap: 8, boxShadow: "0 12px 30px rgba(0,0,0,.3)" }}>
      {ACCENTS.map(([k, name, col]) => <button key={k} type="button" role="menuitemradio" aria-checked={accent === k} title={name}
        onClick={() => { applyAccent(k); setAccent(k); setOpen(false); }}
        style={{ border: 0, background: "transparent", cursor: "pointer", display: "grid", justifyItems: "center", gap: 4, color: "var(--text)", fontSize: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 15, background: col, outline: accent === k ? "3px solid var(--text)" : "none", outlineOffset: 2 }}/>{name}</button>)}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 6, marginTop: 4 }} aria-label="Text size">{SIZES.map(([k, l]) => <button key={k} type="button"
        onClick={() => { applyText(k); setText(k); }} className={text === k ? "primary" : "outline"} style={{ flex: 1, padding: "6px 0" }} title={`Text size: ${k}`}>{l}</button>)}</div>
    </div>}
  </div>;
}
