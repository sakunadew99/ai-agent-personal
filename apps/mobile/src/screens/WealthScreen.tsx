import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Hero, LineChart, Ring, Segments } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const short = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const SC_COLOR: Record<string, string> = { conservative: C.blue, realistic: C.green, ambitious: C.amber };
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line, fontSize: 16, fontWeight: "800" } as const;

function Million({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [m, setM] = useState<Row | null>(null);
  const [saving, setSaving] = useState(""); const [rate, setRate] = useState(""); const [goalYears, setGoalYears] = useState(15);
  const load = useCallback((yrs: number = goalYears) => {
    const q = [saving && `monthly_saving_lkr=${Number(saving)}`, rate && `usd_lkr=${Number(rate)}`, `target_years=${yrs}`].filter(Boolean).join("&");
    api<Row>(`/money/million${q ? `?${q}` : ""}`).then(x => { setM(x); if (!rate) setRate(String(x.usd_lkr)); if (!saving) setSaving(String(x.monthly_saving_lkr)); }).catch(e => onError(msg(e)));
  }, [api, onError, saving, rate, goalYears]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return <Empty>Calculating your journey…</Empty>;
  const sc: Row[] = m.scenarios;
  const years = (sc[0].path as Row[]).map(p => p.year);
  return <View style={{ gap: 14 }}>
    <Hero kicker="$1M FINANCIAL FREEDOM JOURNEY" title={usd(m.current_usd)} accent="today" color={C.green}
      sub={`≈ Rs ${Number(m.current_lkr).toLocaleString()} at ${m.usd_lkr} LKR/USD (${m.rate_source})${(m.not_counted as string[]).length ? ` · not counted: ${(m.not_counted as string[]).join(", ")}` : ""}`}
      right={<Ring value={Math.max(1, m.progress_pct)} size={92} label={`${m.progress_pct < 1 ? m.progress_pct.toFixed(2) : Math.round(m.progress_pct)}%`} sub="OF $1M"/>}>
      <Line><View style={{ flex: 1, gap: 4 }}><Muted small>Monthly saving (LKR)</Muted><TextInput style={input} value={saving} onChangeText={setSaving} keyboardType="number-pad"/></View>
        <View style={{ flex: 1, gap: 4 }}><Muted small>LKR per USD</Muted><TextInput style={input} value={rate} onChangeText={setRate} keyboardType="decimal-pad"/></View></Line>
      <Btn kind="outline" title="↻ Recalculate" onPress={() => load()}/>
      <Muted small>{`Saving: ${m.monthly_saving_source}`}</Muted>
    </Hero>
    <Card><Kicker>3 SCENARIOS · NEXT 40 YEARS</Kicker>
      <LineChart series={sc.map(s => ({ name: s.label, color: SC_COLOR[s.key], values: (s.path as Row[]).map(p => p.value) }))}
        labels={years.map((y: number) => (y % 10 === 0 ? `${y}y` : ""))} height={160} format={n => short(n)}/>
      {sc.map(s => <Line key={s.key}><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: SC_COLOR[s.key] }}/>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{`${s.label}: ${s.years_to_target != null ? `$1M in ${s.years_to_target} years` : "not within 50 years"}`}</Text>
          <Muted small>{`${s.return_pct}% return · savings +${s.saving_growth_pct}%/year · ${s.note}`}</Muted></View></Line>)}
    </Card>
    <Card><Kicker>MONTHLY SAVING NEEDED (START), REALISTIC</Kicker>
      <Line>{["10", "15", "20"].map(y => { const need = sc[1].needed_monthly_usd[y];
        return <View key={y} style={{ flex: 1, backgroundColor: C.panel2, borderRadius: 14, padding: 10 }}>
          <Text style={{ color: C.muted, fontSize: 11 }}>{`in ${y} years`}</Text><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{usd(need)}</Text>
          <Muted small>{`Rs ${Math.round(need * m.usd_lkr).toLocaleString()}`}</Muted></View>; })}</Line>
    </Card>
    {m.roadmap && <Card style={{ gap: 8 }}><Kicker>{`ROADMAP · $1M IN ${m.roadmap.target_years} YEARS (${String(m.roadmap.scenario).toUpperCase()})`}</Kicker>
      <Line>{[10, 15, 20, 25].map(y => <TouchableOpacity key={y} onPress={() => { setGoalYears(y); load(y); }} style={{ flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 10,
        borderWidth: 1, borderColor: goalYears === y ? C.green : C.line }}><Text style={{ color: goalYears === y ? C.green : C.muted, fontWeight: "800" }}>{`${y} yrs`}</Text></TouchableOpacity>)}</Line>
      <Muted small>{`On-track saving now: ${usd(m.roadmap.needed_monthly_usd)}/month (Rs ${Number(m.roadmap.needed_monthly_lkr).toLocaleString()}). You: ${usd(m.roadmap.your_monthly_usd)}/month.`}</Muted>
      {(m.roadmap.steps as Row[]).map(st => <View key={st.year} style={{ backgroundColor: C.panel2, borderRadius: 14, padding: 10, gap: 3 }}>
        <Line><Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>{`Year ${st.year}`}</Text><Text style={{ color: st.status === "on track" ? C.green : C.amber, fontWeight: "800" }}>{st.status}</Text></Line>
        <Muted small>{`On track: ${usd(st.on_track_usd)} (Rs ${Number(st.on_track_lkr).toLocaleString()}) · your path: ${usd(st.your_path_usd)}`}</Muted>
        <Muted small>{`Save ${usd(st.save_per_month_usd)}/month (Rs ${Number(st.save_per_month_lkr).toLocaleString()}) · income ≈ ${usd(st.income_per_month_usd_at_30pct)}/month at 30% saved`}</Muted>
        {(st.focus as string[]).map(f => <Text key={f} style={{ color: C.text, fontSize: 13 }}>{`• ${f}`}</Text>)}</View>)}
      <Muted small>{m.roadmap.how}</Muted></Card>}
    <Card><Kicker>MILESTONES</Kicker><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(m.milestones as Row[]).map(x => <Text key={x.label}
      style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, overflow: "hidden", color: x.reached ? C.greenDark : C.muted, backgroundColor: x.reached ? C.green : C.panel2, fontWeight: "800" }}>{`${x.reached ? "✓ " : ""}${x.label}`}</Text>)}</View></Card>
    <Card><Kicker>YOUR MONEY ACTIONS</Kicker>{Object.entries(m.actions as Record<string, string[]>).map(([k, v]) =>
      <View key={k} style={{ gap: 2 }}><Text style={{ color: C.green, fontWeight: "800", textTransform: "capitalize" }}>{k}</Text>{v.map((a, i) => <Text key={i} style={{ color: C.text }}>{`• ${a}`}</Text>)}</View>)}</Card>
    <Muted small>{m.disclaimer}</Muted>
  </View>;
}

function Ideas({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [o, setO] = useState<Row | null>(null);
  const [hours, setHours] = useState("8"); const [budget, setBudget] = useState("10000");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { api<Row>(`/opportunities?hours=${Number(hours) || 8}&budget_lkr=${Number(budget) || 0}`).then(setO).catch(e => onError(msg(e))); }, [api, onError, hours, budget]);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const makeGoal = (x: Row) => void api<Row>("/dreams/propose", "POST", { dream: `Start ${x.title}`, horizon: "month", ai: false }).then(plan =>
    Alert.alert(`Start “${x.title}”?`, `Creates a 1-month goal with ${(plan.milestones as Row[]).length} milestones and the first step:\n“${x.first}”`, [{ text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => void api("/dreams/accept", "POST", { ...plan, next_action: x.first }).then(() => { onNotice("Goal created. Give it 90 days, then review."); load(); }).catch(e => onError(msg(e))) }]))
    .catch(e => onError(msg(e)));
  if (!o) return <Empty>Finding ideas that fit you…</Empty>;
  return <View style={{ gap: 12 }}>
    <Card><Kicker>WHAT YOU CAN GIVE IT</Kicker>
      <Line><View style={{ flex: 1, gap: 4 }}><Muted small>Hours per week</Muted><TextInput style={input} value={hours} onChangeText={setHours} keyboardType="number-pad"/></View>
        <View style={{ flex: 1, gap: 4 }}><Muted small>Starting budget (LKR)</Muted><TextInput style={input} value={budget} onChangeText={setBudget} keyboardType="number-pad"/></View></Line>
      <Btn kind="outline" title="↻ Rank for me" onPress={load}/>
      <Muted small>{o.known_skills.length ? `Using your skills: ${(o.known_skills as string[]).slice(0, 10).join(", ")}` : "Add skills in Jobs → career profile for a better match."}</Muted>
    </Card>
    {!!o.focus_warning && <Card style={{ borderColor: C.amber }}><Text style={{ color: C.amber, fontWeight: "800" }}>{`⚠ ${o.focus_warning}`}</Text></Card>}
    {(o.items as Row[]).map((x, i) => { const isOpen = open === x.id, col = x.fit >= 70 ? C.green : x.fit >= 45 ? C.amber : C.muted;
      return <TouchableOpacity key={x.id} activeOpacity={0.85} onPress={() => setOpen(isOpen ? null : x.id)}>
        <Card style={{ borderColor: i < 3 ? `${col}77` : C.line }}>
          <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 16, flex: 1 }}>{`${i < 3 ? "⭐ " : ""}${x.title}`}</Text><Text style={{ color: col, fontWeight: "900" }}>{`${x.fit}%`}</Text></Line>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: C.panel2 }}><View style={{ height: 6, borderRadius: 3, width: `${x.fit}%`, backgroundColor: col }}/></View>
          <Muted small>{`${x.what}`}</Muted>
          <Muted small>{`💸 Rs ${Number(x.cost_lkr).toLocaleString()} to start · ⏱ ${x.hours} h/week · ${"●".repeat(x.difficulty)}${"○".repeat(5 - x.difficulty)} difficulty`}</Muted>
          {isOpen && <View style={{ gap: 4 }}>
            <Text style={{ color: C.green }}>{`💰 ${x.income}`}</Text>
            {(x.why as string[]).map((w, k) => <Text key={k} style={{ color: C.text }}>{`✓ ${w}`}</Text>)}
            {(x.missing_skills as string[]).length > 0 && <Muted small>{`To learn: ${(x.missing_skills as string[]).join(", ")}`}</Muted>}
            <Text style={{ color: x.risk === "high_risk" ? C.amber : C.green, fontWeight: "800" }}>{x.risk === "high_risk" ? "⚠ Higher risk" : "🌱 Beginner-friendly"}</Text>
            <Muted small>{`Competition: ${x.competition} · learn ≈ ${x.learn_weeks} weeks · first income ≈ ${x.first_income_weeks} weeks`}</Muted>
            <Muted small>{`Risks: ${(x.risks as string[]).join(" · ")}`}</Muted>
            <Text style={{ color: C.amber, fontWeight: "800" }}>{`First action: ${x.first}`}</Text>
            <Btn title="🎯 Make it a goal" onPress={() => makeGoal(x)}/>
          </View>}
        </Card></TouchableOpacity>; })}
    <Muted small>{o.how}</Muted>
  </View>;
}

/** $1M journey (projections) and the income-opportunity finder. */
export function WealthScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [tab, setTab] = useState<"million" | "ideas">("million");
  return <Screen>
    <Segments options={["million", "ideas"] as const} value={tab} onChange={setTab} labels={{ million: "🚀 $1M journey", ideas: "💡 Income ideas" }}/>
    {tab === "million" ? <Million api={api} onError={onError}/> : <Ideas api={api} onError={onError} onNotice={onNotice}/>}
  </Screen>;
}
