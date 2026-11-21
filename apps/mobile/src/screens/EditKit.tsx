import React, { useCallback, useEffect, useState } from "react";
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Segments } from "../charts";
import { Btn, C, Card, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const FEE = 0.0112;
const rs = (n: number) => `Rs ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const num = (s: string) => Number(String(s).replace(/,/g, "")) || 0;

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" transparent onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%", borderTopWidth: 1, borderColor: C.line }}>
        <View style={{ alignItems: "center", paddingTop: 8 }}><View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line }}/></View>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 10 }}>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: "900", flex: 1 }}>{title}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: C.muted, fontSize: 22 }}>✕</Text></TouchableOpacity></View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View></View>
  </Modal>;
}

function BigInput({ label, value, onChange, color = C.text }: { label: string; value: string; onChange: (s: string) => void; color?: string }) {
  return <View style={{ flex: 1, gap: 4 }}><Text style={{ color: C.muted, fontSize: 11, fontWeight: "700" }}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" selectTextOnFocus
      style={{ color, fontSize: 24, fontWeight: "900", backgroundColor: C.panel2, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.line }}/></View>;
}

/** Change a share you hold: set exact numbers, or say "I bought / sold more" and let Sakuna work out the new average. Delete too. */
export function EditHolding({ api, h, onClose, onDone, onError }: { api: Api; h: Row; onClose: () => void; onDone: (v: Row, note: string) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"set" | "buy" | "sell">("set");
  const [qty, setQty] = useState(String(Number(h.quantity))); const [avg, setAvg] = useState(Number(h.avg_cost).toFixed(2));
  const [moreQ, setMoreQ] = useState(""); const [moreP, setMoreP] = useState(String(h.price ?? ""));
  const [busy, setBusy] = useState(false);
  const haveQ = Number(h.quantity), haveCost = Number(h.cost || haveQ * Number(h.avg_cost)), price = Number(h.price || 0);
  let newQ = num(qty), newAvg = num(avg);
  if (mode === "buy" && num(moreQ) > 0 && num(moreP) > 0) { newQ = haveQ + num(moreQ); newAvg = (haveCost + num(moreQ) * num(moreP) * (1 + FEE)) / newQ; }
  if (mode === "sell" && num(moreQ) > 0) { newQ = Math.max(0, haveQ - num(moreQ)); newAvg = haveQ ? haveCost / haveQ : 0; }
  const value = price * newQ, unreal = value - newQ * newAvg;
  const step = (d: number) => setQty(String(Math.max(1, num(qty) + d)));
  async function save() {
    setBusy(true);
    try {
      const v = newQ <= 0 ? await api<Row>(`/invest/holdings/${encodeURIComponent(h.symbol)}`, "DELETE")
        : await api<Row>(`/invest/holdings/${encodeURIComponent(h.symbol)}`, "PUT", { quantity: Number(newQ.toFixed(4)), avg_price: Number(newAvg.toFixed(4)) });
      onDone(v, newQ <= 0 ? `${String(h.symbol).split(".")[0]} removed` : `${String(h.symbol).split(".")[0]} updated: ${newQ.toLocaleString()} @ ${newAvg.toFixed(2)}`);
    } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  const remove = () => Alert.alert(`Remove ${String(h.symbol).split(".")[0]}?`, "Its buy/sell records are removed. Recorded dividends stay.", [{ text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: () => { setBusy(true); api<Row>(`/invest/holdings/${encodeURIComponent(h.symbol)}`, "DELETE").then(v => onDone(v, "Share removed")).catch(e => onError(msg(e))).finally(() => setBusy(false)); } }]);
  return <Sheet title={`✎ ${String(h.symbol).split(".")[0]}`} onClose={onClose}>
    <Segments options={["set", "buy", "sell"] as const} value={mode} onChange={setMode} labels={{ set: "✎ Set exactly", buy: "＋ I bought more", sell: "－ I sold some" }}/>
    {mode === "set" ? <>
      <Line><BigInput label="SHARES" value={qty} onChange={setQty}/><BigInput label="AVERAGE COST" value={avg} onChange={setAvg} color={C.blue}/></Line>
      <Line>{[-100, -10, 10, 100].map(d => <TouchableOpacity key={d} onPress={() => step(d)} style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: d > 0 ? C.greenSoft : "#3a2222" }}>
        <Text style={{ color: d > 0 ? C.green : C.red, fontWeight: "900" }}>{d > 0 ? `+${d}` : d}</Text></TouchableOpacity>)}</Line>
    </> : <Line><BigInput label={mode === "buy" ? "SHARES BOUGHT" : "SHARES SOLD"} value={moreQ} onChange={setMoreQ}/>
      {mode === "buy" && <BigInput label="PRICE PAID" value={moreP} onChange={setMoreP} color={C.blue}/>}</Line>}
    <Card accent>
      <Kicker>AFTER THIS CHANGE</Kicker>
      <Line><Text style={{ color: C.muted, flex: 1 }}>Shares</Text><Text style={{ color: C.text, fontWeight: "900" }}>{`${haveQ.toLocaleString()} → ${newQ.toLocaleString()}`}</Text></Line>
      <Line><Text style={{ color: C.muted, flex: 1 }}>Average cost</Text><Text style={{ color: C.text, fontWeight: "900" }}>{`${Number(h.avg_cost).toFixed(2)} → ${newAvg.toFixed(2)}`}</Text></Line>
      {price > 0 && <Line><Text style={{ color: C.muted, flex: 1 }}>{`Value at ${price}`}</Text><Text style={{ color: C.text, fontWeight: "900" }}>{rs(value)}</Text></Line>}
      {price > 0 && <Line><Text style={{ color: C.muted, flex: 1 }}>Unrealised</Text><Text style={{ color: unreal >= 0 ? C.green : C.red, fontWeight: "900" }}>{`${unreal >= 0 ? "+" : ""}${rs(unreal)} (${newAvg ? ((price / newAvg - 1) * 100).toFixed(2) : "0"}%)`}</Text></Line>}
      <Muted small>{mode === "buy" ? "Includes ~1.12% buy charges in the new average." : "Saving replaces this share's buy/sell history with one opening position; dividends stay."}</Muted>
    </Card>
    <Btn title={newQ <= 0 ? "Remove share" : "💾 Save"} busy={busy} disabled={newQ < 0 || (newQ > 0 && newAvg <= 0)} onPress={() => void save()}/>
    <Btn kind="danger" title="🗑 Remove this share" onPress={remove}/>
  </Sheet>;
}

/** Latest income and expenses: tap to edit amount, category and note, or delete. */
export function MoneyEntries({ api, onError, onChanged }: { api: Api; onError: (m: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [edit, setEdit] = useState<Row | null>(null);
  const [amount, setAmount] = useState(""); const [label, setLabel] = useState(""); const [notes, setNotes] = useState("");
  const [all, setAll] = useState(false);
  const load = useCallback(() => { api<Row>("/finance/entries?limit=80").then(setD).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const items: Row[] = d.items;
  const open = (r: Row) => { setEdit(r); setAmount(String(Number(r.amount))); setLabel(r.label); setNotes(r.notes || ""); };
  const save = () => void api(`/finance/entries/${edit!.kind}/${edit!.id}`, "PATCH", { amount: num(amount), label, notes }).then(() => { setEdit(null); load(); onChanged(); }).catch(e => onError(msg(e)));
  const del = () => Alert.alert("Delete this entry?", `${edit!.label} ${Number(edit!.amount).toLocaleString()} ${edit!.currency}`, [{ text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void api(`/finance/entries/${edit!.kind}/${edit!.id}`, "DELETE").then(() => { setEdit(null); load(); onChanged(); }).catch(e => onError(msg(e))) }]);
  return <Card>
    <Line><Kicker>{`RECENT ENTRIES · ${items.length}`}</Kicker><View style={{ flex: 1 }}/><Muted small>tap to edit</Muted></Line>
    {(all ? items : items.slice(0, 8)).map(r => <TouchableOpacity key={`${r.kind}-${r.id}`} onPress={() => open(r)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line }}>
      <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: r.kind === "income" ? C.greenSoft : "#3a2222" }}>
        <Text>{r.kind === "income" ? "↓" : "↑"}</Text></View>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800", textTransform: "capitalize" }}>{String(r.label).replaceAll("_", " ")}</Text>
        <Muted small>{`${r.occurred_at ? new Date(r.occurred_at).toLocaleDateString() : ""}${r.notes ? ` · ${r.notes}` : ""}`}</Muted></View>
      <Text style={{ color: r.kind === "income" ? C.green : C.text, fontWeight: "900" }}>{`${r.kind === "income" ? "+" : "−"}${Number(r.amount).toLocaleString()} ${r.currency}`}</Text>
      <Text style={{ color: C.muted }}>✎</Text></TouchableOpacity>)}
    {items.length > 8 && <Btn kind="link" title={all ? "Show less" : `Show all ${items.length}`} onPress={() => setAll(a => !a)}/>}
    {edit && <Sheet title={`✎ ${edit.kind === "income" ? "Income" : "Expense"}`} onClose={() => setEdit(null)}>
      <BigInput label={`AMOUNT (${edit.currency})`} value={amount} onChange={setAmount} color={edit.kind === "income" ? C.green : C.text}/>
      <Kicker>{edit.kind === "income" ? "SOURCE" : "CATEGORY"}</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{((edit.kind === "income" ? d.sources : d.categories) as string[]).map(c =>
        <TouchableOpacity key={c} onPress={() => setLabel(c)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: label === c ? C.green : C.line, backgroundColor: label === c ? C.greenSoft : "transparent" }}>
          <Text style={{ color: label === c ? C.green : C.muted, fontWeight: "700", textTransform: "capitalize" }}>{c.replaceAll("_", " ")}</Text></TouchableOpacity>)}</View>
      <TextInput value={notes} onChangeText={setNotes} placeholder="Note" placeholderTextColor={C.muted} style={{ color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line }}/>
      <Btn title="💾 Save" disabled={num(amount) <= 0} onPress={save}/>
      <Btn kind="danger" title="🗑 Delete entry" onPress={del}/>
    </Sheet>}
  </Card>;
}
