import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";
import { TimeField } from "../pickers";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const hhmm = (t?: string | null) => (t ? String(t).slice(0, 5) : "");
const DAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Home card: today's notes from the AI team. Actions are the note's own (open a screen, add a task, move leftovers). */
export function TeamTodayCard({ api, onError, onNotice, onOpen }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void; onOpen: (target: string) => void }) {
  const [v, setV] = useState<Row | null>(() => peek("/workers/today"));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const load = useCallback(() => { api<Row>("/workers/today").then(x => { setV(x); }).catch(() => setV(null)); }, [api]);
  useEffect(() => { load(); }, [load]);
  if (!v || !(v.items as Row[]).length) return null;
  const items = v.items as Row[];
  const latest = [...items].filter(i => i.note).sort((a, b) => String(b.note.updated_at).localeCompare(String(a.note.updated_at)))[0];
  const shown = open ?? latest?.worker ?? null;

  async function run(key: string) {
    setBusy(key);
    try { await api(`/workers/${key}/run`, "POST"); setOpen(key); load(); } catch (e) { onError(msg(e)); } finally { setBusy(null); }
  }
  async function act(note: Row, a: Row) {
    try {
      const out = await api<Row>(`/workers/notes/${note.id}/act`, "POST", { action_id: a.id });
      if (out.open) onOpen(out.open);
      else if (out.moved != null) onNotice(`Moved ${out.moved} task${out.moved === 1 ? "" : "s"} to tomorrow`);
      else if (out.task_id) onNotice("Added to your tasks ✓");
      load();
    } catch (e) { onError(msg(e)); }
  }
  async function rate(note: Row, feedback: "up" | "down") {
    try { await api(`/workers/notes/${note.id}/feedback`, "POST", { feedback: note.feedback === feedback ? null : feedback }); load(); } catch (e) { onError(msg(e)); }
  }

  const current = items.find(i => i.worker === shown);
  return <Card accent style={{ marginBottom: 10 }}>
    <Line><Kicker>TODAY FROM YOUR AI TEAM</Kicker><View style={{ flex: 1 }}/>{v.unread > 0 && <Badge tone="amber">{`${v.unread} new`}</Badge>}</Line>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.team}>{items.map(i => <TouchableOpacity key={i.worker} onPress={() => { setOpen(i.worker); setMore(false); }} style={[s.member, shown === i.worker && s.memberOn]}>
      <Text style={{ fontSize: 20 }}>{i.icon}</Text>
      <View style={[s.dot, i.note ? (i.note.status === "new" ? s.dotNew : s.dotRead) : null]}/>
    </TouchableOpacity>)}</ScrollView>
    {current && (current.note ? <View style={{ gap: 8 }}>
      <Line><Text style={s.who}>{current.icon} {current.name}</Text><View style={{ flex: 1 }}/>{current.note.used_ai ? <Badge>✨ AI</Badge> : <Badge tone="muted">rules</Badge>}</Line>
      <Text style={s.title}>{current.note.title}</Text>
      <Text style={s.body} numberOfLines={more ? undefined : 6}>{current.note.body}</Text>
      {String(current.note.body || "").length > 280 && <TouchableOpacity onPress={() => setMore(m => !m)}><Text style={{ color: C.green, fontWeight: "800" }}>{more ? "Show less ▲" : "Read more ▼"}</Text></TouchableOpacity>}
      <View style={s.actions}>{(current.note.actions as Row[]).map(a => <TouchableOpacity key={a.id} style={[s.action, a.action === "done" && s.actionQuiet]} onPress={() => void act(current.note, a)}>
        <Text style={[s.actionText, a.action === "done" && { color: C.muted }]}>{a.label}</Text></TouchableOpacity>)}</View>
      <Line>
        <TouchableOpacity onPress={() => void rate(current.note, "up")}><Text style={[s.rate, current.note.feedback === "up" && s.rateOn]}>👍</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => void rate(current.note, "down")}><Text style={[s.rate, current.note.feedback === "down" && s.rateOn]}>👎</Text></TouchableOpacity>
        <View style={{ flex: 1 }}/><Btn kind="link" title={busy === current.worker ? "Updating…" : "↻ Refresh note"} onPress={() => void run(current.worker)}/>
      </Line>
    </View> : <View style={{ gap: 6 }}>
      <Text style={s.who}>{current.icon} {current.name}</Text>
      <Muted>{current.scheduled_today ? `Writes today's note at ${hhmm(current.run_time)}.` : "Not scheduled today."}</Muted>
      <Btn kind="outline" title={busy === current.worker ? "Thinking…" : "Run now"} onPress={() => void run(current.worker)}/>
    </View>)}
  </Card>;
}

/** Settings for each worker: on/off, time, days, AI on/off and its daily token budget. */
export function AiTeamScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [workers, setWorkers] = useState<Row[] | null>(() => peek("/workers"));
  const load = useCallback(() => { api<Row[]>("/workers").then(setWorkers).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!workers) return <Screen><Empty>Loading your AI team…</Empty></Screen>;
  const save = (w: Row, patch: Row) => api<Row>(`/workers/${w.key}`, "PATCH", patch).then(next => setWorkers(ws => ws!.map(x => (x.key === w.key ? next : x)))).catch(e => onError(msg(e)));
  const shift = (w: Row, m: number) => { const [h, mi] = hhmm(w.run_time).split(":").map(Number); const t = ((h * 60 + mi + m) % 1440 + 1440) % 1440;
    void save(w, { run_time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` }); };
  return <Screen onRefresh={load}>
    <Card accent><Kicker>YOUR AI TEAM</Kicker>
      <Muted>Each helper has one job. Sakuna's own code gathers the facts; with your AI key on, the helper writes the note in a coaching voice using only those facts. It never acts on its own: every button on a note is yours to tap.</Muted>
      <Muted small>No AI key, AI switched off, or the budget used up? The helper still writes a rule-based note.</Muted>
    </Card>
    {workers.map(w => <Card key={w.key} style={!w.available ? { opacity: 0.55 } : undefined}>
      <Line><Text style={{ fontSize: 24 }}>{w.icon}</Text><View style={{ flex: 1 }}><Text style={s.title}>{w.name}</Text><Muted small>{w.job}</Muted></View>
        {w.available ? <Switch value={w.enabled} onValueChange={v => void save(w, { enabled: v })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/>
          : <Badge tone="muted">later phase</Badge>}</Line>
      {w.available && w.enabled && <>
        <TimeField label="Writes its note at" value={hhmm(w.run_time)} onChange={t => t && void save(w, { run_time: t })}/>
        <View style={s.days}>{DAY_SHORT.map((n, i) => { const on = (w.days as number[]).includes(i + 1);
          return <TouchableOpacity key={n} style={[s.day, on && s.dayOn]} onPress={() => void save(w, { days: on ? (w.days as number[]).filter(x => x !== i + 1) : [...w.days, i + 1].sort() })}>
            <Text style={[s.dayText, on && s.dayTextOn]}>{n}</Text></TouchableOpacity>; })}</View>
        <Line><Text style={[s.body, { flex: 1 }]}>✨ Use AI for this note</Text><Switch value={w.use_ai} onValueChange={v => void save(w, { use_ai: v })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>
        {w.use_ai && <View style={s.budget}>{[1000, 3000, 6000].map(b => <TouchableOpacity key={b} style={[s.chip, w.daily_token_budget === b && s.chipOn]} onPress={() => void save(w, { daily_token_budget: b })}>
          <Text style={[s.chipText, w.daily_token_budget === b && s.chipTextOn]}>{`${b / 1000}k tokens/day`}</Text></TouchableOpacity>)}</View>}
        {w.use_ai && <Muted small>{`Used today: ${w.tokens_today.toLocaleString()} of ${w.daily_token_budget.toLocaleString()} tokens. One note uses about 600–1,200.`}</Muted>}
        <Btn kind="outline" title="Run now" onPress={() => void api(`/workers/${w.key}/run`, "POST").then(() => { onNotice(`${w.name} wrote today's note. See Home.`); load(); }).catch(e => onError(msg(e)))}/>
      </>}
    </Card>)}
    <Muted small>Notes are written by the server on schedule (every 10 minutes it checks who's due), so they arrive even when the app is closed.</Muted>
  </Screen>;
}

const s = StyleSheet.create({
  team: { flexDirection: "row", gap: 8, paddingRight: 8 },
  member: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.line },
  memberOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  dot: { position: "absolute", top: 2, right: 2, width: 10, height: 10, borderRadius: 5, backgroundColor: "transparent" },
  dotNew: { backgroundColor: C.amber },
  dotRead: { backgroundColor: C.green },
  who: { color: C.muted, fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  title: { color: C.text, fontSize: 16, fontWeight: "800" },
  body: { color: "#d1ddd4", fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { borderColor: C.green, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.greenSoft },
  actionQuiet: { borderColor: C.line, backgroundColor: "transparent" },
  actionText: { color: C.green, fontWeight: "700", fontSize: 13 },
  rate: { fontSize: 20, opacity: 0.45, marginRight: 10 },
  rateOn: { opacity: 1 },
  time: { color: C.text, fontSize: 22, fontWeight: "900", flex: 1, textAlign: "center" },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { width: 38, height: 38, borderRadius: 19, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: C.green, borderColor: C.green },
  dayText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  dayTextOn: { color: C.greenDark },
  budget: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 12 },
  chipTextOn: { color: C.green },
});
