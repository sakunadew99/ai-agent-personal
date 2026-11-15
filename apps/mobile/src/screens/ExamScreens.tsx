import React, { useCallback, useEffect, useState } from "react";
import { Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import { peek, type ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Empty, H2, Kicker, Muted, Progress, Row as Line, Screen } from "../ui";
import { appendSpeech, MicButton } from "../voice";
import { DateField, TimeField } from "../pickers";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const DAY_SHORT = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const STATUS: Record<string, { tone: "green" | "amber" | "red" | "muted"; label: string }> = {
  on_track: { tone: "green", label: "on track" }, met: { tone: "green", label: "target met" }, behind: { tone: "red", label: "behind" },
  no_data: { tone: "muted", label: "no scores yet" }, past: { tone: "muted", label: "exam passed" },
};
const num = (v: unknown) => (v == null ? null : Number(v));
const fmtScore = (v: unknown, exam: string) => (v == null ? "—" : exam === "ielts" ? Number(v).toFixed(1) : String(Math.round(Number(v))));

/** Exam coach: IELTS + Goethe. Plain-code plan and forecast; AI only for writing/speaking feedback (an estimate). */
export function ExamScreen({ api, onError, onNotice }: Props) {
  const [plans, setPlans] = useState<Row[] | null>(() => peek("/exams"));
  const [exam, setExam] = useState<"ielts" | "goethe">("ielts");
  const [modal, setModal] = useState<"score" | "settings" | "writing" | "speaking" | null>(null);
  const load = useCallback(() => { api<Row[]>("/exams").then(setPlans).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!plans) return <Screen><Empty>Loading your exam plans…</Empty></Screen>;
  const p = plans.find(x => x.exam === exam)!;
  const r = p.readiness, t = p.today;
  const replace = (next: Row) => setPlans(ps => ps!.map(x => (x.id === next.id ? next : x)));
  const log = (skill: string, minutes: number, label: string) => api<Row>(`/exams/${p.id}/log`, "POST", { skill, minutes })
    .then(next => { replace(next); onNotice(`+${minutes} min ${label} ✓`); }).catch(e => onError(msg(e)));
  const startFocus = (b: Row) => api("/focus/sessions", "POST", { minutes: Math.max(5, Math.min(180, b.minutes)), mode: "focus", target: `${p.name} · ${b.label}: ${b.activity}`.slice(0, 200), break_minutes: 5 })
    .then(() => onNotice("Focus timer started: open the Focus tab. Log the minutes here when you're done.")).catch(e => onError(msg(e)));
  const st = STATUS[r.status] || STATUS.no_data;
  const left = Math.max(0, t.minutes - t.done_minutes);

  return <Screen onRefresh={load}>
    <View style={s.switch}>{plans.map(x => <TouchableOpacity key={x.exam} style={[s.switchTab, exam === x.exam && s.switchOn]} onPress={() => setExam(x.exam)}>
      <Text style={[s.switchText, exam === x.exam && s.switchTextOn]}>{x.exam === "ielts" ? "🇬🇧 IELTS" : "🇩🇪 Goethe"}</Text></TouchableOpacity>)}</View>

    <Card accent>
      <Line><Kicker>{`${p.name.toUpperCase()} · ${String(p.variant).toUpperCase()}`}</Kicker><View style={{ flex: 1 }}/><Badge tone={st.tone}>{st.label}</Badge></Line>
      <Line>
        <View style={{ flex: 1 }}><Text style={s.days}>{r.days_left}</Text><Muted small>days left</Muted></View>
        <View style={{ flex: 1 }}><Text style={s.days}>{fmtScore(p.target_score, p.exam)}</Text><Muted small>target</Muted></View>
        <View style={{ flex: 1 }}><Text style={s.days}>{r.overall != null ? fmtScore(r.overall, p.exam) : r.streak}</Text><Muted small>{r.overall != null ? `now → ${fmtScore(r.projected_overall, p.exam)}` : "day streak"}</Muted></View>
      </Line>
      <Muted small>{`Exam ${new Date(`${p.exam_date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })}${p.date_is_estimate ? " (estimated: set your real date in ⚙)" : ""} · ${r.hours_left} study hours left`}</Muted>
      <Text style={[s.message, r.status === "behind" && { color: "#ffb1a0" }]}>{r.message}</Text>
      <Line><Muted small>{`This week: ${r.week.done}/${r.week.planned} min`}</Muted><View style={{ flex: 1 }}/><Btn kind="link" title="⚙ Plan settings" onPress={() => setModal("settings")}/></Line>
      <Progress value={r.week.planned ? Math.min(100, (r.week.done / r.week.planned) * 100) : 0}/>
    </Card>

    <Card>
      <Line><Kicker>TODAY</Kicker><View style={{ flex: 1 }}/>{t.study_day && <Badge tone={left ? "amber" : "green"}>{left ? `${left} min to go` : "done ✓"}</Badge>}</Line>
      {!t.study_day ? <Muted>{t.message}</Muted> : <>
        <H2>{`${t.minutes} minutes`}</H2>
        {t.catch_up > 0 && <Text style={s.catchup}>{`⏫ Includes ${t.catch_up} catch-up minutes from this week`}</Text>}
        {(t.blocks as Row[]).map(b => <View key={b.skill} style={s.block}>
          <Line><Text style={{ fontSize: 22 }}>{b.icon}</Text><View style={{ flex: 1 }}><Text style={s.blockTitle}>{`${b.label} · ${b.minutes} min`}</Text>
            {b.done_minutes > 0 && <Muted small>{`${b.done_minutes} min done today`}</Muted>}</View>{b.why === "weakest vs target" && <Badge tone="amber">weakest</Badge>}</Line>
          <Text style={s.activity}>{b.activity}</Text>
          <Line><Btn title={`Done ✓ ${b.minutes}m`} onPress={() => void log(b.skill, b.minutes, b.label)} style={{ flex: 1 }}/>
            <Btn kind="outline" title="⏱ Focus timer" onPress={() => void startFocus(b)} style={{ flex: 1 }}/></Line>
        </View>)}
        <Muted small>{t.message}</Muted>
      </>}
    </Card>

    <Card>
      <Line><Kicker>SKILLS</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title="＋ Add score" onPress={() => setModal("score")}/></Line>
      {(p.skills as Row[]).map(sk => { const target = num(sk.target)!, max = num(p.score_max)!, latest = num(sk.latest), proj = num(sk.projected); const sst = STATUS[sk.status] || STATUS.no_data;
        return <View key={sk.skill} style={{ gap: 4, marginBottom: 6 }}>
          <Line><Text style={s.skill}>{sk.icon} {sk.label}</Text><View style={{ flex: 1 }}/><Text style={s.score}>{fmtScore(latest, p.exam)}</Text><Badge tone={sst.tone}>{sst.label}</Badge></Line>
          <View style={s.bar}>
            <View style={[s.fill, { width: `${((latest ?? 0) / max) * 100}%` }]}/>
            {proj != null && <View style={[s.proj, { left: `${(proj / max) * 100}%` }]}/>}
            <View style={[s.target, { left: `${(target / max) * 100}%` }]}/>
          </View>
          <Muted small>{latest == null ? "Do a mock test to get a starting score." : `Projected at the exam: ${fmtScore(proj, p.exam)}${sk.trend_per_30_days != null ? ` · trend ${sk.trend_per_30_days > 0 ? "+" : ""}${sk.trend_per_30_days}/month` : ""} · ${sk.tests} score${sk.tests === 1 ? "" : "s"}`}</Muted>
        </View>; })}
      <Muted small>Green = latest score, white mark = projection, amber line = target. Projections are capped so they stay realistic.</Muted>
    </Card>

    <Card>
      <Kicker>PRACTICE WITH FEEDBACK</Kicker>
      <Line><Btn title="✍️ Writing" onPress={() => setModal("writing")} style={{ flex: 1 }}/><Btn title="🗣 Speaking" onPress={() => setModal("speaking")} style={{ flex: 1 }}/></Line>
      <Muted small>Rule checks always work. With AI on, you also get corrections and an estimated score (marked as an estimate); the top corrections go to your mistake notebook for revision.</Muted>
    </Card>

    <Card>
      <Kicker>ASK THE ASSISTANT</Kicker>
      {["log 30 minutes IELTS listening", "IELTS reading mock 6.5", "set my IELTS exam date to 20 March", "my IELTS target is 7", "study german 40 minutes a day", "how is my IELTS prep going?"]
        .map(x => <Text key={x} style={s.example}>“{x}”</Text>)}
      <Muted small>The assistant tracks it, adjusts your plan, and tells you honestly when you fall behind.</Muted>
    </Card>

    {modal === "score" && <ScoreModal p={p} api={api} onClose={() => setModal(null)} onSaved={next => { replace(next); setModal(null); onNotice("Score saved"); }} onError={onError}/>}
    {modal === "settings" && <SettingsModal p={p} api={api} onClose={() => setModal(null)} onSaved={next => { replace(next); setModal(null); onNotice("Plan updated"); }} onError={onError}/>}
    {(modal === "writing" || modal === "speaking") && <PracticeModal p={p} mode={modal} api={api} onClose={() => { setModal(null); load(); }} onError={onError}/>}
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

function Pills<T extends string>({ options, value, onChange, labels }: { options: T[]; value: T; onChange: (v: T) => void; labels?: Record<string, string> }) {
  return <View style={s.pills}>{options.map(o => <TouchableOpacity key={o} style={[s.pill, value === o && s.pillOn]} onPress={() => onChange(o)}>
    <Text style={[s.pillText, value === o && s.pillTextOn]}>{labels?.[o] ?? o}</Text></TouchableOpacity>)}</View>;
}

function ScoreModal({ p, api, onClose, onSaved, onError }: { p: Row; api: Api; onClose: () => void; onSaved: (n: Row) => void; onError: (m: string) => void }) {
  const skills = (p.skills as Row[]).map(x => x.skill as string);
  const [skill, setSkill] = useState(skills[0]);
  const [score, setScore] = useState("");
  const [source, setSource] = useState<"mock" | "practice" | "real">("mock");
  const labels = Object.fromEntries((p.skills as Row[]).map(x => [x.skill, `${x.icon} ${x.label}`]));
  return <Sheet title="Add a score" onClose={onClose}>
    <Pills options={skills} value={skill} onChange={setSkill} labels={labels}/>
    <TextInput style={s.input} value={score} onChangeText={setScore} keyboardType="decimal-pad" placeholder={p.exam === "ielts" ? "Band, e.g. 6.5" : "Points 0-100, e.g. 72"} placeholderTextColor={C.muted}/>
    <Pills options={["mock", "practice", "real"]} value={source} onChange={setSource} labels={{ mock: "Mock test", practice: "Practice", real: "Real exam" }}/>
    <Btn title="Save score" onPress={() => void api<Row>(`/exams/${p.id}/scores`, "POST", { skill, score: Number(score), source }).then(onSaved).catch(e => onError(msg(e)))} disabled={!score.trim()}/>
    <Muted small>{p.exam === "ielts" ? "IELTS bands are rounded to the nearest 0.5." : "Goethe: 60 points per module is a pass."}</Muted>
  </Sheet>;
}

function SettingsModal({ p, api, onClose, onSaved, onError }: { p: Row; api: Api; onClose: () => void; onSaved: (n: Row) => void; onError: (m: string) => void }) {
  const [d, setD] = useState<Row>({ variant: p.variant, target_score: String(p.target_score), exam_date: p.exam_date, daily_minutes: p.daily_minutes,
    study_days: p.study_days, study_time: String(p.study_time || "14:00").slice(0, 5), active: p.active });
  const shiftDate = (days: number) => { const x = new Date(`${d.exam_date}T12:00:00`); x.setDate(x.getDate() + days); setD({ ...d, exam_date: x.toISOString().slice(0, 10) }); };
  const shiftTime = (m: number) => { const [h, mi] = String(d.study_time).split(":").map(Number); const t = ((h * 60 + mi + m) % 1440 + 1440) % 1440; setD({ ...d, study_time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` }); };
  const save = () => api<Row>(`/exams/${p.id}`, "PATCH", { ...d, target_score: Number(d.target_score), exam_date: d.exam_date !== p.exam_date ? d.exam_date : undefined })
    .then(onSaved).catch(e => onError(msg(e)));
  return <Sheet title={`${p.name} plan`} onClose={onClose}>
    <Text style={s.label}>{p.exam === "ielts" ? "Test type" : "Level"}</Text>
    <Pills options={p.variants as string[]} value={d.variant} onChange={v => setD({ ...d, variant: v })}/>
    <Text style={s.label}>{p.exam === "ielts" ? "Target band" : "Target points per module (60 = pass)"}</Text>
    <TextInput style={s.input} value={d.target_score} onChangeText={v => setD({ ...d, target_score: v })} keyboardType="decimal-pad"/>
    <Text style={s.label}>Exam date</Text>
    <DateField value={d.exam_date} onChange={v => v && setD({ ...d, exam_date: v })} min={new Date().toISOString().slice(0, 10)}/>
    <Line><Btn kind="outline" title="−1 week" onPress={() => shiftDate(-7)} style={{ flex: 1 }}/><Btn kind="outline" title="+1 week" onPress={() => shiftDate(7)} style={{ flex: 1 }}/></Line>
    {p.date_is_estimate && <Muted small>This date is an estimate. Saving a new date marks it as your real exam date.</Muted>}
    <Text style={s.label}>Minutes per study day</Text>
    <Pills options={["20", "30", "45", "60", "90", "120"]} value={String(d.daily_minutes)} onChange={v => setD({ ...d, daily_minutes: Number(v) })}/>
    <Text style={s.label}>Study days</Text>
    <View style={s.daysRow}>{DAY_SHORT.map((n, i) => { const on = (d.study_days as number[]).includes(i + 1);
      return <TouchableOpacity key={n} style={[s.day, on && s.dayOn]} onPress={() => setD({ ...d, study_days: on ? (d.study_days as number[]).filter(x => x !== i + 1) : [...d.study_days, i + 1].sort() })}>
        <Text style={[s.dayText, on && s.dayTextOn]}>{n}</Text></TouchableOpacity>; })}</View>
    <Text style={s.label}>Study time (added to your day plan)</Text>
    <TimeField value={d.study_time} onChange={t => t && setD({ ...d, study_time: t })}/>
    <Line><Text style={[s.skill, { flex: 1 }]}>Preparing for this exam</Text><Switch value={!!d.active} onValueChange={v => setD({ ...d, active: v })} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line>
    <Btn title="Save plan" onPress={() => void save()}/>
  </Sheet>;
}

function PracticeModal({ p, mode, api, onClose, onError }: { p: Row; mode: "writing" | "speaking"; api: Api; onClose: () => void; onError: (m: string) => void }) {
  const prompts: string[] = mode === "writing" ? p.writing_prompts : p.speaking_questions;
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState("");
  const [task, setTask] = useState<"task1" | "task2">("task2");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [result, setResult] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (startedAt == null) return; const id = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 500); return () => clearInterval(id); }, [startedAt]);
  async function submit() {
    setBusy(true);
    try { setResult(await api<Row>(`/exams/${p.id}/feedback`, "POST", { mode, prompt: prompts[i], answer, task, seconds })); setStartedAt(null); }
    catch (e) { onError(msg(e)); } finally { setBusy(false); }
  }
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  return <Sheet title={mode === "writing" ? "✍️ Writing practice" : "🗣 Speaking practice"} onClose={onClose}>
    <Card><Line><Kicker>{`TASK ${i + 1}/${prompts.length}`}</Kicker><View style={{ flex: 1 }}/><Btn kind="link" title="Next topic ›" onPress={() => { setI((i + 1) % prompts.length); setResult(null); setAnswer(""); setSeconds(0); }}/></Line>
      <Text style={s.prompt}>{prompts[i]}</Text></Card>
    {mode === "writing" && p.exam === "ielts" && <Pills options={["task1", "task2"]} value={task} onChange={setTask} labels={{ task1: "Task 1 (150+)", task2: "Task 2 (250+)" }}/>}
    {mode === "speaking" && <Line>
      <Btn title={startedAt ? `⏹ Stop · ${seconds}s` : "▶ Start timer"} onPress={() => (startedAt ? setStartedAt(null) : (setSeconds(0), setStartedAt(Date.now())))} style={{ flex: 1 }}/>
      <MicButton size={48} onText={x => setAnswer(a => appendSpeech(a, x))}/>
    </Line>}
    {mode === "speaking" && <Muted small>Start the timer, tap 🎙 and answer out loud. Your words appear below; fix any recognition mistakes, then get feedback.</Muted>}
    <TextInput style={[s.input, { minHeight: mode === "writing" ? 220 : 120, textAlignVertical: "top" }]} multiline value={answer} onChangeText={setAnswer}
      placeholder={mode === "writing" ? "Write your answer here…" : "Your spoken answer appears here…"} placeholderTextColor={C.muted}/>
    <Muted small>{`${words} words${mode === "speaking" && seconds ? ` · ${seconds}s` : ""}`}</Muted>
    <Btn title="Get feedback" busy={busy} disabled={words < 3} onPress={() => void submit()}/>
    {result && <Feedback r={result} exam={p.exam}/>}
  </Sheet>;
}

function Feedback({ r, exam }: { r: Row; exam: string }) {
  const m = r.metrics || {}, ai = r.ai;
  return <View style={{ gap: 10 }}>
    {ai?.estimated_score != null && <Card accent><Kicker>ESTIMATED SCORE</Kicker><Text style={s.est}>{fmtScore(ai.estimated_score, exam)}</Text><Muted small>{r.note}</Muted></Card>}
    {ai?.summary ? <Card><Kicker>SUMMARY</Kicker><Text style={s.body}>{ai.summary}</Text></Card> : null}
    {ai && Object.keys(ai.criteria || {}).length > 0 && <Card><Kicker>BY CRITERION</Kicker>{Object.entries(ai.criteria as Record<string, string>).map(([k, v]) => <Text key={k} style={s.body}><Text style={{ fontWeight: "800" }}>{k}: </Text>{v}</Text>)}</Card>}
    {ai && (ai.corrections as Row[]).length > 0 && <Card><Kicker>CORRECTIONS</Kicker>{(ai.corrections as Row[]).map((c, i) => <View key={i} style={{ gap: 2, marginBottom: 6 }}>
      <Text style={s.wrong}>✗ {c.wrong}</Text><Text style={s.right}>✓ {c.right}</Text>{!!c.why && <Muted small>{c.why}</Muted>}</View>)}
      {r.mistakes_saved > 0 && <Muted small>{`${r.mistakes_saved} added to your mistake notebook for revision.`}</Muted>}</Card>}
    <Card><Kicker>CHECKS</Kicker>
      <Text style={s.body}>{m.words_per_minute != null ? `${m.words} words · ${m.words_per_minute} words/min · ${m.fillers} filler words` : `${m.words}/${m.min_words} words · ${m.paragraphs} paragraphs · linking words: ${(m.linking_words || []).join(", ") || "none"}`}</Text>
      {[...(m.tips || []), ...((ai?.tips as string[]) || [])].map((x: string, i: number) => <Text key={i} style={s.body}>•  {x}</Text>)}
      {!ai && <Muted small>{r.note}</Muted>}
    </Card>
  </View>;
}

const s = StyleSheet.create({
  switch: { flexDirection: "row", backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 99, padding: 4 },
  switchTab: { flex: 1, borderRadius: 99, paddingVertical: 10, alignItems: "center" },
  switchOn: { backgroundColor: C.green },
  switchText: { color: C.muted, fontWeight: "800" },
  switchTextOn: { color: C.greenDark },
  days: { color: C.text, fontSize: 28, fontWeight: "900", fontVariant: ["tabular-nums"] },
  message: { color: "#d1ddd4", fontSize: 13, lineHeight: 19 },
  catchup: { color: C.amber, fontWeight: "700", fontSize: 13 },
  block: { backgroundColor: C.panel2, borderRadius: 14, padding: 12, gap: 8 },
  blockTitle: { color: C.text, fontWeight: "800", fontSize: 15 },
  activity: { color: "#d1ddd4", fontSize: 13, lineHeight: 19 },
  skill: { color: C.text, fontWeight: "700", fontSize: 14 },
  score: { color: C.text, fontWeight: "900", fontSize: 16, marginRight: 6, fontVariant: ["tabular-nums"] },
  bar: { height: 10, backgroundColor: C.line, borderRadius: 5, overflow: "visible", position: "relative" },
  fill: { height: 10, backgroundColor: C.green, borderRadius: 5 },
  proj: { position: "absolute", top: -2, width: 3, height: 14, backgroundColor: C.text, borderRadius: 2 },
  target: { position: "absolute", top: -4, width: 2, height: 18, backgroundColor: C.amber },
  example: { color: "#b9c7be", fontSize: 13, fontStyle: "italic" },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 44, paddingBottom: 8 },
  modalTitle: { color: C.text, fontSize: 19, fontWeight: "800" },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  closeText: { color: C.text, fontSize: 18 },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  label: { color: "#aab8af", fontSize: 12, fontWeight: "700" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8 },
  pillOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  pillText: { color: C.muted, fontWeight: "600" },
  pillTextOn: { color: C.green },
  daysRow: { flexDirection: "row", justifyContent: "space-between" },
  day: { width: 40, height: 40, borderRadius: 20, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: C.green, borderColor: C.green },
  dayText: { color: C.muted, fontWeight: "700", fontSize: 12 },
  dayTextOn: { color: C.greenDark },
  time: { color: C.text, fontSize: 22, fontWeight: "900", flex: 1, textAlign: "center" },
  prompt: { color: C.text, fontSize: 15, lineHeight: 22 },
  est: { color: C.green, fontSize: 44, fontWeight: "900" },
  body: { color: "#d1ddd4", fontSize: 14, lineHeight: 20 },
  wrong: { color: "#ffb1a0", fontSize: 14 },
  right: { color: "#a5e3be", fontSize: 14, fontWeight: "700" },
});
