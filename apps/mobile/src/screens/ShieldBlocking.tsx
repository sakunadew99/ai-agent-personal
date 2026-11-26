import React, { useMemo, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";

import type { ShieldCtx } from "../ShieldPanel";
import {
  type AppCategory, type AppInfo, type BlockList, CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_ORDER, clock, clockMin, DAY_SHORT,
  errorText, type ListMode, parseLists, scheduleText, Shield,
} from "../shield";
import { C, soft } from "../ui";
import { DateField, TimeField } from "../pickers";

const QUICK = [15, 30, 60, 120, 240];
const SUGGESTED_SITES = ["youtube.com", "facebook.com", "instagram.com", "tiktok.com", "x.com", "reddit.com", "netflix.com", "web.whatsapp.com", "linkedin.com", "pinterest.com"];
const MODE_LABEL: Record<ListMode, string> = { manual: "Quick block only", always: "Always on", schedule: "On a schedule" };

const minLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);
const newList = (n: number): BlockList => ({
  id: `list-${Date.now()}`, name: n ? `Blocklist ${n + 1}` : "My blocklist", mode: "manual", schedule: null,
  apps: [], domains: [], keywords: [], newApps: false, newAppsSince: 0, adult: false, purchases: false, unsupportedBrowsers: false,
});

/** Blocking tab: quick block, the user's blocklists, and the list editor. */
export function ShieldBlocking({ status, lists, setStatus, setLists, say }: ShieldCtx) {
  const [minutes, setMinutes] = useState(60);
  const [chosen, setChosen] = useState<string[]>([]); // empty = all lists
  const [editing, setEditing] = useState<BlockList | null>(null);
  const shield = Shield!;

  function startQuick() {
    if (!status.accessibility) { say("Turn on “Allow blocking” first (top of this screen)."); return; }
    if (!lists.length) { say("Create a blocklist first."); return; }
    try { setStatus(shield.startSession(minutes, chosen)); say(`Quick block on until ${clock(Date.now() + minutes * 60000)}.`); } catch (r) { say(errorText(r)); }
  }
  function endQuick() { try { setStatus(shield.endSession()); say("Quick block ended."); } catch (r) { say(errorText(r)); } }
  const toggleChosen = (id: string) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));

  return <>
    <View style={[s.card, status.sessionActive && s.cardOn]}>
      <Text style={s.kicker}>⚡ QUICK BLOCK</Text>
      {status.sessionActive ? <>
        <Text style={s.title}>Blocking until {clock(status.sessionEndsAt)}</Text>
        <Text style={s.muted}>{status.sessionListIds.length ? lists.filter(l => status.sessionListIds.includes(l.id)).map(l => l.name).join(", ") : "All blocklists"}</Text>
        {status.strict ? <Text style={s.small}>🔒 Strict Mode is on, so the quick block can't be stopped early.</Text>
          : <TouchableOpacity style={s.outline} onPress={endQuick}><Text style={s.outlineText}>Stop quick block</Text></TouchableOpacity>}
      </> : <>
        <Text style={s.title}>Block now for…</Text>
        <View style={s.chips}>{QUICK.map(m => <Chip key={m} on={minutes === m} label={minLabel(m)} onPress={() => setMinutes(m)}/>)}</View>
        {lists.length > 1 && <View style={s.chips}>
          <Chip on={!chosen.length} label="All lists" onPress={() => setChosen([])}/>
          {lists.map(l => <Chip key={l.id} on={chosen.includes(l.id)} label={l.name} onPress={() => toggleChosen(l.id)}/>)}
        </View>}
        <TouchableOpacity style={s.primary} onPress={startQuick}><Text style={s.primaryText}>Start quick block · {minLabel(minutes)}</Text></TouchableOpacity>
      </>}
    </View>

    <View style={s.headRow}>
      <Text style={s.section}>Blocklists</Text>
      <TouchableOpacity onPress={() => setEditing(newList(lists.length))}><Text style={s.link}>＋ New blocklist</Text></TouchableOpacity>
    </View>
    {!lists.length && <TouchableOpacity style={s.empty} onPress={() => setEditing(newList(0))}>
      <Text style={{ fontSize: 28 }}>🛡</Text><Text style={s.rowTitle}>Create your first blocklist</Text>
      <Text style={s.small}>Pick apps, websites and keywords, then choose when they're blocked.</Text></TouchableOpacity>}
    {lists.map(l => {
      const on = status.activeListIds.includes(l.id);
      const extras = [l.adult && "🔞", l.newApps && "🆕", l.purchases && "🛒", l.unsupportedBrowsers && "🌐"].filter(Boolean).join(" ");
      return <TouchableOpacity key={l.id} style={[s.card, on && s.cardOn]} onPress={() => setEditing(l)}>
        <View style={s.headRow}>
          <Text style={s.title} numberOfLines={1}>{l.name}</Text>
          <Text style={[s.pill, on ? s.pillOn : s.pillOff]}>{on ? "● BLOCKING" : "PAUSED"}</Text>
        </View>
        <Text style={s.muted}>{l.mode === "schedule" ? `🗓 ${scheduleText(l.schedule)}` : l.mode === "always" ? "♾ Always on" : "⚡ Quick block only"}</Text>
        <View style={s.counts}>
          <Text style={s.count}>📱 {l.apps.length} apps</Text><Text style={s.count}>🌐 {l.domains.length} sites</Text><Text style={s.count}># {l.keywords.length} keywords</Text>
          {!!extras && <Text style={s.count}>{extras}</Text>}
        </View>
      </TouchableOpacity>;
    })}

    {editing && <ListEditor initial={editing} isNew={!lists.some(l => l.id === editing.id)} strict={status.strict}
      onClose={() => setEditing(null)} onSaved={(next, note) => { setLists(next); setEditing(null); say(note); }}/>}
  </>;
}

// ---------------------------------------------------------------------------------------------------------------------

type Section = "apps" | "webs" | "keywords";

function ListEditor({ initial, isNew, strict, onClose, onSaved }: { initial: BlockList; isNew: boolean; strict: boolean; onClose: () => void; onSaved: (lists: BlockList[], note: string) => void }) {
  const [d, setD] = useState<BlockList>(initial);
  const [section, setSection] = useState<Section>("apps");
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState("");
  const shield = Shield!;
  const locked = strict && !isNew;
  const orig = initial;

  React.useEffect(() => { shield.getInstalledApps().then(setApps).catch(r => setError(errorText(r))); }, [shield]);

  const patch = (p: Partial<BlockList>) => setD(cur => ({ ...cur, ...p }));
  /** In Strict Mode, items already saved can't be removed. */
  const canRemove = (kind: "apps" | "domains" | "keywords", v: string) => !locked || !orig[kind].includes(v);
  const toggleIn = (kind: "apps" | "domains" | "keywords", v: string) => {
    const has = d[kind].includes(v);
    if (has && !canRemove(kind, v)) { setError("Strict Mode is on: items can be added but not removed."); return; }
    patch({ [kind]: has ? d[kind].filter(x => x !== v) : [...d[kind], v] } as Partial<BlockList>);
  };
  const setOption = (key: "newApps" | "adult" | "purchases" | "unsupportedBrowsers" | "shorts", value: boolean) => {
    if (!value && locked && orig[key]) { setError("Strict Mode is on: options can be switched on but not off."); return; }
    patch({ [key]: value } as Partial<BlockList>);
  };
  function setMode(mode: ListMode) {
    patch({ mode, schedule: mode === "schedule" ? d.schedule ?? { days: [1, 2, 3, 4, 5], start: 9 * 60, end: 17 * 60 } : d.schedule });
  }

  function save() {
    setError("");
    try {
      const next = parseLists(shield.saveList(JSON.stringify({ ...d, schedule: d.mode === "schedule" ? d.schedule : null })));
      onSaved(next, isNew ? `“${d.name}” created.` : `“${d.name}” saved.`);
    } catch (r) { setError(errorText(r)); }
  }
  function remove() {
    Alert.alert("Delete blocklist?", `“${d.name}” will stop blocking and be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { try { onSaved(parseLists(shield.deleteList(d.id)), `“${d.name}” deleted.`); } catch (r) { setError(errorText(r)); } } },
    ]);
  }

  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={s.modal}>
      <View style={s.modalTop}>
        <TouchableOpacity style={s.roundBtn} onPress={onClose} accessibilityLabel="Close"><Text style={s.roundBtnText}>‹</Text></TouchableOpacity>
        <Text style={s.modalTitle}>{isNew ? "New blocklist" : "Edit blocklist"}</Text>
        <View style={{ width: 40 }}/>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {locked && <Text style={s.notice}>🔒 Strict Mode is on. You can add apps, sites and keywords, but not remove them or switch options off.</Text>}
        <TextInput style={s.input} value={d.name} onChangeText={name => patch({ name })} placeholder="Blocklist name" placeholderTextColor={C.muted} maxLength={40}/>

        <View style={s.card}>
          <Text style={s.kicker}>WHEN DOES IT BLOCK?</Text>
          <View style={s.chips}>{(["manual", "always", "schedule"] as ListMode[]).map(m => <Chip key={m} on={d.mode === m} label={MODE_LABEL[m]} onPress={() => setMode(m)}/>)}</View>
          <Text style={s.small}>{d.mode === "manual" ? "Blocks only while you run a Quick block." : d.mode === "always" ? "Blocks all day, every day." : "Blocks on the days and hours below."}</Text>
          {d.mode === "schedule" && d.schedule && <ScheduleEditor value={d.schedule} onChange={schedule => patch({ schedule })}/>}
        </View>

        <View style={s.segment}>{([["apps", `Apps · ${d.apps.length}`], ["webs", `Webs · ${d.domains.length}`], ["keywords", `Keywords · ${d.keywords.length}`]] as [Section, string][]).map(([k, label]) =>
          <TouchableOpacity key={k} style={[s.segmentTab, section === k && s.segmentOn]} onPress={() => setSection(k)}>
            <Text style={[s.segmentText, section === k && s.segmentTextOn]}>{label}</Text></TouchableOpacity>)}</View>

        {section === "apps" && <AppsPicker apps={apps} selected={d.apps} toggle={pkg => toggleIn("apps", pkg)}
          setMany={(pkgs, on) => {
            const keep = on ? Array.from(new Set([...d.apps, ...pkgs])) : d.apps.filter(p => !pkgs.includes(p) || !canRemove("apps", p));
            patch({ apps: keep });
          }}/>}
        {section === "webs" && <ItemsEditor kind="website" values={d.domains} suggestions={SUGGESTED_SITES} toggle={v => toggleIn("domains", v)}
          clean={v => v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0]}
          valid={v => v.includes(".")} hint="Subdomains are included: youtube.com also blocks m.youtube.com."/>}
        {section === "keywords" && <ItemsEditor kind="keyword" values={d.keywords} suggestions={[]} toggle={v => toggleIn("keywords", v)}
          clean={v => v.trim().toLowerCase()} valid={v => v.length >= 2}
          hint="Blocks any web address that contains the word, e.g. “games” blocks store.epicgames.com. Works in supported browsers."/>}

        <Text style={s.section}>Extra options</Text>
        <OptionCard icon="🎬" title="Block YouTube Shorts & Instagram Reels" text="Leaves the Shorts / Reels player as soon as it opens; the rest of YouTube and Instagram keeps working (best effort, apps change)." value={!!d.shorts} onChange={v => setOption("shorts", v)}/>
        <OptionCard icon="🆕" title="Block newly installed apps" text="Apps you install from now on are added to this list and blocked." value={d.newApps} onChange={v => setOption("newApps", v)}/>
        <OptionCard icon="🔞" title="Adult sites blocking" text="Known adult sites and adult words in the address are blocked in supported browsers." value={d.adult} onChange={v => setOption("adult", v)}/>
        <OptionCard icon="🛒" title="In-app purchases blocking" text="Closes Google Play's payment screen while this list is blocking (best effort)." value={d.purchases} onChange={v => setOption("purchases", v)}/>
        <OptionCard icon="🌐" title="Block unsupported browsers" text="If a browser's address bar can't be read, that browser is blocked instead (only when this list has website rules)." value={d.unsupportedBrowsers} onChange={v => setOption("unsupportedBrowsers", v)}/>

        {!isNew && !strict && <TouchableOpacity style={s.danger} onPress={remove}><Text style={s.dangerText}>Delete blocklist</Text></TouchableOpacity>}
      </ScrollView>
      <View style={s.footer}>
        {!!error && <Text style={s.error}>{error}</Text>}
        <TouchableOpacity style={s.primary} onPress={save}><Text style={s.primaryText}>{isNew ? "Create blocklist" : "Save"}</Text></TouchableOpacity>
      </View>
    </View>
  </Modal>;
}

type Sched = { days: number[]; start: number; end: number; from?: string | null; until?: string | null };
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
function ScheduleEditor({ value, onChange }: { value: Sched; onChange: (v: Sched) => void }) {
  const toggleDay = (day: number) => onChange({ ...value, days: value.days.includes(day) ? value.days.filter(x => x !== day) : [...value.days, day].sort() });
  const presets: [string, Sched][] = [
    ["Work hours", { days: [1, 2, 3, 4, 5], start: 540, end: 1020 }], ["Study evenings", { days: [1, 2, 3, 4, 5, 6, 7], start: 1140, end: 1320 }],
    ["Bedtime", { days: [1, 2, 3, 4, 5, 6, 7], start: 1350, end: 360 }],
  ];
  return <View style={{ gap: 10 }}>
    <View style={s.chips}>{presets.map(([label, p]) => <Chip key={label} on={false} label={label} onPress={() => onChange({ ...p, from: value.from, until: value.until })}/>)}</View>
    <View style={s.days}>{DAY_SHORT.map((name, i) => <TouchableOpacity key={name} style={[s.day, value.days.includes(i + 1) && s.dayOn]} onPress={() => toggleDay(i + 1)}>
      <Text style={[s.dayText, value.days.includes(i + 1) && s.dayTextOn]}>{name[0]}</Text></TouchableOpacity>)}</View>
    <View style={{ flexDirection: "row", gap: 10 }}>
      <TimeField label="From" value={clockMin(value.start)} onChange={t => t && onChange({ ...value, start: toMin(t) })}/>
      <TimeField label="To" value={clockMin(value.end)} onChange={t => t && onChange({ ...value, end: toMin(t) })}/>
    </View>
    <View style={{ flexDirection: "row", gap: 10 }}>
      <DateField label="Starting date (optional)" value={value.from ?? null} allowClear placeholder="From today" onChange={from => onChange({ ...value, from })}/>
      <DateField label="Until date (optional)" value={value.until ?? null} allowClear placeholder="No end" min={value.from ?? undefined} onChange={until => onChange({ ...value, until })}/>
    </View>
    <Text style={s.small}>{value.start === value.end ? "Same start and end = the whole day." : value.start > value.end ? "Runs overnight into the next morning." : scheduleText(value)}</Text>
  </View>;
}

function TimeStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const step = (delta: number) => onChange((value + delta + 1440) % 1440);
  return <View style={s.stepper}>
    <Text style={s.small}>{label}</Text>
    <View style={s.stepRow}>
      <TouchableOpacity style={s.stepBtn} onPress={() => step(-30)} onLongPress={() => step(-120)}><Text style={s.stepBtnText}>−</Text></TouchableOpacity>
      <Text style={s.stepValue}>{clockMin(value)}</Text>
      <TouchableOpacity style={s.stepBtn} onPress={() => step(30)} onLongPress={() => step(120)}><Text style={s.stepBtnText}>＋</Text></TouchableOpacity>
    </View>
  </View>;
}

function AppsPicker({ apps, selected, toggle, setMany }: { apps: AppInfo[] | null; selected: string[]; toggle: (pkg: string) => void; setMany: (pkgs: string[], on: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<AppCategory | null>(null);
  const groups = useMemo(() => {
    const m = new Map<AppCategory, AppInfo[]>();
    for (const a of apps ?? []) m.set(a.category, [...(m.get(a.category) ?? []), a]);
    return CATEGORY_ORDER.filter(c => m.has(c)).map(c => [c, m.get(c)!] as const);
  }, [apps]);
  if (!apps) return <Text style={s.muted}>Loading your apps…</Text>;
  const q = search.trim().toLowerCase();

  return <View style={s.cardFlat}>
    <TextInput style={s.input} value={search} onChangeText={setSearch} placeholder="🔍  Search apps" placeholderTextColor={C.muted}/>
    {q ? apps.filter(a => a.label.toLowerCase().includes(q)).map(a => <AppRow key={a.packageName} app={a} on={selected.includes(a.packageName)} onPress={() => toggle(a.packageName)}/>)
      : groups.map(([cat, list]) => {
        const count = list.filter(a => selected.includes(a.packageName)).length;
        const all = count === list.length;
        return <View key={cat}>
          <TouchableOpacity style={s.catRow} onPress={() => setOpen(open === cat ? null : cat)}>
            <Text style={s.chev}>{open === cat ? "⌄" : "›"}</Text>
            <View style={s.catIcon}><Text style={{ fontSize: 18 }}>{CATEGORY_ICON[cat]}</Text></View>
            <View style={{ flex: 1 }}><Text style={s.rowTitle}>{CATEGORY_LABEL[cat]}</Text><Text style={s.small}>{count ? `${count} of ${list.length} blocked` : `${list.length} apps`}</Text></View>
            <Check state={all ? "on" : count ? "some" : "off"} onPress={() => setMany(list.map(a => a.packageName), !all)}/>
          </TouchableOpacity>
          {open === cat && list.map(a => <AppRow key={a.packageName} app={a} on={selected.includes(a.packageName)} onPress={() => toggle(a.packageName)} indent/>)}
        </View>;
      })}
    <Text style={s.small}>Categories come from each app's Play listing; apps without one are under “Other apps”.</Text>
  </View>;
}

function AppRow({ app, on, onPress, indent }: { app: AppInfo; on: boolean; onPress: () => void; indent?: boolean }) {
  return <TouchableOpacity style={[s.appRow, indent && { paddingLeft: 36 }]} onPress={onPress}>
    <View style={s.avatar}><Text style={s.avatarText}>{app.label.slice(0, 1).toUpperCase()}</Text></View>
    <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>{app.label}</Text>
    <Check state={on ? "on" : "off"} onPress={onPress}/>
  </TouchableOpacity>;
}

function ItemsEditor({ kind, values, suggestions, toggle, clean, valid, hint }: { kind: string; values: string[]; suggestions: string[]; toggle: (v: string) => void; clean: (v: string) => string; valid: (v: string) => boolean; hint: string }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  function add() {
    const v = clean(text);
    if (!valid(v)) { setBad(true); return; }
    if (!values.includes(v)) toggle(v);
    setText(""); setBad(false);
  }
  const rows = [...values, ...suggestions.filter(x => !values.includes(x))];
  return <View style={s.cardFlat}>
    <View style={{ flexDirection: "row", gap: 8 }}>
      <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={t => { setText(t); setBad(false); }} placeholder={`Add ${kind}`} placeholderTextColor={C.muted}
        autoCapitalize="none" autoCorrect={false} keyboardType={kind === "website" ? "url" : "default"} onSubmitEditing={add} returnKeyType="done"/>
      <TouchableOpacity style={s.addBtn} onPress={add}><Text style={s.primaryText}>Add</Text></TouchableOpacity>
    </View>
    {bad && <Text style={s.error}>{kind === "website" ? "Type a site like youtube.com" : "Use at least 2 letters."}</Text>}
    {rows.map(v => <TouchableOpacity key={v} style={s.appRow} onPress={() => toggle(v)}>
      <View style={s.avatar}><Text style={s.avatarText}>{kind === "website" ? "🌐" : "#"}</Text></View>
      <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>{v}</Text>
      <Check state={values.includes(v) ? "on" : "off"} onPress={() => toggle(v)}/>
    </TouchableOpacity>)}
    {!rows.length && <Text style={s.muted}>No {kind}s yet.</Text>}
    <Text style={s.small}>{hint}</Text>
  </View>;
}

function OptionCard({ icon, title, text, value, onChange }: { icon: string; title: string; text: string; value: boolean; onChange: (v: boolean) => void }) {
  return <TouchableOpacity style={[s.option, value && s.optionOn]} onPress={() => onChange(!value)} activeOpacity={0.8}>
    <View style={s.optionHead}>
      <View style={s.optionIcon}><Text style={{ fontSize: 20 }}>{icon}</Text></View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: C.green, false: C.line }} thumbColor={C.text}/>
    </View>
    <Text style={s.rowTitleBig}>{title}</Text>
    <Text style={s.small}>{text}</Text>
  </TouchableOpacity>;
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress}><Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text></TouchableOpacity>;
}

function Check({ state, onPress }: { state: "on" | "off" | "some"; onPress: () => void }) {
  return <TouchableOpacity onPress={onPress} hitSlop={10} style={[s.check, state !== "off" && s.checkOn]}>
    <Text style={s.checkText}>{state === "on" ? "✓" : state === "some" ? "–" : ""}</Text></TouchableOpacity>;
}

export const s = StyleSheet.create({
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  cardFlat: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 12, gap: 4 },
  cardOn: { borderColor: C.green },
  kicker: { color: C.muted, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  title: { color: C.text, fontSize: 18, fontWeight: "800", flexShrink: 1 },
  section: { color: C.text, fontSize: 17, fontWeight: "800", marginTop: 4 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  small: { color: C.muted, fontSize: 11, lineHeight: 16 },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: "600" },
  rowTitleBig: { color: C.text, fontSize: 15, fontWeight: "800" },
  link: { color: C.green, fontWeight: "700", fontSize: 13 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: C.line, borderWidth: 1, borderRadius: 99, paddingHorizontal: 13, paddingVertical: 8 },
  chipOn: { borderColor: C.green, backgroundColor: C.greenSoft },
  chipText: { color: C.muted, fontWeight: "600", fontSize: 13 },
  chipTextOn: { color: C.green },
  primary: { backgroundColor: C.green, borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: C.greenDark, fontWeight: "800", fontSize: 14 },
  outline: { borderColor: C.line, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center" },
  outlineText: { color: C.text, fontWeight: "600" },
  danger: { borderColor: "#593a34", borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: "center", marginTop: 6 },
  dangerText: { color: "#ff9b8c", fontWeight: "700" },
  pill: { fontSize: 10, fontWeight: "800", letterSpacing: 0.8, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  pillOn: { color: C.green, backgroundColor: C.greenSoft },
  pillOff: { color: C.muted, backgroundColor: C.line },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  count: { color: C.text2, fontSize: 12 },
  empty: { borderColor: C.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 18, padding: 22, alignItems: "center", gap: 6 },
  modal: { flex: 1, backgroundColor: C.bg },
  modalTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 44, paddingBottom: 8 },
  modalTitle: { color: C.text, fontSize: 20, fontWeight: "800" },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  roundBtnText: { color: C.text, fontSize: 24, marginTop: -2 },
  notice: { color: "#ffd38a", backgroundColor: soft(C.amber), borderRadius: 12, padding: 12, fontSize: 12, lineHeight: 18, overflow: "hidden" },
  input: { backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, color: C.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  addBtn: { backgroundColor: C.green, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center" },
  segment: { flexDirection: "row", borderBottomColor: C.line, borderBottomWidth: 1 },
  segmentTab: { flex: 1, alignItems: "center", paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: "transparent" },
  segmentOn: { borderBottomColor: C.green },
  segmentText: { color: C.muted, fontWeight: "700", fontSize: 13 },
  segmentTextOn: { color: C.green },
  days: { flexDirection: "row", justifyContent: "space-between" },
  day: { width: 38, height: 38, borderRadius: 19, borderColor: C.line, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: C.green, borderColor: C.green },
  dayText: { color: C.muted, fontWeight: "700" },
  dayTextOn: { color: C.greenDark },
  stepper: { flex: 1, backgroundColor: C.field, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 10, gap: 6 },
  stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  stepBtnText: { color: C.green, fontSize: 18, fontWeight: "800" },
  stepValue: { color: C.text, fontSize: 20, fontWeight: "800", fontVariant: ["tabular-nums"] },
  catRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  chev: { color: C.muted, fontSize: 18, width: 14, textAlign: "center" },
  catIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  appRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9 },
  avatar: { width: 32, height: 32, borderRadius: 10, backgroundColor: C.line, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#a5e3be", fontWeight: "800", fontSize: 14 },
  check: { width: 24, height: 24, borderRadius: 7, borderColor: "#476051", borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkText: { color: C.greenDark, fontWeight: "900", fontSize: 14 },
  option: { borderColor: C.line, borderWidth: 1, borderStyle: "dashed", borderRadius: 18, padding: 14, gap: 6 },
  optionOn: { borderStyle: "solid", borderColor: C.green, backgroundColor: C.panel },
  optionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  optionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.panel2, alignItems: "center", justifyContent: "center" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 22, backgroundColor: C.bg, borderTopColor: C.line, borderTopWidth: 1, gap: 8 },
  error: { color: "#ff9b8c", fontSize: 12 },
});
