import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, Card, Kicker, Muted, Row as Line } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;

/** "You mentioned yoga on 12 Nov. Plan it?" — gentle resurfacing of interests/intentions (Phase 2). */
export function BrainCard({ api }: { api: Api }) {
  const [items, setItems] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(() => { api<Row[]>("/memories/resurface").then(setItems).catch(() => setItems([])); }, [api]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "plan" | "later" | "dismiss" | "keep") {
    try {
      const r = await api<Row>(`/memories/${id}/resurface`, "POST", { action });
      setMessage(action === "plan" ? (r.outcome?.status === "proposed" ? "A first small step is waiting in Approvals." : "Added a first small step to your tasks.")
        : action === "later" ? "Okay, I'll ask again later." : action === "keep" ? "Kept. I'll check in next month." : "Got it, I won't bring it up again.");
      load();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not update"); }
  }

  if (!items.length && !message) return null;
  return <Card accent>
    <Kicker>FROM YOUR SECOND BRAIN</Kicker>
    {items.map(item => <View key={String(item.id)} style={{ gap: 6 }}>
      <Text style={{ color: C.text, fontSize: 15, lineHeight: 21 }}>You mentioned <Text style={{ fontWeight: "800" }}>{String(item.topic || item.content)}</Text> on {new Date(String(item.created_at)).toLocaleDateString([], { month: "short", day: "numeric" })}.
        {item.ask_keep ? " Keep it or let it go?" : " Plan a first small step?"}</Text>
      <Muted small>“{String(item.content).slice(0, 120)}”</Muted>
      <Line>{item.ask_keep
        ? <><Btn title="Keep" onPress={() => void act(String(item.id), "keep")} style={{ flex: 1 }}/><Btn kind="outline" title="Let go" onPress={() => void act(String(item.id), "dismiss")} style={{ flex: 1 }}/></>
        : <><Btn title="Plan it" onPress={() => void act(String(item.id), "plan")} style={{ flex: 1 }}/><Btn kind="outline" title="Later" onPress={() => void act(String(item.id), "later")} style={{ flex: 1 }}/>
          <Btn kind="link" title="No" onPress={() => void act(String(item.id), "dismiss")}/></>}</Line>
    </View>)}
    {!!message && <Text style={{ color: C.green, fontSize: 13 }}>{message}</Text>}
  </Card>;
}
