import React, { useCallback, useEffect, useState } from "react";
import { Alert, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const MODES = ["review", "add", "mistakes"] as const;
const DECKS = ["german", "english"] as const;
const SUBJECTS = ["german", "english", "coding", "work", "life", "other"] as const;
const GRADES = [
  { grade: "again", label: "Again", color: C.red }, { grade: "hard", label: "Hard", color: C.amber },
  { grade: "good", label: "Good", color: C.green }, { grade: "easy", label: "Easy", color: C.blue },
] as const;
const msg = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";

/** Flashcards (spaced repetition) and the mistake notebook, same data as the web Learning page. */
export function LearningScreen({ api, onError, onNotice }: Props) {
  const [mode, setMode] = useState<(typeof MODES)[number]>("review");
  const [stats, setStats] = useState<Row>({});
  const loadStats = useCallback(() => { api<Row>("/learning/stats").then(setStats).catch(() => undefined); }, [api]);
  useEffect(() => { loadStats(); }, [loadStats]);

  return <Screen onRefresh={loadStats}>
    <Card><Line>
      <View style={{ flex: 1 }}><Muted small>Due today</Muted><H2>{String(stats.due_today ?? "—")}</H2></View>
      <View style={{ flex: 1 }}><Muted small>Reviewed</Muted><H2>{String(stats.reviewed_today ?? 0)}</H2></View>
      <View style={{ flex: 1 }}><Muted small>Streak</Muted><H2>{`${stats.streak_days ?? 0} 🔥`}</H2></View>
    </Line></Card>
    <Chips options={MODES} value={mode} onChange={setMode} labels={{ review: "Review", add: "Add cards", mistakes: "Mistakes" }}/>
    {mode === "review" && <Review api={api} onError={onError} onChanged={loadStats}/>}
    {mode === "add" && <AddCards api={api} onError={onError} onNotice={onNotice} onChanged={loadStats}/>}
    {mode === "mistakes" && <Mistakes api={api} onError={onError} onNotice={onNotice} onChanged={loadStats}/>}
  </Screen>;
}

function Review({ api, onError, onChanged }: { api: Api; onError: (m: string) => void; onChanged: () => void }) {
  const [queue, setQueue] = useState<Row[]>([]);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  useEffect(() => { api<Row[]>("/learning/review?limit=50").then(setQueue).catch(reason => onError(msg(reason))); }, [api, onError]);
  const card = queue[0];

  async function grade(value: string) {
    if (!card) return;
    try {
      await api(`/learning/cards/${card.id}/review`, "POST", { grade: value });
      setShown(false); setDone(n => n + 1);
      setQueue(rows => value === "again" ? [...rows.slice(1), card] : rows.slice(1));
      onChanged();
    } catch (reason) { onError(msg(reason)); }
  }

  if (!card) return <Card><Empty>{done ? `Nice work: ${done} done. ` : ""}Nothing is due right now.</Empty></Card>;
  return <Card>
    <Kicker>{`${queue.length} TO GO · ${String(card.deck).toUpperCase()}`}</Kicker>
    <TouchableOpacity onPress={() => setShown(true)} activeOpacity={0.8}
      style={{ minHeight: 200, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center", padding: 20, gap: 10 }}>
      <Text style={{ color: C.text, fontSize: 26, fontWeight: "800", textAlign: "center" }}>{card.front}</Text>
      {shown ? <>
        <View style={{ height: 1, width: "60%", backgroundColor: C.line }}/>
        <Text style={{ color: C.green, fontSize: 20, fontWeight: "700", textAlign: "center" }}>{card.back}</Text>
        {!!card.example && <Text style={{ color: C.muted, fontStyle: "italic", textAlign: "center" }}>“{card.example}”</Text>}
      </> : <Muted small>Tap to show the answer</Muted>}
    </TouchableOpacity>
    {shown && <Line>{GRADES.map(g => <TouchableOpacity key={g.grade} onPress={() => void grade(g.grade)}
      style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: g.color, alignItems: "center" }}>
      <Text style={{ color: g.color, fontWeight: "800" }}>{g.label}</Text></TouchableOpacity>)}</Line>}
  </Card>;
}

function AddCards({ api, onError, onNotice, onChanged }: Props & { onChanged: () => void }) {
  const [deck, setDeck] = useState<(typeof DECKS)[number]>("german");
  const [front, setFront] = useState(""); const [back, setBack] = useState(""); const [example, setExample] = useState("");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    try { await api("/learning/cards", "POST", { deck, front, back, ...(example.trim() ? { example } : {}) }); setFront(""); setBack(""); setExample(""); onNotice("Card added."); onChanged(); }
    catch (reason) { onError(msg(reason)); } finally { setBusy(false); }
  }
  async function importBulk() {
    setBusy(true);
    try {
      const r = await api<Row>("/learning/cards/import", "POST", { deck, text: bulk });
      setBulk(""); onNotice(`Imported ${r.added}${r.skipped_duplicates ? `, skipped ${r.skipped_duplicates} duplicates` : ""}.`); onChanged();
    } catch (reason) { onError(msg(reason)); } finally { setBusy(false); }
  }
  return <>
    <Card><Kicker>NEW CARD</Kicker>
      <Chips options={DECKS} value={deck} onChange={setDeck}/>
      <Field voice value={front} onChangeText={setFront} placeholder="Front, e.g. der Bahnhof" maxLength={500}/>
      <Field voice value={back} onChangeText={setBack} placeholder="Back, e.g. the train station" maxLength={1000}/>
      <Field voice value={example} onChangeText={setExample} placeholder="Example sentence (optional)" maxLength={1000}/>
      <Btn title="Add card" onPress={() => void add()} busy={busy} disabled={!front.trim() || !back.trim()}/>
    </Card>
    <Card><Kicker>IMPORT A LIST</Kicker>
      <Muted small>One per line: front ; back ; example</Muted>
      <Field value={bulk} onChangeText={setBulk} placeholder={"die Katze ; the cat\nlaufen ; to run"} multiline/>
      <Btn kind="outline" title={`Import into ${deck}`} onPress={() => void importBulk()} busy={busy} disabled={!bulk.trim()}/>
    </Card>
  </>;
}

function Mistakes({ api, onError, onNotice, onChanged }: Props & { onChanged: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>("german");
  const [what, setWhat] = useState(""); const [fix, setFix] = useState(""); const [lesson, setLesson] = useState("");
  const load = useCallback(() => { api<Row[]>("/mistakes").then(setRows).catch(reason => onError(msg(reason))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note: string) => void work.then(() => { onNotice(note); load(); onChanged(); }).catch(reason => onError(msg(reason)));

  return <>
    <Card><Kicker>LOG A MISTAKE</Kicker>
      <Chips options={SUBJECTS} value={subject} onChange={setSubject}/>
      <Field voice value={what} onChangeText={setWhat} placeholder="What I did / said" maxLength={1000}/>
      <Field voice value={fix} onChangeText={setFix} placeholder="The right way" maxLength={1000}/>
      <Field voice value={lesson} onChangeText={setLesson} placeholder="Why / the rule (optional)" maxLength={2000}/>
      <Btn title="Save mistake" disabled={!what.trim() || !fix.trim()} onPress={() => {
        run(api("/mistakes", "POST", { subject, what_happened: what, correction: fix, ...(lesson.trim() ? { lesson } : {}) }), "Saved.");
        setWhat(""); setFix(""); setLesson("");
      }}/>
    </Card>
    <Card><Kicker>{`${rows.length} OPEN · MOST REPEATED FIRST`}</Kicker>
      {rows.length ? rows.map(row => <View key={row.id} style={{ gap: 4, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
        <Line><Badge tone="muted">{row.subject}</Badge>{row.occurrences > 1 && <Badge tone="amber">{`made ${row.occurrences}×`}</Badge>}</Line>
        <Text style={{ color: C.red, textDecorationLine: "line-through" }}>{row.what_happened}</Text>
        <Text style={{ color: C.green, fontWeight: "700" }}>✓ {row.correction}</Text>
        {!!row.lesson && <Muted small>{row.lesson}</Muted>}
        <Line style={{ flexWrap: "wrap" }}>
          <Btn kind="link" title="Made it again" onPress={() => run(api(`/mistakes/${row.id}/again`, "POST"), "Counted. Its card is due today.")}/>
          {!row.card_id && <Btn kind="link" title="Make a card" onPress={() => run(api(`/mistakes/${row.id}/card`, "POST", {}), "Flashcard created.")}/>}
          <Btn kind="link" title="Fixed" onPress={() => run(api(`/mistakes/${row.id}`, "PATCH", { resolved: true }), "Marked as fixed.")}/>
          <Btn kind="link" title="Delete" onPress={() => Alert.alert("Delete mistake?", String(row.what_happened), [{ text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => run(api(`/mistakes/${row.id}`, "DELETE"), "Deleted.") }])}/>
        </Line>
      </View>) : <Empty>No open mistakes.</Empty>}
    </Card>
  </>;
}

const STAGES = ["draft", "applied", "interview", "offer", "accepted", "rejected", "withdrawn"] as const;
const STAGE_LABEL: Record<string, string> = { draft: "Saved", applied: "Applied", interview: "Interview", offer: "Offer", accepted: "Accepted", rejected: "Rejected", withdrawn: "Withdrawn" };

/** Job tracker. Tracking only: nothing is sent or applied for automatically. */
export function JobsScreen({ api, onError, onNotice }: Props) {
  const [jobs, setJobs] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Row>({});
  const [company, setCompany] = useState(""); const [role, setRole] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [step, setStep] = useState(""); const [follow, setFollow] = useState("");
  const load = useCallback(() => {
    Promise.all([api<Row[]>("/career/jobs"), api<Row>("/career/jobs/summary")]).then(([rows, sum]) => { setJobs(rows); setSummary(sum); }).catch(reason => onError(msg(reason)));
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  const run = (work: Promise<unknown>, note?: string) => void work.then(() => { if (note) onNotice(note); load(); }).catch(reason => onError(msg(reason)));
  const followUps: Row[] = summary.follow_ups_due || [];

  return <Screen onRefresh={load}>
    <Card><Line>
      <View style={{ flex: 1 }}><Muted small>Open</Muted><H2>{String(summary.open ?? 0)}</H2></View>
      <View style={{ flex: 1 }}><Muted small>Interview rate</Muted><H2>{summary.interview_rate_percent != null ? `${summary.interview_rate_percent}%` : "—"}</H2></View>
      <View style={{ flex: 1 }}><Muted small>Follow-ups</Muted><H2>{String(followUps.length)}</H2></View>
    </Line></Card>
    {followUps.length > 0 && <Card accent><Kicker>FOLLOW-UPS DUE</Kicker>{followUps.map(f => <Text key={f.id} style={{ color: C.text }}>{f.company} · {f.role}{f.next_step ? `: ${f.next_step}` : ""}</Text>)}</Card>}
    <Card><Kicker>SAVE A JOB</Kicker>
      <Field voice value={company} onChangeText={setCompany} placeholder="Company" maxLength={200}/>
      <Field voice value={role} onChangeText={setRole} placeholder="Role" maxLength={200}/>
      <Btn title="Save" disabled={!company.trim() || !role.trim()} onPress={() => { run(api("/career/jobs", "POST", { company, role }), "Saved."); setCompany(""); setRole(""); }}/>
    </Card>
    <Card><Kicker>{`${jobs.length} APPLICATIONS`}</Kicker>
      {jobs.length ? jobs.map(job => <View key={job.id} style={{ gap: 6, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
        <TouchableOpacity onPress={() => { setOpen(open === job.id ? null : job.id); setStep(job.next_step || ""); setFollow(job.follow_up_on || ""); }}>
          <Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{job.role}</Text><Muted small>{job.company}{job.next_step ? ` · → ${job.next_step}` : ""}{job.follow_up_on ? ` (${job.follow_up_on})` : ""}</Muted></View>
            <Badge tone={job.status === "offer" || job.status === "accepted" ? "green" : job.status === "interview" ? "amber" : "muted"}>{STAGE_LABEL[job.status] || job.status}</Badge></Line>
        </TouchableOpacity>
        {open === job.id && <View style={{ gap: 6 }}>
          <Chips options={STAGES} value={job.status} onChange={status => run(api(`/career/jobs/${job.id}`, "PATCH", { status }))} labels={STAGE_LABEL}/>
          <Field voice value={step} onChangeText={setStep} placeholder="Next step, e.g. Email recruiter" maxLength={200}/>
          <Field value={follow} onChangeText={setFollow} placeholder="Follow up on YYYY-MM-DD" maxLength={10}/>
          <Line><Btn title="Save next step" style={{ flex: 1 }} onPress={() => {
            if (follow && !/^\d{4}-\d{2}-\d{2}$/.test(follow)) { onError("Date must look like 2026-12-01"); return; }
            run(api(`/career/jobs/${job.id}`, "PATCH", { next_step: step.trim() || null, follow_up_on: follow || null }), "Updated.");
          }}/>
            <Btn kind="danger" title="Delete" onPress={() => Alert.alert("Delete?", `${job.company} · ${job.role}`, [{ text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => run(api(`/career/jobs/${job.id}`, "DELETE"), "Deleted.") }])}/></Line>
        </View>}
      </View>) : <Empty>Save roles you're interested in to track them from saved to offer.</Empty>}
      <Muted small>Sakuna only tracks. It never applies, messages or scrapes job sites for you.</Muted>
    </Card>
  </Screen>;
}
