import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KbScroll } from "../keyboard";
import * as DocumentPicker from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import type { ApiRecord as Row } from "../api";
import { LineChart, Meter, Ring, StatTile, TileRow } from "../charts";
import { openInApp } from "../browser";
import { Badge, Btn, C, Card, Empty, H2, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Upload = (path: string, file: { uri: string; name: string; type?: string | null }) => Promise<Row>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const rs = (v: unknown, d = 0) => (v == null ? "—" : `Rs ${Number(v).toLocaleString(undefined, { maximumFractionDigits: d })}`);
const sg = (v: unknown, suffix = "", d = 2) => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: d })}${suffix}`);
const col = (v: unknown) => (v == null ? C.muted : Number(v) >= 0 ? C.green : C.red);
const root = (s: string) => { const [r, c] = String(s).split("."); return c && c[0] !== "N" ? `${r}.${c[0]}` : r; };

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 14, borderBottomColor: C.line, borderBottomWidth: 1 }}>
        <TouchableOpacity onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.text, fontSize: 18 }}>✕</Text></TouchableOpacity>
        <Text style={{ color: C.text, fontSize: 18, fontWeight: "900", marginLeft: 12 }}>{title}</Text></View>
      <KbScroll contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">{children}</KbScroll>
    </View></KeyboardAvoidingView></Modal>;
}

/** One holding row: value, today, unrealised (Rs and %), after-fee value and break-even price, weight. */
export function HoldingRow({ h, onPress, onEdit }: { h: Row; onPress: () => void; onEdit?: () => void }) {
  return <TouchableOpacity onPress={onPress} style={{ borderRadius: 18, padding: 12, gap: 6, backgroundColor: C.panel2, borderLeftWidth: 4, borderLeftColor: col(h.unrealised) }}>
    <Line><Text style={{ color: C.text, fontSize: 17, fontWeight: "900" }}>{root(h.symbol)}</Text><Muted small>{`${Number(h.quantity).toLocaleString()} sh @ ${Number(h.avg_cost).toFixed(2)}`}</Muted>
      <View style={{ flex: 1 }}/><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }}>{rs(h.value)}</Text>
      {onEdit && <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ marginLeft: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: C.greenSoft, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: C.green, fontWeight: "900" }}>✎</Text></TouchableOpacity>}</Line>
    <Line><Text style={{ color: C.text, fontSize: 15, fontWeight: "900" }}>{`LKR ${h.price ?? "—"}`}</Text>
      <Text style={{ color: col(h.price_change), fontWeight: "900", fontSize: 13 }}>{`  ${sg(h.price_change)}  ${sg(h.change_pct, "%")}`}</Text>
      <View style={{ flex: 1 }}/><Text style={{ color: C.muted, fontSize: 12 }}>{"today "}<Text style={{ color: col(h.day_change), fontWeight: "900" }}>{`${sg(h.day_change, "", 0)} Rs`}</Text></Text></Line>
    <Line><Text style={{ color: C.muted, fontSize: 12, flex: 1 }}>{`Unrealised `}<Text style={{ color: col(h.unrealised), fontWeight: "900" }}>{`${sg(h.unrealised, "", 0)} Rs  (${sg(h.unrealised_pct, "%")})`}</Text></Text>
      <Text style={{ color: C.muted, fontSize: 11 }}>{`B.E.S ${h.break_even_price ?? "—"}`}</Text></Line>
    <Line><Text style={{ color: C.muted, fontSize: 11, flex: 1 }}>{`After sale fees: ${rs(h.net_sale_value)} · net ${sg(h.net_gain_after_fees, "", 0)}`}</Text><Text style={{ color: C.muted, fontSize: 11 }}>{`${h.weight_pct}%`}</Text></Line>
    <Meter value={h.weight_pct} color={col(h.unrealised)} height={5}/>
  </TouchableOpacity>;
}

/** Import an ATrad 'Client Portfolio' PDF (or CSV/text): preview, then save as opening positions. */
export function ImportPortfolio({ api, upload, onClose, onDone, onError }: { api: Api; upload: Upload; onClose: () => void; onDone: (v: Row) => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  async function pick() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "text/csv", "text/plain", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      setBusy(true);
      const f = res.assets[0];
      if (f.size && f.size > 5 * 1024 * 1024) { onError("That file is over 5 MB. Export only the portfolio page."); return; }
      // Sent as base64 JSON (like every other request) instead of a multipart upload, which fails on some phones.
      const data = await readAsStringAsync(f.uri, { encoding: "base64" });
      let out: Row | null = null, last: unknown = null;
      for (let attempt = 0; attempt < 3 && !out; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, attempt * 4000));     // the free server may be waking up
        try { out = await api<Row>("/invest/portfolio/preview-json", "POST", { filename: f.name || "portfolio.pdf", data_base64: data }); }
        catch (e) { last = e; if ((e as { status?: number })?.status) break; }  // a real answer (e.g. 422) is not retried
      }
      if (!out) throw last;
      setRows(out.rows);
    } catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (!rows) return;
    setBusy(true);
    try { const v = await api<Row>("/invest/portfolio/import", "POST", { rows: rows.filter(r => r.avg_price).map(r => ({ symbol: r.symbol, quantity: r.quantity, avg_price: r.avg_price })), replace: true }); onDone(v); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  return <Sheet title="Import my portfolio" onClose={onClose}>
    <Card accent><Kicker>FROM ATRAD (OR ANY BROKER)</Kicker>
      <Muted>In ATrad: Portfolio → Print → Save as PDF. Pick that file here. Sakuna reads symbol, quantity and average price, shows them, and saves only when you confirm.</Muted>
      <Btn title={busy && !rows ? "Reading…" : "📄 Choose PDF / CSV"} busy={busy && !rows} onPress={() => void pick()}/></Card>
    {rows && <Card><Kicker>{`${rows.length} HOLDINGS FOUND`}</Kicker>
      {rows.map((r, i) => <Line key={r.symbol}>
        <Text style={{ color: C.text, fontWeight: "800", width: 92 }}>{root(r.symbol)}</Text>
        <TextInput style={inp} keyboardType="decimal-pad" value={String(r.quantity)} onChangeText={t => setRows(x => x!.map((y, j) => j === i ? { ...y, quantity: Number(t.replace(/,/g, "")) || 0 } : y))}/>
        <Text style={{ color: C.muted }}>@</Text>
        <TextInput style={inp} keyboardType="decimal-pad" value={String(r.avg_price ?? "")} placeholder="avg" placeholderTextColor={C.muted} onChangeText={t => setRows(x => x!.map((y, j) => j === i ? { ...y, avg_price: Number(t) || null } : y))}/>
        <TouchableOpacity onPress={() => setRows(x => x!.filter((_, j) => j !== i))}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></Line>)}
      <Muted small>{`Total cost ≈ ${rs(rows.reduce((n, r) => n + Number(r.quantity) * Number(r.avg_price || 0), 0))}. Replaces your previous import; trades you added yourself stay.`}</Muted>
      <Btn title="✓ Save as my holdings" busy={busy} onPress={() => void save()}/></Card>}
  </Sheet>;
}
const inp = { width: 82, color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 6, textAlign: "center" as const };

export function AddHolding({ api, onClose, onDone, onError, picker }: { api: Api; onClose: () => void; onDone: (v: Row) => void; onError: (m: string) => void; picker: (v: string, set: (s: string) => void) => React.ReactNode }) {
  const [sym, setSym] = useState(""); const [qty, setQty] = useState(""); const [avg, setAvg] = useState("");
  return <Sheet title="Add a share I own" onClose={onClose}>
    <Card><Kicker>SHARE</Kicker>{picker(sym, setSym)}
      <Line><View style={{ flex: 1, gap: 4 }}><Muted small>Quantity</Muted><TextInput style={[inp, { width: "100%" }]} keyboardType="decimal-pad" value={qty} onChangeText={setQty} placeholder="e.g. 350" placeholderTextColor={C.muted}/></View>
        <View style={{ flex: 1, gap: 4 }}><Muted small>Average cost (Rs)</Muted><TextInput style={[inp, { width: "100%" }]} keyboardType="decimal-pad" value={avg} onChangeText={setAvg} placeholder="e.g. 161.24" placeholderTextColor={C.muted}/></View></Line>
      <Btn title="Add to my portfolio" disabled={!sym || !qty || !avg} onPress={() => void api<Row>("/invest/holdings", "POST", { symbol: sym, quantity: Number(qty), avg_price: Number(avg) }).then(onDone).catch(e => onError(msg(e)))}/>
      <Muted small>For shares you already own: no need for the full trade history. Values update every day from CSE prices.</Muted></Card>
  </Sheet>;
}

const ACTION_TONE: Record<string, string> = { "Add on dips": C.green, "Accumulate slowly": C.green, Hold: C.blue, "Watch closely": C.amber, "Trim / take some profit": C.amber, "Review / consider stop-loss": C.red };

/** Daily AI-style review: market context, per-share signals and suggestions, optional AI summary. */
export function PortfolioReview({ api, onClose, onError }: { api: Api; onClose: () => void; onError: (m: string) => void }) {
  const [r, setR] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = (ai = false) => { setBusy(true); api<Row>(`/invest/review${ai ? "?ai=true" : ""}`).then(setR).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const m: Row = r?.market || {};
  return <Sheet title="Portfolio review" onClose={onClose}>
    {r && !(r.holdings as Row[]).length && <Card accent><Kicker>NO SHARES SAVED YET</Kicker>
      <Muted>Your portfolio is empty, so values show Rs 0. Close this and tap “📄 Import ATrad PDF” (or “＋ Share I own”) on the Invest screen, then run the review again.</Muted></Card>}
    {!r ? <Empty>{busy ? "Reading a year of CSE prices, oil, rupee and news… (first time ~20 s)" : "No data"}</Empty> : <>
      <View style={{ borderRadius: 24, padding: 16, gap: 8, backgroundColor: "#0f1a15", borderWidth: 1, borderColor: "#2a6b4a" }}>
        <Line><View style={{ flex: 1 }}><Text style={{ color: C.green, fontWeight: "800", fontSize: 11, letterSpacing: 1.4 }}>PORTFOLIO · TODAY</Text>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: "900" }}>{rs(r.value)}</Text>
          <Text style={{ color: col(r.unrealised), fontWeight: "800" }}>{`Unrealised ${sg(r.unrealised, "", 0)} (${sg(r.unrealised_pct, "%")})`}</Text>
          <Text style={{ color: col(r.day_change), fontWeight: "700" }}>{`Today ${sg(r.day_change, "", 0)} Rs`}</Text></View>
          <Ring value={Math.max(0, Math.min(100, 50 + Number(r.unrealised_pct || 0)))} size={88} color={col(r.unrealised)} label={sg(r.unrealised_pct, "%", 1)} sub="GAIN"/></Line>
      </View>
      <TileRow>
        <StatTile label="ASPI" tone={m.aspi_trend === "up" ? "green" : "red"} value={m.aspi ? Number(m.aspi).toLocaleString() : "—"}
          hint={`${m.aspi_change != null ? `${sg(m.aspi_change)} pts (${sg(m.aspi_change_pct, "%")}) today · ` : ""}${sg(m.aspi_1m_pts, " pts", 0)} / ${sg(m.aspi_1m_pct, "%")} 1M`}/>
        <StatTile label="Brent oil" tone="amber" value={m.brent ? `$${m.brent}` : "—"} hint={`${sg(m.brent_1m_pct, "%")} 1 month`}/>
      </TileRow>
      <TileRow>
        <StatTile label="USD / LKR" tone="blue" value={m.usd_lkr ? String(m.usd_lkr) : "—"} hint={`${sg(m.usd_lkr_1m_pct, "%")} 1 month`}/>
        <StatTile label="Gold" tone="violet" value={m.gold ? `$${Number(m.gold).toLocaleString()}` : "—"} hint={`${sg(m.gold_1m_pct, "%")} 1 month`}/>
      </TileRow>
      {(m.notes as string[] || []).length > 0 && <Card><Kicker>🌍 WHAT'S MOVING THE MARKET</Kicker>{(m.notes as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${x}`}</Text>)}</Card>}
      <Card accent><Kicker>SUMMARY</Kicker><Text style={{ color: C.text, lineHeight: 21 }}>{String(r.summary).replace(/\*\*/g, "").replace(/^#+\s*/gm, "")}</Text>
        <Btn kind="outline" title={busy ? "Writing…" : "✨ AI summary"} busy={busy} onPress={() => load(true)}/></Card>
      {(r.portfolio_notes as string[]).map((x, i) => <Text key={i} style={{ color: C.amber }}>{`⚠ ${x}`}</Text>)}
      <H2>Each share</H2>
      {(r.holdings as Row[]).map(h => { const s: Row = h.suggestion, ind: Row = h.indicators || {}, f: Row | null = ind.forecast || null, isOpen = open === h.symbol;
        return <Card key={h.symbol} style={{ borderLeftWidth: 4, borderLeftColor: ACTION_TONE[s.action] || C.line }}>
          <TouchableOpacity onPress={() => setOpen(isOpen ? null : h.symbol)} style={{ gap: 4 }}>
            <Line><Text style={{ color: C.text, fontSize: 17, fontWeight: "900", flex: 1 }}>{root(h.symbol)}</Text><Badge tone={s.score >= 1 ? "green" : s.score <= -2 ? "red" : "amber"}>{s.action}</Badge></Line>
            <Text style={{ color: col(h.unrealised), fontWeight: "900" }}>{`Unrealised ${sg(h.unrealised, "", 0)} Rs (${sg(h.unrealised_pct, "%")}) · value ${rs(h.value)}`}</Text>
            <Text style={{ color: col(h.price_change), fontWeight: "700", fontSize: 12 }}>{`LKR ${h.price ?? "—"}  ${sg(h.price_change)} (${sg(h.change_pct, "%")}) · today ${sg(h.day_change, "", 0)} Rs`}</Text>
            <Muted small>{`${Number(h.quantity).toLocaleString()} sh @ ${Number(h.avg_cost).toFixed(2)} · RSI ${ind.rsi14 ?? "—"} · 1M ${sg(ind.ret_1m, "%")}`}</Muted>
            {f && <Text style={{ color: col(f.expected_change_pct), fontSize: 12 }}>{`Model, 2 weeks: ${sg(f.expected_change_pct, "%")} (range ${f.low}–${f.high})`}</Text>}
          </TouchableOpacity>
          {isOpen && <View style={{ gap: 6 }}>
            {(ind.spark as number[] || []).length > 5 && <LineChart series={[{ values: ind.spark as number[], color: col(ind.ret_3m) }]} labels={(ind.spark as number[]).map(() => "")} height={80}/>}
            {(s.reasons as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${x}`}</Text>)}
            <Muted small>{`50-day avg ${ind.sma50 ? Number(ind.sma50).toFixed(2) : "—"} · 1-year high ${ind.high_1y ?? "—"} (${sg(ind.from_high_pct, "%")}) · volatility ${ind.volatility_pct ?? "—"}% · confidence ${s.confidence}`}</Muted>
            {(h.news as Row[]).map(n => <TouchableOpacity key={n.url} onPress={() => openInApp(n.url, n.title)}><Text style={{ color: n.tone === "negative" ? C.red : n.tone === "positive" ? C.green : C.text }}>{`📰 ${n.title}`}</Text></TouchableOpacity>)}
          </View>}
        </Card>; })}
      <Muted small>{r.disclaimer}</Muted>
    </>}
  </Sheet>;
}
