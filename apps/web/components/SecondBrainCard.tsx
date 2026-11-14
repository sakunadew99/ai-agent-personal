"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, postJson, type JsonRecord as Row } from "@/lib/api";
import { Icon } from "./Icon";

/** Gently brings back interests/intentions you mentioned but haven't acted on (Phase 2, guide §21). */
export function SecondBrainCard({ token, onChanged }: { token: string; onChanged?: () => void }) {
  const [items, setItems] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const load = useCallback(() => { apiRequest<Row[]>("/memories/resurface", token).then(setItems).catch(() => setItems([])); }, [token]);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: "plan" | "later" | "dismiss" | "keep") {
    try {
      const result = await apiRequest<Row>(`/memories/${id}/resurface`, token, postJson({ action }));
      setMessage(action === "plan"
        ? (result.outcome?.status === "proposed" ? "A first small step is waiting in Approvals. Nothing was added yet." : "Added a first small step to your tasks.")
        : action === "later" ? "Okay, I'll ask again later." : action === "keep" ? "Kept. I'll check in again in a month." : "Got it, I won't bring this up again.");
      load(); onChanged?.();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Could not update"); }
  }

  if (!items.length && !message) return null;
  return <section className="panel brain-card">
    <div className="panel-head"><div><p className="eyebrow">FROM YOUR SECOND BRAIN</p><h2>Still interested?</h2></div><Icon name="brain" size={20}/></div>
    {items.map(item => <div className="brain-item" key={String(item.id)}>
      <p>You mentioned <b>{String(item.topic || item.content)}</b> on {new Date(String(item.created_at)).toLocaleDateString([], { month: "short", day: "numeric" })}
        {item.ask_keep ? ". You've postponed it a few times. Keep it or let it go?" : ". Want to plan a first small step?"}</p>
      <small className="muted">“{String(item.content).slice(0, 140)}”</small>
      <div className="brain-actions">{item.ask_keep
        ? <><button className="primary" onClick={() => void act(String(item.id), "keep")}>Keep it</button><button className="outline" onClick={() => void act(String(item.id), "dismiss")}>Let it go</button></>
        : <><button className="primary" onClick={() => void act(String(item.id), "plan")}>Plan it</button><button className="outline" onClick={() => void act(String(item.id), "later")}>Later</button>
          <button className="text-button" onClick={() => void act(String(item.id), "dismiss")}>Not interested</button></>}</div>
    </div>)}
    {message && <p className="success-note">{message}</p>}
  </section>;
}
