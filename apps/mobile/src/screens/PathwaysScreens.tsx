import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Share, Text, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Btn, C, Card, Empty, Field, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const lkr = (n: number) => `LKR ${Math.round(n).toLocaleString()}`;

function Pill({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1,
    borderColor: on ? C.green : C.line, backgroundColor: on ? C.greenSoft : "transparent" }}><Text style={{ color: on ? C.text : C.muted, fontWeight: "700" }}>{label}</Text></TouchableOpacity>;
}

// ------------------------------------------------------------------ sports pathways

export function SportsScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [list, setList] = useState<Row[]>([]); const [key, setKey] = useState<string>("swimming"); const [city, setCity] = useState<string>("Colombo");
  const [p, setP] = useState<Row | null>(null);
  useEffect(() => { api<Row>("/sports").then(r => setList(r.sports)).catch(e => onError(msg(e))); }, [api, onError]);
  const load = useCallback(() => { api<Row>(`/sports/${key}?city=${encodeURIComponent(city || "Colombo")}`).then(setP).catch(e => onError(msg(e))); }, [api, key, city, onError]);
  useEffect(() => { load(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const makeGoal = () => p && Alert.alert(`Make “${p.goal_plan.title}” a goal?`, `First step: ${p.goal_plan.next_action}`, [{ text: "Cancel", style: "cancel" },
    { text: "Create", onPress: () => void api("/dreams/accept", "POST", p.goal_plan).then(() => onNotice("Goal created 💪")).catch(e => onError(msg(e))) }]);
  return <Screen onRefresh={load}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{list.map(s => <Pill key={s.key} label={`${s.icon} ${s.name}`} on={key === s.key} onPress={() => setKey(s.key)}/>)}</View>
    {!p ? <Empty>Loading…</Empty> : <>
      <Card style={{ gap: 6 }}><Kicker>{`${p.icon} ${String(p.name).toUpperCase()} · ${p.kind}`}</Kicker>
        <Text style={{ color: C.text, lineHeight: 21 }}>{p.what}</Text><Muted small>{`Good for: ${(p.good_for as string[]).join(", ")}`}</Muted>
        <Btn title="🎯 Make it a goal" onPress={makeGoal}/></Card>
      <Card style={{ gap: 6 }}><Kicker>PATHWAY</Kicker>{(p.stages as Row[]).map((s, i) => <View key={i} style={{ flexDirection: "row", gap: 10 }}>
        <Text style={{ color: C.green, fontWeight: "900", width: 22 }}>{i + 1}</Text>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{`${s.name} · ${s.weeks}${/year|month/.test(s.weeks) ? "" : " weeks"}`}</Text><Muted small>{s.focus}</Muted></View></View>)}</Card>
      <Card style={{ gap: 4 }}><Kicker>A NORMAL WEEK</Kicker>{(p.week as string[]).map(w => <Text key={w} style={{ color: C.text }}>{`• ${w}`}</Text>)}</Card>
      <Card style={{ gap: 4 }}><Kicker>EQUIPMENT & COST (ESTIMATES)</Kicker>
        {(p.equipment as Row[]).map(e => <Line key={e.item}><Text style={{ color: C.text, flex: 1 }}>{`${e.needed_from_day_one ? "● " : "○ "}${e.item}`}</Text><Muted small>{`${lkr(e.lkr_min)}–${e.lkr_max.toLocaleString()}`}</Muted></Line>)}
        <Line><Text style={{ color: C.text, flex: 1 }}>Monthly fee</Text><Muted small>{`${lkr(p.monthly_fee_lkr.min)}–${p.monthly_fee_lkr.max.toLocaleString()}`}</Muted></Line>
        {p.grading_fee_lkr && <Line><Text style={{ color: C.text, flex: 1 }}>Grading (each)</Text><Muted small>{`${lkr(p.grading_fee_lkr.min)}–${p.grading_fee_lkr.max.toLocaleString()}`}</Muted></Line>}
        <Text style={{ color: C.green, fontWeight: "800" }}>{`First month: ${lkr(p.first_month_cost_lkr.min)} – ${lkr(p.first_month_cost_lkr.max)}`}</Text>
        <Muted small>● needed from day one · ○ later. {p.note}</Muted></Card>
      <Card style={{ gap: 6 }}><Kicker>ONLINE OR INSTRUCTOR?</Kicker><Text style={{ color: C.text }}>{`💻 ${p.online_ok}`}</Text><Text style={{ color: C.text }}>{`🧑‍🏫 ${p.needs_instructor}`}</Text></Card>
      <Card style={{ gap: 6 }}><Kicker>FIND A CLUB OR POOL</Kicker>
        <Field value={city} onChangeText={setCity} placeholder="Your city" onSubmitEditing={load}/>
        <Line><Btn title="📍 Near me on Maps" onPress={() => void Linking.openURL(p.links.find_near_you)} style={{ flex: 1 }}/>
          <Btn kind="outline" title="▶ Videos" onPress={() => openInApp(p.links.videos, `${p.name} basics`, { category: "study", note: `${p.name} learning` })} style={{ flex: 1 }}/></Line>
        <Muted small>How to choose:</Muted>{(p.choose_a_club as string[]).map(c => <Text key={c} style={{ color: C.text }}>{`✓ ${c}`}</Text>)}</Card>
      <Card style={{ gap: 4 }}><Kicker>FIRST MONTH</Kicker>{(p.first_month as string[]).map(c => <Text key={c} style={{ color: C.text }}>{`• ${c}`}</Text>)}</Card>
      <Card style={{ borderColor: C.amber, gap: 4 }}><Kicker>⚠ SAFETY</Kicker>{(p.safety as string[]).map(c => <Text key={c} style={{ color: C.text }}>{`• ${c}`}</Text>)}</Card>
    </>}
  </Screen>;
}

// ------------------------------------------------------------------ English check

export function EnglishScreen({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [text, setText] = useState<string>(""); const [r, setR] = useState<Row | null>(null); const [busy, setBusy] = useState(false);
  const check = (deep: boolean) => { if (!text.trim()) return; setBusy(true);
    void api<Row>("/english/check", "POST", { text, deep }).then(setR).catch(e => onError(msg(e))).finally(() => setBusy(false)); };
  return <Screen>
    <Card style={{ gap: 8 }}><Kicker>WRITE OR SAY WHAT YOU WANT TO SAY</Kicker>
      <Field voice value={text} onChangeText={setText} multiline placeholder="e.g. Yesterday I didn't went to office because i was sick." style={{ minHeight: 120 }}/>
      <Line><Btn title="✓ Check" busy={busy} onPress={() => check(false)} style={{ flex: 1 }}/><Btn kind="outline" title="🔎 Deeper check" onPress={() => check(true)} style={{ flex: 1 }}/></Line>
      <Muted small>Check uses built-in rules. Deeper check also sends just this text to LanguageTool for more suggestions.</Muted></Card>
    {r && <>
      <Card style={{ gap: 6, borderColor: r.count ? C.amber : C.green }}>
        <Kicker>{r.count ? `${r.count} SUGGESTION${r.count === 1 ? "" : "S"} · SCORE ${r.score}` : "LOOKS GOOD ✓"}</Kicker>
        <Text style={{ color: C.text, fontSize: 16, lineHeight: 23 }}>{r.corrected}</Text>
        <Line><Btn kind="outline" title="Use corrected" onPress={() => setText(r.corrected)} style={{ flex: 1 }}/><Btn kind="link" title="Share" onPress={() => void Share.share({ message: r.corrected })}/></Line>
        {r.note && <Muted small>{r.note}</Muted>}
      </Card>
      {(r.issues as Row[]).map((i, k) => <Card key={k} style={{ gap: 2 }}>
        <Text style={{ color: C.text }}><Text style={{ color: C.red, textDecorationLine: "line-through" }}>{i.text || "∅"}</Text>{i.suggestion != null ? <Text style={{ color: C.green, fontWeight: "800" }}>{`  →  ${i.suggestion || "(remove)"}`}</Text> : null}</Text>
        <Muted small>{`${i.message}${i.source === "languagetool" ? " · LanguageTool" : ""}`}</Muted></Card>)}
    </>}
  </Screen>;
}

// ------------------------------------------------------------------ freelancing

export function FreelanceScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [hours, setHours] = useState<string>("6"); const [rate, setRate] = useState<string>(""); const [level, setLevel] = useState<string>("beginner");
  const [platform, setPlatform] = useState<string>("fiverr"); const [cx, setCx] = useState<string>("standard"); const [rev, setRev] = useState<string>("1");
  const [est, setEst] = useState<Row | null>(null);
  const [job, setJob] = useState<string>(""); const [skills, setSkills] = useState<string>(""); const [name, setName] = useState<string>(""); const [exp, setExp] = useState<string>("");
  const [prop, setProp] = useState<Row | null>(null); const [draft, setDraft] = useState<string>("");
  const estimate = () => void api<Row>("/freelance/estimate", "POST", { hours: parseFloat(hours) || 1, rate_usd: parseFloat(rate) || undefined, level, platform, complexity: cx, revisions: parseInt(rev, 10) || 0 })
    .then(setEst).catch(e => onError(msg(e)));
  const write = () => void api<Row>("/freelance/proposal", "POST", { job, skills: skills.split(",").map(s => s.trim()).filter(Boolean), name, experience: exp || undefined,
    days: est?.delivery_days, price_usd: est ? Number(est.price_usd) : undefined }).then(r => { setProp(r); setDraft(r.text); }).catch(e => onError(msg(e)));
  const track = () => void api("/career/jobs", "POST", { company: platform === "direct" ? "Direct client" : platform[0].toUpperCase() + platform.slice(1),
    role: job.split("\n")[0].slice(0, 190) || "Freelance gig", status: "draft", notes: draft }).then(() => onNotice("Saved to Job tracker as a draft")).catch(e => onError(msg(e)));
  return <Screen>
    <Card style={{ gap: 8 }}><Kicker>💵 PRICE ESTIMATOR</Kicker>
      <Line><Field label="Hours of work" value={hours} onChangeText={setHours} keyboardType="decimal-pad" style={{ flex: 1 }}/><Field label="Your $/hour (optional)" value={rate} onChangeText={setRate} keyboardType="decimal-pad" style={{ flex: 1 }}/></Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["beginner", "intermediate", "expert"].map(x => <Pill key={x} label={x} on={level === x} onPress={() => setLevel(x)}/>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["fiverr", "upwork", "direct"].map(x => <Pill key={x} label={x} on={platform === x} onPress={() => setPlatform(x)}/>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["simple", "standard", "complex"].map(x => <Pill key={x} label={x} on={cx === x} onPress={() => setCx(x)}/>)}</View>
      <Field label="Revisions included" value={rev} onChangeText={setRev} keyboardType="number-pad"/>
      <Btn title="Estimate" onPress={estimate}/>
      {est && <View style={{ gap: 4 }}>
        <Text style={{ color: C.green, fontSize: 22, fontWeight: "900" }}>{`$${est.price_usd} · ${lkr(Number(est.price_lkr))}`}</Text>
        <Muted small>{`You receive $${est.you_receive_usd} after ${est.platform_fee_pct}% fee · about ${est.delivery_days} day(s)`}</Muted>
        <Muted small>{`Packages: basic $${est.packages_usd.basic} · standard $${est.packages_usd.standard} · premium $${est.packages_usd.premium}`}</Muted>
        {(est.explain as string[]).map(x => <Muted key={x} small>{`• ${x}`}</Muted>)}<Muted small>{est.note}</Muted></View>}
    </Card>
    <Card style={{ gap: 8 }}><Kicker>✍️ PROPOSAL WRITER</Kicker>
      <Field value={job} onChangeText={setJob} multiline placeholder="Paste the job / buyer request here" style={{ minHeight: 100 }}/>
      <Field value={skills} onChangeText={setSkills} placeholder="Your skills, comma separated (Power BI, SQL, Excel)"/>
      <Field value={exp} onChangeText={setExp} placeholder="One line of relevant experience (optional)"/>
      <Field value={name} onChangeText={setName} placeholder="Your name"/>
      <Btn title="Write draft" onPress={write} disabled={job.trim().length < 10}/>
      {prop && <>
        <Field value={draft} onChangeText={setDraft} multiline style={{ minHeight: 220 }}/>
        <Line><Btn kind="outline" title="Copy / share" onPress={() => void Share.share({ message: draft })} style={{ flex: 1 }}/><Btn kind="outline" title="Save to Job tracker" onPress={track} style={{ flex: 1 }}/></Line>
        {(prop.checklist as string[]).map(c => <Muted key={c} small>{`✓ ${c}`}</Muted>)}
      </>}
      <Muted small>Drafts only. Sakuna never sends, applies or accepts anything for you, and doesn't automate Fiverr or Upwork.</Muted>
    </Card>
  </Screen>;
}
