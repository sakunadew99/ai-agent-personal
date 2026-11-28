import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Btn, C, H2, Muted, soft } from "../ui";
import { appendSpeech, MicButton } from "../voice";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Msg = { id: string; role: "user" | "assistant"; content: string; error?: boolean; meta?: Row };

const STARTERS = ["Help me plan today around my open tasks and energy.", "How am I doing on my goals?", "Break my most important task into small steps.", "Teach me 5 useful German phrases for today."];
// Things the assistant DOES (tap one to put it in the box, change the words, send). Several at once: separate with ";" or "and".
const POWERS: [string, string, string][] = [
  ["✅", "Add a task", "Remind me to pay the electricity bill tomorrow at 9am"],
  ["🛒", "Buy list", "Add milk, eggs and bread to my buy list"],
  ["✨", "Wish list", "Add noise-cancelling headphones to my wish list"],
  ["💧", "Log water", "Drank 500 ml water"],
  ["🔁", "Habit done", "Did my workout"],
  ["☑️", "Finish a task", "Finished the monthly report"],
  ["💸", "Expense", "Spent 1500 LKR on lunch"],
  ["🧠", "Remember", "Remember that my passport expires in March 2027"],
  ["🗓", "Plan my day", "Plan my day"],
  ["⚡", "Many at once", "Drank 2 glasses of water; add bananas to my buy list and remind me to call Amma at 6pm"],
];
const ICON: Record<string, string> = { create_task: "✅", add_to_buy_list: "🛒", add_to_wishlist: "✨", log_water: "💧", log_habit: "🔁", complete_task: "☑️",
  create_expense: "💸", save_memory: "🧠", create_note: "📝", create_daily_plan: "🗓", log_life_area: "🧭", exam_update: "📝" };

/** Renders the common Markdown in assistant replies (headings, lists, **bold**, `code`) without HTML. */
function Md({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return <View style={{ gap: 4 }}>{lines.map((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) return <View key={i} style={{ height: 4 }}/>;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) return <Text key={i} style={m.h}>{inline(heading[1])}</Text>;
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) return <View key={i} style={m.li}><Text style={m.p}>•</Text><Text style={[m.p, { flex: 1 }]}>{inline(bullet[1])}</Text></View>;
    const num = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);
    if (num) return <View key={i} style={m.li}><Text style={m.p}>{num[1]}.</Text><Text style={[m.p, { flex: 1 }]}>{inline(num[2])}</Text></View>;
    return <Text key={i} style={m.p}>{inline(line)}</Text>;
  })}</View>;
}
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <Text key={i} style={{ fontWeight: "800" }}>{part.slice(2, -2)}</Text>;
    if (part.startsWith("`") && part.endsWith("`")) return <Text key={i} style={m.code}>{part.slice(1, -1)}</Text>;
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) return <Text key={i} style={{ fontStyle: "italic", color: C.muted }}>{part.slice(1, -1)}</Text>;
    return part;
  });
}

export function ChatScreen({ api }: { api: Api }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Row | null>(null);
  const [list, setList] = useState<Row[]>([]);
  const [showList, setShowList] = useState(false);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [done, setDone] = useState<Record<string, string>>({});     // action key -> "undone" | "approved" | "rejected" | "…"
  const mark = (k: string, v: string) => setDone(d => ({ ...d, [k]: v }));
  async function undo(k: string, a: Row) {
    mark(k, "…");
    try { await api("/chat/undo", "POST", { tool: a.tool, ids: a.resource_ids }); mark(k, "undone"); } catch { mark(k, "failed"); }
  }
  async function decide(k: string, a: Row, ok: boolean) {
    mark(k, "…");
    try { await api(`/approvals/${a.approval_id}/${ok ? "approve" : "reject"}`, "POST"); mark(k, ok ? "approved" : "rejected"); } catch { mark(k, "failed"); }
  }

  const loadStatus = useCallback(() => { api<Row>("/assistant/status").then(setStatus).catch(() => setStatus(null)); }, [api]);
  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function openList() {
    setShowList(true);
    try { setList(await api<Row[]>("/conversations")); } catch { setList([]); }
  }
  async function open(id: string) {
    setShowList(false); setConversationId(id);
    try {
      const detail = await api<Row>(`/conversations/${id}`);
      setMessages(((detail.messages || []) as Row[]).filter(x => x.role === "user" || x.role === "assistant").map(x => ({ id: String(x.id), role: x.role, content: String(x.content) })));
    } catch { setMessages([{ id: "e", role: "assistant", content: "Couldn't load that conversation.", error: true }]); }
  }
  async function send(raw?: string) {
    const content = (raw ?? text).trim();
    if (!content || sending) return;
    setMessages(cur => [...cur.filter(x => !x.error), { id: `u${Date.now()}`, role: "user", content }]);
    setText(""); setSending(true);
    try {
      const answer = await api<Row>("/chat", "POST", { message: content, conversation_id: conversationId });
      setConversationId(String(answer.conversation_id));
      setMessages(cur => [...cur, { id: `a${Date.now()}`, role: "assistant", content: String(answer.reply || ""), meta: answer }]);
    } catch (reason) {
      setMessages(cur => [...cur, { id: `e${Date.now()}`, role: "assistant", error: true, content: `I couldn't get a reply (${reason instanceof Error ? reason.message : "error"}). The free server may be waking up; try again in a moment.` }]);
      setText(content);
    } finally { setSending(false); loadStatus(); setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 80); }
  }

  const err = status?.ai_enabled && status.last_error;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={undefined}>
    <View style={m.head}>
      <TouchableOpacity onPress={() => void openList()}><Text style={m.link}>☰ Chats</Text></TouchableOpacity>
      <Text style={[m.pill, status?.ai_enabled ? m.pillOn : null]}>{status?.ai_enabled ? `● AI · ${status.model}` : "● Basic mode"}</Text>
      <TouchableOpacity onPress={() => { setConversationId(null); setMessages([]); }}><Text style={m.link}>＋ New</Text></TouchableOpacity>
    </View>
    {status && !status.ai_enabled && <Text style={m.banner}>Basic mode: no AI key on the server, so replies are short summaries of your records.</Text>}
    {!!err && <Text style={[m.banner, m.bannerErr]}>AI provider refused the last request{err.status ? ` (${err.status})` : ""}: {String(err.message)}</Text>}
    <ScrollView ref={scroller} contentContainerStyle={m.thread} onContentSizeChange={() => messages.length && scroller.current?.scrollToEnd({ animated: true })}>
      {!messages.length && <View style={{ gap: 10, paddingTop: 12 }}>
        <H2>Tell me what to do ✨</H2>
        <Muted>I add tasks, fill your buy and wish lists, log water and habits, finish tasks, record expenses and remember things. Several at once too. Tap one, change the words, send.</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{POWERS.map(([icon, label, example]) =>
          <TouchableOpacity key={label} onPress={() => setText(example)} style={m.power}>
            <Text style={{ fontSize: 20 }}>{icon}</Text><Text style={[m.p, { fontWeight: "800", fontSize: 12, textAlign: "center" }]} numberOfLines={1}>{label}</Text></TouchableOpacity>)}</View>
        <Muted small>Things that change records you care about (new tasks, expenses) may wait for your OK in Approvals; I show the buttons right here.</Muted>
        <Text style={[m.p, { fontWeight: "800", marginTop: 6 }]}>Or ask me something</Text>
        {STARTERS.map(s => <TouchableOpacity key={s} style={m.starter} onPress={() => void send(s)}><Text style={m.p}>{s}</Text></TouchableOpacity>)}
      </View>}
      {messages.map(msg => <View key={msg.id} style={[m.msg, msg.role === "user" ? m.user : m.bot, msg.error && m.errMsg]}>
        {msg.role === "assistant" ? <Md text={msg.content}/> : <Text style={m.p}>{msg.content}</Text>}
        {[...((msg.meta?.actions_completed as Row[]) || []).map((a): Row => ({ ...a, st: "completed" })), ...((msg.meta?.actions_proposed as Row[]) || []).map((a): Row => ({ ...a, st: "proposed" }))].map((a, i) => {
          const k = `${msg.id}-${i}`; const d = done[k];
          return <View key={k} style={[m.action, a.st === "proposed" && { borderColor: C.amber }, (d === "undone" || d === "rejected") && { opacity: 0.5 }]}>
            <Text style={{ fontSize: 16 }}>{d === "undone" ? "↩️" : d === "rejected" ? "✖️" : a.st === "proposed" && d !== "approved" ? "⏳" : ICON[a.tool] || "✓"}</Text>
            <View style={{ flex: 1 }}><Text style={[m.p, { fontSize: 13, fontWeight: "700" }]}>{a.summary}</Text>
              <Text style={m.small}>{d === "undone" ? "Undone" : d === "approved" ? "Approved and done ✓" : d === "rejected" ? "Rejected: nothing changed" : d === "failed" ? "Didn't work; try in Approvals" : a.st === "proposed" ? "Waiting for your OK" : "Done ✓"}</Text></View>
            {a.st === "completed" && a.undoable && !d && <TouchableOpacity onPress={() => void undo(k, a)}><Text style={m.link}>Undo</Text></TouchableOpacity>}
            {a.st === "proposed" && !d && !!a.approval_id && <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity onPress={() => void decide(k, a, true)}><Text style={[m.link, { fontWeight: "900" }]}>Approve</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => void decide(k, a, false)}><Text style={{ color: C.muted, fontWeight: "700" }}>Reject</Text></TouchableOpacity></View>}
          </View>; })}
        {msg.error && <Btn kind="link" title="Retry" onPress={() => void send()}/>}
      </View>)}
      {sending && <View style={[m.msg, m.bot]}><ActivityIndicator color={C.green}/></View>}
    </ScrollView>
    <View style={m.composer}>
      <TextInput style={m.input} value={text} onChangeText={setText} placeholder="Tell Sakuna what to do, or ask…" placeholderTextColor={C.muted} multiline maxLength={8000}/>
      <MicButton size={42} onText={spoken => setText(current => appendSpeech(current, spoken))}/>
      <TouchableOpacity style={[m.send, (!text.trim() || sending) && { opacity: 0.5 }]} disabled={!text.trim() || sending} onPress={() => void send()}><Text style={m.sendText}>↑</Text></TouchableOpacity>
    </View>
    <Modal visible={showList} animationType="slide" onRequestClose={() => setShowList(false)}>
      <View style={m.modal}>
        <View style={m.head}><H2>Conversations</H2><TouchableOpacity onPress={() => setShowList(false)}><Text style={m.link}>Close</Text></TouchableOpacity></View>
        <FlatList data={list} keyExtractor={x => String(x.id)} ListEmptyComponent={<Muted>No conversations yet.</Muted>}
          renderItem={({ item }) => <TouchableOpacity style={m.convo} onPress={() => void open(String(item.id))}>
            <Text style={m.p} numberOfLines={1}>{String(item.title || "Untitled")}</Text>
            <Text style={m.small}>{new Date(String(item.updated_at)).toLocaleDateString([], { month: "short", day: "numeric" })}</Text></TouchableOpacity>}/>
      </View>
    </Modal>
  </KeyboardAvoidingView>;
}

const m = StyleSheet.create({
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  link: { color: C.green, fontWeight: "700" },
  pill: { color: C.muted, fontSize: 11, fontWeight: "700", borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  pillOn: { color: C.green, borderColor: "#2f6b4a" },
  banner: { marginHorizontal: 16, padding: 10, borderRadius: 10, fontSize: 12, color: C.text, backgroundColor: soft(C.amber), borderColor: "#7a5a2a", borderWidth: 1 },
  bannerErr: { backgroundColor: "#381f1f", borderColor: "#663535" },
  thread: { padding: 16, paddingBottom: 24, gap: 12 },
  starter: { borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 12 },
  msg: { maxWidth: "88%", padding: 12, borderRadius: 16, gap: 6 },
  user: { alignSelf: "flex-end", backgroundColor: C.greenSoft, borderBottomRightRadius: 4 },
  bot: { alignSelf: "flex-start", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderBottomLeftRadius: 4, maxWidth: "94%" },
  errMsg: { borderColor: "#663535" },
  p: { color: C.text, fontSize: 14, lineHeight: 21 },
  h: { color: C.text, fontSize: 15, fontWeight: "800", marginTop: 4 },
  li: { flexDirection: "row", gap: 6 },
  code: { fontFamily: Platform.OS === "android" ? "monospace" : "Menlo", backgroundColor: C.panel, color: C.text },
  note: { color: C.amber, fontSize: 12 },
  power: { width: "18%", flexGrow: 1, minWidth: 64, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1 },
  action: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.bg },
  small: { color: C.muted, fontSize: 11 },
  composer: { flexDirection: "row", gap: 8, alignItems: "flex-end", padding: 10, paddingBottom: 14, borderTopColor: C.line, borderTopWidth: 1, backgroundColor: C.bg },
  input: { flex: 1, maxHeight: 140, backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 16, color: C.text, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15 },
  send: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.green, alignItems: "center", justifyContent: "center" },
  sendText: { color: C.greenDark, fontSize: 20, fontWeight: "900" },
  modal: { flex: 1, backgroundColor: C.bg, paddingTop: 40 },
  convo: { paddingHorizontal: 16, paddingVertical: 14, borderBottomColor: C.line, borderBottomWidth: 1, gap: 3 },
});
