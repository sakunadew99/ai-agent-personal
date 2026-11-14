"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon";
import { appendSpeech, VoiceButton } from "./VoiceButton";

export type PaletteAction = { id: string; label: string; hint?: string; icon: string; run: () => void | Promise<void> };

/** Ctrl/⌘+K: capture a thought in one step, or jump anywhere (guide §32.1 "one-tap capture"). */
export function CommandPalette({ open, onClose, actions, onCapture }: {
  open: boolean; onClose: () => void; actions: PaletteAction[]; onCapture: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setText(""); setIndex(0); window.setTimeout(() => input.current?.focus(), 10); } }, [open]);

  const items = useMemo(() => {
    const q = text.trim().toLowerCase();
    const matches = q ? actions.filter(a => a.label.toLowerCase().includes(q) || a.hint?.toLowerCase().includes(q)) : actions;
    const capture: PaletteAction[] = q ? [{ id: "capture", label: `Capture “${text.trim()}”`, hint: "Saved to your inbox for review", icon: "inbox", run: () => onCapture(text.trim()) }] : [];
    // Typing a sentence most likely means "capture this"; put capture first unless it exactly names a page.
    const exact = matches.some(a => a.label.toLowerCase() === q);
    return exact ? [...matches, ...capture] : [...capture, ...matches];
  }, [text, actions, onCapture]);

  if (!open) return null;

  async function run(item: PaletteAction | undefined) {
    if (!item || busy) return;
    setBusy(true);
    try { await item.run(); onClose(); } finally { setBusy(false); }
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setIndex(i => Math.min(items.length - 1, i + 1)); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    else if (event.key === "Enter") { event.preventDefault(); void run(items[index]); }
    else if (event.key === "Escape") onClose();
  }

  return <div className="palette-backdrop" onMouseDown={onClose}>
    <div className="palette" role="dialog" aria-modal="true" aria-label="Quick capture and commands" onMouseDown={event => event.stopPropagation()}>
      <div className="palette-input"><Icon name="search" size={18}/>
        <input ref={input} value={text} onChange={event => { setText(event.target.value); setIndex(0); }} onKeyDown={onKey}
          placeholder="Capture a thought (or tap the mic and say it), or type a page name…" aria-label="Capture or search"/>
        <VoiceButton onText={spoken => { setText(v => appendSpeech(v, spoken)); setIndex(0); input.current?.focus(); }}/>
        <kbd>Esc</kbd></div>
      <ul className="palette-list" role="listbox">
        {items.map((item, i) => <li key={item.id} role="option" aria-selected={i === index}>
          <button className={i === index ? "active" : ""} onMouseEnter={() => setIndex(i)} onClick={() => void run(item)} disabled={busy}>
            <span className="palette-icon"><Icon name={item.icon} size={16}/></span>
            <span className="palette-copy"><b>{item.label}</b>{item.hint && <small>{item.hint}</small>}</span>
            {i === index && <kbd>↵</kbd>}
          </button></li>)}
        {!items.length && <li className="palette-empty">Type to capture a new thought.</li>}
      </ul>
      <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> run</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere</span></div>
    </div>
  </div>;
}
