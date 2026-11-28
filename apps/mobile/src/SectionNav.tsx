/**
 * Section switcher without sideways scrolling: the current section as one big pill with ‹ › to step through, and a tap
 * on the pill opens every section as a grid (4 per row), so all of them are visible at once.
 */
import React, { useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { C } from "./ui";

export type Section = { key: string; icon: string; label: string };

/** "🗣 Lang" -> { icon: "🗣", label: "Lang" } (a label without a leading emoji gets a dot). */
export function splitLabel(key: string, text: string): Section {
  const m = /^(\S+)\s+(.+)$/.exec(text.trim());
  return m && /[^\x00-\x7F]/.test(m[1]) ? { key, icon: m[1], label: m[2] } : { key, icon: "•", label: text };
}

export function SectionNav({ items, value, onChange, color = C.green, pad = 16 }: { items: Section[]; value: string; onChange: (key: string) => void; color?: string; pad?: number }) {
  const [open, setOpen] = useState(false);
  const i = Math.max(0, items.findIndex(x => x.key === value));
  const cur = items[i];
  if (!cur) return null;
  const go = (d: number) => { setOpen(false); onChange(items[(i + d + items.length) % items.length].key); };
  const arrow = { width: 40, height: 44, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: C.panel2 };
  return <View style={{ paddingHorizontal: pad, paddingTop: 8, paddingBottom: 4, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <TouchableOpacity onPress={() => go(-1)} style={arrow} accessibilityLabel="Previous section"><Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>‹</Text></TouchableOpacity>
      <TouchableOpacity onPress={() => setOpen(o => !o)} activeOpacity={0.8} accessibilityLabel="All sections"
        style={{ flex: 1, height: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 14, backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}77` }}>
        <Text style={{ fontSize: 18 }}>{cur.icon}</Text>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 15, flex: 1 }} numberOfLines={1}>{cur.label}</Text>
        {items.length <= 9
          ? <View style={{ flexDirection: "row", gap: 3 }}>{items.map((x, k) => <View key={x.key} style={{ width: k === i ? 12 : 5, height: 5, borderRadius: 3, backgroundColor: k === i ? color : C.line }}/>)}</View>
          : <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>{`${i + 1}/${items.length}`}</Text>}
        <Text style={{ color, fontWeight: "900", fontSize: 14 }}>{open ? "▴" : "▦"}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => go(1)} style={arrow} accessibilityLabel="Next section"><Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>›</Text></TouchableOpacity>
    </View>
    {open && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8, borderRadius: 18, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line }}>
      {items.map(x => { const on = x.key === cur.key;
        return <TouchableOpacity key={x.key} onPress={() => { setOpen(false); if (!on) onChange(x.key); }}
          style={{ width: "23%", flexGrow: 1, alignItems: "center", gap: 3, paddingVertical: 10, borderRadius: 14, backgroundColor: on ? color : C.panel2 }}>
          <Text style={{ fontSize: 20 }}>{x.icon}</Text>
          <Text style={{ color: on ? "#fff" : C.text, fontSize: 11, fontWeight: "800", textAlign: "center" }} numberOfLines={2}>{x.label}</Text>
        </TouchableOpacity>; })}
    </View>}
  </View>;
}
