import React, { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Bars, Segments } from "../charts";
import { C, Card, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const FEE = 0.0112;            // ATrad buy/sell charges, about 1.12% each way
const rs = (v: number) => `Rs ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const sg = (v: number | null | undefined, s = "%") => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}${s}`);
const col = (v: number | null | undefined) => (v == null ? C.muted : v >= 0 ? C.green : C.red);
const root = (s: string) => String(s).split(".")[0];

/** Portfolio insights: what-if calculator, monthly performance against the ASPI, dividends and yield. All plain arithmetic. */
export function InvestInsights({ api, held }: { api: Api; held: Row[] }) {
  const [tab, setTab] = useState<"whatif" | "aspi" | "div">("whatif");
  return <Card>
    <Kicker>PORTFOLIO INSIGHTS</Kicker>
    <Segments options={["whatif", "aspi", "div"] as const} value={tab} onChange={setTab} labels={{ whatif: "🧮 What-if", aspi: "🏁 vs ASPI", div: "💸 Dividends" }}/>
    {tab === "whatif" && <WhatIf held={held}/>}
    {tab === "aspi" && <VsAspi api={api}/>}
    {tab === "div" && <Dividends api={api}/>}
  </Card>;
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (s: string) => void }) {
  return <View style={{ flex: 1, gap: 4 }}><Text style={{ color: C.muted, fontSize: 11 }}>{label}</Text>
    <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholderTextColor={C.muted} placeholder="0"
      style={{ color: C.text, fontSize: 17, fontWeight: "800", backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 }}/></View>;
}

function Out({ label, value, color = C.text }: { label: string; value: string; color?: string }) {
  return <View style={{ width: "48%", backgroundColor: C.panel2, borderRadius: 14, padding: 10, gap: 2 }}>
    <Text style={{ color: C.muted, fontSize: 11 }}>{label}</Text><Text style={{ color, fontSize: 16, fontWeight: "900" }}>{value}</Text></View>;
}

function WhatIf({ held }: { held: Row[] }) {
  const [sym, setSym] = useState<string>(held[0]?.symbol || "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const h = held.find(x => x.symbol === sym);
  const [qty, setQty] = useState(""); const [price, setPrice] = useState("");
  useEffect(() => { if (h?.price) setPrice(String(h.price)); }, [sym]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = Number(qty) || 0, p = Number(price) || 0;
  const haveQ = Number(h?.quantity || 0), haveCost = Number(h?.cost || 0), avg = haveQ ? haveCost / haveQ : 0;
  let rows: [string, string, string?][] = [];
  if (q > 0 && p > 0) {
    if (side === "buy") {
      const pay = q * p * (1 + FEE), nq = haveQ + q, navg = (haveCost + pay) / nq, bes = navg * (1 + FEE) / (1 - FEE);
      rows = [["You pay (with fees)", rs(pay)], ["New quantity", nq.toLocaleString()], ["New average cost", navg.toFixed(2), navg < avg ? C.green : C.amber],
        ["New break-even (B.E.S)", bes.toFixed(2)], ["Avg change", sg(avg ? (navg / avg - 1) * 100 : null), navg < avg ? C.green : C.amber]];
    } else {
      const sell = Math.min(q, haveQ), net = sell * p * (1 - FEE), profit = net - sell * avg;
      rows = [["You receive (after fees)", rs(net)], ["Profit / loss on these", `${profit >= 0 ? "+" : ""}${rs(profit)}`, profit >= 0 ? C.green : C.red],
        ["Return on these", sg(avg ? (net / (sell * avg) - 1) * 100 : null), profit >= 0 ? C.green : C.red], ["Shares left", (haveQ - sell).toLocaleString()],
        ["Break-even price", avg ? (avg * (1 + FEE) / (1 - FEE)).toFixed(2) : "—"], ["Avg cost (unchanged)", avg ? avg.toFixed(2) : "—"]];
      if (q > haveQ) rows.push(["Note", `You hold only ${haveQ}`, C.amber]);
    }
  }
  return <View style={{ gap: 10 }}>
    {held.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{held.map(x =>
      <TouchableOpacity key={x.symbol} onPress={() => setSym(x.symbol)} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: sym === x.symbol ? C.green : C.line, backgroundColor: sym === x.symbol ? C.greenSoft : "transparent" }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{root(x.symbol)}</Text></TouchableOpacity>)}</ScrollView> : <Muted>Add your shares first.</Muted>}
    <Segments options={["buy", "sell"] as const} value={side} onChange={setSide} labels={{ buy: "If I buy more", sell: "If I sell" }}/>
    <Line><Num label="Quantity" value={qty} onChange={setQty}/><Num label="Price" value={price} onChange={setPrice}/></Line>
    {h && <Muted small>{`Now: ${haveQ.toLocaleString()} @ ${avg.toFixed(2)} · last ${h.price ?? "—"}`}</Muted>}
    {rows.length > 0 && <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }}>{rows.map(([l, v, c]) => <Out key={l} label={l} value={v} color={c}/>)}</View>}
    <Muted small>Includes ~1.12% broker charges each way. Just arithmetic: Sakuna never places orders.</Muted>
  </View>;
}

function VsAspi({ api }: { api: Api }) {
  const [d, setD] = useState<Row | null>(null); const [err, setErr] = useState("");
  useEffect(() => { api<Row>("/invest/performance").then(setD).catch(e => setErr(String(e?.message || e))); }, [api]);
  if (!d) return <Muted>{err || "Comparing a year of prices with the ASPI… (first time ~15 s)"}</Muted>;
  const months: Row[] = d.months;
  return <View style={{ gap: 10 }}>
    <Line>
      <Out label="Your mix, 12 months" value={sg(d.portfolio_total_pct)} color={col(d.portfolio_total_pct)}/>
      <Out label="ASPI, 12 months" value={sg(d.aspi_total_pct)} color={col(d.aspi_total_pct)}/></Line>
    <Text style={{ color: C.text, fontWeight: "800" }}>{`Beat the ASPI in ${d.beat_months} of ${d.compared_months} months`}</Text>
    <View style={{ gap: 6 }}>{months.map(m => { const p = m.portfolio_pct as number | null, a = m.aspi_pct as number | null, w = (x: number | null) => `${Math.min(100, Math.abs(x || 0) * 8)}%`;
      return <View key={m.month} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: C.muted, width: 32, fontSize: 12 }}>{m.label}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ height: 8, width: w(p), backgroundColor: col(p), borderRadius: 4 }}/>
          <View style={{ height: 5, width: w(a), backgroundColor: C.blue, opacity: 0.7, borderRadius: 3 }}/></View>
        <Text style={{ color: col(p), width: 62, textAlign: "right", fontWeight: "800", fontSize: 12 }}>{sg(p)}</Text>
        <Text style={{ width: 18 }}>{m.beat ? "🏆" : ""}</Text></View>; })}</View>
    <Muted small>{`Thick bar = your shares · thin blue = ASPI. ${d.note}`}</Muted>
  </View>;
}

function Dividends({ api }: { api: Api }) {
  const [d, setD] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/invest/dividends").then(setD).catch(() => undefined); }, [api]);
  if (!d) return <Muted>Loading dividends…</Muted>;
  return <View style={{ gap: 10 }}>
    <Line><Out label="Last 12 months" value={rs(Number(d.total_12m || 0))} color={C.green}/><Out label="Yield on cost" value={d.yield_on_cost != null ? `${d.yield_on_cost}%` : "—"} color={C.amber}/></Line>
    <Bars data={(d.months as Row[]).map(m => ({ label: m.label, value: Number(m.amount || 0) }))} height={110} format={n => (n ? rs(n) : "")} color={C.amber}/>
    {(d.shares as Row[]).map(s => <Line key={s.symbol}><Text style={{ color: C.text, fontWeight: "800", width: 70 }}>{root(s.symbol)}</Text>
      <Text style={{ color: C.green, flex: 1 }}>{rs(Number(s.amount_12m))}</Text><Muted small>{`${s.yield_on_cost ?? "—"}% on cost · ${s.yield_now ?? "—"}% now`}</Muted></Line>)}
    <Muted small>{d.tip}</Muted>
  </View>;
}
