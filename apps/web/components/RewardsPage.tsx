"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";

const EVENT_LABEL: Record<string, string> = {
  focus: "Focus block (per 25 min)", task: "Finished task (by size)", habit: "Habit done", sleep: "Slept in your window",
  steps: "Steps target reached", workout: "Workout", weekly_review: "Weekly review", quest: "Quest bonus", balance_bonus: "Balance bonus",
};
const QUEST_EVENTS = ["focus", "task", "habit", "sleep", "steps", "workout", "weekly_review"];
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";

/** Game and rewards (guide 30): effort and balance earn points; treats are yours. Pause any time. */
export function RewardsPage({ token }: { token: string }) {
  const [g, setG] = useState<Row | null>(null);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [quest, setQuest] = useState({ title: "", event_type: "focus", target_count: "2", period: "day" });
  const [treat, setTreat] = useState({ name: "", cost_points: "", money_cost: "", currency: "LKR" });
  const [showRules, setShowRules] = useState(false);
  const load = useCallback(() => { apiRequest<Row>("/game", token).then(setG).catch(reason => setError(errorText(reason))); }, [token]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) { setError(""); try { await work; setMessage(note); load(); } catch (reason) { setError(errorText(reason)); setMessage(""); } }

  async function redeem(t: Row) {
    const money = t.money_cost ? ` It also costs ${t.currency} ${Number(t.money_cost).toLocaleString()} from your fun money.` : "";
    if (!window.confirm(`Redeem “${t.name}” for ${t.cost_points} points?${money}`)) return;
    setError("");
    try {
      const r = await apiRequest<Row>(`/game/treats/${t.id}/redeem`, token, postJson({ confirm: true }));
      setMessage(`🎉 ${r.redeemed}! ${r.note}`); load();
    } catch (reason) {
      const msg = errorText(reason);
      if (/fun money|fun-money/i.test(msg) && window.confirm(`${msg}\n\nGo ahead anyway?`)) {
        await run(apiRequest(`/game/treats/${t.id}/redeem`, token, postJson({ confirm: true, over_budget_ok: true })), `🎉 ${t.name}! Remember to log the expense if you spend money.`);
      } else setError(msg);
    }
  }
  function addQuest(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/game/quests", token, postJson({ ...quest, target_count: Number(quest.target_count) })).then(() => setQuest({ ...quest, title: "" })), "Quest added.");
  }
  function addTreat(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/game/treats", token, postJson({ name: treat.name, cost_points: Number(treat.cost_points),
      ...(treat.money_cost ? { money_cost: treat.money_cost.replace(/,/g, ""), currency: treat.currency } : {}) })).then(() => setTreat({ ...treat, name: "", cost_points: "", money_cost: "" })), "Treat added to your shop.");
  }

  if (!g) return error ? <p className="warning-copy">{error}</p> : <p className="muted">Loading…</p>;
  const pct = Math.round(g.into_level / g.next_level_at * 100);
  return <>
    <section className={`panel game-hero${g.paused ? " paused" : ""}`}>
      <div className="game-level"><span className="game-badge">Lv {g.level}</span>
        <div className="game-level-bar"><div className="progress"><span style={{ width: `${pct}%` }}/></div>
          <small className="muted">{g.into_level} / {g.next_level_at} to level {g.level + 1} · {g.total_earned.toLocaleString()} earned in total</small></div></div>
      <div className="game-stats">
        <div><small className="muted">Today</small><b>{g.today.points} / {g.today.cap}</b></div>
        <div><small className="muted">Balance</small><b>{g.balance.toLocaleString()} pts</b></div>
        <div><small className="muted">Streak</small><b>{g.streak_days} 🔥</b><small className="muted">one missed day is OK</small></div>
        <div><small className="muted">Life areas today</small><b>{g.today.areas.length} / 4</b><small className="muted">{g.today.bonus ? `+${g.today.bonus} balance bonus` : "4 areas = ×1.2 bonus"}</small></div>
      </div>
      <div className="row-actions" style={{ justifyContent: "flex-start" }}>
        <button className={g.paused ? "primary" : "outline"} onClick={() => void run(apiRequest("/game/settings", token, patchJson({ paused: !g.paused })), g.paused ? "Game resumed." : "Game paused. Nothing is counted until you resume.")}>{g.paused ? "▶ Resume game" : "⏸ Pause game"}</button>
        {g.today.areas.length > 0 && <small className="muted">Areas: {g.today.areas.join(", ")}</small>}
      </div>
      {message && <p className="success-note">{message}</p>}{error && <p className="warning-copy">{error}</p>}
    </section>

    <div className="grid main-grid">
      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">TREAT SHOP</p><h2>Spend your points</h2></div></div>
        {(g.treats as Row[]).map(t => <div className="treat-row" key={t.id}>
          <div><b>{t.name}</b><small className="muted">{t.cost_points} pts{t.money_cost ? ` · ${t.currency} ${Number(t.money_cost).toLocaleString()} from fun money` : ""}</small></div>
          <div className="row-actions"><button className={t.affordable ? "primary" : "outline"} disabled={!t.affordable} onClick={() => void redeem(t)}>{t.affordable ? "Redeem" : `${t.cost_points - g.balance} to go`}</button>
            <button className="danger-link" aria-label={`Delete ${t.name}`} onClick={() => { if (window.confirm(`Delete treat “${t.name}”?`)) void run(apiRequest(`/game/treats/${t.id}`, token, { method: "DELETE" }), "Treat removed."); }}>×</button></div>
        </div>)}
        {!g.treats.length && <div className="empty-state">Create treats you'd enjoy: tea at your favourite café, a movie night, a small budgeted buy.</div>}
        <form className="inline-form" onSubmit={addTreat}>
          <input value={treat.name} onChange={e => setTreat({ ...treat, name: e.target.value })} placeholder="Treat (e.g. Movie night)" required maxLength={120}/>
          <input value={treat.cost_points} onChange={e => setTreat({ ...treat, cost_points: e.target.value })} placeholder="Points" inputMode="numeric" required className="qty-input"/>
          <input value={treat.money_cost} onChange={e => setTreat({ ...treat, money_cost: e.target.value })} placeholder="Money (optional)" inputMode="decimal"/>
          <input value={treat.currency} onChange={e => setTreat({ ...treat, currency: e.target.value.toUpperCase() })} maxLength={3} className="cur-input" aria-label="Currency"/>
          <button className="primary" disabled={!treat.name.trim() || !treat.cost_points}>Add treat</button>
        </form>
        <p className="muted small-copy">Sakuna never buys anything. Money treats check your fun-money envelope first.</p>
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">QUESTS · MAX 3</p><h2>Small goals, bonus points</h2></div></div>
        {(g.quests as Row[]).map(qst => <div className="quest-row" key={qst.id}>
          <div><b>{qst.done ? "✅ " : ""}{qst.title}</b><small className="muted">{EVENT_LABEL[qst.event_type] || qst.event_type} · {qst.count}/{qst.target} this {qst.period} · +{qst.bonus_points}</small>
            <div className="progress"><span style={{ width: `${Math.round(qst.count / qst.target * 100)}%` }}/></div></div>
          <button className="danger-link" aria-label={`Remove ${qst.title}`} onClick={() => void run(apiRequest(`/game/quests/${qst.id}`, token, { method: "DELETE" }), "Quest removed.")}>×</button>
        </div>)}
        {g.quests.length < 3 && <form className="inline-form" onSubmit={addQuest}>
          <input value={quest.title} onChange={e => setQuest({ ...quest, title: e.target.value })} placeholder="Quest (e.g. Two focus blocks)" required maxLength={120}/>
          <select value={quest.event_type} onChange={e => setQuest({ ...quest, event_type: e.target.value })}>{QUEST_EVENTS.map(ev => <option key={ev} value={ev}>{EVENT_LABEL[ev]}</option>)}</select>
          <input value={quest.target_count} onChange={e => setQuest({ ...quest, target_count: e.target.value })} inputMode="numeric" className="qty-input" aria-label="How many"/>
          <select value={quest.period} onChange={e => setQuest({ ...quest, period: e.target.value })}><option value="day">per day</option><option value="week">per week</option></select>
          <button className="primary" disabled={!quest.title.trim()}>Add</button>
        </form>}
        <h3>Recent points</h3>
        <div className="card-list">{(g.recent as Row[]).map((r, i) => <div className="ledger-row" key={i}>
          <span className={r.points > 0 ? "pts" : "pts zero"}>{r.points > 0 ? `+${r.points}` : "0"}</span><span>{r.reason}</span><small className="muted">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</small>
        </div>)}{!g.recent.length && <div className="empty-state">Finish a focus block, a task or a habit to earn your first points.</div>}</div>
      </section>
    </div>

    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">HOW POINTS WORK</p><h2>Rules you can tune</h2></div><button className="text-button" onClick={() => setShowRules(!showRules)}>{showRules ? "Hide" : "Show"}</button></div>
      <p className="muted small-copy">Effort and balance earn points, not outcomes you can't control. Rest, sleep and health count too, so the game never pushes you to overwork. Daily cap: {g.daily_cap}. No punishments, no loot boxes.</p>
      {showRules && <div className="rules-table">{(g.rules as Row[]).map(r => <div className="rule-row" key={r.event_type}>
        <span>{EVENT_LABEL[r.event_type] || r.event_type}</span>
        <label>pts <input type="number" min={0} max={100} defaultValue={r.points} onBlur={e => { const v = Number(e.target.value); if (v !== r.points) void run(apiRequest(`/game/rules/${r.event_type}`, token, patchJson({ points: v })), "Rule updated."); }}/></label>
        <label>cap/day <input type="number" min={0} max={300} defaultValue={r.daily_cap} onBlur={e => { const v = Number(e.target.value); if (v !== r.daily_cap) void run(apiRequest(`/game/rules/${r.event_type}`, token, patchJson({ daily_cap: v })), "Rule updated."); }}/></label>
        <label className="inline-check"><input type="checkbox" checked={r.active} onChange={e => void run(apiRequest(`/game/rules/${r.event_type}`, token, patchJson({ active: e.target.checked })), "Rule updated.")}/> on</label>
      </div>)}</div>}
    </section>
  </>;
}
