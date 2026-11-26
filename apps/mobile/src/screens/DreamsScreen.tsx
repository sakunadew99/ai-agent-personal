import React, { useCallback, useEffect, useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen, soft } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const HORIZONS: [string, string][] = [["week", "This week"], ["month", "This month"], ["year", "This year"], ["3y", "3 years"], ["5y", "5 years"], ["10y", "10 years"]];
const H_COLOR: Record<string, string> = { today: C.green, week: C.green, month: C.blue, year: "#b48cff", "3y": C.amber, "5y": "#ff9ecf", "10y": C.red, unsorted: C.muted };
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, fontSize: 15 } as const;
const EXAMPLES = ["I want to learn swimming", "I want to study in Germany", "I want to build $1 million net worth", "I want to start a new Fiverr gig", "I want to improve my leadership", "I want to visit Ella"];

function ListEdit({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return <View style={{ gap: 6 }}><Kicker>{label}</Kicker>
    {items.map((x, i) => <View key={i} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
      <TextInput style={[input, { flex: 1, padding: 9 }]} value={x} onChangeText={t => onChange(items.map((y, j) => j === i ? t : y))}/>
      <TouchableOpacity onPress={() => onChange(items.filter((_, j) => j !== i))}><Text style={{ color: C.muted, fontSize: 18 }}>✕</Text></TouchableOpacity></View>)}
    <TouchableOpacity onPress={() => onChange([...items, ""])}><Text style={{ color: C.green, fontWeight: "800" }}>＋ Add</Text></TouchableOpacity></View>;
}

/** Dreams & goals: your goals from this week to 10 years, and "dream -> plan" with your approval. */
export function DreamsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [dream, setDream] = useState(""); const [horizon, setHorizon] = useState("year");
  const [plan, setPlan] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { api<Row>("/dreams/ladder").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const propose = () => { setBusy(true); api<Row>("/dreams/propose", "POST", { dream: dream.trim(), horizon, ai: true }).then(setPlan).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  const accept = () => { setBusy(true); api<Row>("/dreams/accept", "POST", { ...plan, milestones: (plan!.milestones as Row[]).filter(m => m.title.trim()),
    skills: (plan!.skills as string[]).filter(Boolean), resources: (plan!.resources as string[]).filter(Boolean), challenges: (plan!.challenges as string[]).filter(Boolean) })
    .then(x => { setV(x); setPlan(null); setDream(""); onNotice("Goal created with milestones and a first step for tomorrow 🎯"); }).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  if (!v) return <Screen><Empty>Loading your dreams…</Empty></Screen>;
  const set = (k: string) => (val: unknown) => setPlan(p => ({ ...p!, [k]: val }));
  return <Screen onRefresh={load}>
    <Hero kicker="DREAMS & GOALS · TODAY TO 10 YEARS" title="Dream" accent="to action" color="#b48cff"
      sub={`${v.total} goals${(v.today_connects as Row[]).length ? ` · ${(v.today_connects as Row[]).length} tasks today move them forward` : ""}`}
      right={<Ring value={Math.min(100, v.total * 10)} size={86} color="#b48cff" label={`${v.total}`} sub="GOALS"/>}>
      <TextInput style={input} value={dream} onChangeText={setDream} placeholder="I want to…" placeholderTextColor={C.muted} multiline/>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{HORIZONS.map(([k, l]) => <TouchableOpacity key={k} onPress={() => setHorizon(k)}
        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: horizon === k ? H_COLOR[k] : C.line, backgroundColor: horizon === k ? `${H_COLOR[k]}22` : "transparent" }}>
        <Text style={{ color: horizon === k ? H_COLOR[k] : C.muted, fontWeight: "800" }}>{l}</Text></TouchableOpacity>)}</View>
      <Btn title={busy && !plan ? "Thinking…" : "✨ Turn into a plan"} busy={busy && !plan} disabled={dream.trim().length < 3} onPress={propose}/>
      {!dream && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{EXAMPLES.map(e => <TouchableOpacity key={e} onPress={() => setDream(e)}>
        <Text style={{ color: C.muted, fontSize: 12, borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 }}>{e}</Text></TouchableOpacity>)}</View>}
    </Hero>

    {plan && <Card style={{ borderColor: "#b48cff88" }}>
      <Line><Kicker>{`PROPOSED PLAN · ${String(plan.horizon_label).toUpperCase()}${plan.source === "ai" ? " · AI" : ""}`}</Kicker></Line>
      <TextInput style={[input, { fontSize: 18, fontWeight: "900" }]} value={plan.title} onChangeText={set("title")}/>
      {(plan.related_goals as Row[]).length > 0 && <Muted small>{`Connects to: ${(plan.related_goals as Row[]).map(g => g.title).join(", ")}`}</Muted>}
      <Kicker>WHY IT MATTERS</Kicker><TextInput style={input} value={plan.why} onChangeText={set("why")} multiline/>
      <Kicker>WHAT SUCCESS LOOKS LIKE</Kicker><TextInput style={input} value={plan.success} onChangeText={set("success")} multiline/>
      <View style={{ gap: 6 }}><Kicker>MILESTONES</Kicker>{(plan.milestones as Row[]).map((m, i) => <View key={i} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <Text style={{ color: "#b48cff", fontWeight: "900", width: 18 }}>{i + 1}</Text>
        <TextInput style={[input, { flex: 1, padding: 9 }]} value={m.title} onChangeText={t => set("milestones")((plan.milestones as Row[]).map((y, j) => j === i ? { ...y, title: t } : y))}/>
        <Text style={{ color: C.muted, fontSize: 11 }}>{m.due_date}</Text></View>)}</View>
      <ListEdit label="SKILLS YOU NEED" items={plan.skills} onChange={set("skills")}/>
      <ListEdit label="RESOURCES" items={plan.resources} onChange={set("resources")}/>
      <ListEdit label="CHALLENGES TO EXPECT" items={plan.challenges} onChange={set("challenges")}/>
      <Kicker>FIRST STEP (BECOMES A TASK)</Kicker><TextInput style={input} value={plan.next_action} onChangeText={set("next_action")}/>
      <Line><Btn title="✓ Approve and add" busy={busy} onPress={accept} style={{ flex: 1 }}/><Btn kind="outline" title="Reject" onPress={() => setPlan(null)} style={{ flex: 1 }}/></Line>
      <Muted small>Nothing is saved until you approve. Edit anything first.</Muted>
    </Card>}

    {(v.today_connects as Row[]).length > 0 && <Card accent><Kicker>TODAY → YOUR FUTURE</Kicker>
      {(v.today_connects as Row[]).map((c, i) => <Text key={i} style={{ color: C.text }}>{`☑ ${c.task}  `}<Text style={{ color: C.muted }}>{`→ ${c.goal}`}</Text></Text>)}</Card>}

    {(v.horizons as Row[]).map(h => <View key={h.key} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><View style={{ width: 6, height: 20, borderRadius: 3, backgroundColor: H_COLOR[h.key] || C.muted }}/>
        <Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{h.label}</Text></View>
      {(h.goals as Row[]).map(g => { const col = H_COLOR[h.key] || C.green, isOpen = open === g.id;
        return <TouchableOpacity key={g.id} activeOpacity={0.85} onPress={() => setOpen(isOpen ? null : g.id)}>
          <Card style={{ borderColor: `${col}55` }}>
            <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 16, flex: 1 }}>{g.title}</Text>{g.progress != null && <Text style={{ color: col, fontWeight: "900" }}>{`${g.progress}%`}</Text>}</Line>
            {g.progress != null && <View style={{ height: 7, borderRadius: 4, backgroundColor: C.panel2 }}><View style={{ height: 7, borderRadius: 4, width: `${g.progress}%`, backgroundColor: col }}/></View>}
            {!!g.next_milestone && <Muted small>{`Next milestone: ${g.next_milestone} (${g.milestones_done}/${g.milestones_total})`}</Muted>}
            {isOpen && <View style={{ gap: 6 }}>
              {!!g.why && <Text style={{ color: C.text }}>{`💡 ${g.why}`}</Text>}
              {!!g.success && <Text style={{ color: C.text }}>{`🏁 ${g.success}`}</Text>}
              {(g.skills as string[]).length > 0 && <Muted small>{`Skills: ${(g.skills as string[]).join(" · ")}`}</Muted>}
              {(g.challenges as string[]).length > 0 && <Muted small>{`Watch out for: ${(g.challenges as string[]).join(" · ")}`}</Muted>}
              {(g.open_tasks as string[]).map((t, i) => <Text key={i} style={{ color: C.green }}>{`☑ ${t}`}</Text>)}
              {!!g.next_action && !(g.open_tasks as string[]).length && <Text style={{ color: C.amber }}>{`Next: ${g.next_action}`}</Text>}
            </View>}
          </Card></TouchableOpacity>; })}
    </View>)}
    {!v.total && !plan && <Empty>Write a dream above: Sakuna turns it into why, milestones and a first step. You approve before anything is saved.</Empty>}
  </Screen>;
}

// ------------------------------------------------------------------ companion card (Home)

const FREQ_LABEL: Record<string, string> = { daily: "Daily", few_weekly: "Few times a week", useful: "Only when useful", off: "Don't ask" };

export function CompanionCard({ api, onOpen }: { api: Api; onOpen: (t: string) => void }) {
  const [q, setQ] = useState<Row | null>(null);
  const [reply, setReply] = useState<Row | null>(null);
  const [settings, setSettings] = useState(false);
  const load = useCallback((force = false) => { api<Row>(`/companion${force ? "?force=true" : ""}`).then(setQ).catch(() => undefined); }, [api]);
  useEffect(() => { load(); }, [load]);
  if (!q || (!q.question && !reply && !settings)) return null;
  const choose = (key: string) => void api<Row>("/companion/answer", "POST", { choice: key, goal_id: q.question?.goal_id }).then(setReply).catch(() => undefined);
  return <View style={{ borderRadius: 24, padding: 16, gap: 10, backgroundColor: soft("#7c4dff"), borderWidth: 1, borderColor: "#b48cff55" }}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Text style={{ color: "#b48cff", fontSize: 10, letterSpacing: 1.6, fontWeight: "800", flex: 1 }}>✨ SAKUNA ASKS</Text>
      <TouchableOpacity onPress={() => setSettings(s => !s)} hitSlop={10}><Text style={{ color: C.muted }}>⚙</Text></TouchableOpacity></View>
    {settings ? <View style={{ gap: 6 }}><Text style={{ color: C.text, fontWeight: "800" }}>How often should I ask?</Text>
      {Object.entries(FREQ_LABEL).map(([k, l]) => <TouchableOpacity key={k} onPress={() => void api<Row>("/companion/frequency", "PUT", { frequency: k }).then(() => { setSettings(false); load(); })}
        style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: q.frequency === k ? "#b48cff" : C.line }}><Text style={{ color: q.frequency === k ? "#b48cff" : C.text, fontWeight: "700" }}>{l}</Text></TouchableOpacity>)}
      <Muted small>I never ask during your quiet hours or sleep time.</Muted></View>
    : reply ? <View style={{ gap: 8 }}><Text style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>{reply.text}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(reply.actions as Row[]).map(a => <TouchableOpacity key={a.label} onPress={() => onOpen(a.open)}
        style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: "#b48cff" }}><Text style={{ color: "#120a20", fontWeight: "900" }}>{a.label}</Text></TouchableOpacity>)}</View>
      <TouchableOpacity onPress={() => { setReply(null); setQ(null); }}><Text style={{ color: C.muted, fontSize: 12 }}>Done</Text></TouchableOpacity></View>
    : q.question && <View style={{ gap: 8 }}><Text style={{ color: C.text, fontSize: 16, fontWeight: "800", lineHeight: 22 }}>{q.question.text}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(q.question.choices as Row[]).map(c => <TouchableOpacity key={c.key} onPress={() => choose(c.key)}
        style={{ paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, borderWidth: 1, borderColor: "#b48cff77", backgroundColor: "#b48cff14" }}><Text style={{ color: C.text, fontWeight: "700" }}>{c.label}</Text></TouchableOpacity>)}</View></View>}
  </View>;
}
