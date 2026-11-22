import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Image, KeyboardAvoidingView, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { ApiRecord as Row } from "../api";
import { openInApp } from "../browser";
import { Bars, Hero, Ring } from "../charts";
import { Btn, C, Card, Empty, Kicker, Muted, Row as Line, Screen } from "../ui";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
const msg = (r: unknown) => (r instanceof Error ? r.message : "Something went wrong");
const BROWN = "#e0a96d";
const input = { color: C.text, backgroundColor: C.panel2, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: C.line, fontSize: 15 } as const;
const chip = (on: boolean) => ({ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: on ? BROWN : C.line, backgroundColor: on ? `${BROWN}22` : "transparent" });

function Cover({ url, title, size = 56 }: { url?: string | null; title: string; size?: number }) {
  return url ? <Image source={{ uri: url }} style={{ width: size, height: size * 1.5, borderRadius: 8, backgroundColor: C.panel2 }}/>
    : <View style={{ width: size, height: size * 1.5, borderRadius: 8, backgroundColor: `${BROWN}33`, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: BROWN, fontWeight: "900", fontSize: size / 3 }}>{title.slice(0, 1).toUpperCase()}</Text></View>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <Modal visible animationType="slide" transparent onRequestClose={onClose}><KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
    <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "flex-end" }}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "94%", borderTopWidth: 1, borderColor: C.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 18, paddingVertical: 14 }}>
          <Text style={{ color: C.text, fontSize: 19, fontWeight: "900", flex: 1 }} numberOfLines={1}>{title}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: C.muted, fontSize: 22 }}>✕</Text></TouchableOpacity></View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View></View></KeyboardAvoidingView></Modal>;
}

/** Reading: shelves, progress with a reading timer, finish forecasts, highlights, yearly goal and real book search. */
export function ReadingScreen({ api, onError, onNotice }: { api: Api; onError: (m: string) => void; onNotice: (m: string) => void }) {
  const [v, setV] = useState<Row | null>(null);
  const [shelf, setShelf] = useState<"want" | "finished" | "paused">("want");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState(""); const [found, setFound] = useState<Row[] | null>(null);
  const [manual, setManual] = useState({ title: "", author: "", pages: "", link: "" });
  const [link, setLink] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const [hl, setHl] = useState({ quote: "", page: "" });
  const [take, setTake] = useState(""); const [ai, setAi] = useState("");
  const [timer, setTimer] = useState<{ id: string; start: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [goal, setGoal] = useState(false);
  const iv = useRef<ReturnType<typeof setInterval> | null>(null);
  const load = useCallback(() => { api<Row>("/reading").then(setV).catch(e => onError(msg(e))); }, [api, onError]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (timer) { iv.current = setInterval(() => setTick(t => t + 1), 1000); return () => { if (iv.current) clearInterval(iv.current); }; } return undefined; }, [timer]);
  if (!v) return <Screen><Empty>Loading your shelf…</Empty></Screen>;
  const books: Row[] = v.books;
  const reading = books.filter(b => b.status === "reading");
  const progress = (b: Row, body: Row) => void api<Row>(`/reading/books/${b.id}/progress`, "POST", body).then(x => { setV(x);
    const nb = (x.books as Row[]).find(y => y.id === b.id); onNotice(nb?.status === "finished" ? `🎉 Finished “${b.title}”!` : `Saved: page ${nb?.current_page}`); }).catch(e => onError(msg(e)));
  const readEbook = (b: Row) => { openInApp(b.read_url, b.title, { category: "study", note: `Reading: ${b.title}`, bookId: b.is_folder ? undefined : String(b.id) });
    setTimeout(load, 1500); };
  const stopTimer = (b: Row) => { const mins = Math.max(1, Math.round((Date.now() - timer!.start) / 60000)); setTimer(null);
    Alert.prompt ? Alert.prompt("Which page did you reach?", `${mins} minutes read`, p => progress(b, { to_page: Number(p) || b.current_page, minutes: mins }), "plain-text", String(b.current_page), "number-pad")
      : (setOpen({ ...b, _minutes: mins })); };
  const add = (b: Row, status: string) => void api("/reading/books", "POST", { title: b.title, author: b.author || "", total_pages: b.pages || b.total_pages || undefined,
    cover_url: b.cover_url || undefined, source_key: b.source_key || undefined, file_url: b.file_url || undefined, status })
    .then(() => { onNotice(`Added “${b.title}”`); setAdding(false); setFound(null); setQ(""); setManual({ title: "", author: "", pages: "", link: "" }); load(); }).catch(e => onError(msg(e)));
  const patch = (b: Row, body: Row) => void api<Row>(`/reading/books/${b.id}`, "PATCH", body).then(x => { setOpen(o => (o && o.id === x.id ? { ...o, ...x } : o)); load(); }).catch(e => onError(msg(e)));
  const yr = v.year;
  const elapsed = timer ? Math.floor((Date.now() - timer.start) / 1000) : 0;
  return <Screen onRefresh={load}>
    <Hero kicker="READING · BOOKS & IDEAS" title={`${yr.finished}${yr.goal ? `/${yr.goal}` : ""}`} accent="books this year" color={BROWN}
      sub={`${v.streak ? `🔥 ${v.streak}-day streak · ` : ""}${v.week_pages} pages this week${v.pace_pages_per_day ? ` · ${v.pace_pages_per_day} pages/day` : ""}${yr.on_track === false ? ` · behind (${yr.expected_by_now} expected)` : yr.on_track ? " · on track ✓" : ""}`}
      right={<Ring value={yr.goal ? Math.min(100, yr.finished / yr.goal * 100) : 0} size={88} color={BROWN} label={yr.goal ? `${Math.round(yr.finished / yr.goal * 100)}%` : "—"} sub="YEAR GOAL"/>}>
      <Line><Btn title="＋ Add a book" onPress={() => setAdding(true)} style={{ flex: 1 }}/><Btn kind="outline" title="🎯 Goal" onPress={() => setGoal(g => !g)} style={{ flex: 1 }}/></Line>
      {goal && <View style={{ gap: 6 }}><Muted small>Books to finish this year</Muted>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{[6, 12, 24, 36, 52].map(n => <TouchableOpacity key={n} onPress={() => void api<Row>("/reading/goal", "PUT", { books_per_year: n, daily_minutes: v.daily_minutes || 20 }).then(x => { setV(x); setGoal(false); })} style={chip(yr.goal === n)}>
          <Text style={{ color: yr.goal === n ? BROWN : C.muted, fontWeight: "800" }}>{`${n}`}</Text></TouchableOpacity>)}</View></View>}
    </Hero>
    {(v.week as Row[]).some(d => d.pages) && <Card><Kicker>PAGES THIS WEEK</Kicker><Bars data={(v.week as Row[]).map(d => ({ label: d.label, value: d.pages, color: BROWN }))} height={80}/></Card>}

    {reading.map(b => { const running = timer?.id === b.id;
      return <Card key={b.id} style={{ borderColor: `${BROWN}66` }}>
        <TouchableOpacity onPress={() => { setOpen(b); setTake(b.takeaways || ""); setAi(""); }}><Line style={{ alignItems: "flex-start" }}>
          <Cover url={b.cover_url} title={b.title}/>
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: C.text, fontWeight: "900", fontSize: 16 }} numberOfLines={2}>{b.title}</Text><Muted small>{b.author}</Muted>
            {b.total_pages ? <><View style={{ height: 8, borderRadius: 4, backgroundColor: C.panel2 }}><View style={{ height: 8, borderRadius: 4, width: `${b.percent}%`, backgroundColor: BROWN }}/></View>
              <Muted small>{`Page ${b.current_page} of ${b.total_pages} · ${b.percent}%${b.finish_forecast ? ` · done by ${b.finish_forecast}` : ""}`}</Muted></> : <Muted small>{`Page ${b.current_page}`}</Muted>}</View></Line></TouchableOpacity>
        {running ? <Btn title={`⏹ Stop · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}${tick < 0 ? "" : ""}`} onPress={() => stopTimer(b)}/>
          : <Line>{b.read_url ? <Btn title={b.is_folder ? "📁 Open folder" : "📄 Read e-book"} onPress={() => readEbook(b)} style={{ flex: 1 }}/>
            : <Btn title="📖 Read now" onPress={() => setTimer({ id: b.id, start: Date.now() })} style={{ flex: 1 }}/>}
            <Btn kind="outline" title="+10 p" onPress={() => progress(b, { pages: 10 })}/><Btn kind="outline" title="+25 p" onPress={() => progress(b, { pages: 25 })}/></Line>}
      </Card>; })}
    {!reading.length && <Empty>Nothing on the go. Add a book or start one from your shelf.</Empty>}

    <Line>{(["want", "finished", "paused"] as const).map(s => <TouchableOpacity key={s} onPress={() => setShelf(s)} style={[chip(shelf === s), { flex: 1, alignItems: "center" }]}>
      <Text style={{ color: shelf === s ? BROWN : C.muted, fontWeight: "800" }}>{`${s === "want" ? "📚 Want" : s === "finished" ? "✅ Finished" : "⏸ Paused"} · ${books.filter(b => b.status === s).length}`}</Text></TouchableOpacity>)}</Line>
    {books.filter(b => b.status === shelf).map(b => <TouchableOpacity key={b.id} onPress={() => { setOpen(b); setTake(b.takeaways || ""); setAi(""); }}>
      <Card style={{ padding: 10 }}><Line><Cover url={b.cover_url} title={b.title} size={40}/><View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }} numberOfLines={1}>{b.title}</Text>
        <Muted small>{`${b.author}${b.rating ? ` · ${"★".repeat(b.rating)}` : ""}${b.finished_on ? ` · ${b.finished_on}` : ""}`}</Muted></View>
        {shelf === "want" && <TouchableOpacity onPress={() => patch(b, { status: "reading" })} style={chip(true)}><Text style={{ color: BROWN, fontWeight: "800" }}>Start</Text></TouchableOpacity>}</Line></Card></TouchableOpacity>)}

    {(v.suggestions as Row[]).length > 0 && <Card><Kicker>BOOKS FOR YOUR GOALS</Kicker>{(v.suggestions as Row[]).map(s => <Line key={s.title}>
      <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{s.title}</Text><Muted small>{`${s.author} · ${s.why}`}</Muted></View>
      <TouchableOpacity onPress={() => add(s, "want")} style={chip(false)}><Text style={{ color: BROWN, fontWeight: "900" }}>＋</Text></TouchableOpacity></Line>)}</Card>}

    {adding && <Sheet title="＋ Add a book" onClose={() => setAdding(false)}>
      <Line><TextInput style={[input, { flex: 1 }]} value={q} onChangeText={setQ} placeholder="Search title or author" placeholderTextColor={C.muted} returnKeyType="search"
        onSubmitEditing={() => void api<Row>(`/reading/search?q=${encodeURIComponent(q)}`).then(x => setFound(x.items)).catch(e => onError(msg(e)))}/>
        <Btn title="🔎" disabled={q.trim().length < 2} onPress={() => void api<Row>(`/reading/search?q=${encodeURIComponent(q)}`).then(x => setFound(x.items)).catch(e => onError(msg(e)))}/></Line>
      {found && !found.length && <Muted>No results (or you're offline). Add it by hand below.</Muted>}
      {(found || []).map((b, i) => <Card key={i} style={{ padding: 10 }}><Line style={{ alignItems: "flex-start" }}><Cover url={b.cover_url} title={b.title} size={44}/>
        <View style={{ flex: 1 }}><Text style={{ color: C.text, fontWeight: "800" }}>{b.title}</Text><Muted small>{`${b.author || "Unknown"}${b.year ? ` · ${b.year}` : ""}${b.pages ? ` · ${b.pages} pages` : ""}`}</Muted>
          <Line><TouchableOpacity onPress={() => add(b, "reading")} style={chip(true)}><Text style={{ color: BROWN, fontWeight: "800" }}>📖 Reading</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => add(b, "want")} style={chip(false)}><Text style={{ color: C.muted, fontWeight: "800" }}>Want</Text></TouchableOpacity></Line></View></Line></Card>)}
      <Kicker>OR ADD BY HAND</Kicker>
      <TextInput style={input} value={manual.title} onChangeText={t => setManual({ ...manual, title: t })} placeholder="Title" placeholderTextColor={C.muted}/>
      <Line><TextInput style={[input, { flex: 2 }]} value={manual.author} onChangeText={t => setManual({ ...manual, author: t })} placeholder="Author" placeholderTextColor={C.muted}/>
        <TextInput style={[input, { flex: 1 }]} value={manual.pages} onChangeText={t => setManual({ ...manual, pages: t })} placeholder="Pages" placeholderTextColor={C.muted} keyboardType="number-pad"/></Line>
      <TextInput style={input} value={manual.link} onChangeText={t => setManual({ ...manual, link: t })} placeholder="📎 Google Drive link to the PDF (optional)" placeholderTextColor={C.muted} autoCapitalize="none"/>
      <Btn title="Add" disabled={!manual.title.trim()} onPress={() => add({ title: manual.title.trim(), author: manual.author.trim(), pages: Number(manual.pages) || undefined, file_url: manual.link.trim() || undefined }, "reading")}/>
      <Muted small>E-book in Google Drive: open it in Drive → Share → “Anyone with the link” → Copy link, then paste it here. It opens in a reader inside Sakuna.</Muted>
      <Muted small>Search uses Open Library (free and open): real titles, page counts and covers.</Muted>
    </Sheet>}

    {open && <Sheet title={open.title} onClose={() => setOpen(null)}>
      {open._minutes && <Card accent><Text style={{ color: C.text, fontWeight: "800" }}>{`You read ${open._minutes} minutes. Which page did you reach?`}</Text>
        <Line>{[10, 20, 30].map(n => <Btn key={n} kind="outline" title={`p ${open.current_page + n}`} onPress={() => { progress(open, { to_page: open.current_page + n, minutes: open._minutes }); setOpen(null); }}/>)}</Line></Card>}
      <Line><Cover url={open.cover_url} title={open.title} size={70}/><View style={{ flex: 1, gap: 4 }}><Muted>{open.author}</Muted>
        {open.total_pages && <Muted small>{`${open.current_page}/${open.total_pages} pages · ${open.percent}%`}</Muted>}
        <Line>{[1, 2, 3, 4, 5].map(n => <TouchableOpacity key={n} onPress={() => patch(open, { rating: n })}><Text style={{ fontSize: 26, color: n <= (open.rating || 0) ? C.amber : C.line }}>★</Text></TouchableOpacity>)}</Line></View></Line>
      <Line>{(["reading", "paused", "finished"] as const).map(s => <TouchableOpacity key={s} onPress={() => patch(open, { status: s })} style={[chip(open.status === s), { flex: 1, alignItems: "center" }]}>
        <Text style={{ color: open.status === s ? BROWN : C.muted, fontWeight: "800", textTransform: "capitalize" }}>{s}</Text></TouchableOpacity>)}</Line>
      {open.read_url && <Btn title={open.is_folder ? "📁 Open the Drive folder" : "📄 Read e-book"} onPress={() => readEbook(open)}/>}
      <Line><TextInput style={[input, { flex: 1 }]} value={link} onChangeText={setLink} placeholder={open.file_url ? "Change e-book link" : "📎 Paste Google Drive link (PDF)"} placeholderTextColor={C.muted} autoCapitalize="none"/>
        <Btn kind="outline" title="Save" disabled={!link.trim()} onPress={() => { patch(open, { file_url: link.trim() }); setLink(""); }}/></Line>
      {open.file_url && <Btn kind="link" title="Remove e-book link" onPress={() => patch(open, { file_url: "" })}/>}
      <Line><TextInput style={[input, { flex: 1 }]} keyboardType="number-pad" placeholder="Page reached" placeholderTextColor={C.muted} onSubmitEditing={e => progress(open, { to_page: Number(e.nativeEvent.text) || 0 })}/></Line>
      <Kicker>{`HIGHLIGHTS · ${(open.highlights as Row[]).length}`}</Kicker>
      {(open.highlights as Row[]).map((h, i) => <TouchableOpacity key={i} onLongPress={() => void api<Row>(`/reading/books/${open.id}/highlights/${i}`, "DELETE").then(x => setOpen({ ...open, ...x }))}>
        <View style={{ borderLeftWidth: 3, borderLeftColor: BROWN, paddingLeft: 10 }}><Text style={{ color: C.text, fontStyle: "italic", lineHeight: 21 }}>{`“${h.quote}”`}</Text>
          <Muted small>{`${h.page != null ? `p. ${h.page}` : ""}${h.note ? ` · ${h.note}` : ""}`}</Muted></View></TouchableOpacity>)}
      <TextInput style={[input, { minHeight: 60 }]} value={hl.quote} onChangeText={t => setHl({ ...hl, quote: t })} placeholder="A line worth remembering" placeholderTextColor={C.muted} multiline/>
      <Line><TextInput style={[input, { width: 90 }]} value={hl.page} onChangeText={t => setHl({ ...hl, page: t })} placeholder="Page" placeholderTextColor={C.muted} keyboardType="number-pad"/>
        <Btn title="＋ Save highlight" disabled={!hl.quote.trim()} onPress={() => void api<Row>(`/reading/books/${open.id}/highlights`, "POST", { quote: hl.quote.trim(), page: Number(hl.page) || undefined })
          .then(x => { setOpen({ ...open, ...x }); setHl({ quote: "", page: "" }); }).catch(e => onError(msg(e)))} style={{ flex: 1 }}/></Line>
      <Kicker>MY TAKEAWAYS</Kicker>
      <TextInput style={[input, { minHeight: 80 }]} value={take} onChangeText={setTake} placeholder="What will you do differently because of this book?" placeholderTextColor={C.muted} multiline/>
      <Line><Btn kind="outline" title="💾 Save" onPress={() => patch(open, { takeaways: take })} style={{ flex: 1 }}/>
        <Btn kind="outline" title="✨ AI summary" onPress={() => void api<Row>(`/reading/books/${open.id}/takeaways`, "POST").then(x => setAi(x.text)).catch(e => onError(msg(e)))} style={{ flex: 1 }}/></Line>
      {!!ai && <View style={{ backgroundColor: `${BROWN}18`, borderRadius: 12, padding: 10 }}><Text style={{ color: C.text, lineHeight: 21 }}>{ai}</Text></View>}
      <Btn kind="link" title="Find this book on Open Library" onPress={() => openInApp(`https://openlibrary.org/search?q=${encodeURIComponent(`${open.title} ${open.author}`)}`, open.title)}/>
      <Btn kind="danger" title="Remove from my shelf" onPress={() => Alert.alert(`Remove “${open.title}”?`, "Its highlights and reading log are deleted.", [{ text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void api(`/reading/books/${open.id}`, "DELETE").then(() => { setOpen(null); load(); }).catch(e => onError(msg(e))) }])}/>
    </Sheet>}
  </Screen>;
}
