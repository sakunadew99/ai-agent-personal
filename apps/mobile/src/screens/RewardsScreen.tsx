import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";
const QUEST_EVENTS = ["focus", "task", "habit", "workout", "steps", "sleep"] as const;

/** Points, level, streak, quests and treats (same as the web Rewards page). Pause any time. */
export function RewardsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [g, setG] = useState<Row | null>(null);
  const [treatName, setTreatName] = useState(""); const [treatCost, setTreatCost] = useState("");
  const [questTitle, setQuestTitle] = useState(""); const [questEvent, setQuestEvent] = useState<(typeof QUEST_EVENTS)[number]>("focus");
  const [questCount, setQuestCount] = useState("2");
  const load = useCallback(() => { api<Row>("/game").then(setG).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note: string) => void work.then(() => { onNotice(note); load(); }).catch(r => onError(msg(r)));

  function redeem(t: Row) {
    const money = t.money_cost ? ` (also ${t.currency} ${Number(t.money_cost).toLocaleString()} from fun money)` : "";
    Alert.alert("Redeem treat?", `${t.name} for ${t.cost_points} points${money}`, [{ text: "Cancel", style: "cancel" }, {
      text: "Redeem", onPress: () => void api<Row>(`/game/treats/${t.id}/redeem`, "POST", { confirm: true }).then(r => { onNotice(`🎉 ${r.redeemed}!`); load(); })
        .catch(reason => {
          const text = msg(reason);
          if (/fun money|fun-money/i.test(text)) Alert.alert("Fun money is short", text, [{ text: "Cancel", style: "cancel" },
            { text: "Go ahead", onPress: () => run(api(`/game/treats/${t.id}/redeem`, "POST", { confirm: true, over_budget_ok: true }), `🎉 ${t.name}!`) }]);
          else onError(text);
        }),
    }]);
  }

  if (!g) return <Screen><Empty>Loading…</Empty></Screen>;
  return <Screen onRefresh={load}>
    <Card accent>
      <Line><View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: C.green, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: C.greenDark, fontWeight: "900", fontSize: 18 }}>{`Lv ${g.level}`}</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Progress value={Math.round(g.into_level / g.next_level_at * 100)}/><Muted small>{`${g.into_level}/${g.next_level_at} to level ${g.level + 1}`}</Muted></View></Line>
      <Line><View style={{ flex: 1 }}><Muted small>Today</Muted><H2>{`${g.today.points}/${g.today.cap}`}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Balance</Muted><H2>{`${g.balance} pts`}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Streak</Muted><H2>{`${g.streak_days} 🔥`}</H2></View></Line>
      <Muted small>{`Life areas today: ${g.today.areas.length}/4${g.today.bonus ? ` · +${g.today.bonus} balance bonus` : " · 4 areas = ×1.2 bonus"}`}</Muted>
      <Btn kind={g.paused ? "primary" : "outline"} title={g.paused ? "▶ Resume game" : "⏸ Pause game"} onPress={() => run(api("/game/settings", "PATCH", { paused: !g.paused }), g.paused ? "Game resumed." : "Game paused.")}/>
    </Card>
    <Card><Kicker>TREAT SHOP</Kicker>
      {(g.treats as Row[]).length ? (g.treats as Row[]).map(t => <Line key={t.id} style={{ paddingVertical: 6 }}>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{t.name}</Text><Muted small>{`${t.cost_points} pts${t.money_cost ? ` · ${t.currency} ${Number(t.money_cost).toLocaleString()}` : ""}`}</Muted></View>
        <Btn kind={t.affordable ? "primary" : "outline"} title={t.affordable ? "Redeem" : `${t.cost_points - g.balance} to go`} disabled={!t.affordable} onPress={() => redeem(t)}/>
      </Line>) : <Empty>Add treats you'd enjoy.</Empty>}
      <Line><View style={{ flex: 2 }}><Field voice value={treatName} onChangeText={setTreatName} placeholder="Treat, e.g. Movie night" maxLength={120}/></View>
        <View style={{ flex: 1 }}><Field value={treatCost} onChangeText={setTreatCost} placeholder="Points" keyboardType="number-pad"/></View></Line>
      <Btn title="Add treat" disabled={!treatName.trim() || !Number(treatCost)} onPress={() => { run(api("/game/treats", "POST", { name: treatName, cost_points: Number(treatCost) }), "Treat added."); setTreatName(""); setTreatCost(""); }}/>
    </Card>
    <Card><Kicker>QUESTS · MAX 3</Kicker>
      {(g.quests as Row[]).map(qst => <View key={qst.id} style={{ gap: 4, paddingVertical: 4 }}>
        <Line><Text style={{ color: C.text, flex: 1, fontWeight: "600" }}>{`${qst.done ? "✅ " : ""}${qst.title}`}</Text><Badge tone="muted">{`${qst.count}/${qst.target} · ${qst.period}`}</Badge>
          <Btn kind="link" title="✕" onPress={() => run(api(`/game/quests/${qst.id}`, "DELETE"), "Quest removed.")}/></Line>
        <Progress value={Math.round(qst.count / qst.target * 100)}/>
      </View>)}
      {(g.quests as Row[]).length < 3 && <>
        <Field voice value={questTitle} onChangeText={setQuestTitle} placeholder="Quest, e.g. Two focus blocks" maxLength={120}/>
        <Chips options={QUEST_EVENTS} value={questEvent} onChange={setQuestEvent}/>
        <Line><View style={{ flex: 1 }}><Field value={questCount} onChangeText={setQuestCount} keyboardType="number-pad" placeholder="How many per day"/></View>
          <Btn title="Add quest" disabled={!questTitle.trim() || !Number(questCount)} onPress={() => { run(api("/game/quests", "POST", { title: questTitle, event_type: questEvent, target_count: Number(questCount), period: "day" }), "Quest added."); setQuestTitle(""); }}/></Line>
      </>}
    </Card>
    <Card><Kicker>RECENT POINTS</Kicker>
      {(g.recent as Row[]).length ? (g.recent as Row[]).slice(0, 12).map((r, i) => <Line key={i}>
        <Text style={{ color: r.points > 0 ? C.green : C.muted, fontWeight: "800", width: 44 }}>{r.points > 0 ? `+${r.points}` : "0"}</Text>
        <Text style={{ color: C.text, flex: 1 }} numberOfLines={1}>{r.reason}</Text></Line>) : <Empty>Finish a focus block, task or habit to earn points.</Empty>}
      <Muted small>Rest, sleep and health count too. Daily cap keeps it fair. Tune rules on the web Rewards page.</Muted>
    </Card>
  </Screen>;
}

/** One-line forecast for a goal card. */
export function GoalStatusLine({ api, goalId }: { api: Api; goalId: string }) {
  const [f, setF] = useState<Row | null>(null);
  useEffect(() => { api<Row>(`/goals/${goalId}/forecast`).then(setF).catch(() => setF(null)); }, [api, goalId]);
  if (!f || !(f.levels as Row[]).length) return null;
  const label: Record<string, string> = { achieved: "achieved", ahead: "ahead", on_track: "on track", behind: "behind", missed: "date passed", not_enough_data: "needs data", no_deadline: "no date" };
  return <View style={{ gap: 2 }}>{(f.levels as Row[]).map(lv => <Text key={lv.level} style={{ color: ["achieved", "ahead", "on_track"].includes(lv.status) ? C.green : lv.status === "behind" || lv.status === "missed" ? C.amber : C.muted, fontSize: 12 }}>
    {`${lv.level}: ${label[lv.status] || lv.status}${lv.required_per_month && Number(lv.required_per_month) > 0 ? ` · needs ${Number(lv.required_per_month).toLocaleString()}/mo` : ""}`}</Text>)}
    {f.confidence === "low" && <Muted small>Low confidence (under 3 months of data)</Muted>}</View>;
}
