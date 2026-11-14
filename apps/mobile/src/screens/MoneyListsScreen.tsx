import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
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
    <Chips options={TABS} value={tab} onChange={setTab} labels={{ balance: "Balance", wishes: "Wish list", buy: "Buy list" }}/>
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
    {((view.currencies || []) as Row[]).map(v => <Card key={v.currency} accent>
      <Kicker>{`${v.currency} · SAFE TO SPEND`}</Kicker>
      <Text style={{ color: C.green, fontSize: 30, fontWeight: "800" }}>{fmt(v.safe_to_spend, v.currency)}</Text>
      <Line><View style={{ flex: 1 }}><Muted small>Have now</Muted><H2>{fmt(v.have_now)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Committed 30d</Muted><H2>{fmt(v.committed_30_days)}</H2></View></Line>
      <Line><View style={{ flex: 1 }}><Muted small>In savings</Muted><H2>{fmt(v.in_savings)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Runway</Muted><H2>{v.runway_months != null ? `${v.runway_months} mo` : "—"}</H2></View></Line>
      {v.next_month_forecast && <Muted small>{`Next month: ${fmt(v.next_month_forecast.low)} – ${fmt(v.next_month_forecast.high)}`}</Muted>}
      {v.stale_accounts?.length > 0 && <Text style={{ color: C.amber, fontSize: 12 }}>Not checked this week: {v.stale_accounts.join(", ")}</Text>}
    </Card>)}
    <Card><Kicker>ACCOUNTS</Kicker>
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
    {envelopes.length > 0 && <Card><Kicker>ENVELOPES · THIS MONTH</Kicker>{envelopes.map(e => <View key={e.id} style={{ gap: 4, paddingVertical: 4 }}>
      <Line><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{e.name}</Text><Text style={{ color: e.over ? C.red : C.text }}>{`${fmt(e.left, e.currency)} left`}</Text></Line>
      <Progress value={Math.min(100, e.used_percent ?? 0)}/>
    </View>)}<Muted small>Add or change envelopes on the web Finance page.</Muted></Card>}
  </>;
}

function Wishes({ api, onError, onNotice }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [cur, setCur] = useState("LKR");
  const [wait, setWait] = useState<"0" | "7" | "14" | "30">("7");
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
      <Btn title="Add wish" disabled={!name.trim()} onPress={() => { run(api("/money/wishlist", "POST", { name, currency: cur, cooling_days: Number(wait), ...(clean(price) ? { price: clean(price) } : {}) }), "Added. A short wait helps decide."); setName(""); setPrice(""); }}/>
    </Card>
    {check && <Card accent><Kicker>CAN I AFFORD IT?</Kicker>{(check.lines as string[]).map((l, i) => <Text key={i} style={{ color: C.text }}>{l}</Text>)}
      <Muted small>Your numbers; the decision is yours.</Muted><Btn kind="link" title="Close" onPress={() => setCheck(null)}/></Card>}
    <Card><Kicker>{`${rows.length} WISHES`}</Kicker>
      {rows.length ? rows.map(w => <View key={w.id} style={{ gap: 4, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
        <Line><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{w.name}</Text>{w.price != null && <Text style={{ color: C.text }}>{fmt(w.price, w.currency)}</Text>}</Line>
        <Line>{w.state === "ready" ? <Badge>ready</Badge> : <Badge tone="amber">{`waiting · ${w.days_left}d`}</Badge>}</Line>
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
      <Btn title="Add" disabled={!name.trim()} onPress={() => { run(api("/money/buy-list", "POST", { name, currency: "LKR", staple: staple === "staple", ...(clean(est) ? { est_price: clean(est) } : {}) }), "Added."); setName(""); setEst(""); }}/>
    </Card>
    <Card><Kicker>{`${rows.length} TO BUY · EST. ${fmt(total, "LKR")}`}</Kicker>
      {rows.length ? rows.map(r => { const on = selected.includes(r.id); return <TouchableOpacity key={r.id} onPress={() => setSelected(s => on ? s.filter(x => x !== r.id) : [...s, r.id])}>
        <Line style={{ paddingVertical: 6 }}>
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: on ? C.green : C.line, backgroundColor: on ? C.green : "transparent" }}/>
          <Text style={{ color: C.text, flex: 1 }}>{r.name}{r.staple ? "  ↻" : ""}</Text>
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
