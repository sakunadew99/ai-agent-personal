import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { GermanyFinder } from "./GermanyFinder";
import { Badge, Btn, C, Card, Chips, Empty, Field, H2, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => r instanceof Error ? r.message : "Something went wrong";
const day = (d?: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }) : "—";
const FACES = ["😞", "🙁", "😐", "🙂", "😄"];

/** Coach on Home: check-in, top 3 / wrap-up, pattern suggestions with evidence and options, care when needed. */
export function CoachCardMobile({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [c, setC] = useState<Row | null>(null);
  const [energy, setEnergy] = useState(0); const [mood, setMood] = useState(0);
  const [win, setWin] = useState(""); const [note, setNote] = useState("");
  const load = useCallback(() => { api<Row>("/coach").then(setC).catch(() => setC(null)); }, [api]);
  useEffect(() => { load(); }, [load]);
  const run = (w: Promise<unknown>) => void w.then(load).catch(r => onError(msg(r)));
  if (!c) return null;
  return <Card accent>
    <Kicker>{c.moment === "evening" ? "COACH · EVENING" : "COACH · TODAY"}</Kicker>
    {c.care && <View style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.amber }}>
      <Text style={{ color: C.text }}>{c.care.message}</Text>
      {(c.care.help as Row[]).map(h => <TouchableOpacity key={h.label} disabled={!/^\d+$/.test(h.phone)} onPress={() => void Linking.openURL(`tel:${h.phone}`)}>
        <Text style={{ color: C.amber, fontWeight: "800" }}>{`${h.phone} · ${h.label}`}</Text></TouchableOpacity>)}
      <Muted small>{c.care.note}</Muted></View>}
    {!c.checkin ? <View style={{ gap: 6 }}>
      <Muted small>Quick check-in</Muted>
      <Line><Text style={{ color: C.muted, width: 52 }}>Energy</Text>{[1, 2, 3, 4, 5].map(n => <TouchableOpacity key={n} onPress={() => setEnergy(n)}
        style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: energy === n ? C.green : C.line, backgroundColor: energy === n ? C.green : "transparent" }}>
        <Text style={{ color: energy === n ? C.greenDark : C.text }}>{n}</Text></TouchableOpacity>)}</Line>
      <Line><Text style={{ color: C.muted, width: 52 }}>Mood</Text>{[1, 2, 3, 4, 5].map(n => <TouchableOpacity key={n} onPress={() => setMood(n)}
        style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: mood === n ? C.green : C.line }}>
        <Text>{FACES[n - 1]}</Text></TouchableOpacity>)}</Line>
      <Field voice value={win} onChangeText={setWin} placeholder="One win today (optional)" maxLength={300}/>
      <Field voice value={note} onChangeText={setNote} placeholder="Anything on your mind? (private)" maxLength={2000}/>
      <Btn title="Save check-in" disabled={!energy || !mood} onPress={() => run(api("/coach/checkin", "POST", { energy, mood, win, note }))}/>
    </View> : <Muted small>{`Checked in · energy ${c.checkin.energy}/5 · mood ${FACES[c.checkin.mood - 1]}`}</Muted>}
    {c.brief && c.moment !== "evening" && (c.brief.top3 as Row[]).length > 0 && <View style={{ gap: 2 }}>
      <Text style={{ color: C.text, fontWeight: "700" }}>Top 3 today</Text>
      {(c.brief.top3 as Row[]).map((t, i) => <Text key={t.id} style={{ color: C.text }}>{`${i + 1}. ${t.title}`}</Text>)}
      {!!c.brief.balance_note && <Muted small>{c.brief.balance_note}</Muted>}
    </View>}
    {c.moment === "evening" && (c.wrap_up as Row[]).map(t => <Line key={t.id}><Text style={{ color: C.text, flex: 1 }}>{t.title}</Text>
      <Btn kind="link" title="Done" onPress={() => run(api(`/tasks/${t.id}/complete`, "PATCH"))}/>
      <Btn kind="link" title="Tomorrow" onPress={() => run(api(`/tasks/${t.id}`, "PATCH", { due_at: new Date(new Date(t.due_at).getTime() + 86400000).toISOString() }))}/>
      <Btn kind="link" title="Drop" onPress={() => run(api(`/tasks/${t.id}`, "PATCH", { status: "cancelled" }))}/></Line>)}
    {(c.suggestions as Row[]).map(s => <View key={s.id} style={{ gap: 4, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
      <Text style={{ color: C.text }}>{s.message}</Text>
      <Muted small>{`Based on: ${Object.entries(s.evidence as Row).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`).join(" · ")}`}</Muted>
      <Line style={{ flexWrap: "wrap" }}>{(s.options as Row[]).map(o => <Btn key={o.id} kind={o.action === "none" ? "outline" : "primary"} title={o.label}
        onPress={() => run(api(`/coach/suggestions/${s.id}/decide`, "POST", { option_id: o.id }))}/>)}</Line>
    </View>)}
  </Card>;
}

const STAGES = ["explore", "shortlist", "requirements", "prepare", "apply", "offer", "visa", "move", "dropped"] as const;

/** Study abroad on the phone: overview, programs with stage + checklist, add a program. */
export function StudyScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [ov, setOv] = useState<Row | null>(null);
  const [programs, setPrograms] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [reqs, setReqs] = useState<Row[]>([]);
  const [uni, setUni] = useState(""); const [course, setCourse] = useState(""); const [country, setCountry] = useState(""); const [deadline, setDeadline] = useState("");
  const load = useCallback(() => {
    Promise.all([api<Row>("/study"), api<Row[]>("/study/programs")]).then(([o, p]) => { setOv(o); setPrograms(p); }).catch(r => onError(msg(r)));
  }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) api<Row[]>(`/study/programs/${open}/requirements`).then(setReqs).catch(() => setReqs([])); }, [api, open]);
  const run = (w: Promise<unknown>, note: string) => void w.then(() => { onNotice(note); load(); if (open) api<Row[]>(`/study/programs/${open}/requirements`).then(setReqs).catch(() => undefined); }).catch(r => onError(msg(r)));

  return <Screen onRefresh={load}>
    <GermanyFinder api={api} onError={onError} onNotice={onNotice} onSaved={load}/>
    {ov && <Card accent><Kicker>MY APPLICATIONS</Kicker>
      <Line><View style={{ flex: 1 }}><Muted small>Programs</Muted><H2>{String(ov.programs)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>Deadlines 60 d</Muted><H2>{String(ov.deadlines_60_days.length)}</H2></View>
        <View style={{ flex: 1 }}><Muted small>To re-check</Muted><H2>{String(ov.to_verify.length)}</H2></View></Line>
      {(ov.next_actions as Row[]).map(a => <Line key={a.id}><Text style={{ color: a.overdue ? C.amber : C.text, flex: 1 }}>{`• ${a.title}`}</Text><Muted small>{day(a.due_date)}</Muted></Line>)}
      <Muted small>{ov.disclaimer}</Muted></Card>}
    <Card><Kicker>ADD A PROGRAM</Kicker>
      <Field voice value={uni} onChangeText={setUni} placeholder="University" maxLength={200}/>
      <Field voice value={course} onChangeText={setCourse} placeholder="Course" maxLength={200}/>
      <Line><View style={{ flex: 1 }}><Field value={country} onChangeText={setCountry} placeholder="Country" maxLength={80}/></View>
        <View style={{ flex: 1 }}><Field value={deadline} onChangeText={setDeadline} placeholder="Deadline YYYY-MM-DD" maxLength={10}/></View></Line>
      <Btn title="Add" disabled={!uni.trim() || !course.trim() || !country.trim()} onPress={() => {
        if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) { onError("Deadline must look like 2027-01-15"); return; }
        run(api("/study/programs", "POST", { university: uni, course, country, ...(deadline ? { deadline } : {}) }), "Program added.");
        setUni(""); setCourse(""); setCountry(""); setDeadline("");
      }}/>
      <Muted small>Add costs, scholarships and your LKR rate on the web Study abroad page.</Muted>
    </Card>
    <Card><Kicker>{`${programs.length} PROGRAMS`}</Kicker>
      {programs.length ? programs.map(p => <View key={p.id} style={{ gap: 6, paddingVertical: 8, borderTopColor: C.line, borderTopWidth: 1 }}>
        <TouchableOpacity onPress={() => setOpen(open === p.id ? null : p.id)}>
          <Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "700" }}>{p.university}</Text><Muted small>{`${p.course} · ${p.country} · ${p.deadline ? `deadline ${day(p.deadline)}` : "no deadline"}`}</Muted></View>
            <Badge tone={p.last_verified_at ? "green" : "amber"}>{p.stage}</Badge></Line>
        </TouchableOpacity>
        {open === p.id && <View style={{ gap: 6 }}>
          <Chips options={STAGES} value={p.stage} onChange={stage => run(api(`/study/programs/${p.id}`, "PATCH", { stage }), "Stage updated.")}/>
          <Line style={{ flexWrap: "wrap" }}>
            <Btn kind="outline" title="I checked the official page" onPress={() => run(api(`/study/programs/${p.id}`, "PATCH", { verified: true }), "Verified today.")}/>
            {!!p.link && <Btn kind="link" title="Open page ↗" onPress={() => void Linking.openURL(p.link)}/>}
          </Line>
          {reqs.length ? reqs.map(r => <TouchableOpacity key={r.id} onPress={() => run(api(`/study/requirements/${r.id}`, "PATCH", { status: r.status === "done" ? "todo" : "done" }), "Updated.")}>
            <Line><Text style={{ color: r.status === "done" ? C.green : C.text }}>{r.status === "done" ? "☑" : "☐"}</Text>
              <Text style={{ color: r.status === "done" ? C.muted : C.text, flex: 1, textDecorationLine: r.status === "done" ? "line-through" : "none" }}>{r.title}</Text>
              <Muted small>{day(r.due_date)}</Muted></Line></TouchableOpacity>)
            : <Btn title="Build checklist + tasks" disabled={!p.deadline} onPress={() => run(api(`/study/programs/${p.id}/checklist`, "POST", { create_tasks: true }), "Checklist created.")}/>}
          <Btn kind="danger" title="Delete program" onPress={() => Alert.alert("Delete?", p.university, [{ text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => run(api(`/study/programs/${p.id}`, "DELETE"), "Deleted.") }])}/>
        </View>}
      </View>) : <Empty>Add programs you're considering.</Empty>}
    </Card>
  </Screen>;
}
