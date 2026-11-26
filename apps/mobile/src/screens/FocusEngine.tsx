import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { cancelFocusEnd, scheduleFocusEnd } from "../notify";
import { defaultMark, parseLists, Shield, type BlockList } from "../shield";
import { Badge, Btn, C, Card, Empty, H2, Kicker, Muted, Progress, Row as Line, soft } from "../ui";
import { MicButton, appendSpeech } from "../voice";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
type Phase = "setup" | "countdown" | "focus" | "review" | "break";
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const clock = (sec: number) => `${String(Math.floor(Math.max(0, sec) / 60)).padStart(2, "0")}:${String(Math.max(0, sec) % 60).padStart(2, "0")}`;
const RHYTHMS = { deep: { label: "50 / 10", work: 50, rest: 10 }, pomodoro: { label: "25 / 5", work: 25, rest: 5 } } as const;
const RATING = ["😵", "😕", "🙂", "😊", "🔥"];

// Your notebook's distractions, as Shield rules (only apps installed on this phone are added).
const DISTRACTING_APPS = ["com.facebook.katana", "com.facebook.lite", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.zhiliaoapp.musically.go",
  "com.google.android.youtube", "org.telegram.messenger", "org.telegram.messenger.web", "com.whatsapp"];
const DISTRACTING_SITES = ["facebook.com", "tiktok.com", "youtube.com", "web.telegram.org", "web.whatsapp.com"];
const DISTRACTIONS = "Distractions";
const BEDTIME = "Bedtime (no phone after 12)";

/** "1 hour, 1 task": clear target -> one task -> distractions blocked -> 50/10 or 25/5 -> 2-minute review -> break. */
export function FocusEngine({ api, onError, onNotice }: Props) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [today, setToday] = useState<Row | null>(() => peek("/focus/today"));
  const [session, setSession] = useState<Row | null>(null);
  const [now, setNow] = useState(Date.now());
  // setup
  const [target, setTarget] = useState("");
  const [tasks, setTasks] = useState<Row[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [rhythm, setRhythm] = useState<keyof typeof RHYTHMS>("deep");
  const [water, setWater] = useState(false);
  const [posture, setPosture] = useState(false);
  const [block, setBlock] = useState(!!Shield);
  const [setupStarted] = useState(Date.now());
  const [count, setCount] = useState(5);
  // focus + review + break
  const [distractions, setDistractions] = useState(0);
  const [breakEnds, setBreakEnds] = useState(0);
  const [lastNext, setLastNext] = useState("");
  const busy = useRef(false);

  const load = useCallback(async () => {
    try {
      const [t, list] = await Promise.all([api<Row>("/focus/today"), api<Row[]>("/tasks")]);
      setToday(t);
      setTasks((list || []).filter(x => x.status !== "done").slice(0, 12));
      if (t.active) { setSession(t.active); setPhase(p => (p === "setup" ? "focus" : p)); }
    } catch (r) { onError(msg(r)); }
  }, [api, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const endsAt = session ? new Date(String(session.ends_at)).getTime() : 0;
  const left = Math.round((endsAt - now) / 1000);
  const elapsedMin = session ? (now - new Date(String(session.started_at)).getTime()) / 60000 : 0;

  // Time's up -> review (once).
  useEffect(() => { if (phase === "focus" && session && left <= 0) setPhase("review"); }, [phase, session, left]);
  // 5-4-3-2-1 -> start.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) { void begin(); return; }
    const id = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, count]); // eslint-disable-line react-hooks/exhaustive-deps

  async function distractionList(): Promise<BlockList | null> {
    if (!Shield) return null;
    const lists = parseLists(Shield.getLists());
    const found = lists.find(l => l.name === DISTRACTIONS);
    if (found) return found;
    const installed = new Set((await Shield.getInstalledApps()).map(a => a.packageName));
    const list: BlockList = { id: `list-distractions-${Date.now()}`, name: DISTRACTIONS, mode: "manual", schedule: null,
      apps: DISTRACTING_APPS.filter(p => installed.has(p)), domains: DISTRACTING_SITES, keywords: ["reels", "shorts"],
      newApps: false, newAppsSince: 0, adult: true, purchases: false, unsupportedBrowsers: false };
    return parseLists(Shield.saveList(JSON.stringify(list))).find(l => l.name === DISTRACTIONS) ?? null;
  }

  async function begin() {
    if (busy.current) return;
    busy.current = true;
    const r = RHYTHMS[rhythm];
    try {
      const s = await api<Row>("/focus/sessions", "POST", { minutes: r.work, mode: rhythm, task_id: taskId, target: target.trim() || null, break_minutes: r.rest });
      setSession(s); setDistractions(0); setPhase("focus");
      void scheduleFocusEnd(r.work * 60);
      if (block && Shield) {
        try {
          const list = await distractionList();
          if (list && Shield.getStatus().accessibility) { Shield.startSession(r.work, [list.id]); onNotice("Distractions blocked until the session ends 🛡"); }
          else if (list) onNotice("Turn on “Allow blocking” in Focus → Shield to block distractions.");
        } catch (e) { onNotice(`Focus started (Shield: ${msg(e)})`); }
      }
    } catch (e) { onError(msg(e)); setPhase("setup"); }
    finally { busy.current = false; }
  }

  function startCountdown() {
    if (!target.trim()) { onError("Write a clear target first. One sentence is enough."); return; }
    setCount(5); setPhase("countdown");
  }

  async function finish(review: Row) {
    if (!session) return;
    try {
      const out = await api<Row>(`/focus/sessions/${session.id}/finish`, "PATCH", { distractions, ...review });
      void cancelFocusEnd();
      try { if (Shield?.getStatus().sessionActive && !Shield.getStatus().strict) Shield.endSession(); } catch { /* strict or not running */ }
      setLastNext(review.next_step || "");
      onNotice(`${Math.round(out.minutes || 0)} min focused${out.points ? ` · +${out.points} points` : ""}${out.task_done ? " · task done ✓" : ""}${out.next_task_id ? " · next step added" : ""}`);
      setBreakEnds(Date.now() + (session.break_minutes || 5) * 60000);
      setSession(null); setPhase("break"); void load();
    } catch (e) { onError(msg(e)); }
  }

  function nextSession() {
    setTarget(lastNext); setTaskId(null); setWater(false); setPosture(false); setPhase("setup");
  }

  if (!today) return <Empty>Loading focus…</Empty>;

  // ---------------------------------------------------------------- COUNTDOWN
  if (phase === "countdown") {
    return <View style={s.countWrap}>
      <Text style={s.countHint}>Sit straight · breathe · start</Text>
      <Text style={s.countNum}>{count > 0 ? count : "GO"}</Text>
      <Text style={s.countTarget}>{target}</Text>
      <Btn kind="outline" title="Cancel" onPress={() => setPhase("setup")}/>
    </View>;
  }

  // ---------------------------------------------------------------- FOCUS
  if (phase === "focus" && session) {
    const total = session.minutes_planned * 60;
    const firstFive = elapsedMin < 5;
    const half = elapsedMin >= session.minutes_planned / 2 && elapsedMin < session.minutes_planned / 2 + 1;
    const task = tasks.find(t => t.id === session.task_id);
    return <View style={{ gap: 12 }}>
      <View style={s.focusCard}>
        <Text style={s.focusKicker}>{firstFive ? "JUST 5 MINUTES · BEGIN ANYWHERE" : "YOU'RE IN · ONE TASK ONLY"}</Text>
        <Text style={s.timer}>{clock(left)}</Text>
        <Progress value={(1 - left / total) * 100}/>
        <Text style={s.focusTarget}>🎯 {session.target || "Your one task"}</Text>
        {task && <Muted>📌 {task.title}</Muted>}
        {half && <Text style={s.nudge}>💧 Halfway: sip of water, sit straight.</Text>}
      </View>
      <Line>
        <Btn kind="outline" title={`🙈 Got distracted (${distractions})`} onPress={() => setDistractions(d => d + 1)} style={{ flex: 1 }}/>
        <Btn kind="outline" title="Finish now" onPress={() => setPhase("review")} style={{ flex: 1 }}/>
      </Line>
      <Muted small>Phone alarm rings when the block ends, even with Sakuna closed. If your mind wanders, tap “Got distracted” and come back. No guilt.</Muted>
    </View>;
  }

  // ---------------------------------------------------------------- REVIEW
  if (phase === "review" && session) return <Review session={session} task={tasks.find(t => t.id === session.task_id)} onSubmit={finish}/>;

  // ---------------------------------------------------------------- BREAK
  if (phase === "break") {
    const breakLeft = Math.round((breakEnds - now) / 1000);
    return <View style={{ gap: 12 }}>
      <Card accent>
        <Kicker>BREAK · BRAIN OFF</Kicker>
        <Text style={s.timer}>{breakLeft > 0 ? clock(breakLeft) : "Ready"}</Text>
        <BreakChecklist/>
      </Card>
      <BrainGame/>
      <Line><Btn title="▶ Next session" onPress={nextSession} style={{ flex: 1 }}/><Btn kind="outline" title="Done for now" onPress={() => setPhase("setup")} style={{ flex: 1 }}/></Line>
      {!!lastNext && <Muted small>Next session target: “{lastNext}”</Muted>}
    </View>;
  }

  // ---------------------------------------------------------------- SETUP
  const targetLeft = Math.max(0, 120 - Math.round((now - setupStarted) / 1000));
  return <View style={{ gap: 12 }}>
    <TodayFocus today={today}/>
    <Card accent>
      <Line><Kicker>1 HOUR · 1 TASK</Kicker><View style={{ flex: 1 }}/><Badge tone={targetLeft > 0 ? "amber" : "muted"}>{targetLeft > 0 ? `⏱ ${clock(targetLeft)} to set your target` : "target time"}</Badge></Line>
      <H2>What will be finished in this block?</H2>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        <TextInput style={[s.input, { flex: 1 }]} value={target} onChangeText={setTarget} placeholder="e.g. Write the intro and 2 body paragraphs" placeholderTextColor={C.muted} maxLength={200} multiline/>
        <MicButton onText={t => setTarget(appendSpeech(target, t))}/>
      </View>
      <Text style={s.label}>Pick ONE task (optional)</Text>
      <View style={s.chips}>
        <TouchableOpacity style={[s.chip, !taskId && s.chipOn]} onPress={() => setTaskId(null)}><Text style={[s.chipText, !taskId && s.chipTextOn]}>No task</Text></TouchableOpacity>
        {tasks.map(t => <TouchableOpacity key={t.id} style={[s.chip, taskId === t.id && s.chipOn]} onPress={() => { setTaskId(t.id); if (!target.trim()) setTarget(t.title); }}>
          <Text style={[s.chipText, taskId === t.id && s.chipTextOn]} numberOfLines={1}>{t.priority === "high" ? "🔴 " : ""}{t.title}</Text></TouchableOpacity>)}
      </View>
      <Text style={s.label}>Rhythm</Text>
      <View style={s.chips}>{(Object.keys(RHYTHMS) as (keyof typeof RHYTHMS)[]).map(k => <TouchableOpacity key={k} style={[s.chip, rhythm === k && s.chipOn]} onPress={() => setRhythm(k)}>
        <Text style={[s.chipText, rhythm === k && s.chipTextOn]}>{RHYTHMS[k].label}</Text></TouchableOpacity>)}</View>
      <Text style={s.label}>Before you start</Text>
      <Check label="💧 Drank some water" value={water} onChange={setWater}/>
      <Check label="🪑 Sitting straight (not lying down)" value={posture} onChange={setPosture}/>
      {Shield && <Check label="🛡 Block my distractions during this block" value={block} onChange={setBlock}/>}
      <Btn title="5-4-3-2-1 · Start" onPress={startCountdown}/>
      <Muted small>Just start with 5 minutes. Starting is the hard part; the rest follows.</Muted>
    </Card>
    <AvoidCard api={api} onError={onError} onNotice={onNotice}/>
    {Shield && <ShieldPresets onNotice={onNotice} onError={onError}/>}
  </View>;
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return <Line><Text style={[s.rowText, { flex: 1 }]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>;
}

/** Today's focus numbers, best hours, and a focus score that also uses Shield's phone data when allowed. */
function TodayFocus({ today }: { today: Row }) {
  const [phone, setPhone] = useState<{ longest: number | null; pickups: number; distracting: number } | null>(null);
  useEffect(() => {
    if (!Shield) return;
    const shield = Shield;
    shield.getInsights(0).then(d => {
      if (!d.available) return;
      const marks = shield.getAppMarks();
      const distracting = d.apps.filter(a => (marks[a.packageName] ?? defaultMark(a.category)) === "distracting").reduce((x, a) => x + a.minutes, 0);
      setPhone({ longest: d.longestFocusMinutes, pickups: d.pickups, distracting });
    }).catch(() => setPhone(null));
  }, []);
  const score = useMemo(() => {
    let sc = Math.min(50, (today.minutes / 120) * 50);                              // up to 50: 2 hours of focus blocks
    if (phone) {
      sc += Math.min(20, ((phone.longest ?? 0) / 90) * 20);                           // up to 20: a long phone-free stretch
      sc += Math.max(0, 15 - Math.max(0, phone.pickups - 30) * 0.5);                 // up to 15: not too many pickups
      sc += Math.max(0, 15 - phone.distracting / 8);                                  // up to 15: little time in distracting apps
    } else sc *= 2;
    return Math.round(Math.min(100, sc));
  }, [today, phone]);
  const maxWeek = Math.max(30, ...(today.week as Row[]).map(d => d.minutes));
  return <Card>
    <Line><View style={s.scoreRing}><Text style={s.scoreText}>{score}</Text></View>
      <View style={{ flex: 1, gap: 2 }}><Kicker>FOCUS SCORE TODAY</Kicker>
        <Text style={s.rowText}>{today.minutes} min in {today.sessions} block{today.sessions === 1 ? "" : "s"} · longest {today.longest} min</Text>
        {phone && <Muted small>{`Phone: longest phone-free ${Math.round(phone.longest ?? 0)} min · ${phone.pickups} pickups · ${Math.round(phone.distracting)} min distracting`}</Muted>}
        {today.best_hours && <Muted small>{`Your best focus hours: ${today.best_hours.from}–${today.best_hours.to}`}</Muted>}</View></Line>
    <View style={s.week}>{(today.week as Row[]).map(d => <View key={d.date} style={s.weekCol}>
      <View style={s.weekTrack}><View style={[s.weekBar, { height: `${Math.max(d.minutes ? 6 : 0, (d.minutes / maxWeek) * 100)}%` }]}/></View>
      <Text style={s.weekLabel}>{new Date(`${d.date}T12:00:00`).toLocaleDateString([], { weekday: "narrow" })}</Text></View>)}</View>
    <Muted small>Score: focus blocks (50) + longest phone-free time (20) + pickups (15) + distracting apps (15). Phone parts need Shield usage access.</Muted>
  </Card>;
}

function Review({ session, task, onSubmit }: { session: Row; task?: Row; onSubmit: (r: Row) => Promise<void> }) {
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [taskDone, setTaskDone] = useState(false);
  const [asTask, setAsTask] = useState(true);
  const [busy, setBusy] = useState(false);
  const [start] = useState(Date.now());
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick(t => t + 1), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, 120 - Math.round((Date.now() - start) / 1000));
  return <Card accent>
    <Line><Kicker>2-MINUTE REVIEW</Kicker><View style={{ flex: 1 }}/><Badge tone="amber">{`⏱ ${clock(left)}`}</Badge></Line>
    <H2>🎯 {session.target || "Your block"}</H2>
    <Text style={s.label}>What got done?</Text>
    <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder="e.g. Intro and one paragraph" placeholderTextColor={C.muted} multiline maxLength={2000}/>
    <Text style={s.label}>What's next?</Text>
    <TextInput style={s.input} value={next} onChangeText={setNext} placeholder="The very next small step" placeholderTextColor={C.muted} maxLength={300}/>
    {!!next.trim() && <Check label="Add the next step as a task" value={asTask} onChange={setAsTask}/>}
    {task && <Check label={`Task finished: ${task.title}`} value={taskDone} onChange={setTaskDone}/>}
    <Text style={s.label}>How focused did it feel?</Text>
    <View style={s.ratingRow}>{RATING.map((e, i) => <TouchableOpacity key={e} onPress={() => setRating(i + 1)} style={[s.rating, rating === i + 1 && s.ratingOn]}><Text style={{ fontSize: 26 }}>{e}</Text></TouchableOpacity>)}</View>
    <Btn title="Save and take a break" busy={busy} onPress={() => { setBusy(true); void onSubmit({ notes: notes.trim() || null, next_step: next.trim() || null, rating, task_done: taskDone, next_as_task: asTask && !!next.trim() }).finally(() => setBusy(false)); }}/>
  </Card>;
}

function BreakChecklist() {
  const items = ["💧 Drink water", "🚶 Walk or a short run", "☀️ Sun exposure", "👀 Eye rest: look far away for 20 seconds", "🧩 A quick brain game (below)"];
  const [done, setDone] = useState<string[]>([]);
  return <View style={{ gap: 6 }}>{items.map(i => { const on = done.includes(i);
    return <TouchableOpacity key={i} style={s.breakRow} onPress={() => setDone(d => (on ? d.filter(x => x !== i) : [...d, i]))}>
      <View style={[s.check, on && s.checkOn]}><Text style={s.checkText}>{on ? "✓" : ""}</Text></View><Text style={[s.rowText, on && { color: C.muted }]}>{i}</Text></TouchableOpacity>; })}
    <Muted small>No phone scrolling on the break: let the brain rest so the next block is easier.</Muted></View>;
}

/** Tiny mental-math game for the break (made up on the phone, no internet). */
function BrainGame() {
  const make = () => { const a = 6 + Math.floor(Math.random() * 14), b = 3 + Math.floor(Math.random() * 9); const answer = a * b;
    const opts = [answer, answer + b, answer - a, answer + 10].sort(() => Math.random() - 0.5); return { a, b, answer, opts }; };
  const [q, setQ] = useState(make);
  const [streak, setStreak] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  function choose(n: number) {
    setPick(n);
    setStreak(s0 => (n === q.answer ? s0 + 1 : 0));
    setTimeout(() => { setQ(make()); setPick(null); }, 700);
  }
  return <Card>
    <Line><Kicker>🧩 BRAIN GAME</Kicker><View style={{ flex: 1 }}/><Badge>{`streak ${streak}`}</Badge></Line>
    <Text style={s.game}>{q.a} × {q.b} = ?</Text>
    <View style={s.chips}>{q.opts.map(n => <TouchableOpacity key={n} onPress={() => choose(n)} style={[s.gameOpt, pick === n && { backgroundColor: n === q.answer ? C.greenSoft : soft(C.red), borderColor: n === q.answer ? C.green : C.red }]}>
      <Text style={s.gameOptText}>{n}</Text></TouchableOpacity>)}</View>
  </Card>;
}

/** Your notebook's avoid-list: log honestly; clean days earn points, slips cost nothing. */
function AvoidCard({ api, onError, onNotice }: Props) {
  const [items, setItems] = useState<Row[] | null>(null);
  const load = useCallback(() => { api<Row[]>("/focus/avoid").then(setItems).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!items) return null;
  if (!items.length) return <Card><Kicker>AVOID LIST</Kicker><H2>Things an app can't block</H2>
    <Muted>Oversleeping, sugar and oily food, gossip, scrolling in bed, WhatsApp status: log them honestly once a day.</Muted>
    <Btn kind="outline" title="📓 Load my avoid list" onPress={() => void api("/focus/avoid/starter", "POST").then(load).catch(r => onError(msg(r)))}/></Card>;
  const log = (id: string, completed: boolean, name: string) => void api(`/habits/${id}/logs`, "POST", { completed })
    .then(() => { onNotice(completed ? `Clean day: ${name} ✓` : "Logged. Tomorrow is a fresh start."); load(); }).catch(r => onError(msg(r)));
  return <Card>
    <Kicker>AVOID LIST · TODAY</Kicker>
    {items.map(h => <View key={h.id} style={s.avoid}>
      <Line><Text style={[s.rowText, { flex: 1 }]}>{h.name}</Text>{h.streak > 0 && <Badge>{`🔥 ${h.streak}`}</Badge>}</Line>
      <Line>
        <View style={s.dots}>{(h.week as Row[]).map(d => <View key={d.date} style={[s.dot, d.state === "clean" ? s.dotClean : d.state === "slipped" ? s.dotSlip : null]}/>)}</View>
        <View style={{ flex: 1 }}/>
        <TouchableOpacity onPress={() => log(h.id, true, h.name)} style={[s.pill, h.today === "clean" && s.pillClean]}><Text style={s.pillText}>Clean ✓</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => log(h.id, false, h.name)} style={[s.pill, h.today === "slipped" && s.pillSlip]}><Text style={s.pillText}>Slipped</Text></TouchableOpacity>
      </Line>
    </View>)}
    <Muted small>Dots show the last 7 days. A slip resets the streak, never your points.</Muted>
  </Card>;
}

/** One tap: your distraction blocklist and a bedtime schedule (no phone after 12). */
function ShieldPresets({ onNotice, onError }: { onNotice: (m: string) => void; onError: (m: string) => void }) {
  const shield = Shield!;
  const [lists, setLists] = useState<BlockList[]>(() => { try { return parseLists(shield.getLists()); } catch { return []; } });
  const has = (name: string) => lists.some(l => l.name === name);
  async function create(name: string) {
    try {
      const installed = new Set((await shield.getInstalledApps()).map(a => a.packageName));
      const bedtime = name === BEDTIME;
      const list: BlockList = { id: `list-${bedtime ? "bedtime" : "distractions"}-${Date.now()}`, name, mode: bedtime ? "schedule" : "manual",
        schedule: bedtime ? { days: [1, 2, 3, 4, 5, 6, 7], start: 0, end: 360 } : null, apps: DISTRACTING_APPS.filter(p => installed.has(p)),
        domains: DISTRACTING_SITES, keywords: ["reels", "shorts"], newApps: false, newAppsSince: 0, adult: true, purchases: false, unsupportedBrowsers: false };
      setLists(parseLists(shield.saveList(JSON.stringify(list))));
      onNotice(bedtime ? "Bedtime list on: distractions blocked 00:00–06:00 🌙" : "Distractions list ready 🛡");
    } catch (r) { onError(msg(r)); }
  }
  return <Card>
    <Kicker>SHIELD PRESETS</Kicker>
    <Line><Text style={[s.rowText, { flex: 1 }]}>🛡 Distractions list{"\n"}<Text style={s.small}>Facebook, TikTok, YouTube, Telegram, WhatsApp, reels/shorts, adult sites</Text></Text>
      {has(DISTRACTIONS) ? <Badge>ready</Badge> : <Btn kind="outline" title="Create" onPress={() => void create(DISTRACTIONS)}/>}</Line>
    <Line><Text style={[s.rowText, { flex: 1 }]}>🌙 No phone after 12{"\n"}<Text style={s.small}>Same list, blocked every night 00:00–06:00</Text></Text>
      {has(BEDTIME) ? <Badge>on</Badge> : <Btn kind="outline" title="Create" onPress={() => void create(BEDTIME)}/>}</Line>
    <Muted small>Edit them in Shield below. To make bedtime unbreakable, use Strict Mode → Follow schedules.</Muted>
  </Card>;
}

const s = StyleSheet.create({
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, minHeight: 44 },
  label: { color: "#aab8af", fontSize: 12, fontWeight: "700", marginTop: 4 },
  small: { color: C.muted, fontSize: 11 },
  rowText: { color: C.text, fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8, maxWidth: "100%" },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 13 },
  chipTextOn: { color: C.green },
  countWrap: { alignItems: "center", gap: 18, paddingVertical: 50 },
  countHint: { color: C.muted, fontSize: 14, letterSpacing: 1 },
  countNum: { color: C.green, fontSize: 120, fontWeight: "900" },
  countTarget: { color: C.text, fontSize: 16, textAlign: "center", paddingHorizontal: 20 },
  focusCard: { backgroundColor: C.panel2, borderColor: C.green, borderWidth: 1, borderRadius: 22, padding: 20, gap: 12, alignItems: "stretch" },
  focusKicker: { color: C.green, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textAlign: "center" },
  timer: { color: C.text, fontSize: 64, fontWeight: "900", textAlign: "center", fontVariant: ["tabular-nums"] },
  focusTarget: { color: C.text, fontSize: 17, fontWeight: "700", textAlign: "center" },
  nudge: { color: C.amber, textAlign: "center", fontWeight: "700" },
  scoreRing: { width: 66, height: 66, borderRadius: 33, borderWidth: 4, borderColor: C.green, alignItems: "center", justifyContent: "center" },
  scoreText: { color: C.text, fontSize: 22, fontWeight: "900" },
  week: { flexDirection: "row", height: 70, gap: 6, marginTop: 4 },
  weekCol: { flex: 1, alignItems: "center", gap: 3 },
  weekTrack: { flex: 1, width: "70%", justifyContent: "flex-end", backgroundColor: C.field, borderRadius: 5, overflow: "hidden" },
  weekBar: { width: "100%", backgroundColor: C.green, borderRadius: 5 },
  weekLabel: { color: C.muted, fontSize: 10 },
  ratingRow: { flexDirection: "row", justifyContent: "space-between" },
  rating: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.line },
  ratingOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  breakRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  check: { width: 24, height: 24, borderRadius: 7, borderColor: "#476051", borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkText: { color: C.greenDark, fontWeight: "900" },
  game: { color: C.text, fontSize: 34, fontWeight: "900", textAlign: "center", marginVertical: 6 },
  gameOpt: { flexGrow: 1, minWidth: 64, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  gameOptText: { color: C.text, fontSize: 18, fontWeight: "800" },
  avoid: { gap: 6, paddingVertical: 8, borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line },
  dotClean: { backgroundColor: C.green },
  dotSlip: { backgroundColor: C.amber },
  pill: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  pillClean: { borderColor: C.green, backgroundColor: C.greenSoft },
  pillSlip: { borderColor: C.amber, backgroundColor: soft(C.amber) },
  pillText: { color: C.text, fontSize: 12, fontWeight: "700" },
});
