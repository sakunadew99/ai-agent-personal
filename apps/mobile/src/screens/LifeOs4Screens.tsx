import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Bars, Hero, LineChart, Meter, PALETTE, Ring, Segments, SplitBar } from "../charts";
import { scheduleHourlyCheckins } from "../notify";
import { Shield, defaultMark, type BlockList, type Mark } from "../shield";
import { Badge, Btn, C, Card, Empty, Field, H2, Kicker, Muted, Row as Line, Screen } from "../ui";
import { WeekInsightsCard } from "./SmartCards";
import { GapCards } from "./SleepDayScreens";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
type Props = { api: Api; onError: (m: string) => void; onNotice: (m: string) => void };
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const chip = (on: boolean, color = C.green) => ({ borderColor: on ? color : C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: on ? `${color}33` : "transparent" });

// =====================================================================================================================
// GYM
// =====================================================================================================================

type SetRow = { exercise: string; weight: string; reps: string };
const gymInput = { width: 74, color: C.text, fontSize: 16, fontWeight: "700" as const, borderColor: C.line, borderWidth: 1, borderRadius: 12, paddingVertical: 8, textAlign: "center" as const, backgroundColor: C.bg };
export function GymScreen({ api, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(null);
  const [group, setGroup] = useState("Chest");
  const [sets, setSets] = useState<SetRow[]>([]);
  const [title, setTitle] = useState("Gym");
  const [started, setStarted] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => { api<Row>("/gym").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  const [custom, setCustom] = useState("");
  useEffect(() => { load(); void SecureStore.getItemAsync("sakuna.gymDraft").then(x => { if (x) { const d = JSON.parse(x);
    const fresh = d.started && Date.now() - d.started < 4 * 3600 * 1000;      // an old draft's timer would read hundreds of minutes
    setSets(fresh ? d.sets || [] : []); setTitle(fresh ? d.title || "Gym" : "Gym"); setStarted(fresh ? d.started : null); } }).catch(() => undefined); }, [load]);
  useEffect(() => { void SecureStore.setItemAsync("sakuna.gymDraft", JSON.stringify({ sets, title, started })).catch(() => undefined); }, [sets, title, started]);
  useEffect(() => { if (!started) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [started]);
  if (!v) return <Screen><Empty>Loading your gym log…</Empty></Screen>;
  const last = (ex: string) => v.last?.[ex] as Row | undefined;
  const addEx = (ex: string) => { const l = last(ex); setSets(s => [...s, { exercise: ex, weight: l?.weight_kg != null ? String(l.weight_kg) : "", reps: l?.reps != null ? String(l.reps) : "" }]); if (!started) setStarted(Date.now()); };
  const template = (name: string) => { setTitle(name); setSets([]); (v.templates[name] as string[]).forEach(ex => { for (let i = 0; i < 3; i++) addEx(ex); }); };
  const elapsed = started ? Math.min(240, Math.round((now - started) / 60000)) : 0;
  const groups: [string, { s: SetRow; i: number }[]][] = [];
  sets.forEach((st, i) => { const g = groups.find(x => x[0] === st.exercise); if (g) g[1].push({ s: st, i }); else groups.push([st.exercise, [{ s: st, i }]]); });
  async function finish() {
    const clean = sets.filter(s => s.exercise && (s.reps || s.weight));
    if (!clean.length) { onError("Add at least one set with reps or weight."); return; }
    try {
      const out = await api<Row>("/gym/workouts", "POST", { title, duration_minutes: Math.max(1, elapsed || clean.length * 3), started_at: started ? new Date(started).toISOString() : undefined,
        sets: clean.map(s => ({ exercise: s.exercise, weight_kg: s.weight ? Number(s.weight.replace(",", ".")) : null, reps: s.reps ? Number(s.reps) : null })) });
      setV(out); setSets([]); setStarted(null); onNotice(`💪 ${title} saved · ${clean.length} sets · ${Math.max(1, elapsed)} min`);
    } catch (e) { onError(msg(e)); }
  }
  const tw: Row = v.this_week || {};
  const muscles = Object.entries((v.sets_by_muscle_30d || {}) as Record<string, number>);
  return <Screen onRefresh={load}>
    <Hero kicker="GYM" title={started ? `${elapsed} min` : "Let's train"} accent={started ? "in progress" : "💪"} sub={`This week: ${tw.sessions ?? 0} sessions · ${tw.minutes ?? 0} min · ${(tw.volume_kg ?? 0).toLocaleString()} kg lifted`}
      right={<Ring value={Math.min(100, ((tw.sessions ?? 0) / 4) * 100)} size={92} label={`${tw.sessions ?? 0}/4`} sub="THIS WEEK"/>}>
      <Line>{started ? <Btn kind="outline" title="⏹ Reset timer" onPress={() => setStarted(Date.now())}/> : <Btn title="▶ Start workout" onPress={() => setStarted(Date.now())}/>}
        {v.trained_today && <Badge>✓ trained today</Badge>}</Line>
    </Hero>
    <Card><Kicker>QUICK START</Kicker><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{Object.keys(v.templates).map(t => <TouchableOpacity key={t} style={chip(title === t)} onPress={() => template(t)}><Text style={{ color: C.text, fontWeight: "700" }}>{t}</Text></TouchableOpacity>)}</View></Card>
    <Card><Kicker>ADD AN EXERCISE</Kicker>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{Object.keys(v.exercises).map(g => <TouchableOpacity key={g} style={chip(group === g)} onPress={() => setGroup(g)}><Text style={{ color: C.text }}>{g}</Text></TouchableOpacity>)}</ScrollView>
      <Line><View style={{ flex: 1 }}><Field value={custom} onChangeText={setCustom} placeholder="Your own exercise, e.g. Cable row (narrow grip)"/></View>
        <Btn title="Add" disabled={!custom.trim()} onPress={() => { addEx(custom.trim()); setCustom(""); }}/></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{(v.exercises[group] as string[]).map(ex => <TouchableOpacity key={ex} style={chip(false, PALETTE[1])} onPress={() => addEx(ex)}>
        <Text style={{ color: C.text, fontSize: 13 }}>{`＋ ${ex}`}</Text>{last(ex) && <Text style={{ color: C.muted, fontSize: 10 }}>{`last ${last(ex)!.weight_kg ?? "-"}kg × ${last(ex)!.reps ?? "-"}`}</Text>}</TouchableOpacity>)}</View>
    </Card>
    {sets.length > 0 && <Card accent>
      <Line><Kicker>{`TODAY · ${sets.length} SETS · ${groups.length} EXERCISES`}</Kicker><View style={{ flex: 1 }}/>
        <Btn kind="link" title="Clear all" onPress={() => Alert.alert("Clear today's sets?", "", [{ text: "Keep", style: "cancel" }, { text: "Clear", style: "destructive", onPress: () => { setSets([]); setStarted(null); } }])}/></Line>
      {groups.map(([ex, rows], gi) => <View key={ex} style={{ borderRadius: 18, padding: 12, gap: 8, backgroundColor: C.panel2, borderLeftWidth: 4, borderLeftColor: PALETTE[gi % PALETTE.length] }}>
        <Line><Text style={{ color: C.text, fontSize: 17, fontWeight: "900", flex: 1 }}>{ex}</Text>
          {last(ex) && <Text style={{ color: C.muted, fontSize: 12 }}>{`last ${last(ex)!.weight_kg ?? "-"} kg × ${last(ex)!.reps ?? "-"}`}</Text>}</Line>
        {rows.map(({ s: st, i: idx }, n) => <Line key={idx}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: C.bg }}><Text style={{ color: C.text, fontWeight: "800" }}>{n + 1}</Text></View>
          <TextInput style={gymInput} keyboardType="decimal-pad" value={st.weight} placeholder="kg" placeholderTextColor={C.muted} onChangeText={w => setSets(x => x.map((y, j2) => j2 === idx ? { ...y, weight: w } : y))}/>
          <Text style={{ color: C.muted, fontSize: 16 }}>×</Text>
          <TextInput style={gymInput} keyboardType="number-pad" value={st.reps} placeholder="reps" placeholderTextColor={C.muted} onChangeText={r => setSets(x => x.map((y, j2) => j2 === idx ? { ...y, reps: r } : y))}/>
          <View style={{ flex: 1 }}/>
          <TouchableOpacity onPress={() => setSets(x => x.filter((_, j2) => j2 !== idx))} hitSlop={10}><Text style={{ color: C.muted, fontSize: 16 }}>✕</Text></TouchableOpacity>
        </Line>)}
        <TouchableOpacity onPress={() => { const lastRow = rows[rows.length - 1].s; setSets(x => [...x, { ...lastRow }]); }} style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: C.green, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: C.green, fontWeight: "800" }}>＋ Add set</Text></TouchableOpacity>
      </View>)}
      <Field value={title} onChangeText={setTitle} placeholder="Workout name (e.g. Pull day)"/>
      <Btn title={`✓ Finish & save · ${Math.max(1, elapsed)} min`} onPress={() => void finish()}/>
      <Muted small>Your last weight and reps are filled in. “＋ Add set” copies the previous set.</Muted>
    </Card>}
    <Card><Kicker>MINUTES PER WEEK</Kicker><Bars data={(v.weeks as Row[]).map((w, i, a) => ({ label: w.label.split(" ")[0], value: w.minutes, highlight: i === a.length - 1 }))} height={100} format={n => `${n}m`}/></Card>
    <Card><Kicker>VOLUME PER WEEK (KG)</Kicker><LineChart series={[{ values: (v.weeks as Row[]).map(w => w.volume_kg), color: C.amber }]} labels={(v.weeks as Row[]).map(w => w.label)} height={100}/></Card>
    {(v.prs as Row[]).length > 0 && <Card><Kicker>🏆 PERSONAL RECORDS</Kicker>{(v.prs as Row[]).slice(0, 8).map(p => <Line key={p.exercise}>
      <Text style={{ color: C.text, flex: 1 }}>{p.exercise}</Text><Text style={{ color: C.amber, fontWeight: "800" }}>{`${p.weight_kg} kg × ${p.reps ?? "-"}`}</Text>{p.e1rm && <Muted small>{`1RM≈${p.e1rm}`}</Muted>}</Line>)}</Card>}
    {muscles.length > 0 && <Card><Kicker>SETS BY MUSCLE · 30 DAYS</Kicker><SplitBar parts={muscles.map(([k, n]) => ({ label: k, value: n }))} format={n => `${n} sets`}/></Card>}
    <Card><Kicker>RECENT WORKOUTS</Kicker>{(v.recent as Row[]).length ? (v.recent as Row[]).map(w => <View key={w.id} style={{ paddingVertical: 6, borderTopColor: C.line, borderTopWidth: 1, gap: 2 }}>
      <Line><Text style={{ color: C.text, fontWeight: "800", flex: 1 }}>{`${w.title} · ${w.date}`}</Text><Muted small>{`${w.minutes} min · ${w.volume_kg} kg`}</Muted>
        <TouchableOpacity onPress={() => Alert.alert("Delete workout?", w.title, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void api(`/gym/workouts/${w.id}`, "DELETE").then(load).catch(e => onError(msg(e))) }])}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></Line>
      <Muted small>{(w.exercises as Row[]).map(e => `${e.exercise} ${(e.sets as Row[]).map(s => s.reps != null ? `${s.weight_kg ?? 0}×${s.reps}` : `${s.seconds}s`).join(", ")}`).join(" · ")}</Muted>
    </View>) : <Muted>No workouts yet.</Muted>}</Card>
  </Screen>;
}

// =====================================================================================================================
// LANGUAGES: today's German + English plan, daily cards, videos
// =====================================================================================================================

export function LanguageScreen({ api, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(null);
  const [fresh, setFresh] = useState<Row[]>([]);
  const load = useCallback(() => { api<Row>("/language/today").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { void api<Row>("/language/daily-cards", "POST").then(r => { setFresh(r.decks || []); load(); }).catch(() => load()); }, [api, load]);
  if (!v) return <Screen><Empty>Preparing today's lessons…</Empty></Screen>;
  const newWords = fresh.reduce((n, d) => n + Number(d.added || 0), 0);
  return <Screen onRefresh={load}>
    <Hero kicker="LANGUAGES · TODAY" title={`${v.total_minutes} min`} accent="of German & English" sub="Cards, one video and your exam-coach blocks. New words are added every day."
      right={<Ring value={Math.min(100, v.total_minutes)} size={92} label={`${(v.languages as Row[]).reduce((n, l) => n + Number(l.cards_due), 0)}`} sub="CARDS DUE"/>}/>
    {newWords > 0 && <Card accent><Kicker>{`✨ ${newWords} NEW WORDS TODAY`}</Kicker>{fresh.map(d => (d.words as Row[]).map(w => <View key={`${d.lang}${w.front}`} style={{ gap: 1, paddingVertical: 3 }}>
      <Text style={{ color: C.text, fontWeight: "800" }}>{`${d.lang === "german" ? "🇩🇪" : "🇬🇧"} ${w.front} — ${w.back}`}</Text><Muted small>{w.example}</Muted></View>))}</Card>}
    {(v.languages as Row[]).map((l, k) => <Card key={l.lang} style={{ borderTopWidth: 3, borderTopColor: PALETTE[k + 1] }}>
      <Line><H2>{l.title}</H2><View style={{ flex: 1 }}/><Badge tone="amber">{`${l.minutes} min`}</Badge></Line>
      {l.exam && <Muted small>{`${l.exam.name}: ${l.exam.days_left} days to the exam`}</Muted>}
      {(l.steps as Row[]).map((s, i) => <TouchableOpacity key={i} disabled={!s.url} onPress={() => openInApp(s.url, s.what, { category: "study", note: `${l.lang === "german" ? "German" : "English"} video` })}>
        <Line style={{ paddingVertical: 4 }}><Text style={{ fontSize: 18 }}>{s.kind === "cards" ? "🃏" : s.kind === "video" ? "▶" : "📝"}</Text>
          <Text style={{ color: C.text, flex: 1 }}>{s.what}</Text><Text style={{ color: C.muted }}>{`${s.minutes}m`}</Text></Line></TouchableOpacity>)}
      <Muted small>{`${l.cards_total} words in your ${l.lang} deck. Review them in Learning → Study.`}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{(l.channels as Row[]).map(c => <TouchableOpacity key={c.name} style={chip(false, PALETTE[k + 1])}
        onPress={() => openInApp(c.url, c.name, { category: "study", note: `${c.name}` })}><Text style={{ color: C.text, fontSize: 12 }}>{`▶ ${c.name}`}</Text></TouchableOpacity>)}</ScrollView>
    </Card>)}
    <Btn kind="outline" title="＋ Add today's words again" onPress={() => void api<Row>("/language/daily-cards", "POST").then(r => { setFresh(r.decks || []); onNotice("Up to date: 5 new words per language per day."); load(); }).catch(e => onError(msg(e)))}/>
  </Screen>;
}

// =====================================================================================================================
// PROGRESS: courses (Coursera, Udemy…) + LeetCode / HackerRank / GitHub / Codeforces
// =====================================================================================================================

const PLATFORMS = ["leetcode", "hackerrank", "github", "codeforces"] as const;
const P_ICON: Record<string, string> = { leetcode: "🟧", hackerrank: "🟩", github: "🐙", codeforces: "🔷" };
const COURSE_SITES = ["Coursera", "Udemy", "edX", "freeCodeCamp", "YouTube", "Google", "AWS", "University", "Other"];
export function ProgressScreen({ api, onError, onNotice }: Props) {
  const [v, setV] = useState<Row | null>(null);
  const [plat, setPlat] = useState<(typeof PLATFORMS)[number]>("leetcode");
  const [uname, setUname] = useState("");
  const [course, setCourse] = useState<Row | null>(null);
  const load = useCallback(() => { api<Row>("/learning/tracker").then(setV).catch(r => onError(msg(r))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  if (!v) return <Screen><Empty>Loading…</Empty></Screen>;
  const link = () => void api("/learning/profiles", "PUT", { platform: plat, username: uname.trim() }).then(() => { setUname(""); onNotice("Linked"); load(); }).catch(e => onError(msg(e)));
  const saveCourse = () => { if (!course?.title?.trim()) return; void api(course.id ? `/learning/courses/${course.id}` : "/learning/courses", course.id ? "PATCH" : "POST",
    { platform: course.platform, title: course.title.trim(), url: course.url || null, progress_pct: Number(course.progress_pct || 0) }).then(() => { setCourse(null); load(); }).catch(e => onError(msg(e))); };
  const solved = (v.profiles as Row[]).reduce((n, p) => n + (p.platform === "github" ? 0 : Number(p.stats.solved || 0)), 0);
  return <Screen onRefresh={load}>
    <Hero kicker="LEARNING PROGRESS" title={`${solved}`} accent="problems solved" sub={`${v.active} active courses · ${v.done} finished · ${v.hours_total} h logged`}
      right={<Ring value={Math.min(100, ((v.done) / Math.max(1, (v.courses as Row[]).length)) * 100)} size={92} label={`${v.done}/${(v.courses as Row[]).length}`} sub="COURSES"/>}>
      <Btn kind="outline" title="↻ Refresh stats" onPress={() => void api<Row>("/learning/profiles/refresh", "POST").then(r => { load(); if ((r.errors as string[]).length) onError((r.errors as string[]).join(" · ")); }).catch(e => onError(msg(e)))}/>
    </Hero>
    {(v.profiles as Row[]).map((p, k) => <Card key={p.id} style={{ borderLeftWidth: 4, borderLeftColor: PALETTE[k % PALETTE.length] }}>
      <Line><Text style={{ fontSize: 20 }}>{P_ICON[p.platform]}</Text><View style={{ flex: 1 }}><H2>{`${p.platform} · ${p.username}`}</H2>
        <Muted small>{p.platform === "leetcode" ? `Easy ${p.stats.easy} · Medium ${p.stats.medium} · Hard ${p.stats.hard}${p.stats.ranking ? ` · rank ${Number(p.stats.ranking).toLocaleString()}` : ""}`
          : p.platform === "hackerrank" ? `${p.stats.stars} stars across ${(p.stats.badges || []).length} badges`
          : p.platform === "github" ? `${p.stats.repos} repos · ${p.stats.commits_7d} commits this week` : `rating ${p.stats.rating ?? "—"} · ${p.stats.rank ?? ""}`}</Muted></View>
        <View style={{ alignItems: "flex-end" }}><Text style={{ color: C.text, fontSize: 22, fontWeight: "900" }}>{p.platform === "github" ? p.stats.commits_7d : p.stats.solved}</Text>
          <Muted small>{p.platform === "github" ? "commits 7d" : `+${p.gain_7d} this week`}</Muted></View></Line>
      {(p.history as Row[]).length > 1 && <LineChart series={[{ values: (p.history as Row[]).map(h => h.solved), color: PALETTE[k % PALETTE.length] }]} labels={(p.history as Row[]).map(h => String(h.date).slice(5))} height={70}/>}
      <Line><Btn kind="link" title="Open profile" onPress={() => openInApp(p.stats.url, `${p.platform} · ${p.username}`, { category: "study", note: `${p.platform} practice` })}/>
        <Btn kind="link" title="Unlink" onPress={() => void api(`/learning/profiles/${p.id}`, "DELETE").then(load).catch(e => onError(msg(e)))}/></Line>
    </Card>)}
    <Card><Kicker>LINK A CODING PROFILE</Kicker>
      <Segments options={PLATFORMS} value={plat} onChange={setPlat} labels={{ leetcode: "LeetCode", hackerrank: "HackerRank", github: "GitHub", codeforces: "CF" }}/>
      <Line><View style={{ flex: 1 }}><Field value={uname} onChangeText={setUname} placeholder="Your public username" autoCapitalize="none"/></View><Btn title="Link" onPress={link} disabled={!uname.trim()}/></Line>
      <Muted small>Stats are read from each site's public profile data. No password needed.</Muted></Card>
    <Line style={{ justifyContent: "space-between" }}><H2>Courses</H2><Btn kind="link" title="＋ Add course" onPress={() => setCourse({ platform: "Coursera", title: "", url: "", progress_pct: 0 })}/></Line>
    {course && <Card accent>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{COURSE_SITES.map(x => <TouchableOpacity key={x} style={chip(course.platform === x)} onPress={() => setCourse({ ...course, platform: x })}><Text style={{ color: C.text }}>{x}</Text></TouchableOpacity>)}</ScrollView>
      <Field value={course.title} onChangeText={t => setCourse({ ...course, title: t })} placeholder="Course name"/>
      <Field value={course.url || ""} onChangeText={t => setCourse({ ...course, url: t })} placeholder="Link (optional)" autoCapitalize="none"/>
      <Field value={String(course.progress_pct ?? 0)} onChangeText={t => setCourse({ ...course, progress_pct: t.replace(/\D/g, "") })} placeholder="Progress %" keyboardType="number-pad"/>
      <Line><Btn title="Save" onPress={saveCourse} style={{ flex: 1 }}/><Btn kind="outline" title="Cancel" onPress={() => setCourse(null)} style={{ flex: 1 }}/></Line></Card>}
    {(v.courses as Row[]).map((c, k) => <Card key={c.id}>
      <Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{c.title}</Text><Muted small>{`${c.platform} · ${c.status} · ${c.hours_spent} h`}</Muted></View><Badge tone={c.status === "done" ? "green" : "amber"}>{`${c.progress_pct}%`}</Badge></Line>
      <Meter value={c.progress_pct} color={PALETTE[k % PALETTE.length]}/>
      <Line style={{ flexWrap: "wrap" }}>
        {!!c.url && <Btn kind="link" title="▶ Continue" onPress={() => openInApp(c.url, c.title, { category: "study", note: `Course: ${c.title}` })}/>}
        <Btn kind="link" title="+30 min" onPress={() => void api(`/learning/courses/${c.id}`, "PATCH", { add_hours: 0.5 }).then(load).catch(e => onError(msg(e)))}/>
        <Btn kind="link" title="+10%" onPress={() => void api(`/learning/courses/${c.id}`, "PATCH", { progress_pct: Math.min(100, c.progress_pct + 10) }).then(load).catch(e => onError(msg(e)))}/>
        <Btn kind="link" title="Edit" onPress={() => setCourse({ ...c })}/>
        <Btn kind="link" title="Delete" onPress={() => void api(`/learning/courses/${c.id}`, "DELETE").then(load).catch(e => onError(msg(e)))}/>
      </Line></Card>)}
  </Screen>;
}

// =====================================================================================================================
// DAY TRACKER: hour by hour, phone usage, end-of-day report, tomorrow's block list
// =====================================================================================================================

export const CATS: [string, string, string][] = [["work", "💼 Work", "#5aa8ff"], ["deep_work", "🎯 Deep work", "#3ee08f"], ["meeting", "👥 Meeting", "#4fd1c5"], ["study", "📚 Study", "#b48cff"],
  ["exercise", "🏋️ Exercise", "#e6e15a"], ["commute", "🚌 Commute", "#8a9b92"], ["chores", "🧹 Chores", "#8a9b92"], ["family", "🏠 Family", "#ff9f5a"], ["social", "🤝 Social", "#ff9f5a"],
  ["rest", "😌 Rest", "#8a9b92"], ["entertainment", "🎬 Fun", "#f5b65b"], ["wasted", "📱 Wasted", "#ff7a8a"], ["sleep", "😴 Sleep", "#4b5d54"], ["other", "• Other", "#8a9b92"]];
const COLOR = Object.fromEntries(CATS.map(c => [c[0], c[2]]));
const LABEL = Object.fromEntries(CATS.map(c => [c[0], c[1]]));

/** Read today's phone usage from Android (Usage Access) and send totals + top apps to the server. */
export async function uploadUsage(api: Api, day = new Date()): Promise<boolean> {
  try {
    if (!Shield) return false;
    const daysAgo = Math.round((new Date(iso(new Date())).getTime() - new Date(iso(day)).getTime()) / 86400000);
    const ins = await Shield.getInsights(daysAgo);
    if (!ins.available) return false;
    const marks = Shield.getAppMarks();
    const apps = ins.apps.map(a => ({ package: a.packageName, label: a.label, category: a.category, mark: (marks[a.packageName] || defaultMark(a.category)) as Mark, minutes: Math.round(a.minutes) }))
      .filter(a => a.minutes > 0).sort((a, b) => b.minutes - a.minutes);
    const sum = (m: Mark) => apps.filter(a => a.mark === m).reduce((n, a) => n + a.minutes, 0);
    await api("/day/usage", "PUT", { local_date: iso(day), total_minutes: Math.min(1440, Math.round(ins.totalMinutes)), distracting_minutes: Math.min(1440, sum("distracting")),
      productive_minutes: Math.min(1440, sum("productive")), pickups: Math.min(5000, ins.pickups), apps: apps.slice(0, 20), hourly: ins.hourly.map(x => Math.min(60, Math.round(x))),
      ...(ins.hourlyApps ? { hourly_apps: ins.hourlyApps.map(h => h.slice(0, 3).map(a => ({ package: a.packageName, label: a.label, category: a.category,
        mark: (marks[a.packageName] || defaultMark(a.category)) as Mark, minutes: Math.min(60, Math.round(a.minutes)) }))) } : {}) });
    return true;
  } catch { return false; }
}

export function DayTrackerScreen({ api, onError, onNotice, initialHour }: Props & { initialHour?: number | null }) {
  const [day, setDay] = useState(iso(new Date()));
  const [r, setR] = useState<Row | null>(null);
  const [hour, setHour] = useState<number | null>(initialHour ?? null);
  const [len, setLen] = useState(60);
  const [note, setNote] = useState("");
  const [story, setStory] = useState("");
  const [hourly, setHourly] = useState(false);
  const [strict, setStrict] = useState(false);
  const load = useCallback(async (d = day) => {
    if (d === iso(new Date())) await uploadUsage(api);
    api<Row>(`/day/report?day=${d}`).then(setR).catch(e => onError(msg(e)));
  }, [api, day, onError]);
  useEffect(() => { void load(); void SecureStore.getItemAsync("sakuna.hourlyCheckins").then(v => setHourly(v === "on")).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const shift = (n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); const k = iso(d); setDay(k); setStory(""); void load(k); };
  async function log(cat: string) {
    if (hour == null) { onError("Pick an hour first."); return; }
    const end = Math.min(24 * 60 - 1, hour * 60 + len);
    try {
      await api("/day/entries", "POST", { local_date: day, start_time: `${String(hour).padStart(2, "0")}:00`, end_time: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
        category: cat, note: note.trim() || null, source: "manual" });
      setNote(""); setHour(h => (h == null ? h : Math.min(23, h + Math.ceil(len / 60)))); onNotice(`${LABEL[cat]} logged`); void load();
    } catch (e) { onError(msg(e)); }
  }
  async function toggleHourly(on: boolean) {
    setHourly(on); await SecureStore.setItemAsync("sakuna.hourlyCheckins", on ? "on" : "off").catch(() => undefined);
    const n = await scheduleHourlyCheckins(on); onNotice(on ? `Hourly check-ins on (${n} reminders, 8:00–21:00, plus the 21:30 report)` : "Hourly check-ins off");
  }
  async function applyBlock() {
    const b = r?.block_suggestion; if (!b || !Shield) { onError("The app blocker needs the Sakuna APK on Android."); return; }
    const [sh, sm] = String(b.start).split(":").map(Number), [eh, em] = String(b.end).split(":").map(Number);
    const list: BlockList = { id: `tomorrow-${b.day}`, name: `Focus ${b.day} (from your day report)`, mode: "schedule", schedule: { days: [b.weekday], start: sh * 60 + sm, end: eh * 60 + em, from: b.day, until: b.day },
      apps: b.apps, domains: [], keywords: [], newApps: false, newAppsSince: 0, adult: false, purchases: false, unsupportedBrowsers: false, shorts: true };
    try {
      Shield.saveList(JSON.stringify(list));
      if (strict && !Shield.getStatus().strict) Shield.startStrict("schedule", 0);
      onNotice(`Tomorrow ${b.start}–${b.end}: ${(b.labels as string[]).join(", ")} blocked${strict ? " in Strict Mode" : ""}.`);
    } catch (e) { onError(msg(e)); }
  }
  const hours: Row[] = r?.hours || [];
  const t: Row = r?.totals || {};
  const nowH = new Date().getHours();
  return <Screen>
    <GapCards api={api} day={day} onError={onError} onNotice={onNotice} onSaved={() => void load()}/>
    <Hero kicker={`DAY TRACKER · ${new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" }).toUpperCase()}`}
      title={`${Math.floor((t.productive || 0) / 60)}h ${(t.productive || 0) % 60}m`} accent="productive" sub={`${t.waste_total ?? 0} min wasted (logged + distracting apps) · ${t.focus ?? 0} min focus · ${t.tasks_done ?? 0} tasks done`}
      right={<Ring value={Number(r?.score ?? 0)} size={96} label={`${r?.score ?? "—"}`} sub="DAY SCORE"/>}>
      <Line><Btn kind="outline" title="‹" onPress={() => shift(-1)}/><Btn kind="outline" title="Today" onPress={() => { const k = iso(new Date()); setDay(k); void load(k); }}/><Btn kind="outline" title="›" onPress={() => shift(1)}/></Line>
    </Hero>
    <Card><Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>Ask me every hour</Text><Muted small>“What did you do this hour?” 8:00–21:00, answer from the notification. Report at 21:30.</Muted></View>
      <Switch value={hourly} onValueChange={v => void toggleHourly(v)} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/></Line></Card>
    <Card><Kicker>HOUR BY HOUR · TAP AN HOUR TO LOG IT</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>{hours.filter(h => h.hour >= 5).map(h => { const sel = h.hour === hour;
        return <TouchableOpacity key={h.hour} onPress={() => setHour(h.hour)} style={{ width: "15.5%", aspectRatio: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 1,
          backgroundColor: h.category ? `${COLOR[h.category]}55` : C.panel2, borderWidth: sel ? 2 : 1, borderColor: sel ? C.green : day === iso(new Date()) && h.hour === nowH ? C.amber : C.line }}>
          <Text style={{ color: C.text, fontSize: 11, fontWeight: "800" }}>{h.label.slice(0, 2)}</Text>
          <Text style={{ fontSize: 12 }}>{h.category ? String(LABEL[h.category]).split(" ")[0] : ""}</Text>
          {h.phone_minutes > 0 && <Text style={{ color: h.phone_minutes > 20 ? C.red : C.muted, fontSize: 8 }}>{`📱${h.phone_minutes}`}</Text>}</TouchableOpacity>; })}</View>
      {hour != null && <View style={{ gap: 8 }}>
        <Text style={{ color: C.text, fontWeight: "800" }}>{`What did you do from ${String(hour).padStart(2, "0")}:00?`}</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>{[30, 60, 90, 120].map(m => <TouchableOpacity key={m} style={chip(len === m)} onPress={() => setLen(m)}><Text style={{ color: C.text }}>{m < 60 ? `${m}m` : `${m / 60}h`}</Text></TouchableOpacity>)}</View>
        <Field value={note} onChangeText={setNote} placeholder="Note (optional): e.g. bug fixing, IELTS reading"/>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{CATS.map(([k, label, col]) => <TouchableOpacity key={k} style={chip(false, col)} onPress={() => void log(k)}><Text style={{ color: C.text, fontWeight: "700", fontSize: 13 }}>{label}</Text></TouchableOpacity>)}</View>
      </View>}
    </Card>
    {r && (r.by_category as Row[]).length > 0 && <Card><Kicker>WHERE THE TIME WENT</Kicker><SplitBar parts={(r.by_category as Row[]).map(c => ({ label: c.label, value: c.minutes, color: COLOR[c.category] }))} format={n => `${Math.floor(n / 60)}h ${n % 60}m`}/></Card>}
    {r?.usage && <Card><Kicker>{`PHONE · ${r.usage.total} MIN · ${r.usage.pickups} PICKUPS`}</Kicker>
      <Bars data={(r.usage.hourly as number[]).map((m, h) => ({ label: h % 3 === 0 ? String(h) : "", value: m, color: m > 20 ? C.red : C.blue }))} height={80} format={n => `${n}m`}/>
      {(r.usage.apps as Row[]).slice(0, 6).map(a => <Line key={a.package}><Text style={{ color: a.mark === "distracting" ? C.red : a.mark === "productive" ? C.green : C.text, flex: 1 }}>{a.label}</Text><Muted small>{`${a.minutes} min`}</Muted></Line>)}</Card>}
    {!r?.usage && Shield && <Muted small>Allow Usage Access in Focus → Shield to include phone screen time in this report.</Muted>}
    {r && <Card accent><Kicker>📋 END-OF-DAY REPORT</Kicker>
      <Text style={{ color: C.text, lineHeight: 21 }}>{story || r.summary}</Text>
      <Text style={{ color: C.green, fontWeight: "800", marginTop: 4 }}>Tomorrow</Text>
      {(r.tomorrow as string[]).map((x, i) => <Text key={i} style={{ color: C.text, lineHeight: 20 }}>{`• ${x}`}</Text>)}
      <Btn kind="outline" title={story ? "Refresh coaching" : "✨ Coach me on this day"} onPress={() => void api<Row>(`/day/report/explain?day=${day}`, "POST").then(x => setStory(String(x.text || ""))).catch(e => onError(msg(e)))}/>
    </Card>}
    {r?.block_suggestion && <Card style={{ borderColor: C.red }}><Kicker>🛡 BLOCK THESE TOMORROW?</Kicker>
      <Text style={{ color: C.text }}>{`${(r.block_suggestion.labels as string[]).join(", ")} took ${r.block_suggestion.minutes_today} min today.`}</Text>
      <Muted small>{`Blocks them ${r.block_suggestion.day} from ${r.block_suggestion.start} to ${r.block_suggestion.end} (Shorts too). You decide; nothing is blocked until you tap.`}</Muted>
      <Line><Text style={{ color: C.text, flex: 1 }}>Strict Mode (can't undo while it runs)</Text><Switch value={strict} onValueChange={setStrict} trackColor={{ true: C.red, false: C.line }} thumbColor={C.text}/></Line>
      <Btn kind="danger" title="Block tomorrow" onPress={() => Alert.alert("Block tomorrow?", strict ? "Strict Mode: you can't turn it off while the schedule runs." : "You can change it later in Focus → Shield.", [{ text: "Cancel", style: "cancel" }, { text: "Block", style: "destructive", onPress: () => void applyBlock() }])}/>
    </Card>}
    {(r?.auto as Row[] || []).length > 0 && <Card><Kicker>FILLED IN AUTOMATICALLY</Kicker>{(r!.auto as Row[]).map((a, i) => <Line key={i}>
      <Text style={{ color: C.muted, width: 92 }}>{`${a.start} · ${a.minutes}m`}</Text><Text style={{ color: COLOR[a.category], flex: 1 }}>{a.note}</Text></Line>)}
      <Muted small>From your gym log, focus sessions and finished routines. No need to log these hours.</Muted></Card>}
    <WeekInsightsCard api={api}/>
    {r && (r.entries as Row[]).length > 0 && <Card><Kicker>ENTRIES</Kicker>{(r.entries as Row[]).map(e => <Line key={e.id}>
      <Text style={{ color: C.muted, width: 92 }}>{`${e.start}–${e.end}`}</Text><Text style={{ color: COLOR[e.category], flex: 1 }}>{`${LABEL[e.category]}${e.note ? ` · ${e.note}` : ""}`}</Text>
      <TouchableOpacity onPress={() => void api(`/day/entries/${e.id}`, "DELETE").then(() => load()).catch(x => onError(msg(x)))}><Text style={{ color: C.muted }}>✕</Text></TouchableOpacity></Line>)}</Card>}
  </Screen>;
}
