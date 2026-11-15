import React, { useCallback, useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Field, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** "Say it once": speak or type; clear commands are added with Undo, unclear ones get one question. */
export function CommandCard({ api, onError, onCreated }: { api: Api; onError: (m: string) => void; onCreated?: () => void }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<Row | null>(null);
  const [free, setFree] = useState("");

  async function run(work: Promise<Row>) {
    setBusy(true);
    try { const row = await work; setCard(row); if (row.status === "created" || row.status === "undone") onCreated?.(); return row; }
    catch (reason) { onError(msg(reason)); return null; } finally { setBusy(false); }
  }
  async function submit() {
    if (!text.trim()) return;
    const row = await run(api<Row>("/commands", "POST", { text: text.trim(), source: voice ? "voice" : "text", idempotency_key: newKey() }));
    if (row) { setText(""); setVoice(false); }
  }
  const answer = (value: string) => { setFree(""); if (card) void run(api<Row>(`/commands/${card.id}/answer`, "POST", { answer: value })); };

  return <Card accent>
    <Kicker>SAY IT ONCE</Kicker>
    <Field voice value={text} onChangeText={v => { setText(v); if (v.length > text.length + 3) setVoice(true); }} placeholder="“Dentist Tuesday at 3” · “add milk to my buy list”" maxLength={500} onSubmitEditing={() => void submit()}/>
    <Btn title={busy ? "…" : "Do it"} onPress={() => void submit()} disabled={busy || !text.trim()}/>
    {card?.status === "created" && <View style={{ gap: 4 }}>
      <Line><Text style={{ color: C.green, fontWeight: "900" }}>✓</Text><Text style={{ color: C.text, fontWeight: "700", flex: 1 }}>{card.summary}</Text>
        <Btn kind="link" title="Undo" onPress={() => void run(api<Row>(`/commands/${card.id}/undo`, "POST"))}/></Line>
      {(card.defaults as string[] || []).length > 0 && <Muted small>{`Assumed: ${(card.defaults as string[]).join(" · ")}`}</Muted>}
    </View>}
    {card?.status === "needs_answer" && <View style={{ gap: 6 }}>
      <Text style={{ color: C.amber, fontWeight: "800" }}>{card.question}</Text>
      <Line style={{ flexWrap: "wrap" }}>{(card.options as Row[]).map(o => <Btn key={o.value} kind={o.value === "no" ? "outline" : "primary"} title={o.label} onPress={() => answer(o.value)}/>)}</Line>
      <Line><View style={{ flex: 1 }}><Field value={free} onChangeText={setFree} placeholder="…or type an answer" maxLength={200}/></View>
        <Btn kind="outline" title="Answer" disabled={!free.trim()} onPress={() => answer(free.trim())}/></Line>
    </View>}
    {card?.status === "cancelled" && <Muted small>Cancelled. Nothing was added.</Muted>}
    {card?.status === "undone" && <Muted small>Undone.</Muted>}
    {!card && <Muted small>Clear commands are added straight away with Undo. Sakuna never sends messages or pays for anything.</Muted>}
  </Card>;
}

const GROUPS: Record<string, string> = { chat: "Assistant chat", summary: "Conversation summaries", memory: "Memory search", transcription: "Audio transcription", voice_parse: "Unusual voice commands", exam: "Exam writing & speaking feedback" };

/** AI usage meter and privacy switches. */
export function AiScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/ai/usage").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const save = (body: Row) => void api<Row>("/ai/settings", "PATCH", body).then(setV).catch(r => onError(msg(r)));
  if (!v) return <Screen><Muted>Loading…</Muted></Screen>;
  const s = v.settings;
  const disabled: string[] = s.disabled_features || [];
  const row = (label: string, value: boolean, onChange: (b: boolean) => void, enabled = true) =>
    <Line key={label}><Text style={{ color: enabled ? C.text : C.muted, flex: 1 }}>{label}</Text><Switch value={value} onValueChange={onChange} disabled={!enabled} trackColor={{ true: C.green, false: C.line }}/></Line>;
  return <Screen onRefresh={load}>
    <Card accent><Kicker>AI STATUS</Kicker>
      <Text style={{ color: C.text }}>{v.status === "no_key" ? "No AI key: everything runs on built-in rules (free)." : v.status === "blocked" ? v.blocked_reason : "AI is on."}</Text>
      <Line><View style={{ flex: 1 }}><Muted small>Today</Muted><H2>{Number(v.today.tokens).toLocaleString()}</H2><Muted small>{`tokens · ${v.today.calls} calls`}</Muted></View>
        <View style={{ flex: 1 }}><Muted small>This month</Muted><H2>{Number(v.month.tokens).toLocaleString()}</H2><Muted small>{v.cost_known ? `≈ USD ${Number(v.month.cost_usd).toFixed(4)}` : "tokens"}</Muted></View></Line>
      {s.daily_token_cap ? <Progress value={Math.min(100, Math.round(v.today.tokens / s.daily_token_cap * 100))}/> : null}
      {row("Use AI", !s.ai_off, on => save({ ai_off: !on }))}
    </Card>
    <Card><Kicker>FEATURES</Kicker>{Object.entries(GROUPS).map(([g, label]) => row(label, !disabled.includes(g),
      on => save({ disabled_features: on ? disabled.filter(x => x !== g) : [...disabled, g] }), !s.ai_off))}</Card>
    <Card><Kicker>WHAT THE AI CAN SEE</Kicker>
      {row("Share money totals", s.share_money, on => save({ share_money: on }))}
      {row("Share health data", s.share_health, on => save({ share_health: on }))}
      {(v.what_ai_can_see as string[]).map(line => <Muted key={line} small>{`• ${line}`}</Muted>)}
      <Muted small>{`Never sent: ${(v.never_sent as string[]).join(" · ")}`}</Muted>
      <Muted small>Set daily or monthly caps on the web (Settings › AI).</Muted>
    </Card>
  </Screen>;
}
