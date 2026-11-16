import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { DateField } from "../pickers";
import { Hero, Meter, PALETTE, Ring, Segments, SplitBar, StatTile, TileRow } from "../charts";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const TABS = ["balance", "wishes", "buy"] as const;
const msg = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";
const fmt = (value: unknown, cur?: string) => value === null || value === undefined ? "—" : `${cur ? `${cur} ` : ""}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const clean = (v: string) => v.replace(/,/g, "").trim();

/** Balances, envelopes, wish list (cooling-off) and buy list. Manual only: never pays or transfers. */
export function MoneyListsScreen(props: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("balance");
  return <Screen>
    <Segments options={TABS} value={tab} onChange={setTab} labels={{ balance: "💳 Balance", wishes: "✨ Wishes", buy: "🛒 Buy list" }}/>
    {tab === "balance" && <Balance {...props}/>}
    {tab === "wishes" && <Wishes {...props}/>}
    {tab === "buy" && <Buy {...props}/>}
  </Screen>;
}

function Balance({ api, onError, onNotice }: Props) {
  const [view, setView] = useState<Row>({});
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [envelopes, setEnvelopes] = useState<Row[]>([]);
  const [name, setName] = useState(""); const [kind, setKind] = useState<"bank" | "cash" | "wallet" | "savings">("bank");
  const [cur, setCur] = useState("LKR"); const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState<string | null>(null); const [newBalance, setNewBalance] = useState("");
  const load = useCallback(() => {
    Promise.all([api<Row>("/money/balance"), api<Row[]>("/money/accounts"), api<Row[]>("/money/envelopes")])
      .then(([b, a, e]) => { setView(b); setAccounts(a); setEnvelopes(e); }).catch(r => onError(msg(r)));
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note: string) => void work.then(() => { onNotice(note); load(); }).catch(r => onError(msg(r)));

  return <>
    {((view.currencies || []) as Row[]).map(v => { const have = Number(v.have_now || 0), safe = Number(v.safe_to_spend || 0);
      return <React.Fragment key={v.currency}>
      <Hero kicker={`${v.currency} · SAFE TO SPEND`} title={fmt(v.safe_to_spend)} sub={v.next_month_forecast ? `Next month: ${fmt(v.next_month_forecast.low)} – ${fmt(v.next_month_forecast.high)}` : "after bills and commitments for 30 days"}
        right={<Ring value={have > 0 ? (safe / have) * 100 : 0} size={96} color={safe < 0 ? C.red : C.green} label={have > 0 ? `${Math.round((safe / have) * 100)}%` : "—"} sub="FREE"/>}>
        {v.stale_accounts?.length > 0 && <Text style={{ color: C.amber, fontSize: 12 }}>Not checked this week: {v.stale_accounts.join(", ")}</Text>}
      </Hero>
      <TileRow>
        <StatTile label="Have now" tone="green" value={fmt(v.have_now)}/>
        <StatTile label="Committed" icon="📌" tone="amber" value={fmt(v.committed_30_days)} hint="next 30 days"/>
      </TileRow>
      <TileRow>
        <StatTile label="Savings" icon="🏦" tone="blue" value={fmt(v.in_savings)}/>
        <StatTile label="Runway" icon="🛟" tone="violet" value={v.runway_months != null ? `${v.runway_months} mo` : "—"} hint="months you could live on savings"/>
      </TileRow>
    </React.Fragment>; })}
    {accounts.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
      {accounts.map((a, i) => <TouchableOpacity key={a.id} onPress={() => { setEditing(editing === a.id ? null : a.id); setNewBalance(String(a.balance)); }}
        style={{ width: 210, height: 124, borderRadius: 22, padding: 16, justifyContent: "space-between", backgroundColor: ["#123a2a", "#13294a", "#3a2a12", "#2a1a44", "#3a1620"][i % 5], borderWidth: 1, borderColor: PALETTE[i % PALETTE.length] + "55", overflow: "hidden" }}>
        <View style={{ position: "absolute", width: 140, height: 140, borderRadius: 70, right: -50, top: -60, backgroundColor: PALETTE[i % PALETTE.length], opacity: 0.18 }}/>
        <Line style={{ justifyContent: "space-between" }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>{a.name}</Text>
          <Text style={{ fontSize: 16 }}>{({ bank: "🏦", cash: "💵", wallet: "📱", savings: "🐷" } as Record<string, string>)[a.account_type] || "💳"}</Text></Line>
        <View><Muted small>{`${a.account_type} · ${a.currency}`}</Muted><Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }} numberOfLines={1} adjustsFontSizeToFit>{fmt(a.balance)}</Text></View>
      </TouchableOpacity>)}
    </ScrollView>}
    {accounts.length > 1 && <Card><Kicker>WHERE YOUR MONEY SITS</Kicker>
      <SplitBar parts={accounts.filter(a => a.currency === accounts[0].currency).map(a => ({ label: a.name, value: Math.max(0, Number(a.balance)) }))} format={n => fmt(n, accounts[0].currency)}/></Card>}
    <Card><Kicker>ACCOUNTS · TAP A CARD TO RECONCILE</Kicker>
      {accounts.length ? accounts.map(a => <View key={a.id} style={{ gap: 6, paddingVertical: 6, borderTopColor: C.line, borderTopWidth: 1 }}>
        <TouchableOpacity onPress={() => { setEditing(editing === a.id ? null : a.id); setNewBalance(String(a.balance)); }}>
          <Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{a.name}</Text><Muted small>{`${a.account_type} · tap to reconcile`}</Muted></View>
            <Text style={{ color: C.text, fontWeight: "700" }}>{fmt(a.balance, a.currency)}</Text></Line>
        </TouchableOpacity>
        {editing === a.id && <Line><View style={{ flex: 1 }}><Field value={newBalance} onChangeText={setNewBalance} keyboardType="decimal-pad" placeholder="What it shows now"/></View>
          <Btn title="Save" onPress={() => { if (!/^-?\d+(\.\d{1,2})?$/.test(clean(newBalance))) { onError("Enter a number like 12500.50"); return; }
            run(api(`/money/accounts/${a.id}/reconcile`, "POST", { balance: clean(newBalance) }), "Updated. The difference was recorded."); setEditing(null); }}/></Line>}
      </View>) : <Empty>Add cash, bank, wallet and savings accounts.</Empty>}
      <Field voice value={name} onChangeText={setName} placeholder="Account name" maxLength={200}/>
      <Chips options={["bank", "cash", "wallet", "savings"] as const} value={kind} onChange={setKind}/>
      <Line><View style={{ flex: 2 }}><Field value={amount} onChangeText={setAmount} placeholder="Balance" keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1 }}><Field value={cur} onChangeText={v => setCur(v.toUpperCase())} maxLength={3} autoCapitalize="characters"/></View></Line>
      <Btn title="Add account" disabled={!name.trim()} onPress={() => { run(api("/money/accounts", "POST", { name, account_type: kind, currency: cur, balance: clean(amount) || "0" }), "Account added."); setName(""); setAmount(""); }}/>
      <Muted small>No bank logins or passwords. Sakuna never pays or transfers.</Muted>
    </Card>
    {envelopes.length > 0 && <Card><Kicker>ENVELOPES · THIS MONTH</Kicker>{envelopes.map(e => <Meter key={e.id} label={e.name}
      value={Math.min(100, e.used_percent ?? 0)} color={e.over ? C.red : (e.used_percent ?? 0) > 80 ? C.amber : C.green} right={`${fmt(e.left, e.currency)} left`}/>)}<Muted small>Add or change envelopes on the web Finance page.</Muted></Card>}
  </>;
}

function Wishes({ api, onError, onNotice }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [cur, setCur] = useState("LKR");
  const [wait, setWait] = useState<"0" | "7" | "14" | "30">("7");
  const [by, setBy] = useState<string | null>(null);
  const [check, setCheck] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row[]>("/money/wishlist").then(setRows).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note: string) => void work.then(() => { onNotice(note); load(); }).catch(r => onError(msg(r)));

  return <>
    <Card><Kicker>ADD A WISH</Kicker>
      <Field voice value={name} onChangeText={setName} placeholder="What do you want?" maxLength={200}/>
      <Line><View style={{ flex: 2 }}><Field value={price} onChangeText={setPrice} placeholder="Price" keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1 }}><Field value={cur} onChangeText={v => setCur(v.toUpperCase())} maxLength={3} autoCapitalize="characters"/></View></Line>
      <Chips options={["0", "7", "14", "30"] as const} value={wait} onChange={setWait} labels={{ "0": "no wait", "7": "7 days", "14": "14 days", "30": "30 days" }}/>
      <DateField label="Want it by (optional)" value={by} allowClear onChange={setBy}/>
      <Btn title="Add wish" disabled={!name.trim()} onPress={() => { run(api("/money/wishlist", "POST", { name, currency: cur, cooling_days: Number(wait), ...(clean(price) ? { price: clean(price) } : {}), ...(by ? { target_date: by } : {}) }), "Added. A short wait helps decide."); setName(""); setPrice(""); setBy(null); }}/>
    </Card>
    {check && <Card accent><Kicker>CAN I AFFORD IT?</Kicker>{(check.lines as string[]).map((l, i) => <Text key={i} style={{ color: C.text }}>{l}</Text>)}
      <Muted small>Your numbers; the decision is yours.</Muted><Btn kind="link" title="Close" onPress={() => setCheck(null)}/></Card>}
    <Card><Kicker>{`${rows.length} WISHES`}</Kicker>
      {rows.length ? rows.map(w => <View key={w.id} style={{ gap: 4, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
        <Line><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{w.name}</Text>{w.price != null && <Text style={{ color: C.text }}>{fmt(w.price, w.currency)}</Text>}</Line>
        <Line>{w.state === "ready" ? <Badge>ready to decide</Badge> : <Badge tone="amber">{`cooling off · ${w.days_left}d left`}</Badge>}
          {!!w.target_date && <Badge tone="muted">{`🎯 by ${new Date(`${w.target_date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}`}</Badge>}</Line>
        {w.state !== "ready" && w.cooling_days > 0 && <Meter value={100 - (Number(w.days_left) / Number(w.cooling_days)) * 100} color={C.amber} height={6}/>}
        <Line style={{ flexWrap: "wrap" }}>
          {w.price != null && <Btn kind="link" title="Afford?" onPress={() => void api<Row>(`/money/wishlist/${w.id}/affordability`).then(setCheck).catch(r => onError(msg(r)))}/>}
          <Btn kind="link" title="Bought" onPress={() => Alert.alert("Bought it?", `Log ${w.price != null ? fmt(w.price, w.currency) : "it"} as an expense?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Just mark", onPress: () => run(api(`/money/wishlist/${w.id}/decide`, "POST", { action: "bought", record_expense: false }), "Marked as bought.") },
            ...(w.price != null ? [{ text: "Log expense", onPress: () => run(api(`/money/wishlist/${w.id}/decide`, "POST", { action: "bought" }), "Bought and logged.") }] : []),
          ])}/>
          <Btn kind="link" title="Skip" onPress={() => run(api(`/money/wishlist/${w.id}/decide`, "POST", { action: "skipped" }), "Skipped. No more reminders.")}/>
        </Line>
      </View>) : <Empty>Nothing on your wish list.</Empty>}
    </Card>
  </>;
}

function Buy({ api, onError, onNotice }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(""); const [est, setEst] = useState(""); const [staple, setStaple] = useState<"no" | "staple">("no");
  const [needBy, setNeedBy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [paid, setPaid] = useState("");
  const load = useCallback(() => { api<Row[]>("/money/buy-list?include_checked=false").then(setRows).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note: string) => void work.then(() => { onNotice(note); setSelected([]); setPaid(""); load(); }).catch(r => onError(msg(r)));
  const total = rows.reduce((n, r) => n + Number(r.est_price || 0), 0);

  return <>
    <Card><Kicker>ADD TO BUY LIST</Kicker>
      <Field voice value={name} onChangeText={setName} placeholder="e.g. rice 5kg" maxLength={200}/>
      <Line><View style={{ flex: 1 }}><Field value={est} onChangeText={setEst} placeholder="Est. price (LKR)" keyboardType="decimal-pad"/></View></Line>
      <Chips options={["no", "staple"] as const} value={staple} onChange={setStaple} labels={{ no: "one-off", staple: "staple (rebuy)" }}/>
      <DateField label="Need it by (optional)" value={needBy} allowClear onChange={setNeedBy}/>
      <Btn title="Add" disabled={!name.trim()} onPress={() => { run(api("/money/buy-list", "POST", { name, currency: "LKR", staple: staple === "staple", ...(clean(est) ? { est_price: clean(est) } : {}), ...(needBy ? { need_by: needBy } : {}) }), "Added."); setName(""); setEst(""); setNeedBy(null); }}/>
    </Card>
    <View style={{ borderRadius: 24, padding: 18, backgroundColor: "#123a6b", borderWidth: 1, borderColor: "#2d64a8", overflow: "hidden", gap: 4 }}>
      <View style={{ position: "absolute", width: 180, height: 180, borderRadius: 90, right: -60, top: -70, backgroundColor: "#5aa8ff", opacity: 0.2 }}/>
      <Text style={{ color: "#cfe3ff", fontWeight: "800", fontSize: 12, letterSpacing: 1 }}>{`ITEMS ${selected.length}/${rows.length} PICKED`}</Text>
      <Text style={{ color: "#fff", fontSize: 30, fontWeight: "900" }}>{fmt(total, "LKR")}</Text>
      <Text style={{ color: "#cfe3ff", fontSize: 12 }}>estimated total for your list</Text>
    </View>
    <Card><Kicker>{`${rows.length} TO BUY`}</Kicker>
      {rows.length ? rows.map(r => { const on = selected.includes(r.id); return <TouchableOpacity key={r.id} onPress={() => setSelected(s => on ? s.filter(x => x !== r.id) : [...s, r.id])}>
        <Line style={{ paddingVertical: 6 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: on ? C.green : C.line, backgroundColor: on ? C.green : "transparent" }}/>
          <Text style={{ color: C.text, flex: 1 }}>{r.name}{r.staple ? "  ↻" : ""}{r.need_by ? `  · 📅 ${new Date(`${r.need_by}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}</Text>
          {r.est_price != null && <Muted small>{fmt(r.est_price)}</Muted>}
        </Line></TouchableOpacity>; }) : <Empty>Nothing to buy.</Empty>}
      {selected.length > 0 && <><Field value={paid} onChangeText={setPaid} placeholder="Total paid (blank = estimate)" keyboardType="decimal-pad"/>
        <Btn title={`Bought ${selected.length} · log expense`} onPress={() => run(api("/money/buy-list/checkout", "POST", { item_ids: selected, currency: "LKR", ...(clean(paid) ? { amount: clean(paid) } : {}) }), "Checked off and logged.")}/></>}
      <Btn kind="outline" title="Restock staples" onPress={() => run(api("/money/buy-list/restock", "POST"), "Staples are back on the list.")}/>
    </Card>
  </>;
}

/** Plan tab card: planning multiplier, today's capacity vs. load, warnings and suggested top 3. */
export function TimeCard({ api }: { api: Api }) {
  const [data, setData] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/time/insights").then(setData).catch(() => setData(null)); }, [api]);
  if (!data) return null;
  const today = (data.days || [])[0] || {};
  const h = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
  return <Card>
    <Kicker>TIME ENGINE</Kicker>
    <Line><View style={{ flex: 1 }}><Muted small>Today planned</Muted><H2>{`${h(today.planned_minutes || 0)} / ${h(today.capacity_minutes || 0)}`}</H2></View>
      <View style={{ flex: 1 }}><Muted small>Your multiplier</Muted><H2>{`×${data.multiplier.multiplier}`}</H2></View></Line>
    {data.deep_work_window && <Muted small>{`Best focus hours: ${data.deep_work_window.start}–${data.deep_work_window.end}`}</Muted>}
    {(data.warnings as Row[]).slice(0, 3).map((w, i) => <Text key={i} style={{ color: C.amber, fontSize: 13 }}>⚠ {w.message}</Text>)}
    <Text style={{ color: C.text, fontWeight: "700", marginTop: 4 }}>Top 3 today</Text>
    {(data.top3 as Row[]).length ? (data.top3 as Row[]).map((t, i) => <Text key={t.id} style={{ color: C.text }}>{`${i + 1}. ${t.title}`}<Text style={{ color: C.muted }}>{`  ~${h(t.adjusted_minutes)}`}</Text></Text>) : <Muted small>No open tasks.</Muted>}
  </Card>;
}
