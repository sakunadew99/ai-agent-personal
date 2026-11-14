import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
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
  const month = new Date().toISOString().slice(0, 7);

  const load = useCallback(async () => {
    try { setSummary(await api<Row>(`/finance/summary?month=${month}`)); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); }
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

  const cur = String(summary.currency || "USD");
  const cats = Object.entries((summary.expense_by_category || {}) as Record<string, unknown>);
  return <Screen>
    <Card><Kicker>THIS MONTH · {month}</Kicker>
      <Line><View style={{ flex: 1 }}><Muted small>Income</Muted><H2>{money(summary.total_income, cur)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Spent</Muted><H2>{money(summary.total_expenses, cur)}</H2></View></Line>
      <Line><View style={{ flex: 1 }}><Muted small>Net</Muted><H2>{money(summary.net_income, cur)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Net worth</Muted><H2>{money(summary.net_worth, cur)}</H2></View></Line>
      <Muted small>Totals use your display currency ({cur}); records in other currencies are kept separately, never converted by guess.</Muted>
    </Card>
    <Card><Kicker>QUICK ADD</Kicker>
      <Chips options={KINDS} value={kind} onChange={setKind}/>
      <Line><View style={{ flex: 2 }}><Field value={amount} onChangeText={setAmount} placeholder="Amount" keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1 }}><Field value={currency} onChangeText={setCurrency} placeholder="LKR" autoCapitalize="characters" maxLength={3}/></View></Line>
      {kind === "expense" ? <Chips options={EXPENSE_CATS} value={category} onChange={setCategory}/> : <Chips options={SOURCES} value={source} onChange={setSource}/>}
      <Field value={note} onChangeText={setNote} placeholder="Note (optional)"/>
      <Btn title={`Save ${kind}`} onPress={() => void save()} busy={busy}/>
    </Card>
    <Card><Kicker>SPENDING BY CATEGORY</Kicker>
      {cats.length ? cats.map(([name, value]) => <Line key={name} style={{ justifyContent: "space-between" }}><Text style={{ color: C.text, textTransform: "capitalize" }}>{name}</Text><Text style={{ color: C.text, fontWeight: "700" }}>{money(value, cur)}</Text></Line>)
        : <Empty>Log an expense to see categories.</Empty>}
    </Card>
  </Screen>;
}

/** What Sakuna remembers: search, add, delete. */
export function MemoryScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await api<Row[]>("/memories")); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); } }, [api, onError]);
  useEffect(() => { void load(); }, [load]);

  async function search() {
    if (!query.trim()) { void load(); return; }
    try { setRows(await api<Row[]>("/memories/search", "POST", { query: query.trim() })); } catch (reason) { onError(reason instanceof Error ? reason.message : "Search failed"); }
  }
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    try { await api("/memories", "POST", { content: text.trim(), category: "note" }); setText(""); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Could not save"); } finally { setBusy(false); }
  }
  function remove(row: Row) {
    Alert.alert("Delete memory?", String(row.content).slice(0, 120), [{ text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void api(`/memories/${row.id}`, "DELETE").then(load).catch(e => onError(String(e))) }]);
  }
  return <Screen>
    <Card><Kicker>SAVE SOMETHING TO REMEMBER</Kicker>
      <Field value={text} onChangeText={setText} placeholder="e.g. I prefer deep work before 11am" multiline/>
      <Btn title="Save memory" onPress={() => void add()} busy={busy} disabled={!text.trim()}/>
      <Muted small>Sensitive details (passwords, health, money) are blocked unless you save them from the web app with explicit consent.</Muted>
    </Card>
    <Field value={query} onChangeText={setQuery} placeholder="Search memories…" onSubmitEditing={() => void search()} returnKeyType="search"/>
    <Card><Kicker>MEMORIES · {rows.length}</Kicker>
      {rows.length ? rows.map(row => <View key={row.id} style={{ gap: 4, paddingVertical: 6, borderBottomColor: C.line, borderBottomWidth: 1 }}>
        <Line><Badge>{row.category}</Badge>{row.sensitivity === "sensitive" && <Badge tone="amber">sensitive</Badge>}<View style={{ flex: 1 }}/>
          <TouchableOpacity onPress={() => remove(row)}><Text style={{ color: "#f18c80" }}>Delete</Text></TouchableOpacity></Line>
        <Text style={{ color: C.text, lineHeight: 20 }}>{row.content}</Text><Muted small>{niceDate(row.updated_at)}</Muted>
      </View>) : <Empty>No memories yet.</Empty>}
    </Card>
  </Screen>;
}

/** AI/MCP proposals that need your yes. */
export function ApprovalsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => { try { setRows((await api<Row[]>("/approvals")).filter(r => r.status === "pending")); } catch (reason) { onError(reason instanceof Error ? reason.message : "Could not load"); } }, [api, onError]);
  useEffect(() => { void load(); }, [load]);
  async function resolve(id: string, action: "approve" | "reject") {
    try { await api(`/approvals/${id}/${action}`, "POST"); onNotice(action === "approve" ? "Approved and done." : "Rejected."); await load(); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Could not resolve"); }
  }
  return <Screen>
    <H1>Approvals</H1><Muted>The assistant and MCP tools only propose changes. Nothing happens until you approve it here.</Muted>
    {rows.length ? rows.map(r => <Card key={r.id}>
      <Line><Badge>{String(r.tool_name).replaceAll("_", " ")}</Badge><View style={{ flex: 1 }}/><Muted small>{niceDate(r.created_at)}</Muted></Line>
      <Text style={{ color: C.text, fontFamily: "monospace", fontSize: 12 }}>{JSON.stringify(r.payload?.body || r.payload, null, 2)}</Text>
      <Line><Btn kind="danger" title="Reject" onPress={() => void resolve(r.id, "reject")} style={{ flex: 1 }}/><Btn title="Approve" onPress={() => void resolve(r.id, "approve")} style={{ flex: 1 }}/></Line>
    </Card>) : <Empty>Nothing is waiting for your approval.</Empty>}
  </Screen>;
}
