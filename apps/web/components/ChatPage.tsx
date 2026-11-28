"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, postJson, type JsonRecord as Row } from "@/lib/api";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { appendSpeech, VoiceButton } from "./VoiceButton";

type Msg = { id: string; role: "user" | "assistant"; content: string; created_at?: string; pending?: boolean; error?: boolean; meta?: Row };

// Things the assistant DOES (click to put the example in the box, edit it, send). Several at once: separate with ";" or "and".
const POWERS: [string, string, string][] = [
  ["✅", "Add a task", "Remind me to pay the electricity bill tomorrow at 9am"], ["🛒", "Buy list", "Add milk, eggs and bread to my buy list"],
  ["✨", "Wish list", "Add noise-cancelling headphones to my wish list"], ["💧", "Log water", "Drank 500 ml water"], ["🔁", "Habit done", "Did my workout"],
  ["☑️", "Finish a task", "Finished the monthly report"], ["🔂", "Repeating", "Every Monday at 7 pm: team call"], ["📆", "Move a task", "Move the monthly report to Friday 5pm"],
  ["💸", "Expense", "Spent 1500 LKR on lunch"], ["❓", "Ask my data", "When did I last go to the gym?"],
  ["⚡", "Many at once", "Drank 2 glasses of water; add bananas to my buy list and remind me to call Amma at 6pm"],
];
const ICON: Record<string, string> = { create_task: "✅", add_to_buy_list: "🛒", add_to_wishlist: "✨", log_water: "💧", log_habit: "🔁", complete_task: "☑️", edit_task: "📆",
  delete_task: "🗑", rename_habit: "✏️", create_expense: "💸", save_memory: "🧠", create_note: "📝", create_daily_plan: "🗓", undo: "↩️", approval: "🛡" };

const STARTERS = [
  { title: "Plan my day", prompt: "Help me plan today around my open tasks and energy." },
  { title: "Goal check-in", prompt: "How am I doing on my goals? What should I adjust?" },
  { title: "Break it down", prompt: "Break my most important task into small, concrete steps." },
  { title: "Learn something", prompt: "Explain spaced repetition and how I can use it to learn German vocabulary." },
];

function providerHint(err: Row): string {
  const text = `${err.status ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (text.includes("401") || text.includes("api key") || text.includes("invalid_api_key")) return "Check the key in Render → Environment (no spaces; a newly created key replaces the old one).";
  if (text.includes("quota") || text.includes("billing") || text.includes("429")) return "OpenAI: check Settings → Billing has credit and that the key's project can use it. New credit can take a few minutes.";
  if (text.includes("model") || text.includes("404")) return "The model name may be wrong or not allowed for this key's project. Check the OPENAI_MODEL_* values and the project's model permissions.";
  return "Check the AI settings on Render, then send the message again.";
}

/** Full chat experience: thread with history, past conversations, Markdown replies, Enter to send. */
export function ChatPage({ token, conversations, onChanged }: { token: string; conversations: Row[]; onChanged: () => void }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [status, setStatus] = useState<Row | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const mark = (k: string, v: string) => setDone(d => ({ ...d, [k]: v }));
  const undo = (k: string, a: Row) => { mark(k, "…"); apiRequest("/chat/undo", token, postJson({ tool: a.tool, ids: a.resource_ids })).then(() => mark(k, "undone")).catch(() => mark(k, "failed")); };
  const decide = (k: string, a: Row, ok: boolean) => { mark(k, "…");
    apiRequest(`/approvals/${a.approval_id}/${ok ? "approve" : "reject"}`, token, { method: "POST" }).then(() => mark(k, ok ? "approved" : "rejected")).catch(() => mark(k, "failed")); };
  const input = useRef<HTMLTextAreaElement>(null);

  const loadStatus = useCallback(() => { apiRequest<Row>("/assistant/status", token).then(setStatus).catch(() => setStatus(null)); }, [token]);
  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { // follow the conversation; with no messages, keep the welcome screen at the top
    if (!scroller.current) return;
    if (messages.length === 0 && !sending) scroller.current.scrollTo({ top: 0 });
    else scroller.current.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);
  useEffect(() => { // auto-grow the input
    const el = input.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);

  const openConversation = useCallback(async (id: string) => {
    setListOpen(false); setLoadingThread(true); setConversationId(id);
    try {
      const detail = await apiRequest<Row>(`/conversations/${id}`, token);
      setMessages(((detail.messages || []) as Row[]).filter(m => m.role === "user" || m.role === "assistant")
        .map(m => ({ id: String(m.id), role: m.role as Msg["role"], content: String(m.content), created_at: m.created_at })));
    } catch { setMessages([{ id: "err", role: "assistant", content: "Couldn't load that conversation. Please try again.", error: true }]); }
    finally { setLoadingThread(false); }
  }, [token]);

  function newChat() { setConversationId(null); setMessages([]); setText(""); setListOpen(false); input.current?.focus(); }

  async function send(raw?: string) {
    const content = (raw ?? text).trim();
    if (!content || sending) return;
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content };
    setMessages(current => [...current.filter(m => !m.error), userMsg]);
    setText(""); setSending(true); setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 7000);
    try {
      const answer = await apiRequest<Row>("/chat", token, postJson({ message: content, conversation_id: conversationId }));
      setConversationId(String(answer.conversation_id));
      setMessages(current => [...current, { id: `a-${Date.now()}`, role: "assistant", content: String(answer.reply || ""), meta: answer }]);
      onChanged();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Something went wrong";
      setMessages(current => [...current, { id: `e-${Date.now()}`, role: "assistant", error: true,
        content: `I couldn't get a reply (${message}). The free server may still be waking up. Tap **Retry** in a moment.` }]);
      setText(content);
    } finally { window.clearTimeout(slowTimer); setSending(false); setSlow(false); loadStatus(); }
  }

  function onSubmit(event: FormEvent) { event.preventDefault(); void send(); }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  }

  const empty = messages.length === 0 && !loadingThread;
  const title = conversations.find(c => String(c.id) === conversationId)?.title || (conversationId ? "Conversation" : "New conversation");

  return <div className="chat-layout">
    <aside className={`chat-sidebar ${listOpen ? "open" : ""}`}>
      <button className="primary chat-new" onClick={newChat}><Icon name="plus" size={16}/> New chat</button>
      <p className="eyebrow">RECENT</p>
      <div className="chat-list">
        {conversations.length ? conversations.map(c => <button key={String(c.id)} className={`chat-list-item ${String(c.id) === conversationId ? "active" : ""}`} onClick={() => void openConversation(String(c.id))}>
          <b>{String(c.title || "Untitled")}</b><small>{new Date(String(c.updated_at)).toLocaleDateString([], { month: "short", day: "numeric" })}</small>
        </button>) : <p className="muted small-copy">Your conversations will appear here.</p>}
      </div>
    </aside>

    <section className="chat-main">
      <header className="chat-head">
        <button className="outline icon-only chat-list-toggle" aria-label="Conversations" onClick={() => setListOpen(open => !open)}><Icon name="menu" size={16}/></button>
        <h2>{title}</h2>
        <span className={`ai-pill ${status?.ai_enabled ? "on" : "off"}`} title={status?.ai_enabled ? `${status.provider} · ${status.model}` : "No AI provider configured"}>
          <span className="dot"/>{status?.ai_enabled ? `AI · ${status.model}` : "Basic mode"}</span>
      </header>

      {status?.ai_enabled && status.last_error && <div className="chat-banner error"><Icon name="bolt" size={15}/>
        <span><b>The AI provider refused the last request{status.last_error.status ? ` (${status.last_error.status})` : ""}:</b> {String(status.last_error.message)}<br/>
          {providerHint(status.last_error)}</span></div>}
      {status && !status.ai_enabled && <div className="chat-banner"><Icon name="bolt" size={15}/>
        <span><b>Basic mode:</b> no AI provider key is configured, so replies are short summaries of your records. Add an AI key on the server to get full assistant answers.</span></div>}

      <div className="chat-scroll" ref={scroller} aria-live="polite">
        {loadingThread && <div className="loading"><span className="spinner"/>Loading conversation…</div>}
        {empty && <div className="chat-empty">
          <div className="chat-empty-mark"><Icon name="sparkle" size={26}/></div>
          <h2>Tell me what to do ✨</h2>
          <p className="muted">I add tasks, fill your buy and wish lists, log water and habits, finish, move and rename tasks, record expenses and answer questions about your records. Reply “yes” to approve, “undo that” or “move it to tomorrow 5pm”.</p>
          <div className="power-grid">{POWERS.map(([icon, label, example]) => <button key={label} className="power" onClick={() => { setText(example); input.current?.focus(); }}><span>{icon}</span><b>{label}</b></button>)}</div>
          <h3 style={{ marginTop: 18 }}>Or ask me something</h3>
          <p className="muted">Ask anything: plan your day, review goals, learn something new, or think a problem through. I use your saved records and memories for anything about you.</p>
          <div className="starter-grid">{STARTERS.map(s => <button key={s.title} className="starter" onClick={() => void send(s.prompt)}><b>{s.title}</b><small>{s.prompt}</small></button>)}</div>
        </div>}
        {messages.map(m => { const meta: Row = m.meta || {}; return <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
          {m.role === "assistant" && <div className="msg-avatar"><Icon name="sparkle" size={15}/></div>}
          <div className="msg-body">
            {m.role === "assistant" ? <Markdown text={m.content}/> : <p className="msg-user-text">{m.content}</p>}
            {[...((meta.actions_completed as Row[]) || []).map((a): Row => ({ ...a, st: "completed" })), ...((meta.actions_proposed as Row[]) || []).map((a): Row => ({ ...a, st: "proposed" }))].map((a, i) => {
              const k = `${m.id}-${i}`; const d = done[k];
              return <div key={k} className={`action-card ${a.st} ${d === "undone" || d === "rejected" ? "faded" : ""}`}>
                <span className="action-icon">{d === "undone" ? "↩️" : d === "rejected" ? "✖️" : a.st === "proposed" && d !== "approved" ? "⏳" : ICON[a.tool] || "✓"}</span>
                <div><b>{a.summary}</b><small>{d === "undone" ? "Undone" : d === "approved" ? "Approved and done ✓" : d === "rejected" ? "Rejected: nothing changed" : d === "failed" ? "Didn't work; try in Approvals" : a.st === "proposed" ? "Waiting for your OK" : "Done ✓"}</small></div>
                {a.st === "completed" && a.undoable && !d && <button className="text-button" onClick={() => undo(k, a)}>Undo</button>}
                {a.st === "proposed" && !d && a.approval_id && <span className="action-buttons"><button className="primary" onClick={() => decide(k, a, true)}>Approve</button><button className="outline" onClick={() => decide(k, a, false)}>Reject</button></span>}
              </div>; })}
            {meta.relevant_memories?.length > 0 && <details className="msg-context"><summary>Used {meta.relevant_memories.length} saved memor{meta.relevant_memories.length === 1 ? "y" : "ies"}</summary>
              {(meta.relevant_memories as string[]).map((mem, i) => <small key={i}>{mem}</small>)}</details>}
            {m.role === "assistant" && !m.error && <button className="msg-copy" title="Copy" aria-label="Copy reply" onClick={() => void navigator.clipboard?.writeText(m.content)}><Icon name="copy" size={13}/></button>}
            {m.error && <button className="outline msg-retry" onClick={() => void send()}>Retry</button>}
          </div>
        </div>; })}
        {sending && <div className="msg assistant"><div className="msg-avatar"><Icon name="sparkle" size={15}/></div>
          <div className="msg-body"><div className="typing"><span/><span/><span/></div>
            {slow && <p className="muted small-copy">Waking up the server. On free hosting the first reply can take up to a minute…</p>}</div></div>}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea ref={input} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
          placeholder="Tell Sakuna what to do, or ask…" aria-label="Message Sakuna" maxLength={8000}/>
        <VoiceButton className="composer-mic" onText={spoken => { setText(v => appendSpeech(v, spoken)); input.current?.focus(); }}/>
        <button className="primary composer-send" disabled={sending || !text.trim()} aria-label="Send"><Icon name="send" size={17}/></button>
      </form>
      <p className="composer-hint">Enter to send · Shift + Enter for a new line · Sakuna proposes changes; you approve them.</p>
    </section>
  </div>;
}
