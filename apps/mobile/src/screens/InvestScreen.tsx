import * as DocumentPicker from "expo-document-picker";
import { InvestInsights } from "./InvestInsights";
import React, { useCallback, useEffect, useState } from "react";
import { Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Empty, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";
import { DateField } from "../pickers";
import { AddHolding, HoldingRow, ImportPortfolio, PortfolioReview } from "./InvestPlus";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Upload = (path: string, file: { uri: string; name: string; type?: string | null }) => Promise<Row>;
type Props = { api: Api; upload: Upload; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const lkr = (v: unknown) => (v == null ? "—" : `Rs ${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const signed = (v: unknown, suffix = "") => (v == null ? "—" : `${Number(v) >= 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`);
const tone = (v: unknown) => (v == null ? C.muted : Number(v) >= 0 ? C.green : "#ff9b8c");
/** "JKH.N0000" -> "JKH"; other share classes keep their letter so they can't be mixed up: "COMB.X0000" -> "COMB.X". */
const root = (s: string) => { const [r, cls] = String(s).split("."); return cls && cls[0] !== "N" ? `${r}.${cls[0]}` : r; };
const CLASS_NAME: Record<string, string> = { N: "voting", X: "non-voting", Y: "non-voting", P: "preference", R: "rights", W: "warrant" };

/** Symbol box with a dropdown of matching CSE shares, so COMB.N0000 (voting) and COMB.X0000 (non-voting) are picked exactly. */
function SymbolPicker({ api, value, onChange, placeholder = "Symbol or company, e.g. COMB" }: { api: Api; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [items, setItems] = useState<Row[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) return;
    const q = value.trim();
    const timer = setTimeout(() => { api<Row>(`/invest/symbols?q=${encodeURIComponent(q)}`).then(r => { setItems(r.items || []); setHint(r.hint || null); }).catch(() => setItems([])); }, 250);
    return () => clearTimeout(timer);
  }, [api, value, focused]);
  const exact = items.some(i => i.symbol === value.trim().toUpperCase());
  return <View style={{ gap: 6 }}>
    <TextInput style={s.input} value={value} onChangeText={t => onChange(t.toUpperCase())} onFocus={() => setFocused(true)} placeholder={placeholder} placeholderTextColor={C.muted} autoCapitalize="characters"/>
    {focused && !exact && (items.length > 0 || hint) && <View style={s.dropdown}>
      {items.slice(0, 8).map(i => <TouchableOpacity key={i.symbol} style={s.dropItem} onPress={() => { onChange(i.symbol); setFocused(false); }}>
        <View style={{ flex: 1 }}><Text style={s.sym}>{i.symbol}</Text><Text style={{ color: C.muted, fontSize: 11 }} numberOfLines={1}>{i.name || "—"}</Text></View>
        <Text style={[s.classTag, i.share_class !== "N" && { color: C.amber, borderColor: C.amber }]}>{i.class_label || CLASS_NAME[i.share_class] || "share"}</Text>
        {i.close != null && <Text style={{ color: C.text, marginLeft: 8, fontWeight: "700" }}>{Number(i.close).toFixed(2)}</Text>}
      </TouchableOpacity>)}
      {!items.length && !!hint && <Text style={{ color: C.muted, fontSize: 12, padding: 10 }}>{hint}</Text>}
    </View>}
    {exact && <Text style={{ color: C.muted, fontSize: 11 }}>{`${value.split(".")[1]?.[0] === "N" ? "Voting" : "Non-voting / other class"} share selected.`}</Text>}
  </View>;
}
const today = () => new Date().toISOString().slice(0, 10);

/** CSE investing: portfolio from your trades, prices from the CSE website or your file, signals from YOUR rules. */
export function InvestScreen({ api, upload, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(() => peek("/invest"));
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"trade" | "paste" | "import" | "holding" | "review" | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [watchAdd, setWatchAdd] = useState("");
  const load = useCallback(() => { api<Row>("/invest").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading your portfolio…</Empty></Screen>;
  const p = v.portfolio, idx = p.index;
  const held = (p.items as Row[]).filter(i => Number(i.quantity) > 0);
  const newAlerts = (v.alerts as Row[]).filter(a => a.status === "new");

  async function fetchCse() {
    setBusy("fetch");
    try { const out = await api<Row>("/invest/fetch", "POST"); setV(out); onNotice(`CSE prices for ${out.trade_date}: ${out.saved} shares${out.new_alerts ? ` · ${out.new_alerts} rule alert(s)` : ""}`); }
    catch (e) { onError(msg(e)); } finally { setBusy(null); }
  }
  async function pickFile() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "*/*"], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const f = res.assets[0];
      setBusy("upload");
      const out = await upload("/invest/upload", { uri: f.uri, name: f.name, type: f.mimeType });
      onNotice(`${out.kind === "trades" ? "Trades" : "Prices"}: ${out.saved} saved${out.skipped?.length ? `, ${out.skipped.length} skipped (${out.skipped[0]})` : ""}`);
      load();
    } catch (e) { onError(msg(e)); } finally { setBusy(null); }
  }

  return <Screen onRefresh={load}>
    <Card accent>
      <Line><Kicker>PORTFOLIO</Kicker><View style={{ flex: 1 }}/>{v.last_price_date && <Muted small>{`prices ${v.last_price_date}`}</Muted>}</Line>
      <Text style={s.value}>{lkr(p.value)}</Text>
      <Line>
        <View style={{ flex: 1 }}><Text style={[s.stat, { color: tone(p.day_change) }]}>{signed(p.day_change)}</Text><Muted small>today</Muted></View>
        <View style={{ flex: 1 }}><Text style={[s.stat, { color: tone(p.unrealised) }]}>{signed(p.unrealised)}</Text><Muted small>{`unrealised ${signed(p.unrealised_pct, "%")}`}</Muted></View>
        <View style={{ flex: 1 }}><Text style={[s.stat, { color: tone(p.total_return) }]}>{signed(p.total_return)}</Text><Muted small>total return</Muted></View>
      </Line>
      <Muted small>{`Cost ${lkr(p.cost)} · realised ${signed(p.realised)} · dividends ${lkr(p.dividends)}`}</Muted>
      {idx && <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.panel2, borderRadius: 14, padding: 10 }}>
        <Text style={{ color: C.muted, fontWeight: "800" }}>ASPI</Text><Text style={{ color: C.text, fontWeight: "900", fontSize: 17 }}>{Number(idx.close).toLocaleString()}</Text>
        <Text style={{ color: tone(idx.change_pct), fontWeight: "900" }}>{`${Number(idx.change_pct) >= 0 ? "▲" : "▼"} ${idx.change != null ? `${signed(idx.change)}  ` : ""}${signed(idx.change_pct, "%")}`}</Text>
        <View style={{ flex: 1 }}/><Muted small>{idx.date}</Muted></View>}
      <Line>
        <Btn title={busy === "fetch" ? "Reading CSE…" : "↻ CSE prices"} busy={busy === "fetch"} onPress={() => void fetchCse()} style={{ flex: 1 }}/>
        <Btn kind="outline" title={busy === "upload" ? "Uploading…" : "⬆ CSV / Excel"} busy={busy === "upload"} onPress={() => void pickFile()} style={{ flex: 1 }}/>
      </Line>
      <Line><Btn title="📊 AI review" onPress={() => setModal("review")} style={{ flex: 1 }}/><Btn kind="outline" title="📄 Import ATrad PDF" onPress={() => setModal("import")} style={{ flex: 1 }}/></Line>
      <Line><Btn kind="link" title="＋ Share I own" onPress={() => setModal("holding")}/><Btn kind="link" title="📋 Paste" onPress={() => setModal("paste")}/><View style={{ flex: 1 }}/><Btn kind="link" title="＋ Trade" onPress={() => setModal("trade")}/></Line>
    </Card>

    {newAlerts.length > 0 && <Card style={{ borderColor: C.amber }}>
      <Line><Kicker>RULE ALERTS</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title="Mark seen" onPress={() => void api("/invest/alerts/seen", "POST").then(load)}/></Line>
      {newAlerts.map(a => <TouchableOpacity key={a.id} onPress={() => setSymbol(a.symbol)}><Text style={s.alert}>🔔 {a.message}</Text></TouchableOpacity>)}
      <Muted small>{v.disclaimer}</Muted>
    </Card>}

    <Card>
      <Kicker>{`HOLDINGS · ${held.length}`}</Kicker>
      {held.length ? <View style={{ gap: 8 }}>{held.map(h => <HoldingRow key={h.symbol} h={h} onPress={() => setSymbol(h.symbol)}/>)}</View> : <Muted>No holdings yet. Add a trade, or upload your broker's trade history (CSV / Excel with Date, Symbol, Buy/Sell, Qty, Price).</Muted>}
      {(p.sectors as Row[]).length > 1 && <Muted small>{"Sectors: " + (p.sectors as Row[]).map(x => `${x.sector} ${x.pct}%`).join(" · ")}</Muted>}
    </Card>

    <InvestInsights api={api} held={held}/>

    <Card>
      <Kicker>WATCHLIST · YOUR RULES</Kicker>
      {(v.watchlist as Row[]).map(w => <TouchableOpacity key={w.symbol} onPress={() => setSymbol(w.symbol)} style={s.holding}>
        <Line><Text style={s.sym}>{root(w.symbol)}</Text>{w.held && <Badge>held</Badge>}<View style={{ flex: 1 }}/><Text style={s.sym}>{w.price ?? "—"}</Text>
          <Text style={{ color: tone(w.change_pct), marginLeft: 6 }}>{signed(w.change_pct, "%")}</Text></Line>
        <Muted small>{[w.target_buy != null && `buy ≤ ${w.target_buy}`, w.stop_loss != null && `stop ${w.stop_loss}`, w.take_profit != null && `take ${w.take_profit}`,
          w.pe != null && `P/E ${w.pe}`, w.yield_pct != null && `yield ${w.yield_pct}%`].filter(Boolean).join(" · ") || "No rules yet: tap to set"}</Muted>
        {(w.signals as Row[]).map(sg => <Text key={sg.rule} style={s.signal}>● {sg.text}</Text>)}
      </TouchableOpacity>)}
      <View style={{ gap: 8 }}><SymbolPicker api={api} value={watchAdd} onChange={setWatchAdd}/>
        <Btn title="Add to watchlist" onPress={() => { if (watchAdd.trim()) void api(`/invest/watch/${encodeURIComponent(watchAdd.trim())}`, "PUT", {}).then(() => { setSymbol(watchAdd.trim().toUpperCase().includes(".") ? watchAdd.trim().toUpperCase() : `${watchAdd.trim().toUpperCase()}.N0000`); setWatchAdd(""); load(); }).catch(e => onError(msg(e))); }}/></View>
      <Muted small>{v.disclaimer}</Muted>
    </Card>

    {modal === "trade" && <TradeModal api={api} onClose={() => setModal(null)} onSaved={next => { setV(next); setModal(null); onNotice("Trade recorded"); }} onError={onError}/>}
    {modal === "import" && <ImportPortfolio api={api} upload={upload} onClose={() => setModal(null)} onError={onError} onDone={next => { setV(next); setModal(null); onNotice(`Portfolio imported: ${next.saved} holdings`); }}/>}
    {modal === "holding" && <AddHolding api={api} onClose={() => setModal(null)} onError={onError} onDone={next => { setV(next); setModal(null); onNotice("Share added"); }}
      picker={(val, set) => <SymbolPicker api={api} value={val} onChange={set}/>}/>}
    {modal === "review" && <PortfolioReview api={api} onClose={() => setModal(null)} onError={onError}/>}
    {modal === "paste" && <PasteModal api={api} onClose={() => setModal(null)} onSaved={(text) => { setModal(null); onNotice(text); load(); }} onError={onError}/>}
    {symbol && <SymbolSheet api={api} symbol={symbol} watch={(v.watchlist as Row[]).find(w => w.symbol === symbol)} holding={held.find(h => h.symbol === symbol)}
      onClose={() => { setSymbol(null); load(); }} onError={onError} onNotice={onNotice}/>}
  </Screen>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={s.modal}>
      <View style={s.modalTop}><TouchableOpacity style={s.close} onPress={onClose}><Text style={s.closeText}>✕</Text></TouchableOpacity><Text style={s.modalTitle}>{title}</Text><View style={{ width: 40 }}/></View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  </Modal>;
}

function TradeModal({ api, onClose, onSaved, onError }: { api: Api; onClose: () => void; onSaved: (v: Row) => void; onError: (m: string) => void }) {
  const [t, setT] = useState({ symbol: "", side: "buy", quantity: "", price: "", fees: "", trade_date: today() });
  return <Sheet title="Record a trade" onClose={onClose}>
    <View style={s.pills}>{(["buy", "sell", "dividend"] as const).map(x => <TouchableOpacity key={x} style={[s.pill, t.side === x && s.pillOn]} onPress={() => setT({ ...t, side: x })}>
      <Text style={[s.pillText, t.side === x && { color: C.green }]}>{x}</Text></TouchableOpacity>)}</View>
    <SymbolPicker api={api} value={t.symbol} onChange={symbol => setT({ ...t, symbol })}/>
    <TextInput style={s.input} value={t.quantity} onChangeText={quantity => setT({ ...t, quantity })} placeholder={t.side === "dividend" ? "Shares that received it" : "Quantity"} placeholderTextColor={C.muted} keyboardType="decimal-pad"/>
    <TextInput style={s.input} value={t.price} onChangeText={price => setT({ ...t, price })} placeholder={t.side === "dividend" ? "Dividend per share (Rs)" : "Price per share (Rs)"} placeholderTextColor={C.muted} keyboardType="decimal-pad"/>
    {t.side !== "dividend" && <TextInput style={s.input} value={t.fees} onChangeText={fees => setT({ ...t, fees })} placeholder="Fees / commission (Rs)" placeholderTextColor={C.muted} keyboardType="decimal-pad"/>}
    <DateField label="Trade date" value={t.trade_date} onChange={v => v && setT({ ...t, trade_date: v })}/>
    <Btn title="Save trade" onPress={() => void api<Row>("/invest/trades", "POST", { ...t, quantity: Number(t.quantity), price: Number(t.price), fees: Number(t.fees || 0) })
      .then(onSaved).catch(e => onError(msg(e)))}/>
    <Muted small>This only records what you did at your broker. Sakuna never places orders.</Muted>
  </Sheet>;
}

function PasteModal({ api, onClose, onSaved, onError }: { api: Api; onClose: () => void; onSaved: (text: string) => void; onError: (m: string) => void }) {
  const [text, setText] = useState("");
  return <Sheet title="Paste from Excel" onClose={onClose}>
    <Muted>Copy the rows (with the header row) in Excel or Google Sheets and paste them here. Prices need Symbol + Close/Price/LTP; trades need Date, Symbol, Buy/Sell, Qty, Price.</Muted>
    <TextInput style={[s.input, { minHeight: 200, textAlignVertical: "top" }]} multiline value={text} onChangeText={setText} placeholder={"Symbol\tLTP\nJKH\t21.50"} placeholderTextColor={C.muted}/>
    <Btn title="Import" disabled={text.trim().length < 5} onPress={() => void api<Row>("/invest/import-text", "POST", { text })
      .then(out => onSaved(`${out.kind === "trades" ? "Trades" : "Prices"}: ${out.saved} saved${out.skipped.length ? `, ${out.skipped.length} skipped` : ""}`)).catch(e => onError(msg(e)))}/>
  </Sheet>;
}

function SymbolSheet({ api, symbol, watch, holding, onClose, onError, onNotice }: { api: Api; symbol: string; watch?: Row; holding?: Row; onClose: () => void; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [d, setD] = useState<Row | null>(null);
  const [rules, setRules] = useState<Row>(() => Object.fromEntries(["sector", "target_buy", "stop_loss", "take_profit", "max_pe", "min_yield", "eps", "dps"]
    .map(k => [k, watch?.[k] != null ? String(watch[k]) : ""])));
  const load = useCallback((ai = false) => { api<Row>(`/invest/symbols/${encodeURIComponent(symbol)}${ai ? "?ai=true" : ""}`).then(setD).catch(e => onError(msg(e))); }, [api, symbol, onError]);
  useEffect(() => { load(); }, [load]);
  const hist = (d?.history as Row[]) || [];
  const max = Math.max(...hist.map(h => Number(h.close)), 1), min = Math.min(...hist.map(h => Number(h.close)), max);
  const save = () => {
    const body: Row = {};
    for (const [k, val] of Object.entries(rules)) body[k] = k === "sector" ? (String(val).trim() || null) : (String(val).trim() === "" ? null : Number(val));
    void api(`/invest/watch/${encodeURIComponent(symbol)}`, "PUT", body).then(() => onNotice("Rules saved")).catch(e => onError(msg(e)));
  };
  const field = (k: string, label: string) => <View style={{ flex: 1, gap: 4 }}><Text style={s.label}>{label}</Text>
    <TextInput style={s.input} value={rules[k]} onChangeText={x => setRules({ ...rules, [k]: x })} keyboardType={k === "sector" ? "default" : "decimal-pad"} placeholderTextColor={C.muted} placeholder="—"/></View>;
  return <Sheet title={root(symbol)} onClose={onClose}>
    {holding && <Card><Kicker>YOUR HOLDING</Kicker><H2>{`${Number(holding.quantity).toLocaleString()} shares · ${lkr(holding.value)}`}</H2>
      <Muted small>{`Avg cost ${holding.avg_cost} · unrealised ${signed(holding.unrealised)} (${signed(holding.unrealised_pct, "%")}) · dividends ${lkr(holding.dividends)}`}</Muted></Card>}
    {hist.length > 1 && <Card><Kicker>{`PRICE · LAST ${hist.length} DAYS`}</Kicker>
      <View style={s.chart}>{hist.map((h, i) => <View key={i} style={[s.bar, { height: `${8 + ((Number(h.close) - min) / Math.max(0.01, max - min)) * 92}%` }]}/>)}</View>
      <Muted small>{`${hist[0].date}: ${hist[0].close} → ${hist[hist.length - 1].date}: ${hist[hist.length - 1].close}`}</Muted></Card>}
    <Card>
      <Kicker>YOUR RULES</Kicker>
      <Line>{field("target_buy", "Buy at or below")}{field("stop_loss", "Stop-loss")}</Line>
      <Line>{field("take_profit", "Take profit")}{field("sector", "Sector")}</Line>
      <Line>{field("eps", "EPS (annual)")}{field("max_pe", "Max P/E")}</Line>
      <Line>{field("dps", "Dividend / share")}{field("min_yield", "Min yield %")}</Line>
      <Btn title="Save rules" onPress={save}/>
      <Muted small>EPS and dividend per share come from the company's latest annual report; Sakuna uses them with the live price for P/E and yield.</Muted>
    </Card>
    <Card>
      <Line><Kicker>NEWS AND RESEARCH</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title="✨ Summarise" onPress={() => load(true)}/></Line>
      {d?.research?.ai && <View style={{ gap: 4 }}><Text style={s.body}>{d.research.ai.summary}</Text>
        {(d.research.ai.positives as string[]).map(x => <Text key={x} style={[s.body, { color: "#a5e3be" }]}>＋ {x}</Text>)}
        {(d.research.ai.risks as string[]).map(x => <Text key={x} style={[s.body, { color: "#ffb1a0" }]}>− {x}</Text>)}</View>}
      {((d?.research?.news as Row[]) || []).map(n => <TouchableOpacity key={n.url} onPress={() => { if (/^https?:\/\//.test(n.url)) void Linking.openURL(n.url); }}>
        <Text style={s.news}>• {n.title}</Text></TouchableOpacity>)}
      {d && !(d.research.news as Row[]).length && <Muted small>No recent stories about this company in your news feeds.</Muted>}
      <Muted small>{d?.research?.disclaimer}</Muted>
    </Card>
    {watch && <Btn kind="danger" title="Remove from watchlist" onPress={() => void api(`/invest/watch/${encodeURIComponent(symbol)}`, "DELETE").then(onClose).catch(e => onError(msg(e)))}/>}
  </Sheet>;
}

const s = StyleSheet.create({
  dropdown: { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  dropItem: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomColor: C.line, borderBottomWidth: 1 },
  classTag: { color: C.green, borderColor: C.green, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontWeight: "800", overflow: "hidden" },
  value: { color: C.text, fontSize: 32, fontWeight: "900", fontVariant: ["tabular-nums"] },
  stat: { fontSize: 16, fontWeight: "800", fontVariant: ["tabular-nums"] },
  index: { color: "#d1ddd4", fontSize: 13, fontWeight: "700" },
  alert: { color: "#ffd38a", fontSize: 14, lineHeight: 20 },
  holding: { gap: 4, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  sym: { color: C.text, fontSize: 15, fontWeight: "800", marginRight: 6 },
  signal: { color: C.amber, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  label: { color: "#aab8af", fontSize: 11, fontWeight: "700" },
  pills: { flexDirection: "row", gap: 8 },
  pill: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 8 },
  pillOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  pillText: { color: C.muted, fontWeight: "700", textTransform: "capitalize" },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 44, paddingBottom: 8 },
  modalTitle: { color: C.text, fontSize: 19, fontWeight: "800" },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  closeText: { color: C.text, fontSize: 18 },
  chart: { flexDirection: "row", alignItems: "flex-end", height: 110, gap: 1 },
  bar: { flex: 1, backgroundColor: C.green, borderRadius: 2, minHeight: 2 },
  body: { color: "#d1ddd4", fontSize: 14, lineHeight: 20 },
  news: { color: C.text, fontSize: 13, lineHeight: 20, paddingVertical: 3 },
});
