import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { C } from "./ui";

/** Real date and time pickers (calendar + hour/minute lists), in Sakuna's dark style. Values: "YYYY-MM-DD" and "HH:MM". */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00`) : null);
export const prettyDate = (v?: string | null) => { const d = parse(v); return d ? d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : ""; };
export const prettyTime = (v?: string | null) => (v ? String(v).slice(0, 5) : "");

export function DateField({ label, value, onChange, placeholder = "Pick a date", allowClear, min }: {
  label?: string; value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string; allowClear?: boolean; min?: string;
}) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 6, flex: 1 }}>
    {!!label && <Text style={s.label}>{label}</Text>}
    <TouchableOpacity style={s.field} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label || "Date"}>
      <Text style={s.icon}>📅</Text><Text style={[s.value, !value && s.placeholder]} numberOfLines={1}>{value ? prettyDate(value) : placeholder}</Text>
      {allowClear && !!value && <TouchableOpacity onPress={() => onChange(null)} hitSlop={10}><Text style={s.clear}>✕</Text></TouchableOpacity>}
    </TouchableOpacity>
    {open && <CalendarModal value={value || null} min={min} onClose={() => setOpen(false)} onPick={v => { onChange(v); setOpen(false); }}/>}
  </View>;
}

function CalendarModal({ value, min, onClose, onPick }: { value: string | null; min?: string; onClose: () => void; onPick: (v: string) => void }) {
  const start = parse(value) || new Date();
  const [cursor, setCursor] = useState(new Date(start.getFullYear(), start.getMonth(), 1));
  const today = isoDate(new Date());
  const first = (cursor.getDay() + 6) % 7;
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const move = (months: number) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + months, 1));
  const quick = (days: number, months = 0) => { const d = new Date(); d.setMonth(d.getMonth() + months); d.setDate(d.getDate() + days); onPick(isoDate(d)); };
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity style={s.sheet} activeOpacity={1}>
        <View style={s.headRow}>
          <TouchableOpacity style={s.nav} onPress={() => move(-12)}><Text style={s.navText}>«</Text></TouchableOpacity>
          <TouchableOpacity style={s.nav} onPress={() => move(-1)}><Text style={s.navText}>‹</Text></TouchableOpacity>
          <Text style={s.month}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Text>
          <TouchableOpacity style={s.nav} onPress={() => move(1)}><Text style={s.navText}>›</Text></TouchableOpacity>
          <TouchableOpacity style={s.nav} onPress={() => move(12)}><Text style={s.navText}>»</Text></TouchableOpacity>
        </View>
        <View style={s.week}>{WEEK.map(w => <Text key={w} style={s.weekDay}>{w}</Text>)}</View>
        <View style={s.grid}>{cells.map((n, i) => {
          if (n == null) return <View key={`e${i}`} style={s.cell}/>;
          const v = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}-${pad(n)}`;
          const disabled = !!min && v < min;
          return <TouchableOpacity key={v} style={s.cell} disabled={disabled} onPress={() => onPick(v)}>
            <View style={[s.dayDot, v === value && s.daySelected, v === today && v !== value && s.dayToday]}>
              <Text style={[s.dayText, v === value && s.dayTextSelected, disabled && { opacity: 0.25 }]}>{n}</Text></View>
          </TouchableOpacity>;
        })}</View>
        <View style={s.chips}>{([["Today", 0, 0], ["Tomorrow", 1, 0], ["+1 week", 7, 0], ["+1 month", 0, 1]] as [string, number, number][])
          .map(([t, d, m]) => <TouchableOpacity key={t} style={s.chip} onPress={() => quick(d, m)}><Text style={s.chipText}>{t}</Text></TouchableOpacity>)}</View>
        <TouchableOpacity style={s.done} onPress={onClose}><Text style={s.doneText}>Close</Text></TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  </KeyboardAvoidingView></Modal>;
}

export function TimeField({ label, value, onChange, placeholder = "Pick a time", allowClear, step = 5 }: {
  label?: string; value: string | null | undefined; onChange: (v: string | null) => void; placeholder?: string; allowClear?: boolean; step?: number;
}) {
  const [open, setOpen] = useState(false);
  return <View style={{ gap: 6, flex: 1 }}>
    {!!label && <Text style={s.label}>{label}</Text>}
    <TouchableOpacity style={s.field} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={label || "Time"}>
      <Text style={s.icon}>🕒</Text><Text style={[s.value, !value && s.placeholder]}>{value ? prettyTime(value) : placeholder}</Text>
      {allowClear && !!value && <TouchableOpacity onPress={() => onChange(null)} hitSlop={10}><Text style={s.clear}>✕</Text></TouchableOpacity>}
    </TouchableOpacity>
    {open && <ClockModal value={value || null} step={step} onClose={() => setOpen(false)} onPick={v => { onChange(v); setOpen(false); }}/>}
  </View>;
}

const ROW = 44;
function ClockModal({ value, step, onClose, onPick }: { value: string | null; step: number; onClose: () => void; onPick: (v: string) => void }) {
  const now = new Date();
  const [h, setH] = useState(value ? Number(value.slice(0, 2)) : now.getHours());
  const [m, setM] = useState(value ? Number(value.slice(3, 5)) : Math.floor(now.getMinutes() / step) * step);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (!minutes.includes(m)) minutes.push(m), minutes.sort((a, b) => a - b);
  const hRef = useRef<React.ComponentRef<typeof ScrollView>>(null), mRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => {
    const t = setTimeout(() => { hRef.current?.scrollTo({ y: Math.max(0, (h - 2) * ROW), animated: false }); mRef.current?.scrollTo({ y: Math.max(0, (minutes.indexOf(m) - 2) * ROW), animated: false }); }, 30);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ampm = (x: number) => (x === 0 ? "12 am" : x < 12 ? `${x} am` : x === 12 ? "12 pm" : `${x - 12} pm`);
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
      <TouchableOpacity style={s.sheet} activeOpacity={1}>
        <Text style={s.bigTime}>{pad(h)}:{pad(m)}</Text>
        <View style={s.columns}>
          <ScrollView ref={hRef} style={s.column} showsVerticalScrollIndicator={false}>{Array.from({ length: 24 }, (_, x) => x).map(x =>
            <TouchableOpacity key={x} style={[s.opt, x === h && s.optOn]} onPress={() => setH(x)}>
              <Text style={[s.optText, x === h && s.optTextOn]}>{pad(x)}</Text><Text style={s.optHint}>{ampm(x)}</Text></TouchableOpacity>)}</ScrollView>
          <ScrollView ref={mRef} style={s.column} showsVerticalScrollIndicator={false}>{minutes.map(x =>
            <TouchableOpacity key={x} style={[s.opt, x === m && s.optOn]} onPress={() => setM(x)}>
              <Text style={[s.optText, x === m && s.optTextOn]}>:{pad(x)}</Text></TouchableOpacity>)}</ScrollView>
        </View>
        <View style={s.chips}>{["Now", "06:00", "09:00", "12:00", "18:00", "21:00"].map(t => <TouchableOpacity key={t} style={s.chip} onPress={() => {
          if (t === "Now") { const d = new Date(); onPick(`${pad(d.getHours())}:${pad(d.getMinutes())}`); } else onPick(t);
        }}><Text style={s.chipText}>{t}</Text></TouchableOpacity>)}</View>
        <TouchableOpacity style={s.done} onPress={() => onPick(`${pad(h)}:${pad(m)}`)}><Text style={s.doneText}>Set {pad(h)}:{pad(m)}</Text></TouchableOpacity>
      </TouchableOpacity>
    </TouchableOpacity>
  </KeyboardAvoidingView></Modal>;
}

const s = StyleSheet.create({
  label: { color: "#aab8af", fontSize: 12, fontWeight: "700" },
  field: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  icon: { fontSize: 15 },
  value: { color: C.text, fontSize: 14, fontWeight: "600", flex: 1 },
  placeholder: { color: C.muted, fontWeight: "400" },
  clear: { color: C.muted, fontSize: 15, paddingHorizontal: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 18 },
  sheet: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 16, gap: 12 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  navText: { color: C.text, fontSize: 18, fontWeight: "700" },
  month: { flex: 1, textAlign: "center", color: C.text, fontSize: 16, fontWeight: "800" },
  week: { flexDirection: "row" },
  weekDay: { flex: 1, textAlign: "center", color: C.muted, fontSize: 11, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: C.green },
  dayToday: { borderColor: C.green, borderWidth: 1 },
  dayText: { color: C.text, fontSize: 14, fontWeight: "600" },
  dayTextSelected: { color: C.greenDark, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: C.text, fontSize: 12, fontWeight: "700" },
  done: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  doneText: { color: C.greenDark, fontWeight: "900", fontSize: 15 },
  bigTime: { color: C.text, fontSize: 40, fontWeight: "900", textAlign: "center", fontVariant: ["tabular-nums"] },
  columns: { flexDirection: "row", gap: 10, height: ROW * 5 },
  column: { flex: 1, backgroundColor: C.field, borderRadius: 14 },
  opt: { height: ROW, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  optOn: { backgroundColor: C.greenSoft },
  optText: { color: C.text, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  optTextOn: { color: C.green, fontWeight: "900" },
  optHint: { color: C.muted, fontSize: 11 },
});
