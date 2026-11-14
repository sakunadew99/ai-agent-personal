import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => r instanceof Error ? r.message : "Something went wrong";
const ICON: Record<string, string> = { work: "💼", money: "💰", health: "💪", learning: "📚", relationships: "🤝", rest: "🌿", home: "🏠" };
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Life balance on the phone: each area's target vs actual this week, with a one-tap +1. */
export function BalanceScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/balance").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  return <Screen onRefresh={load}>
    <Card accent><Kicker>THIS WEEK</Kicker>
      <Line><H2>{`${v.met} of ${v.total}`}</H2><Muted>areas on target</Muted></Line>
      {(v.warnings as string[]).map(w => <Text key={w} style={{ color: C.amber, fontSize: 13 }}>{`⚠ ${w}`}</Text>)}
    </Card>
    {(v.areas as Row[]).map(a => <Card key={a.id}>
      <Line><Text style={{ fontSize: 20 }}>{ICON[a.key] || "⭐"}</Text><Text style={{ color: C.text, fontWeight: "800", flex: 1, fontSize: 15 }}>{a.name}</Text>
        <Badge tone={a.status === "met" ? "green" : a.status === "zero" ? "muted" : "amber"}>{a.status === "met" ? "on target" : a.status === "zero" ? "nothing yet" : `${a.percent}%`}</Badge></Line>
      <Progress value={Math.min(100, a.percent ?? 0)}/>
      <Line><Muted small>{`${Number(a.actual)} / ${Number(a.target)} ${a.unit}`}</Muted><View style={{ flex: 1 }}/>
        <Btn kind="outline" title={`+1 ${a.unit}`} onPress={() => void api(`/balance/areas/${a.id}/log`, "POST", { amount: 1 }).then(() => { onNotice(`+1 for ${a.name}`); load(); }).catch(r => onError(msg(r)))}/></Line>
    </Card>)}
    <Muted small>{v.note}</Muted>
  </Screen>;
}

const KINDS = ["passport", "visa", "national_id", "driving_license", "insurance", "warranty", "certificate", "other"] as const;
const LABEL: Record<string, string> = { passport: "Passport", visa: "Visa", national_id: "ID", driving_license: "Licence", insurance: "Insurance", warranty: "Warranty", certificate: "Certificate", other: "Other" };

/** Document vault on the phone: status, expiry, reveal (logged), renewal reminder. */
export function VaultScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("passport");
  const [name, setName] = useState(""); const [expires, setExpires] = useState(""); const [number, setNumber] = useState(""); const [where, setWhere] = useState("");
  const [shown, setShown] = useState<Record<string, string>>({});
  const load = useCallback(() => { api<Row>("/vault").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (w: Promise<unknown>, note: string) => void w.then(() => { onNotice(note); load(); }).catch(r => onError(msg(r)));
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  return <Screen onRefresh={load}>
    <Card accent><Kicker>DOCUMENT VAULT</Kicker>
      <Line>{(["expired", "renew_now", "valid"] as const).map(s => <View key={s} style={{ flex: 1 }}><Muted small>{s === "renew_now" ? "Renew now" : s === "expired" ? "Expired" : "Valid"}</Muted>
        <H2>{String(v.counts[s])}</H2></View>)}</Line>
      {(v.needed_for_plans as Row[]).map(n => <Text key={n.kind} style={{ color: n.have ? C.green : C.amber, fontSize: 13 }}>{`${n.have ? "✓" : "○"} ${n.label} · ${n.needed_for}`}</Text>)}
    </Card>
    {(v.documents as Row[]).map(d => <Card key={d.id}>
      <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{d.name}</Text>
        <Badge tone={d.status === "valid" ? "green" : d.status === "no_expiry" ? "muted" : d.status === "expired" ? "red" : "amber"}>{d.status === "renew_now" ? "renew now" : d.status.replace("_", " ")}</Badge></Line>
      <Muted small>{`${d.kind_label}${d.number_hint ? ` · ${shown[d.id] || d.number_hint}` : ""}${d.location_note ? ` · 📍 ${d.location_note}` : ""}`}</Muted>
      {d.expires_on && <Muted small>{`Expires ${day(d.expires_on)} · ${d.days_left < 0 ? `${-d.days_left} days ago` : `${d.days_left} days left`}`}</Muted>}
      <Line style={{ flexWrap: "wrap" }}>
        {d.has_number && <Btn kind="link" title={shown[d.id] ? "Shown" : "Reveal number"} onPress={() => void api<Row>(`/vault/documents/${d.id}/reveal`, "POST").then(r => {
          setShown(s => ({ ...s, [d.id]: r.number })); setTimeout(() => setShown(s => { const c = { ...s }; delete c[d.id]; return c; }), 20000); }).catch(r => onError(msg(r)))}/>}
        {d.expires_on && <Btn kind="link" title={d.reminder_task_id ? "Reminder set ✓" : "Remind me"} onPress={() => run(api(`/vault/documents/${d.id}/reminder`, "POST"), "Renewal task added.")}/>}
        <Btn kind="link" title="Delete" onPress={() => Alert.alert("Delete?", d.name, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => run(api(`/vault/documents/${d.id}`, "DELETE"), "Deleted.") }])}/>
      </Line>
    </Card>)}
    <Card><Kicker>ADD A DOCUMENT</Kicker>
      <Chips options={KINDS} value={kind} onChange={setKind} labels={LABEL}/>
      <Field value={name} onChangeText={setName} placeholder={`Name (default: ${LABEL[kind]})`} maxLength={120}/>
      <Field value={expires} onChangeText={setExpires} placeholder="Expires YYYY-MM-DD (optional)" maxLength={10}/>
      <Field value={number} onChangeText={setNumber} placeholder="Number (optional, encrypted)" maxLength={60} secureTextEntry/>
      <Field voice value={where} onChangeText={setWhere} placeholder="Where the copy is (e.g. home safe)" maxLength={300}/>
      <Btn title="Save" onPress={() => {
        if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) { onError("Date must look like 2031-05-20"); return; }
        run(api("/vault/documents", "POST", { name: name.trim() || LABEL[kind], kind, ...(expires ? { expires_on: expires } : {}), ...(number.trim() ? { number: number.trim() } : {}), ...(where.trim() ? { location_note: where.trim() } : {}) }), "Saved.");
        setName(""); setExpires(""); setNumber(""); setWhere("");
      }}/>
      <Muted small>Sakuna stores details, not files. Numbers are encrypted on the server.</Muted>
    </Card>
  </Screen>;
}

