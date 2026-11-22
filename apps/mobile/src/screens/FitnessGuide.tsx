import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Hero, Ring, Segments } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const PLAN_KEY = "sakuna.workoutPlan";
const MEAL_KEY = "sakuna.mealPrefs";
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line, fontSize: 15 } as const;
const chip = (on: boolean) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: on ? C.green : C.line, backgroundColor: on ? C.greenSoft : "transparent" });

function ExerciseCard({ e, open, onToggle }: { e: Row; open: boolean; onToggle: () => void }) {
  return <TouchableOpacity activeOpacity={0.85} onPress={onToggle}>
    <Card style={{ padding: 12 }}>
      <Line><Text style={{ color: C.text, fontWeight: "900", fontSize: 15, flex: 1 }}>{e.name}</Text>
        <Text style={{ color: C.green, fontWeight: "800" }}>{`${e.sets} × ${e.reps}`}</Text></Line>
      <Muted small>{`${(e.muscles as string[]).join(", ")} · ${e.equipment} · rest ${e.rest_s ? `${e.rest_s}s` : "—"}`}</Muted>
      {open && <View style={{ gap: 4 }}>
        <Kicker>HOW TO DO IT</Kicker>{(e.technique as string[]).map((t, i) => <Text key={i} style={{ color: C.text }}>{`${i + 1}. ${t}`}</Text>)}
        <Kicker>COMMON MISTAKES</Kicker>{(e.mistakes as string[]).map((t, i) => <Text key={i} style={{ color: C.amber }}>{`✗ ${t}`}</Text>)}
        <Text style={{ color: C.blue }}>{`Easier: ${e.easier}`}</Text>
        <Btn kind="outline" title="▶ Watch how (YouTube search)" onPress={() => openInApp(e.video_search, e.name, { category: "exercise", note: `Technique: ${e.name}` })}/>
      </View>}
    </Card></TouchableOpacity>;
}

function Today({ api, onError, onOpen }: { api: Api; onError: (m: string) => void; onOpen?: (t: string) => void }) {
  const [plans, setPlans] = useState<Row[]>([]);
  const [plan, setPlan] = useState("full_body");
  const [t, setT] = useState<Row | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { SecureStore.getItemAsync(PLAN_KEY).then(p => { if (p) setPlan(p); }).catch(() => undefined); api<Row>("/exercises").then(x => setPlans(x.plans)).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { api<Row>(`/exercises/today?plan=${plan}`).then(setT).catch(e => onError(msg(e))); }, [api, plan, onError]);
  const choose = (p: string) => { setPlan(p); void SecureStore.setItemAsync(PLAN_KEY, p).catch(() => undefined); };
  return <View style={{ gap: 10 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{plans.map(p => <TouchableOpacity key={p.key} onPress={() => choose(p.key)} style={chip(plan === p.key)}>
      <Text style={{ color: plan === p.key ? C.green : C.muted, fontWeight: "800" }}>{p.title}</Text></TouchableOpacity>)}</ScrollView>
    {!t ? <Empty>Loading…</Empty> : t.rest_day ? <Card accent><Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>😌 Rest day</Text>
      <Muted>{t.tip}</Muted><Muted small>{`Next workout: ${t.next_day}`}</Muted></Card> : <>
      <Card accent><Kicker>{`TODAY · WORKOUT ${t.workout}`}</Kicker><Text style={{ color: C.text }}>{`Warm-up: ${(t.warmup as string[]).join(", ")}`}</Text><Muted small>{t.tip}</Muted>
        {onOpen && <Btn title="🏋️ Log it in Gym" onPress={() => onOpen("Gym")}/>}</Card>
      {(t.exercises as Row[]).map(e => <ExerciseCard key={e.name} e={e} open={open === e.name} onToggle={() => setOpen(open === e.name ? null : e.name)}/>)}
    </>}
  </View>;
}

function Library({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [items, setItems] = useState<Row[]>([]);
  const [muscle, setMuscle] = useState(""); const [equip, setEquip] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { const q = [muscle && `muscle=${muscle}`, equip && `equipment=${equip}`].filter(Boolean).join("&");
    api<Row>(`/exercises${q ? `?${q}` : ""}`).then(x => setItems(x.items)).catch(e => onError(msg(e))); }, [api, muscle, equip, onError]);
  return <View style={{ gap: 10 }}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{["", "chest", "back", "shoulders", "quads", "glutes", "hamstrings", "biceps", "triceps", "core", "cardio"].map(m =>
      <TouchableOpacity key={m || "all"} onPress={() => setMuscle(m)} style={chip(muscle === m)}><Text style={{ color: muscle === m ? C.green : C.muted, fontWeight: "700", textTransform: "capitalize" }}>{m || "All"}</Text></TouchableOpacity>)}</ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{["", "none", "dumbbell", "barbell", "machine", "bar"].map(m =>
      <TouchableOpacity key={m || "any"} onPress={() => setEquip(m)} style={chip(equip === m)}><Text style={{ color: equip === m ? C.green : C.muted, fontWeight: "700" }}>{m ? (m === "none" ? "No equipment" : m) : "Any equipment"}</Text></TouchableOpacity>)}</ScrollView>
    {items.map(e => <ExerciseCard key={e.name} e={e} open={open === e.name} onToggle={() => setOpen(open === e.name ? null : e.name)}/>)}
  </View>;
}

function Meals({ api, onError }: { api: Api; onError: (m: string) => void }) {
  const [prefs, setPrefs] = useState<Row>({ weight_kg: "75", goal: "lose", budget_lkr_day: "", diet: [] as string[], height_cm: "", age: "", sex: "" });
  const [plan, setPlan] = useState<Row | null>(null);
  const [day, setDay] = useState(0);
  const [showShop, setShowShop] = useState(false);
  useEffect(() => { SecureStore.getItemAsync(MEAL_KEY).then(v => { if (v) setPrefs(JSON.parse(v)); }).catch(() => undefined); }, []);
  const make = useCallback(() => {
    const body: Row = { weight_kg: Number(prefs.weight_kg), goal: prefs.goal, diet: prefs.diet };
    if (Number(prefs.budget_lkr_day) > 0) body.budget_lkr_day = Number(prefs.budget_lkr_day);
    if (Number(prefs.height_cm) && Number(prefs.age) && prefs.sex) Object.assign(body, { height_cm: Number(prefs.height_cm), age: Number(prefs.age), sex: prefs.sex });
    void SecureStore.setItemAsync(MEAL_KEY, JSON.stringify(prefs)).catch(() => undefined);
    api<Row>("/nutrition/plan", "POST", body).then(p => { setPlan(p); setDay(Math.max(0, new Date().getDay() - 1 < 0 ? 6 : new Date().getDay() - 1)); }).catch(e => onError(msg(e)));
  }, [api, prefs, onError]);
  const set = (k: string) => (v: unknown) => setPrefs(p => ({ ...p, [k]: v }));
  const d: Row | null = plan ? plan.days[day] : null;
  return <View style={{ gap: 10 }}>
    <Card><Kicker>YOUR DETAILS</Kicker>
      <Line><View style={{ flex: 1, gap: 4 }}><Muted small>Weight (kg)</Muted><TextInput style={input} value={String(prefs.weight_kg)} onChangeText={set("weight_kg")} keyboardType="decimal-pad"/></View>
        <View style={{ flex: 1, gap: 4 }}><Muted small>Budget / day (LKR)</Muted><TextInput style={input} value={String(prefs.budget_lkr_day)} onChangeText={set("budget_lkr_day")} keyboardType="number-pad" placeholder="optional" placeholderTextColor={C.muted}/></View></Line>
      <Line>{(["lose", "maintain", "gain"] as const).map(g => <TouchableOpacity key={g} onPress={() => set("goal")(g)} style={[chip(prefs.goal === g), { flex: 1, alignItems: "center" }]}>
        <Text style={{ color: prefs.goal === g ? C.green : C.muted, fontWeight: "800", textTransform: "capitalize" }}>{g === "lose" ? "Lose fat" : g === "gain" ? "Build muscle" : "Maintain"}</Text></TouchableOpacity>)}</Line>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{["vegetarian", "pescatarian", "no_egg", "no_dairy"].map(x => { const on = (prefs.diet as string[]).includes(x);
        return <TouchableOpacity key={x} onPress={() => set("diet")(on ? (prefs.diet as string[]).filter(y => y !== x) : [...prefs.diet, x])} style={chip(on)}>
          <Text style={{ color: on ? C.green : C.muted, fontWeight: "700" }}>{x.replace("_", " ")}</Text></TouchableOpacity>; })}</View>
      <Line><TextInput style={[input, { flex: 1 }]} value={String(prefs.height_cm)} onChangeText={set("height_cm")} placeholder="Height cm" placeholderTextColor={C.muted} keyboardType="number-pad"/>
        <TextInput style={[input, { flex: 1 }]} value={String(prefs.age)} onChangeText={set("age")} placeholder="Age" placeholderTextColor={C.muted} keyboardType="number-pad"/>
        {(["male", "female"] as const).map(s => <TouchableOpacity key={s} onPress={() => set("sex")(prefs.sex === s ? "" : s)} style={chip(prefs.sex === s)}><Text style={{ color: prefs.sex === s ? C.green : C.muted }}>{s === "male" ? "♂" : "♀"}</Text></TouchableOpacity>)}</Line>
      <Muted small>Height, age and sex are optional; they make the calorie target more accurate.</Muted>
      <Btn title="🥗 Make my week" disabled={!(Number(prefs.weight_kg) >= 30)} onPress={make}/>
    </Card>
    {plan && <>
      <Card accent><Line><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 18 }}>{`${plan.targets.kcal} kcal · ${plan.targets.protein_g} g protein`}</Text>
        <Muted small>{`Target per day (${plan.targets.method}). Plan average: ${plan.avg_kcal} kcal, ${plan.avg_protein_g} g protein, Rs ${Number(plan.avg_day_cost_lkr).toLocaleString()}/day`}</Muted></View></Line>
        {!!plan.targets.floor_note && <Text style={{ color: C.amber }}>{plan.targets.floor_note}</Text>}
        {!!plan.budget_note && <Text style={{ color: C.amber }}>{plan.budget_note}</Text>}</Card>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{(plan.days as Row[]).map((x, i) => <TouchableOpacity key={x.day} onPress={() => setDay(i)} style={chip(day === i)}>
        <Text style={{ color: day === i ? C.green : C.muted, fontWeight: "800" }}>{x.day.slice(0, 3)}</Text></TouchableOpacity>)}</ScrollView>
      {d && <>{(d.meals as Row[]).map(m => <Card key={m.slot} style={{ padding: 12 }}>
        <Line><Text style={{ color: C.text, fontWeight: "900", textTransform: "capitalize", flex: 1 }}>{m.slot}</Text><Muted small>{`${m.kcal} kcal · ${m.protein_g} g`}</Muted></Line>
        {(m.items as Row[]).map((it, k) => <Text key={k} style={{ color: C.text }}>{`• ${it.name} — ${it.qty !== 1 ? `${it.qty} × ` : ""}${it.portion}`}</Text>)}</Card>)}
        <Muted small>{`${d.day}: ${d.kcal} kcal · ${d.protein_g} g protein · Rs ${Number(d.cost_lkr).toLocaleString()}`}</Muted></>}
      <TouchableOpacity onPress={() => setShowShop(s => !s)}><Card><Line><Kicker>{`🛒 SHOPPING LIST · ABOUT Rs ${Number(plan.week_cost_lkr).toLocaleString()} / WEEK`}</Kicker><View style={{ flex: 1 }}/><Text style={{ color: C.green }}>{showShop ? "Hide" : "Show"}</Text></Line>
        {showShop && (plan.shopping as Row[]).map(s => <Line key={s.item}><Text style={{ color: C.text, flex: 1 }}>{`${s.item} (${s.portions} × ${s.portion})`}</Text><Muted small>{`Rs ${Number(s.cost_lkr).toLocaleString()}`}</Muted></Line>)}</Card></TouchableOpacity>
      <Card><Kicker>MEAL PREP</Kicker>{(plan.prep as string[]).map((x, i) => <Text key={i} style={{ color: C.text }}>{`• ${x}`}</Text>)}</Card>
      <Muted small>{plan.note}</Muted>
    </>}
  </View>;
}

/** Fitness guide: today's workout, an exercise library with technique, and a Sri Lankan meal planner. */
export function FitnessGuideScreen({ api, onError, onOpen }: { api: Api; onError: (m: string) => void; onOpen?: (t: string) => void }) {
  const [tab, setTab] = useState<"today" | "library" | "meals">("today");
  return <Screen>
    <Hero kicker="FITNESS GUIDE" title="Stronger," accent="leaner, safer" color="#3ee08f" sub="Workout plans with technique, plus meals from Sri Lankan food that fit your budget."
      right={<Ring value={tab === "today" ? 33 : tab === "library" ? 66 : 100} size={70} label={tab === "today" ? "🏋️" : tab === "library" ? "📖" : "🥗"}/>}/>
    <Segments options={["today", "library", "meals"] as const} value={tab} onChange={setTab} labels={{ today: "🏋️ Today", library: "📖 Exercises", meals: "🥗 Meals" }}/>
    {tab === "today" ? <Today api={api} onError={onError} onOpen={onOpen}/> : tab === "library" ? <Library api={api} onError={onError}/> : <Meals api={api} onError={onError}/>}
    <Muted small>General fitness information, not medical advice. Stop if anything hurts and ask a qualified coach or doctor.</Muted>
  </Screen>;
}
