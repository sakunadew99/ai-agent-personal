import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import { peek, type ApiRecord as Row } from "../api";
import { NetWorthCard } from "./SmartCards";
import { MoneyEntries } from "./EditKit";
import { Bars, Hero, LineChart, Ring, Segments, SplitBar, StatTile, TileRow } from "../charts";
import { Badge, Btn, C, Card, Chips, Empty, Field, H1, H2, Kicker, Muted, money, niceDate, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const EXPENSE_CATS = ["food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "other"] as const;
const KINDS = ["expense", "income"] as const;
const SOURCES = ["salary", "freelance", "business", "other"] as const;

/** Monthly money summary plus 10-second expense/income entry. */
export function FinanceScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [summary, setSummary] = useState<Row>({});
  const [kind, setKind] = useState<(typeof KINDS)[number]>("expense");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("LKR");
  const [category, setCategory] = useState<(typeof EXPENSE_CATS)[number]>("food");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("freelance");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [trends, setTrends] = useState<Row | null>(() => peek<Row>("/finance/trends"));
  const [subs, setSubs] = useState<Row | null>(null);
  const month = new Date().toISOString().slice(0, 7);

  const load = useCallback(async () => {
    try { const [sum, tr] = await Promise.all([api<Row>(`/finance/summary?month=${month}`), api<Row>("/finance/trends")]); setSummary(sum); setTrends(tr); api<Row>("/subscriptions").then(setSubs).catch(() => undefined); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); }
  }, [api, onError, month]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    const value = Number(amount.replace(/,/g, ""));
    if (!value || value <= 0) { onError("Enter an amount greater than 0."); return; }
    setBusy(true);
    try {
      const code = currency.trim().toUpperCase() || "LKR";
      if (kind === "expense") await api("/finance/expenses", "POST", { amount: value, currency: code, category, scope: "personal", record_kind: "actual", ...(note ? { notes: note } : {}) });
      else await api("/finance/income", "POST", { amount: value, currency: code, source, record_kind: "actual", ...(note ? { notes: note } : {}) });
      setAmount(""); setNote(""); onNotice(`${kind === "expense" ? "Expense" : "Income"} saved.`); await load();
    } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not save"); } finally { setBusy(false); }
  }

  const cur = String(summary.currency || trends?.currency || "USD");
  const tm: Row = trends?.this_month || {};
  const months: Row[] = trends?.months || [];
  const days: Row[] = trends?.days || [];
  const cats: Row[] = trends?.categories || [];
  const short = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
  const rate = tm.savings_rate === null || tm.savings_rate === undefined ? null : Number(tm.savings_rate);
  return <Screen>
    <Hero kicker={`MONEY · ${month}`} title={money(tm.net ?? summary.net_income, cur)} sub="left this month after spending"
      right={<Ring value={Math.max(0, rate ?? 0)} size={100} color={rate !== null && rate < 0 ? C.red : C.green} label={rate === null ? "—" : `${Math.round(rate)}%`} sub="SAVED"/>}/>
    <TileRow>
      <StatTile label="Income" icon="↘" tone="green" value={short(Number(tm.income ?? summary.total_income ?? 0))} hint={cur}/>
      <StatTile label="Spent" icon="↗" tone="red" value={short(Number(tm.spent ?? summary.total_expenses ?? 0))}
        trend={tm.change_vs_last_month_pct ?? null} hint="vs same day last month"/>
    </TileRow>
    <TileRow>
      <StatTile label="Per day" tone="amber" value={short(Number(tm.avg_per_day || 0))} hint={`on track for ${short(Number(tm.projected_spend || 0))} this month`}/>
      <StatTile label="Net worth" tone="blue" value={short(Number(summary.net_worth || 0))} hint={summary.target_progress_percent ? `${summary.target_progress_percent}% of target` : cur}/>
    </TileRow>
    {subs && (subs.items as Row[]).length > 0 && <TileRow>
      <StatTile label="Subscriptions" icon="💳" tone="violet" value={Object.entries(subs.per_month as Record<string, number>).map(([c, x]) => `${c} ${short(Number(x))}`).join(" · ")} hint="per month, all bills & renewals"/>
      <StatTile label="Due soon" icon="⏰" tone={subs.due_soon + subs.overdue ? "amber" : "plain"} value={`${subs.due_soon + subs.overdue}`} hint="see Documents & renewals"/>
    </TileRow>}

    <NetWorthCard api={api}/>
    {months.length > 0 && <Card><Kicker>INCOME VS SPENDING · 6 MONTHS</Kicker>
      <LineChart series={[{ values: months.map(m => Number(m.income)), color: C.green, name: "Income" }, { values: months.map(m => Number(m.expenses)), color: C.red, name: "Spent" }]}
        labels={months.map(m => m.label)} format={short}/>
      <Line><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: C.green }}/><Muted small>Income</Muted>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: C.red, marginLeft: 10 }}/><Muted small>Spent</Muted></Line></Card>}

    {days.length > 1 && <Card><Kicker>DAILY SPENDING · THIS MONTH</Kicker>
      <Bars data={days.map((d, i) => ({ label: days.length > 16 ? (i % 5 === 0 ? d.label : "") : d.label, value: Number(d.spent), highlight: i === days.length - 1, color: Number(d.spent) > Number(tm.avg_per_day || 0) * 1.5 ? C.amber : C.green }))}
        height={110} format={short}/>
      <Muted small>Amber days are well above your daily average. Tap a bar to see it.</Muted></Card>}

    <Card><Kicker>WHERE IT WENT</Kicker>
      {cats.length ? <SplitBar parts={cats.map(c => ({ label: c.category, value: Number(c.amount) }))} format={n => money(n, cur)}/> : <Empty>Log an expense to see categories.</Empty>}
      {cats.filter(c => Number(c.previous) > 0 && Number(c.amount) > Number(c.previous) * 1.2).slice(0, 2).map(c =>
        <Text key={c.category} style={{ color: C.amber, fontSize: 12 }}>{`▲ ${c.category} is already above last month (${money(c.previous, cur)}).`}</Text>)}
    </Card>

    <Card><Kicker>QUICK ADD</Kicker>
      <Segments options={KINDS} value={kind} onChange={setKind}/>
      <Line><View style={{ flex: 2 }}><Field value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1 }}><Field value={currency} onChangeText={setCurrency} placeholder="LKR" autoCapitalize="characters" maxLength={3}/></View></Line>
      {kind === "expense" ? <Chips options={EXPENSE_CATS} value={category} onChange={setCategory}/> : <Chips options={SOURCES} value={source} onChange={setSource}/>}
      <Field voice value={note} onChangeText={setNote} placeholder="Note (optional)"/>
      <Btn title={`Save ${kind}`} onPress={() => void save()} busy={busy}/>
    </Card>

    {(trends?.biggest || []).length > 0 && <Card><Kicker>BIGGEST THIS MONTH</Kicker>
      {(trends!.biggest as Row[]).map(b => <Line key={b.id} style={{ paddingVertical: 4 }}>
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" }}><Text>{CAT_ICON[b.category] || "•"}</Text></View>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700", textTransform: "capitalize" }}>{b.merchant || b.notes || b.category}</Text><Muted small>{`${b.category} · ${b.date}`}</Muted></View>
        <Text style={{ color: C.red, fontWeight: "800" }}>{`−${money(b.amount, cur)}`}</Text></Line>)}
    </Card>}
    <MoneyEntries api={api} onError={onError} onChanged={() => void load()}/>
    <Muted small>{`Charts use your display currency (${cur}); ${trends?.other_currency_records ? `${trends.other_currency_records} record(s) in other currencies are kept separately, ` : ""}never converted by guess.`}</Muted>
  </Screen>;
}

const CAT_ICON: Record<string, string> = { food: "🍛", transport: "🚌", housing: "🏠", subscriptions: "🔁", shopping: "🛍️", health: "💊", education: "🎓", business: "💼", other: "📦" };

/** What Sakuna remembers: search, add, delete. */
export function MemoryScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const load = useCallback(async () => { try { setRows(await api<Row[]>("/memories")); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); } }, [api, onError]);
  useEffect(() => { void load(); }, [load]);

  async function search() {
    if (!query.trim()) { void load(); return; }
    try { setRows(await api<Row[]>("/memories/search", "POST", { query: query.trim() })); } catch (reason) { onError(reason instanceof Error ? reason.message : "Search failed"); }
  }
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try { await api("/memories", "POST", { content: text.trim(), category: "note", allow_duplicate: duplicate }); setText(""); setDuplicate(false); await load(); }
    catch (reason) {
      const msg = reason instanceof Error ? reason.message : "Could not save";
      if (/duplicate/i.test(msg)) setDuplicate(true);
      onError(msg);
    } finally { setBusy(false); }
  }
  async function saveEdit(row: Row) {
    if (!draft.trim()) return;
    try { await api(`/memories/${row.id}`, "PATCH", { content: draft.trim() }); setEditing(null); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not save"); }
  }
  const pin = (row: Row) => void api(`/memories/${row.id}`, "PATCH", { pinned: !row.pinned }).then(load).catch(e => onError(String(e)));
  function remove(row: Row) {
    Alert.alert("Delete memory?", String(row.content).slice(0, 120), [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/memories/${row.id}`, "DELETE").then(load).catch(e => onError(String(e))) }]);
  }
  return <Screen>
    <Card><Kicker>SAVE SOMETHING TO REMEMBER</Kicker>
      <Field voice value={text} onChangeText={setText} placeholder="e.g. I prefer deep work before 11am" multiline/>
      <Btn title={duplicate ? "Save anyway (keep both)" : "Save memory"} onPress={() => void add()} busy={busy} disabled={!text.trim()}/>
      <Muted small>Type is detected automatically: “I like…” = interest, “I want to…” = intention (Sakuna may gently remind you later), “I prefer…” = preference.</Muted>
      <Muted small>Sensitive details (passwords, health, money) are blocked unless you save them from the web app with explicit consent.</Muted>
    </Card>
    <Field voice value={query} onChangeText={setQuery} placeholder="Search memories…" onSubmitEditing={() => void search()} returnKeyType="search"/>
    <Card><Kicker>MEMORIES · {rows.length}</Kicker>
      {rows.length ? rows.map(row => <View key={row.id} style={{ gap: 4, paddingVertical: 6, borderBottomColor: C.line, borderBottomWidth: 1 }}>
        <Line><Badge>{row.category}</Badge>{row.intent_type && row.intent_type !== "fact" && <Badge tone="amber">{`${row.intent_type}${row.topic ? ` · ${row.topic}` : ""}`}</Badge>}{row.sensitivity === "sensitive" && <Badge tone="amber">sensitive</Badge>}<View style={{ flex: 1 }}/>
          <TouchableOpacity onPress={() => pin(row)} style={{ paddingHorizontal: 6 }}><Text style={{ color: row.pinned ? C.amber : C.muted }}>{row.pinned ? "★" : "☆"}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => { setEditing(editing === row.id ? null : row.id); setDraft(row.content); }} style={{ paddingHorizontal: 6 }}><Text style={{ color: C.green, fontWeight: "700" }}>✎ Edit</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => remove(row)}><Text style={{ color: "#f18c80" }}>🗑</Text></TouchableOpacity></Line>
        {editing === row.id ? <View style={{ gap: 6 }}><Field voice value={draft} onChangeText={setDraft} multiline/>
          <Line><Btn title="💾 Save" onPress={() => void saveEdit(row)} disabled={!draft.trim()} style={{ flex: 1 }}/><Btn kind="outline" title="Cancel" onPress={() => setEditing(null)} style={{ flex: 1 }}/></Line></View>
          : <TouchableOpacity onLongPress={() => { setEditing(row.id); setDraft(row.content); }}><Text style={{ color: C.text, lineHeight: 20 }}>{row.content}</Text></TouchableOpacity>}
        <Muted small>{niceDate(row.updated_at)}</Muted>
      </View>) : <Empty>No memories yet.</Empty>}
    </Card>
  </Screen>;
}

/** AI/MCP proposals that need your yes. */
export function ApprovalsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => { try { setRows((await api<Row[]>("/approvals")).filter(r => r.status === "pending")); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); } }, [api, onError]);
  useEffect(() => { void load(); }, [load]);
  async function resolve(id: string, action: "approve" | "reject" | "cancel") {
    try { await api(`/approvals/${id}/${action}`, "POST"); onNotice(action === "approve" ? "Approved and done." : action === "cancel" ? "Cancelled." : "Rejected."); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Could not resolve"); }
  }
  return <Screen>
    <H1>Approvals</H1><Muted>The assistant and MCP tools only propose changes. Nothing happens until you approve it here.</Muted>
    {rows.length ? rows.map(r => <Card key={r.id}>
      <Line><Badge>{String(r.tool_name).replaceAll("_", " ")}</Badge><View style={{ flex: 1 }}/><Muted small>{niceDate(r.created_at)}</Muted></Line>
      {r.payload?.preview ? <><Text style={{ color: C.text, fontWeight: "800" }}>{r.payload.preview}</Text>{r.payload.reason ? <Muted small>{r.payload.reason}</Muted> : null}</>
        : <Text style={{ color: C.text, fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(r.payload?.body || r.payload, null, 2)}</Text>}
      <Line><Btn kind="link" title="Cancel" onPress={() => void resolve(r.id, "cancel")}/><Btn kind="danger" title="Reject" onPress={() => void resolve(r.id, "reject")} style={{ flex: 1 }}/><Btn title="Approve" onPress={() => void resolve(r.id, "approve")} style={{ flex: 1 }}/></Line>
    </Card>) : <Empty>Nothing is waiting for your approval.</Empty>}
  </Screen>;
}
