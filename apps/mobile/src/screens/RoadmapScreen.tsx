/**
 * Life roadmap that stays alive: steps measured from your records, daily / weekly / monthly / yearly reports, and a monitor
 * that suggests changes (you approve them). Edit, add, finish or drop any step.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Bars } from "../charts";
import { DateField } from "../pickers";
import { Badge, Btn, C, Card, Chips, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const AREA: Record<string, string> = { money: "💰", learn: "📚", earn: "💼", career: "🚀", health: "💪", mind: "🧠" };
const STATE: Record<string, [string, string]> = { done: ["✓ done", C.green], on_track: ["on track", C.blue], behind: ["behind", C.amber], late: ["late", C.red], dropped: ["dropped", C.muted] };
const PHASES = ["now", "m1_3", "m3_6", "m6_12", "y1_3"] as const;
const PHASE_LABEL: Record<string, string> = { now: "This month", m1_3: "Months 1-3", m3_6: "Months 3-6", m6_12: "Months 6-12", y1_3: "Years 1-3" };
const KINDS = ["daily", "weekly", "monthly", "yearly"] as const;

export function RoadmapScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("weekly");
  const [rep, setRep] = useState<Row | null>(null);
  const [chk, setChk] = useState<Row | null>(null); const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [add, setAdd] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/roadmap").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (v?.has_roadmap) api<Row>(`/roadmap/review/${kind}`).then(setRep).catch(() => setRep(null)); }, [api, kind, v?.has_roadmap]);
  if (!v) return <Screen><Empty>Checking your roadmap…</Empty></Screen>;
  if (!v.has_roadmap) return <Screen><Card style={{ gap: 8 }}>
    <Kicker>🧭 YOUR LIVE LIFE ROADMAP</Kicker>
    <Text style={{ color: C.text, lineHeight: 21 }}>Steps for money, learning, earning, career and health, each with a target Sakuna measures from your records. Reports every day, week, month and year, and a monitor that suggests changes for you to approve.</Text>
    <Muted small>Tip: set up your money plan first (salary, costs, debts) so the targets fit your numbers.</Muted>
    <Btn title="Create my roadmap" onPress={() => void api<Row>("/roadmap/generate", "POST", {}).then(r => { setV(r); onNotice("🧭 Roadmap ready"); }).catch(e => onError(msg(e)))}/>
  </Card></Screen>;
  const cur = String(v.currency || "LKR");
  const show = (x: number | null, unit: string) => x == null ? "—" : unit === "money" ? `${cur} ${Math.round(x).toLocaleString()}` : `${x}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
  const patch = (id: string, body: Row) => void api<Row>(`/roadmap/items/${id}`, "PATCH", body).then(r => { setV(r); setEdit(null); }).catch(e => onError(msg(e)));
  const runCheck = () => { setChecking(true); void api<Row>("/roadmap/check", "POST", { ai: true }).then(setChk).catch(e => onError(msg(e))).finally(() => setChecking(false)); };
  const decide = (ok: boolean) => chk?.approval_id && void api(`/approvals/${chk.approval_id}/${ok ? "approve" : "reject"}`, "POST")
    .then(() => { onNotice(ok ? "✓ Roadmap updated" : "Kept as it was"); setChk(null); load(); }).catch(e => onError(msg(e)));
  const today = v.today as Row | null;
  return <Screen onRefresh={load}>
    {/* header + today */}
    <View style={{ borderRadius: 22, padding: 16, backgroundColor: "#7c4dff", gap: 6 }}>
      <Text style={{ color: "#ffffffcc", fontSize: 11, fontWeight: "900", letterSpacing: 1 }}>{`🧭 NOW: ${String(v.current_name).toUpperCase()}${today ? ` · SCORE ${today.score}%` : ""}`}</Text>
      <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>Today's focus</Text>
      {(v.focus as string[]).length ? (v.focus as string[]).map(f => <Text key={f} style={{ color: "#fff", fontWeight: "700", lineHeight: 21 }}>{f}</Text>) : <Text style={{ color: "#fff" }}>Nothing pressing: enjoy the day 🎉</Text>}
      {(v.behind as Row[]).length > 0 && <Text style={{ color: "#ffe082", fontWeight: "800" }}>{`⚠️ Behind: ${(v.behind as Row[]).map(r => r.title).slice(0, 2).join(" · ")}`}</Text>}
    </View>
    {/* monitor */}
    <Card style={{ gap: 8, borderColor: C.green }}>
      <Kicker>🤖 ROADMAP MONITOR</Kicker>
      <Muted small>Checks your progress and suggests changes (new dates, smaller steps, next steps). It runs every Sunday by itself; nothing changes until you approve.</Muted>
      {!chk ? <Btn title={checking ? "Checking…" : "Check my roadmap now"} disabled={checking} onPress={runCheck}/> : <>
        <Text style={{ color: C.text, lineHeight: 21 }}>{chk.summary}</Text>
        {(chk.changes as Row[]).map((c, i) => <View key={i} style={{ flexDirection: "row", gap: 8, padding: 8, borderRadius: 10, backgroundColor: C.panel2 }}>
          <Text style={{ fontSize: 15 }}>{c.op === "add" ? "➕" : c.op === "move" ? "📆" : c.op === "target" ? "🎯" : "✕"}</Text>
          <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{c.op === "add" ? c.title : c.op === "move" ? `New date ${c.target_date}` : c.op === "target" ? `New target ${c.target_value}` : "Drop this step"}</Text>
            <Muted small>{c.why}</Muted></View></View>)}
        {chk.approval_id ? <Line><Btn title="Approve changes" onPress={() => decide(true)} style={{ flex: 1 }}/><Btn kind="outline" title="Keep as is" onPress={() => decide(false)}/></Line>
          : <Line><Muted small>No changes needed.</Muted><View style={{ flex: 1 }}/><Btn kind="link" title="OK" onPress={() => setChk(null)}/></Line>}
      </>}
    </Card>
    {/* reports */}
    <Card style={{ gap: 8 }}>
      <Chips options={KINDS} value={kind} onChange={setKind} labels={{ daily: "Day", weekly: "Week", monthly: "Month", yearly: "Year" }}/>
      {!rep ? <Muted small>Loading report…</Muted> : <>
        <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 22 }}>{`${rep.score}%`}</Text><Muted small>{` steps done or on track · since ${rep.period_start}`}</Muted></Line>
        {(rep.better as string[]).map(x => <Text key={x} style={{ color: C.green }}>{`▲ ${x}`}</Text>)}
        {(rep.worse as string[]).map(x => <Text key={x} style={{ color: C.red }}>{`▼ ${x}`}</Text>)}
        {(rep.done_in_period as string[]).length > 0 && <Text style={{ color: C.text }}>{`✓ Done: ${(rep.done_in_period as string[]).join(" · ")}`}</Text>}
        {!rep.previous && <Muted small>First report of this kind: the next one compares with this.</Muted>}
        {(rep.history as Row[])?.length > 1 && <Bars data={[...(rep.history as Row[])].reverse().map(h => ({ label: String(h.period_start).slice(5), value: Number(h.score || 0) }))} height={80} format={n => `${n}%`}/>}
      </>}
    </Card>
    {/* phases */}
    {(v.phases as Row[]).map(ph => <Card key={ph.phase} style={{ gap: 8, borderColor: ph.current ? "#7c4dff" : C.line }}>
      <TouchableOpacity onPress={() => setOpen(o => (o === ph.phase ? null : ph.phase))}>
        <Line><Text style={{ color: ph.current ? "#b388ff" : C.text, fontWeight: "900", flex: 1 }}>{`${ph.current ? "▶ " : ""}${ph.name} · ${ph.done}/${ph.total}`}</Text>
          <Text style={{ color: C.muted }}>{(open ?? v.current_phase) === ph.phase ? "▴" : "▾"}</Text></Line>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: C.line, marginTop: 6 }}><View style={{ width: `${ph.pct}%`, height: 6, borderRadius: 3, backgroundColor: ph.current ? "#7c4dff" : C.green }}/></View>
      </TouchableOpacity>
      {(open ?? v.current_phase) === ph.phase && (ph.items as Row[]).map(it => { const [lab, col] = STATE[it.state] || ["", C.muted];
        return <View key={it.id} style={{ gap: 6, padding: 10, borderRadius: 14, backgroundColor: C.panel2, opacity: it.state === "dropped" ? 0.5 : 1 }}>
          <TouchableOpacity onPress={() => setEdit(e => (e?.id === it.id ? null : { ...it, target: it.target ?? "" }))}>
            <Line><Text style={{ fontSize: 16 }}>{AREA[it.area] || "•"}</Text><Text style={{ color: C.text, fontWeight: "800", flex: 1, textDecorationLine: it.state === "done" ? "line-through" : "none" }}>{it.title}</Text>
              <Text style={{ color: col, fontSize: 11, fontWeight: "900" }}>{lab}</Text></Line>
            {it.metric !== "manual" && <>
              <Muted small>{`${it.metric_label}: ${show(it.current, it.unit)} → ${show(it.target, it.unit)}${it.target_date ? ` · by ${it.target_date}` : ""}`}</Muted>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: C.line }}><View style={{ width: `${it.pct}%`, height: 5, borderRadius: 3, backgroundColor: col }}/></View></>}
            {it.metric === "manual" && !!it.target_date && <Muted small>{`by ${it.target_date}${it.source === "ai" ? " · suggested by the monitor" : ""}`}</Muted>}
          </TouchableOpacity>
          {edit && edit.id === it.id && <View style={{ gap: 6 }}>
            <Field value={String(edit.title)} onChangeText={t => setEdit(e => e && { ...e, title: t })} placeholder="Step"/>
            {it.metric !== "manual" && <Field value={String(edit.target)} onChangeText={t => setEdit(e => e && { ...e, target: t })} keyboardType="numeric" placeholder="Target"/>}
            <DateField value={edit.target_date || null} onChange={d => setEdit(e => e && { ...e, target_date: d })} placeholder="Target date" allowClear/>
            <Line><Btn title="Save" style={{ flex: 1 }} onPress={() => patch(String(it.id), { title: String(edit.title).trim(), ...(edit.target_date ? { target_date: edit.target_date } : {}),
              ...(it.metric !== "manual" && edit.target !== "" ? { target_value: Number(edit.target) } : {}) })}/>
              {it.state !== "done" ? <Btn kind="outline" title="✓ Done" onPress={() => patch(String(it.id), { status: "done" })}/> : <Btn kind="outline" title="↺ Reopen" onPress={() => patch(String(it.id), { status: "todo" })}/>}</Line>
            <Line><Btn kind="link" title={it.state === "dropped" ? "Bring back" : "Drop this step"} onPress={() => patch(String(it.id), { status: it.state === "dropped" ? "todo" : "dropped" })}/><View style={{ flex: 1 }}/>
              <Btn kind="link" title="Delete" onPress={() => Alert.alert("Delete step?", String(it.title), [{ text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => void api(`/roadmap/items/${it.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}/></Line>
          </View>}
        </View>; })}
    </Card>)}
    {/* add a step */}
    {!add ? <Btn kind="outline" title="＋ Add my own step" onPress={() => setAdd({ title: "", phase: v.current_phase || "now", area: "learn", metric: "manual", target: "", date: null })}/> : <Card style={{ gap: 8 }}>
      <Kicker>＋ NEW STEP</Kicker>
      <Field value={String(add.title)} onChangeText={t => setAdd(a => a && { ...a, title: t })} placeholder="e.g. German A1 course, finish 2 Power BI projects"/>
      <Chips options={PHASES} value={add.phase} onChange={p => setAdd(a => a && { ...a, phase: p })} labels={PHASE_LABEL}/>
      <Chips options={["money", "learn", "earn", "career", "health", "mind"] as const} value={add.area} onChange={x => setAdd(a => a && { ...a, area: x })}
        labels={{ money: "💰 Money", learn: "📚 Learn", earn: "💼 Earn", career: "🚀 Career", health: "💪 Health", mind: "🧠 Mind" }}/>
      <Chips options={Object.keys(v.metrics as Row) as string[]} value={add.metric} onChange={x => setAdd(a => a && { ...a, metric: x })}
        labels={Object.fromEntries(Object.entries(v.metrics as Record<string, Row>).map(([k, m]) => [k, k === "manual" ? "✋ I'll tick it" : String(m.label)]))}/>
      {add.metric !== "manual" && <Field value={String(add.target)} onChangeText={t => setAdd(a => a && { ...a, target: t })} keyboardType="numeric" placeholder="Target number"/>}
      <DateField value={add.date} onChange={d => setAdd(a => a && { ...a, date: d })} placeholder="Target date (optional)" allowClear/>
      <Line><Btn title="Add step" style={{ flex: 1 }} disabled={String(add.title).trim().length < 2} onPress={() => void api<Row>("/roadmap/items", "POST", {
        title: String(add.title).trim(), phase: add.phase, area: add.area, metric: add.metric, ...(add.metric !== "manual" && add.target ? { target_value: Number(add.target) } : {}),
        ...(add.date ? { target_date: add.date } : {}) }).then(r => { setV(r); setAdd(null); onNotice("＋ Step added"); }).catch(e => onError(msg(e)))}/>
        <Btn kind="link" title="Cancel" onPress={() => setAdd(null)}/></Line>
    </Card>}
    <Btn kind="link" title="Rebuild roadmap from my money plan (keeps finished steps)" onPress={() => Alert.alert("Rebuild?", "Unfinished steps are replaced with fresh ones from your current numbers.",
      [{ text: "Cancel", style: "cancel" }, { text: "Rebuild", onPress: () => void api<Row>("/roadmap/generate", "POST", { replace: true }).then(r => { setV(r); onNotice("🧭 Rebuilt"); }).catch(e => onError(msg(e))) }])}/>
    <Muted small>Progress is measured from your records (Finance, Day tracker, Gym, Sleep, Money check-in, Job tracker). Badge colours: green done, blue on track, amber behind, red late.</Muted>
    <Badge tone="muted">{`Values now: debt ${show(v.values.debt_total ?? null, "money")} · emergency ${show(v.values.emergency_amount ?? null, "money")} · learning ${v.values.learning_hours_week ?? 0} h · workouts ${v.values.workouts_week ?? 0}`}</Badge>
  </Screen>;
}
