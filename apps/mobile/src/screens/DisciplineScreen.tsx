import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const TINT = "#8f7bff";

function Pill({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1,
    borderColor: on ? TINT : C.line, backgroundColor: on ? TINT + "33" : "transparent" }}><Text style={{ color: on ? C.text : C.muted, fontWeight: "700" }}>{label}</Text></TouchableOpacity>;
}

function RideItOut({ minutes, onEnd }: { minutes: number; onEnd: () => void }) {
  const [left, setLeft] = useState(minutes * 60);
  useEffect(() => { const t = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, []);
  const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, "0");
  return <Card style={{ borderColor: TINT, alignItems: "center", gap: 8 }}>
    <Kicker>RIDE IT OUT</Kicker>
    <Ring value={100 - left / (minutes * 60) * 100} size={120} color={TINT} label={`${mm}:${ss}`} sub={left ? "KEEP GOING" : "DONE"}/>
    <Muted small>{left ? "The urge peaks and fades. Stay busy with your choice until the timer ends." : "You made it through. That's a real win."}</Muted>
    <Btn kind="outline" title={left ? "Stop timer" : "Close"} onPress={onEnd}/>
  </Card>;
}

function NewGoal({ api, data, onDone, onError }: { api: Api; data: Row; onDone: () => void; onError: (m: string) => void }) {
  const [kind, setKind] = useState<string>("porn_free"); const [label, setLabel] = useState<string>("");
  const [reasons, setReasons] = useState<string>(""); const [picked, setPicked] = useState<string[]>([]); const [own, setOwn] = useState<string>("");
  const [daysAgo, setDaysAgo] = useState<string>("0");
  const save = () => {
    const d = new Date(); d.setDate(d.getDate() - Math.max(0, parseInt(daysAgo, 10) || 0));
    const reps = [...picked, ...own.split(",").map(s => s.trim()).filter(Boolean)];
    void api("/discipline/goals", "POST", { kind, label: label.trim() || undefined, reasons: reasons.trim() || undefined, replacements: reps,
      started_on: d.toISOString().slice(0, 10) }).then(onDone).catch(e => onError(msg(e)));
  };
  return <Card style={{ gap: 10 }}>
    <Kicker>START A COMMITMENT</Kicker>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.entries(data.kinds as Record<string, string>).map(([k, l]) => <Pill key={k} label={l} on={kind === k} onPress={() => setKind(k)}/>)}</View>
    <Field label="Name shown on screen (kept neutral)" value={label} onChangeText={setLabel} placeholder="Self-control"/>
    <Field label="Your why (shown when you need motivation)" value={reasons} onChangeText={setReasons} placeholder="More focus, energy and confidence…" multiline/>
    <Field label="Already going for how many days?" value={daysAgo} onChangeText={setDaysAgo} keyboardType="number-pad"/>
    <Muted small>Healthy replacements (pick a few):</Muted>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(data.default_replacements as string[]).map(r => <Pill key={r} label={r} on={picked.includes(r)}
      onPress={() => setPicked(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r])}/>)}</View>
    <Field value={own} onChangeText={setOwn} placeholder="Your own, separated by commas (gym, yoga, guitar…)"/>
    <Btn title="Start" onPress={save}/>
  </Card>;
}

function GoalCard({ api, g, data, onChange, onError, onNotice }: { api: Api; g: Row; data: Row; onChange: (g: Row) => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [mode, setMode] = useState<"" | "urge" | "reset">(""); const [trigger, setTrigger] = useState<string>(""); const [intensity, setIntensity] = useState<number>(3);
  const [reply, setReply] = useState<Row | null>(null); const [timer, setTimer] = useState<number>(0); const [note, setNote] = useState<string>("");
  const send = (kind: string, extra: Row = {}) => void api<Row>(`/discipline/goals/${g.id}/checkin`, "POST", { kind, ...extra }).then(r => {
    setReply(r); onChange(r.goal); setMode(""); setNote(""); if (r.timer_minutes) setTimer(r.timer_minutes);
  }).catch(e => onError(msg(e)));
  const handled = (stayed: boolean, action?: string) => {
    const ev = (g.recent as Row[])[0]; if (!ev) return;
    void api(`/discipline/events/${ev.id}`, "PATCH", { stayed, action }).then(() => { setReply(null); setTimer(0);
      onNotice(stayed ? "Urge handled. Well done 💪" : "Thanks for being honest. Try again; you've got this."); return api<Row>("/discipline"); })
      .then(d => { const x = (d as Row).goals.find((y: Row) => y.id === g.id); if (x) onChange(x); }).catch(e => onError(msg(e)));
  };
  const next = g.next_milestone as number | null;
  return <View style={{ gap: 10 }}>
    <Hero kicker={`🛡 ${String(g.label).toUpperCase()}`} title={`${g.streak_days}`} accent={g.streak_days === 1 ? "day" : "days"} color={TINT}
      sub={`Best ${g.best_streak} · ${g.clean_days_total} good days in total${g.resets ? ` · restarted ${g.resets}×` : ""}`}
      right={<Ring value={next ? Math.min(100, g.streak_days / next * 100) : 100} size={88} color={TINT} label={next ? `${next}` : "🏆"} sub="NEXT"/>}>
      {!g.checked_in_today && <Muted small>No check-in yet today.</Muted>}
    </Hero>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Btn title="😊 I'm doing well" onPress={() => send("ok")} style={{ flexGrow: 1 }}/>
      <Btn kind="outline" title="🌊 I'm having an urge" onPress={() => { setMode("urge"); setReply(null); }} style={{ flexGrow: 1 }}/>
      <Btn kind="outline" title="✨ I need motivation" onPress={() => send("motivation")} style={{ flexGrow: 1 }}/>
      <Btn kind="outline" title="↺ I want to reset" onPress={() => { setMode("reset"); setReply(null); }} style={{ flexGrow: 1 }}/>
    </View>
    {mode !== "" && <Card style={{ gap: 8 }}>
      <Kicker>{mode === "urge" ? "WHAT'S GOING ON?" : "NO GUILT. WHAT HAPPENED JUST BEFORE?"}</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{Object.entries(data.triggers as Record<string, string>).map(([k, l]) =>
        <Pill key={k} label={l} on={trigger === k} onPress={() => setTrigger(t => t === k ? "" : k)}/>)}</View>
      {mode === "urge" && <><Muted small>How strong? (1 = mild, 5 = very strong)</Muted>
        <Line>{[1, 2, 3, 4, 5].map(n => <Pill key={n} label={String(n)} on={intensity === n} onPress={() => setIntensity(n)}/>)}</Line></>}
      <Field value={note} onChangeText={setNote} placeholder="Optional note for your trigger journal" multiline/>
      <Line><Btn kind="link" title="Cancel" onPress={() => setMode("")}/><View style={{ flex: 1 }}/>
        <Btn title={mode === "urge" ? "Help me now" : "Restart my streak"} onPress={() => send(mode, { trigger: trigger || undefined, intensity: mode === "urge" ? intensity : undefined, note: note.trim() || undefined })}/></Line>
    </Card>}
    {reply && <Card style={{ borderColor: TINT, gap: 8 }}>
      <Text style={{ color: C.text, fontSize: 16, lineHeight: 23 }}>{reply.message}</Text>
      {reply.your_why && <Text style={{ color: TINT, fontWeight: "800" }}>{`Your why: ${reply.your_why}`}</Text>}
      {(reply.suggestions as string[] | undefined)?.length ? <><Kicker>PICK ONE, DO IT NOW</Kicker>
        {(reply.suggestions as string[]).map(s => <TouchableOpacity key={s} onPress={() => reply.kind === "urge" ? handled(true, s) : setReply(null)}
          style={{ padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}><Text style={{ color: C.text }}>{`→ ${s}`}</Text></TouchableOpacity>)}</> : null}
      {reply.kind === "urge" && <Line><Btn kind="outline" title="It passed ✓" onPress={() => handled(true)} style={{ flex: 1 }}/><Btn kind="link" title="I slipped" onPress={() => { handled(false); setMode("reset"); }}/></Line>}
      {reply.kind !== "ok" && <Muted small>{reply.support}</Muted>}
      {!timer && <Btn kind="link" title="Close" onPress={() => setReply(null)}/>}
    </Card>}
    {timer > 0 && <RideItOut minutes={timer} onEnd={() => setTimer(0)}/>}
    {(g.insights as string[]).length > 0 && <Card><Kicker>INSIGHTS</Kicker>{(g.insights as string[]).map((t, i) => <Text key={i} style={{ color: C.text, lineHeight: 21 }}>{`• ${t}`}</Text>)}</Card>}
    {(g.triggers_30d as Row[]).length > 0 && <Card><Kicker>TRIGGERS · LAST 30 DAYS</Kicker>{(g.triggers_30d as Row[]).map(t => <Line key={t.trigger}>
      <Text style={{ color: C.text, flex: 1 }}>{t.label}</Text>
      <View style={{ width: 110, height: 8, borderRadius: 4, backgroundColor: C.line }}><View style={{ width: Math.min(110, t.count * 18), height: 8, borderRadius: 4, backgroundColor: TINT }}/></View>
      <Text style={{ color: C.muted, width: 26, textAlign: "right" }}>{t.count}</Text></Line>)}</Card>}
    <Card><Kicker>MILESTONES</Kicker><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(g.milestones as Row[]).map(m =>
      <View key={m.days} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: m.reached ? TINT + "44" : C.panel2 }}>
        <Text style={{ color: m.reached ? C.text : C.muted, fontWeight: "800" }}>{`${m.reached ? "★" : "○"} ${m.days}d`}</Text></View>)}</View></Card>
    <Card><Kicker>MY REPLACEMENTS</Kicker><Text style={{ color: C.text }}>{(g.replacements as string[]).join(" · ")}</Text></Card>
    {(g.recent as Row[]).length > 0 && <Card><Kicker>TRIGGER JOURNAL</Kicker>{(g.recent as Row[]).slice(0, 8).map(e => <View key={e.id} style={{ paddingVertical: 4 }}>
      <Text style={{ color: C.text }}>{`${e.date} ${String(e.hour).padStart(2, "0")}:00 · ${({ ok: "Doing well", urge: "Urge", motivation: "Motivation", reset: "Reset" } as Row)[e.kind]}`
        + `${e.trigger ? ` · ${data.triggers[e.trigger] || e.trigger}` : ""}${e.stayed === true ? " · handled ✓" : e.stayed === false ? " · slipped" : ""}`}</Text>
      {e.action && <Muted small>{`→ ${e.action}`}</Muted>}{e.note && <Muted small>{e.note}</Muted>}</View>)}</Card>}
    <Btn kind="link" title="Remove this commitment" onPress={() => Alert.alert("Remove this commitment?", "Its streak and check-ins will be deleted.", [{ text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void api(`/discipline/goals/${g.id}`, "DELETE").then(() => onChange({ ...g, _deleted: true })).catch(e => onError(msg(e))) }])}/>
  </View>;
}

export function DisciplineScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [data, setData] = useState<Row | null>(null); const [adding, setAdding] = useState(false); const [sel, setSel] = useState<string>("");
  const load = useCallback(() => { api<Row>("/discipline").then(d => { setData(d); setSel(s => s || d.goals[0]?.id || ""); }).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!data) return <Screen><Empty>Loading…</Empty></Screen>;
  const goals = data.goals as Row[]; const g = goals.find(x => x.id === sel) || goals[0];
  const onChange = (x: Row) => { if (x._deleted) { setSel(""); load(); return; } setData(d => d && ({ ...d, goals: (d.goals as Row[]).map(y => y.id === x.id ? x : y) })); };
  const b = data.blocking as Row;
  return <Screen onRefresh={load}>
    <Muted small>{`🔒 ${data.privacy}`}</Muted>
    {goals.length > 1 && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{goals.map(x => <Pill key={x.id} label={x.label} on={x.id === g?.id} onPress={() => setSel(x.id)}/>)}</View>}
    {g && !adding ? <GoalCard api={api} g={g} data={data} onChange={onChange} onError={onError} onNotice={onNotice}/>
      : <NewGoal api={api} data={data} onDone={() => { setAdding(false); setSel(""); load(); onNotice("Started. One day at a time 💜"); }} onError={onError}/>}
    {g && <Btn kind="outline" title={adding ? "Cancel" : "＋ Another commitment"} onPress={() => setAdding(a => !a)}/>}
    <Card style={{ gap: 6 }}><Kicker>BLOCK APPS & WEBSITES</Kicker>
      <Text style={{ color: C.text }}>{b.shield}</Text>
      <Text style={{ color: C.text, lineHeight: 21 }}>{b.dns_how}</Text>
      {(b.dns as Row[]).map(d => <View key={d.host} style={{ padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}>
        <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>{d.name}</Text><Text selectable style={{ color: TINT, fontWeight: "800" }}>{d.host}</Text></View>)}
      <Btn kind="outline" title="Open phone settings" onPress={() => void Linking.sendIntent("android.settings.WIRELESS_SETTINGS").catch(() => Linking.openSettings())}/>
      <Muted small>Long-press a hostname to copy it.</Muted>
    </Card>
    <Muted small>{data.support}</Muted>
  </Screen>;
}
