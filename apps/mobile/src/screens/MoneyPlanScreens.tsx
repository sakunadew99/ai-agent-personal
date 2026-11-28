/**
 * Money plan: your real numbers (net worth to $1M, savings rate, emergency fund, leaks), debt payoff, payday split,
 * income streams + freelance pipeline + skills/salary ladder, 90-day income sprint, idea check and the life roadmap.
 * All maths is on the server in plain code; Sakuna never moves, pays or invests money.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Alert, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { LineChart, Meter } from "../charts";
import { schedulePayday } from "../notify";
import { Badge, Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const n = (v: unknown) => Number(v || 0);
const fmt = (v: unknown, cur = "LKR") => `${cur} ${Math.round(n(v)).toLocaleString()}`;
const AREA: Record<string, string> = { money: "💰", learn: "📚", earn: "💼", career: "🚀", health: "💪" };

export function usePlan(api: Api, onError: (m: string) => void) {
  const [v, setV] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/money/plan").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  return [v, load, setV] as const;
}

// ===================================================================================================================== setup

function SetupCard({ api, onError, onNotice, onDone, initial }: Props & { onDone: (v: Row) => void; initial?: Row }) {
  const fixed0 = Object.entries((initial?.fixed as Record<string, string>) || { boarding: "" });
  const [salary, setSalary] = useState(String(initial?.salary || ""));
  const [payday, setPayday] = useState(String(initial?.payday || "25"));
  const [fixed, setFixed] = useState<[string, string][]>(fixed0.length ? fixed0 : [["boarding", ""]]);
  const [food, setFood] = useState(String(initial?.food_transport || ""));
  const [debts, setDebts] = useState<Row[]>([{ name: "Credit card", balance: "", apr_pct: "", min_payment: "", due_day: "" }]);
  const num = (s: string) => Number(String(s).replace(/,/g, "")) || 0;
  const save = () => {
    if (!num(salary)) { onError("Enter your monthly salary"); return; }
    void api<Row>("/money/setup", "POST", {
      salary: num(salary), currency: "LKR", payday: Math.min(31, Math.max(1, num(payday) || 25)), food_transport: num(food),
      fixed: Object.fromEntries(fixed.filter(([k, x]) => k.trim() && num(x) > 0).map(([k, x]) => [k.trim(), num(x)])),
      debts: debts.filter(d => num(d.balance) > 0).map(d => ({ name: String(d.name || "Debt"), balance: num(d.balance),
        ...(num(d.apr_pct) ? { apr_pct: num(d.apr_pct) } : {}), ...(num(d.min_payment) ? { min_payment: num(d.min_payment) } : {}), ...(num(d.due_day) ? { due_day: num(d.due_day) } : {}) })),
      envelopes: true,
    }).then(r => { onNotice("💰 Money plan ready"); onDone(r); }).catch(e => onError(msg(e)));
  };
  return <Card style={{ gap: 8 }}>
    <Kicker>💰 SET UP YOUR MONEY PLAN (2 MINUTES)</Kicker>
    <Muted small>Your own numbers; you can change them any time. Nothing is sent anywhere.</Muted>
    <Line><View style={{ flex: 2 }}><Field label="Monthly salary (LKR)" value={salary} onChangeText={setSalary} keyboardType="numeric" placeholder="100000"/></View>
      <View style={{ flex: 1 }}><Field label="Payday (day)" value={payday} onChangeText={setPayday} keyboardType="numeric" placeholder="25"/></View></Line>
    <Text style={{ color: C.text, fontWeight: "800", marginTop: 4 }}>Fixed costs each month</Text>
    {fixed.map(([k, x], i) => <Line key={i}><View style={{ flex: 1.4 }}><Field value={k} onChangeText={t => setFixed(f => f.map((r, j) => j === i ? [t, r[1]] : r))} placeholder="e.g. boarding"/></View>
      <View style={{ flex: 1 }}><Field value={x} onChangeText={t => setFixed(f => f.map((r, j) => j === i ? [r[0], t] : r))} keyboardType="numeric" placeholder="6500"/></View></Line>)}
    <Btn kind="link" title="＋ Another fixed cost (phone, gym, family…)" onPress={() => setFixed(f => [...f, ["", ""]])}/>
    <Field label="Food + transport a month (estimate)" value={food} onChangeText={setFood} keyboardType="numeric" placeholder="30000"/>
    <Text style={{ color: C.text, fontWeight: "800", marginTop: 4 }}>Debts (credit card, loans)</Text>
    {debts.map((d, i) => <View key={i} style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}>
      <Line><View style={{ flex: 1.3 }}><Field value={String(d.name)} onChangeText={t => setDebts(x => x.map((r, j) => j === i ? { ...r, name: t } : r))} placeholder="Credit card"/></View>
        <View style={{ flex: 1 }}><Field value={String(d.balance)} onChangeText={t => setDebts(x => x.map((r, j) => j === i ? { ...r, balance: t } : r))} keyboardType="numeric" placeholder="40000"/></View></Line>
      <Line><View style={{ flex: 1 }}><Field value={String(d.apr_pct)} onChangeText={t => setDebts(x => x.map((r, j) => j === i ? { ...r, apr_pct: t } : r))} keyboardType="numeric" placeholder="Interest % (e.g. 28)"/></View>
        <View style={{ flex: 1 }}><Field value={String(d.min_payment)} onChangeText={t => setDebts(x => x.map((r, j) => j === i ? { ...r, min_payment: t } : r))} keyboardType="numeric" placeholder="Minimum"/></View>
        <View style={{ flex: 0.8 }}><Field value={String(d.due_day)} onChangeText={t => setDebts(x => x.map((r, j) => j === i ? { ...r, due_day: t } : r))} keyboardType="numeric" placeholder="Due day"/></View></Line>
    </View>)}
    <Btn kind="link" title="＋ Another debt" onPress={() => setDebts(x => [...x, { name: "", balance: "", apr_pct: "", min_payment: "", due_day: "" }])}/>
    <Btn title="Build my money plan" onPress={save}/>
  </Card>;
}

// ===================================================================================================================== my plan

export function MoneyPlan({ api, onError, onNotice }: Props) {
  const [v, load, setV] = usePlan(api, onError);
  const [edit, setEdit] = useState(false);
  const [spent, setSpent] = useState(""); const [act, setAct] = useState(false);
  const [open, setOpen] = useState(0);
  if (!v) return <Empty>Adding up your money…</Empty>;
  if (!v.setup_done || edit) return <SetupCard api={api} onError={onError} onNotice={onNotice} initial={v.setup} onDone={r => { setV(r); setEdit(false); }}/>;
  const cur = String(v.currency);
  const nw = v.net_worth as Row, em = v.emergency as Row, sr = v.savings_rate as Row, debt = v.debt as Row, ck = v.checkin as Row;
  const hist = (nw.history as Row[]) || [];
  const addTask = (text: string) => void api("/tasks", "POST", { title: text.slice(0, 200), priority: "medium", category: "career" })
    .then(() => onNotice("＋ Added to your tasks")).catch(e => onError(msg(e)));
  return <View style={{ gap: 12 }}>
    {/* 1. progress to $1M */}
    <View style={{ borderRadius: 22, padding: 16, backgroundColor: "#00c853", gap: 4 }}>
      <Text style={{ color: "#ffffffcc", fontSize: 11, fontWeight: "900", letterSpacing: 1 }}>NET WORTH · TOWARDS $1M</Text>
      <Text style={{ color: "#fff", fontSize: 30, fontWeight: "900" }}>{fmt(nw.amount, cur)}</Text>
      <Text style={{ color: "#fff", fontWeight: "700" }}>{`≈ $${n(nw.usd).toLocaleString()} · ${n(nw.progress_pct).toFixed(2)}% of $1M`}</Text>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: "#ffffff44", marginTop: 4 }}><View style={{ width: `${Math.max(1, Math.min(100, n(nw.progress_pct)))}%`, height: 8, borderRadius: 4, backgroundColor: "#fff" }}/></View>
      <Text style={{ color: "#ffffffdd", fontSize: 12 }}>{v.million.years ? `At your saving now (~$${v.million.monthly_saving_usd}/month): $1M in about ${v.million.years} years. More income shortens it.` : "Save something every month to start the clock."}</Text>
    </View>
    {hist.length > 1 && <Card><Kicker>NET WORTH BY MONTH</Kicker><LineChart series={[{ values: hist.map(h => n(h.net_worth)), color: C.green, name: "net worth" }]} labels={hist.map(h => String(h.month).slice(5))} format={x => `${Math.round(x / 1000)}k`}/></Card>}
    {/* 19. daily money check-in */}
    <Card style={{ gap: 8, borderColor: ck.done_today ? C.green : C.amber }}>
      <Line><Kicker>{`⏱ 10-SECOND MONEY CHECK-IN · 🔥 ${ck.streak}`}</Kicker><View style={{ flex: 1 }}/>{ck.done_today && <Badge>done today ✓</Badge>}</Line>
      {!ck.done_today ? <>
        <Field value={spent} onChangeText={setSpent} keyboardType="numeric" placeholder={`Spent today (${cur})`}/>
        <Line><Text style={{ color: C.text, flex: 1 }}>I did one income action today (proposal, skill, portfolio)</Text><Switch value={act} onValueChange={setAct}/></Line>
        <Btn title="Check in (+2 pts)" onPress={() => void api<Row>("/money/checkin", "POST", { spent: Number(spent) || null, income_action: act }).then(() => { onNotice("✓ Money check-in"); load(); }).catch(e => onError(msg(e)))}/>
      </> : <Muted small>{`${ck.income_actions_week}/7 days with an income action this week.`}</Muted>}
    </Card>
    {/* this month + 2. savings rate + 3. emergency */}
    <Card style={{ gap: 6 }}><Kicker>{`THIS MONTH · ${v.month}`}</Kicker>
      <Line><Muted>Income</Muted><View style={{ flex: 1 }}/><Text style={{ color: C.green, fontWeight: "800" }}>{fmt(v.this_month.income, cur)}</Text></Line>
      <Line><Muted>Spent</Muted><View style={{ flex: 1 }}/><Text style={{ color: C.red, fontWeight: "800" }}>{fmt(v.this_month.spending, cur)}</Text></Line>
      <Line><Muted>Left</Muted><View style={{ flex: 1 }}/><Text style={{ color: C.text, fontWeight: "900" }}>{fmt(v.this_month.left, cur)}</Text></Line>
      <Meter label={`Savings rate (last full month) · target ${sr.target_pct}%`} value={Math.max(0, n(sr.last_full_month_pct))} right={sr.last_full_month_pct == null ? "log a full month" : `${sr.last_full_month_pct}%`}
        color={n(sr.last_full_month_pct) >= 30 ? C.green : C.amber}/>
      <Meter label={`Emergency fund · ${fmt(em.have, cur)} of ${fmt(em.target_amount, cur)}`} value={Math.min(100, n(em.months) / 6 * 100)} right={`${em.months} / 6 months`} color={C.blue}/>
      <Muted small>{`From ${v.income_from}. Needs ≈ ${fmt(v.needs_month, cur)} a month.`}</Muted>
    </Card>
    {/* 13. payday split */}
    <Card style={{ gap: 6 }}><Kicker>{`💸 PAYDAY PLAN · PAY YOURSELF FIRST${v.payday_day ? ` · DAY ${v.payday_day}` : ""}`}</Kicker>
      {(v.payday.parts as Row[]).map(p => <Line key={p.label}><Text style={{ color: C.text, flex: 1 }}>{p.label}</Text><Text style={{ color: C.text, fontWeight: "800" }}>{fmt(p.amount, cur)}</Text></Line>)}
      <Muted small>{v.payday.note}</Muted>
      {!!v.payday_day && <Btn kind="outline" title="🔔 Remind me every payday" onPress={() => void schedulePayday(Number(v.payday_day),
        (v.payday.parts as Row[]).filter(p => !String(p.label).startsWith("needs")).map(p => `${p.label}: ${fmt(p.amount, cur)}`).join(" · ")).then(ok => ok ? onNotice(`🔔 Payday reminder set for day ${v.payday_day}, 09:00`) : onError("Allow notifications first"))}/>}
    </Card>
    {/* debt summary */}
    {(debt.debts as Row[]).length > 0 && <Card style={{ gap: 6, borderColor: C.red }}><Kicker>{`💳 DEBT · ${fmt(debt.total, cur)}`}</Kicker><Text style={{ color: C.text, lineHeight: 20 }}>{debt.advice}</Text>
      <Muted small>Open the 💳 Debt tab for the full payoff plan and to enter your real interest rate.</Muted></Card>}
    {/* 4. leaks */}
    {(v.leaks as Row[]).length > 0 && <Card style={{ gap: 6 }}><Kicker>🔍 LEAK FINDER</Kicker>{(v.leaks as Row[]).map(l => <View key={l.what}>
      <Line><Text style={{ color: C.text, flex: 1, textTransform: "capitalize" }}>{l.what}</Text><Text style={{ color: C.amber, fontWeight: "800" }}>{fmt(l.amount, cur)}</Text></Line>
      <Muted small>{`Cut a bit → save ${fmt(l.cut_20pct_year, cur)} a year${l.months_sooner ? `, $1M about ${l.months_sooner} months sooner` : ""}.`}</Muted></View>)}</Card>}
    {/* 17. freedom number + 18. milestones */}
    <Card style={{ gap: 6 }}><Kicker>🕊 FREEDOM NUMBER</Kicker>
      <Text style={{ color: C.text }}>{`Side income ${fmt(v.freedom.side_income_month, cur)} a month covers ${v.freedom.covers_pct}% of your costs (${fmt(v.freedom.monthly_cost, cur)}).`}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>{(v.milestones as Row[]).map(m => <Badge key={m.usd} tone={m.reached ? "green" : "muted"}>{`${m.reached ? "🏆" : "🔒"} ${m.label}`}</Badge>)}</View>
    </Card>
    {/* 14. investing steps + 16. rupee */}
    <Card style={{ gap: 6 }}><Kicker>📈 INVESTING, IN THIS ORDER</Kicker>{(v.invest_steps as Row[]).map((s, i) => <View key={s.step} style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: s.done ? C.green : C.muted, fontWeight: "900" }}>{s.done ? "✓" : `${i + 1}.`}</Text><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{s.step}</Text><Muted small>{s.why}</Muted></View></View>)}
      <Muted small>{`Rupee view: $1M is ${fmt(v.rupee.lkr_needed_now)} today and about ${fmt(v.rupee.lkr_needed_then)} in ${v.rupee.years} years. ${v.rupee.lesson} (${v.rupee.assumptions})`}</Muted>
    </Card>
    {/* life roadmap */}
    <Card style={{ gap: 8 }}><Kicker>🧭 YOUR LIFE UPGRADE ROADMAP</Kicker>
      {(v.roadmap as Row[]).map((ph, i) => <View key={ph.phase} style={{ gap: 6 }}>
        <TouchableOpacity onPress={() => setOpen(o => (o === i ? -1 : i))}><Line><Text style={{ color: i === 0 ? C.green : C.text, fontWeight: "900", flex: 1 }}>{`${ph.phase}: ${ph.focus}`}</Text><Text style={{ color: C.muted }}>{open === i ? "▴" : "▾"}</Text></Line></TouchableOpacity>
        {open === i && (ph.items as Row[]).map(it => <View key={it.text} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 12, backgroundColor: C.panel2 }}>
          <Text style={{ fontSize: 16 }}>{AREA[it.area] || "•"}</Text><Text style={{ color: C.text, flex: 1, lineHeight: 19 }}>{it.text}</Text>
          <TouchableOpacity onPress={() => addTask(String(it.text))}><Text style={{ color: C.green, fontWeight: "900" }}>＋ Task</Text></TouchableOpacity></View>)}
      </View>)}
    </Card>
    <Muted small>Want this roadmap checked every day, with weekly, monthly and yearly reports? Open Hubs → Today & plan → 🧭 Life roadmap.</Muted>
    <Card style={{ gap: 4 }}><Kicker>📚 MONEY MINDSET READING</Kicker>{(v.books as string[]).map(b => <Text key={b} style={{ color: C.text }}>{`• ${b}`}</Text>)}
      <Muted small>Money affirmations: Mindset studio → 💰 Money mindset.</Muted></Card>
    <Btn kind="outline" title="✏️ Change salary, costs or debts" onPress={() => setEdit(true)}/>
    <Muted small>{v.disclaimer}</Muted>
  </View>;
}

// ===================================================================================================================== debt

export function DebtTab({ api, onError, onNotice }: Props) {
  const [v, load] = usePlan(api, onError);
  const [editing, setEditing] = useState<Row | null>(null);
  const [nw, setNw] = useState<Row>({ name: "", amount: "" });
  if (!v) return <Empty>Loading your debts…</Empty>;
  const d = v.debt as Row, cur = String(v.currency);
  const save = () => { if (!editing) return;
    void api(`/finance/liabilities/${editing.id}`, "PATCH", { amount: Number(editing.balance) || 0, ...(Number(editing.apr_pct) ? { apr_pct: Number(editing.apr_pct) } : {}),
      ...(Number(editing.min_payment) ? { min_payment: Number(editing.min_payment) } : {}), ...(Number(editing.due_day) ? { due_day: Number(editing.due_day) } : {}) })
      .then(() => { setEditing(null); onNotice("Saved"); load(); }).catch(e => onError(msg(e))); };
  const plan = (k: string, label: string) => { const p = d[k] as Row; return <View key={k} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: C.panel2, gap: 2 }}>
    <Text style={{ color: C.muted, fontSize: 11, fontWeight: "800" }}>{label}</Text>
    <Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{p.months == null ? "50+ mo" : `${p.months} mo`}</Text>
    <Text style={{ color: C.red, fontSize: 12 }}>{`interest ${fmt(p.interest, cur)}`}</Text></View>; };
  return <View style={{ gap: 12 }}>
    {(d.debts as Row[]).length === 0 ? <Card><Text style={{ color: C.green, fontWeight: "900" }}>🎉 No debt recorded.</Text><Muted small>Keep any card for planned spending you pay in full every month.</Muted></Card> : <>
      <Card style={{ gap: 6, borderColor: C.red }}><Kicker>{`💳 TOTAL ${fmt(d.total, cur)} · MINIMUMS ${fmt(d.minimums, cur)}/MONTH`}</Kicker><Text style={{ color: C.text, lineHeight: 20 }}>{d.advice}</Text></Card>
      <Card style={{ gap: 8 }}><Kicker>{`PAYOFF PLANS · ${fmt(d.monthly_budget, cur)} A MONTH`}</Kicker>
        <View style={{ flexDirection: "row", gap: 8 }}>{plan("avalanche", "🏔 Highest interest first")}{plan("snowball", "⛄ Smallest first")}{plan("minimum_only", "🐢 Minimums only")}</View>
        <Muted small>Highest interest first saves the most money; smallest first gives quick wins. Both beat paying only the minimum.</Muted></Card>
      {(d.debts as Row[]).map(x => <Card key={x.id} style={{ gap: 6 }}>
        <Line><Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>{x.name}</Text><Text style={{ color: C.red, fontWeight: "900" }}>{fmt(x.balance, cur)}</Text></Line>
        <Muted small>{`${x.apr_pct}% a year${x.apr_assumed ? " (assumed: enter your real rate)" : ""} · ≈ ${fmt(x.interest_per_month, cur)} interest a month · minimum ${fmt(x.min_payment, cur)}${x.min_assumed ? " (assumed)" : ""}${x.due_day ? ` · due day ${x.due_day}` : ""}`}</Muted>
        {editing && editing.id === x.id ? <View style={{ gap: 6 }}>
          <Line><View style={{ flex: 1 }}><Field label="Balance" value={String(editing.balance)} onChangeText={t => setEditing(e => e && { ...e, balance: t })} keyboardType="numeric"/></View>
            <View style={{ flex: 1 }}><Field label="Interest % / year" value={String(editing.apr_pct)} onChangeText={t => setEditing(e => e && { ...e, apr_pct: t })} keyboardType="numeric"/></View></Line>
          <Line><View style={{ flex: 1 }}><Field label="Minimum" value={String(editing.min_payment)} onChangeText={t => setEditing(e => e && { ...e, min_payment: t })} keyboardType="numeric"/></View>
            <View style={{ flex: 1 }}><Field label="Due day" value={String(editing.due_day || "")} onChangeText={t => setEditing(e => e && { ...e, due_day: t })} keyboardType="numeric"/></View></Line>
          <Line><Btn title="Save" onPress={save} style={{ flex: 1 }}/><Btn kind="link" title="Cancel" onPress={() => setEditing(null)}/></Line></View>
          : <Line><Btn kind="outline" title="✏️ Update" onPress={() => setEditing({ ...x })} style={{ flex: 1 }}/>
            <Btn kind="link" title="Paid off 🎉" onPress={() => Alert.alert("Paid off?", `Remove ${x.name} from your debts?`, [{ text: "Cancel", style: "cancel" },
              { text: "Yes, paid off", onPress: () => void api(`/finance/liabilities/${x.id}`, "DELETE").then(() => { onNotice(`🎉 ${x.name} paid off!`); load(); }).catch(e => onError(msg(e))) }])}/></Line>}
      </Card>)}
    </>}
    <Card style={{ gap: 6 }}><Kicker>＋ ADD A DEBT</Kicker>
      <Line><View style={{ flex: 1.3 }}><Field value={String(nw.name)} onChangeText={t => setNw({ ...nw, name: t })} placeholder="Name (e.g. Personal loan)"/></View>
        <View style={{ flex: 1 }}><Field value={String(nw.amount)} onChangeText={t => setNw({ ...nw, amount: t })} keyboardType="numeric" placeholder="Balance"/></View></Line>
      <Btn kind="outline" title="Add" disabled={!String(nw.name).trim() || !Number(nw.amount)} onPress={() => void api("/finance/liabilities", "POST", { name: String(nw.name).trim(), amount: Number(nw.amount), currency: cur,
        category: /card/i.test(String(nw.name)) ? "credit card" : "loan" }).then(() => { setNw({ name: "", amount: "" }); load(); }).catch(e => onError(msg(e)))}/>
    </Card>
  </View>;
}

// ===================================================================================================================== income

export function IncomeTab({ api, onError, onNotice }: Props) {
  const [v, load] = usePlan(api, onError);
  const [name, setName] = useState(""); const [logFor, setLogFor] = useState<string | null>(null);
  const [mins, setMins] = useState("60"); const [earned, setEarned] = useState("");
  const [idea, setIdea] = useState(""); const [check, setCheck] = useState<Row | null>(null);
  if (!v) return <Empty>Loading your income…</Empty>;
  const cur = String(v.currency), st = v.streams as Row, pl = v.pipeline as Row, sk = v.skills as Row, sp = v.sprint as Row | null;
  return <View style={{ gap: 12 }}>
    {/* 6. income streams */}
    <Card style={{ gap: 8 }}><Kicker>{`💼 INCOME STREAMS · SIDE ${fmt(st.side_income_per_month, cur)}/MONTH`}</Kicker>
      {(st.streams as Row[]).length === 0 && <Muted small>Add each way you earn (job, a gig, tutoring…). Log hours to see your real money per hour.</Muted>}
      {(st.streams as Row[]).map(s => <View key={s.id} style={{ gap: 4, padding: 10, borderRadius: 12, backgroundColor: C.panel2 }}>
        <Line><Text style={{ color: C.text, fontWeight: "900", flex: 1 }}>{s.name}</Text><Text style={{ color: C.green, fontWeight: "800" }}>{s.per_hour != null ? `${fmt(s.per_hour, cur)}/h` : "—"}</Text></Line>
        <Muted small>{`${s.hours_90d} h · ${fmt(s.earned_90d, cur)} in 90 days · ${s.verdict}`}</Muted>
        {logFor === s.id ? <Line><View style={{ flex: 1 }}><Field value={mins} onChangeText={setMins} keyboardType="numeric" placeholder="Minutes"/></View>
          <View style={{ flex: 1 }}><Field value={earned} onChangeText={setEarned} keyboardType="numeric" placeholder={`Earned (${cur})`}/></View>
          <Btn title="Log" onPress={() => void api(`/money/streams/${s.id}/logs`, "POST", { minutes: Number(mins) || 0, ...(Number(earned) ? { earned: Number(earned) } : {}) })
            .then(() => { setLogFor(null); setEarned(""); load(); }).catch(e => onError(msg(e)))}/></Line>
          : <Btn kind="link" title="⏱ Log hours / money" onPress={() => setLogFor(String(s.id))}/>}
      </View>)}
      <Line><View style={{ flex: 1 }}><Field value={name} onChangeText={setName} placeholder="New stream, e.g. Power BI gigs"/></View>
        <Btn kind="outline" title="Add" disabled={!name.trim()} onPress={() => void api("/money/streams", "POST", { name: name.trim(), kind: "freelance" }).then(() => { setName(""); load(); }).catch(e => onError(msg(e)))}/></Line>
    </Card>
    {/* 7-8. pipeline + rate coach */}
    <Card style={{ gap: 6 }}><Kicker>📋 FREELANCE PIPELINE</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{Object.entries(pl.stages as Record<string, number>).map(([k, x]) => <Badge key={k} tone={k === "paid" ? "green" : k === "lost" ? "red" : "muted"}>{`${k} ${x}`}</Badge>)}</View>
      <Muted small>{`Win rate ${pl.win_rate_pct ?? "—"}% · average project ${pl.avg_value ?? "—"} · waiting to be paid ${pl.money_waiting}`}</Muted>
      {!!pl.rate_tip && <Text style={{ color: C.amber, fontWeight: "700" }}>{`💡 ${pl.rate_tip}`}</Text>}
      <Muted small>{`${pl.rule} Add projects in Freelancing kit / Job tracker.`}</Muted>
    </Card>
    {/* 12. 90-day sprint + 11. money hour */}
    <Card style={{ gap: 8 }}><Kicker>🏃 90-DAY INCOME SPRINT</Kicker>
      {sp ? <>
        <Text style={{ color: C.text, fontWeight: "900" }}>{`${sp.title} · week ${sp.week_now}/13 · ${sp.done_count} done`}</Text>
        {(sp.weeks as Row[]).map(w => <TouchableOpacity key={w.week} onPress={() => void api("/money/sprint/week", "PATCH", { week: w.week, done: !w.done }).then(load).catch(e => onError(msg(e)))}
          style={{ flexDirection: "row", gap: 8, padding: 8, borderRadius: 10, backgroundColor: w.current ? `${C.green}22` : "transparent" }}>
          <Text style={{ color: w.done ? C.green : C.muted, fontWeight: "900", width: 22 }}>{w.done ? "✓" : `${w.week}`}</Text>
          <Text style={{ color: w.done ? C.muted : C.text, flex: 1, textDecorationLine: w.done ? "line-through" : "none" }}>{w.goal}</Text></TouchableOpacity>)}
      </> : <><Muted small>Pick one idea and give it 90 days: a goal for every week (+15 pts each).</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(sk.best_ideas as Row[]).slice(0, 4).map(b => {
          return <TouchableOpacity key={b.idea} onPress={() => void api("/money/sprint", "POST", { idea_id: b.id }).then(() => { onNotice("🏃 Sprint started"); load(); }).catch(e => onError(msg(e)))}
            style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: C.green }}><Text style={{ color: C.text, fontSize: 12 }}>{`${b.idea} · ${b.fit_pct}% fit`}</Text></TouchableOpacity>; })}</View></>}
      <Btn kind="outline" title="💰 Add a weekly money hour (Saturday 10:00)" onPress={() => void api<Row>("/money/money-hour", "POST", { weekday: "SA", time: "10:00" }).then(r => onNotice(`Added: ${r.title}`)).catch(e => onError(msg(e)))}/>
    </Card>
    {/* 9-10. skills + salary ladder */}
    <Card style={{ gap: 6 }}><Kicker>🧠 SKILLS THAT UNLOCK MORE MONEY</Kicker>
      {(sk.next_skills as Row[]).length ? (sk.next_skills as Row[]).map(s => <Line key={s.skill}><Text style={{ color: C.text, flex: 1, textTransform: "capitalize" }}>{`📚 ${s.skill}`}</Text><Muted small>{`up to $${s.unlocks_usd_month}/mo in ideas`}</Muted></Line>)
        : <Muted small>Add your skills in Settings / Skills to see this.</Muted>}
      <Kicker>🪜 SALARY LADDER</Kicker>
      {(sk.salary_ladder as Row[]).map(r => <View key={r.role} style={{ gap: 2 }}>
        <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{r.role}</Text><Badge tone={r.ready_pct >= 60 ? "green" : "muted"}>{`${r.ready_pct}% ready`}</Badge></Line>
        <Muted small>{`LK ${fmt(r.lk_lkr[0])}–${Math.round(r.lk_lkr[1] / 1000)}k · remote $${r.remote_usd[0]}–${r.remote_usd[1]}/mo · Germany €${Math.round(r.germany_eur_year[0] / 1000)}–${Math.round(r.germany_eur_year[1] / 1000)}k/yr${(r.missing as string[]).length ? ` · learn: ${(r.missing as string[]).join(", ")}` : ""}`}</Muted></View>)}
      <Muted small>{sk.note}</Muted>
    </Card>
    {/* 24-25. idea check */}
    <Card style={{ gap: 6 }}><Kicker>🔬 CHECK AN IDEA (AND SCAM SIGNS)</Kicker>
      <TextInput value={idea} onChangeText={setIdea} multiline placeholder="e.g. Power BI dashboards for small shops in Colombo" placeholderTextColor={C.muted}
        style={{ color: C.text, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 10, minHeight: 60, textAlignVertical: "top" }}/>
      <Btn title="Check it" disabled={idea.trim().length < 3} onPress={() => void api<Row>("/money/validate", "POST", { idea: idea.trim(), cost_lkr: 0, hours_week: 6, ai: true }).then(setCheck).catch(e => onError(msg(e)))}/>
      {check && <View style={{ gap: 4 }}><Text style={{ color: check.score >= 70 ? C.green : check.score >= 45 ? C.amber : C.red, fontWeight: "900", fontSize: 16 }}>{`${check.score}/100 · ${check.verdict}`}</Text>
        {(check.tips as string[]).map(t => <Text key={t} style={{ color: C.text }}>{`• ${t}`}</Text>)}
        {!!check.explanation && <Text style={{ color: C.muted, lineHeight: 19 }}>{check.explanation}</Text>}</View>}
    </Card>
  </View>;
}
