import React, { useEffect, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { ACCENTS, LANGS, MODES, TEXT_SIZES, build, setTheme, subscribe, theme, type Accent, type Lang, type Mode, type TextSize } from "../theme";
import { Btn, C, Card, Kicker, Muted, Screen } from "../ui";

/** Appearance: light / dark / AMOLED / follow the phone, plus an accent colour. Applies instantly and is remembered. */
export function AppearanceScreen() {
  const [t, setT] = useState(theme());
  useEffect(() => subscribe(() => setT(theme())), []);
  const preview = (m: Mode, a: Accent) => build(m, a);
  return <Screen>
    <Card style={{ gap: 10 }}>
      <Kicker>MODE</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{(Object.keys(MODES) as Mode[]).map(m => { const p = preview(m, t.accent); const on = t.mode === m;
        return <TouchableOpacity key={m} onPress={() => setTheme({ mode: m })} style={{ width: "47%", borderRadius: 18, padding: 12, gap: 8, backgroundColor: p.bg,
          borderWidth: on ? 3 : 1, borderColor: on ? C.green : C.line }}>
          <View style={{ height: 14, width: "70%", borderRadius: 7, backgroundColor: p.panel2 }}/>
          <View style={{ flexDirection: "row", gap: 6 }}><View style={{ height: 26, flex: 1, borderRadius: 8, backgroundColor: p.green }}/><View style={{ height: 26, flex: 1, borderRadius: 8, backgroundColor: p.panel }}/></View>
          <Text style={{ color: p.text, fontWeight: "800" }}>{MODES[m]}</Text>
        </TouchableOpacity>; })}</View>
      <Muted small>System follows your phone's light/dark setting automatically. AMOLED black saves battery on OLED screens.</Muted>
    </Card>
    <Card style={{ gap: 10 }}>
      <Kicker>ACCENT COLOUR</Kicker>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{(Object.keys(ACCENTS) as Accent[]).map(a => { const col = t.resolved === "light" ? ACCENTS[a].light : ACCENTS[a].dark; const on = t.accent === a;
        return <TouchableOpacity key={a} onPress={() => setTheme({ accent: a })} style={{ alignItems: "center", gap: 4, width: 64 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: col, borderWidth: on ? 4 : 0, borderColor: C.text, alignItems: "center", justifyContent: "center" }}>
            {on && <Text style={{ color: t.resolved === "light" ? "#fff" : "#000", fontWeight: "900" }}>✓</Text>}</View>
          <Text style={{ color: on ? C.text : C.muted, fontSize: 11, fontWeight: "700" }}>{ACCENTS[a].name}</Text></TouchableOpacity>; })}</View>
    </Card>
    <Card style={{ gap: 10 }}>
      <Kicker>TEXT SIZE</Kicker>
      <View style={{ flexDirection: "row", gap: 8 }}>{(Object.keys(TEXT_SIZES) as TextSize[]).map(k => <TouchableOpacity key={k} onPress={() => setTheme({ text: k })}
        style={{ flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 14, backgroundColor: t.text === k ? C.green : C.panel2 }}>
        <Text style={{ color: t.text === k ? C.greenDark : C.text, fontWeight: "800", fontSize: 12 * TEXT_SIZES[k].scale }}>Aa</Text>
        <Text style={{ color: t.text === k ? C.greenDark : C.muted, fontSize: 10 }}>{TEXT_SIZES[k].label}</Text></TouchableOpacity>)}</View>
      <Kicker>LANGUAGE</Kicker>
      <View style={{ flexDirection: "row", gap: 8 }}>{(Object.keys(LANGS) as Lang[]).map(k => <TouchableOpacity key={k} onPress={() => setTheme({ lang: k })}
        style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 14, backgroundColor: t.lang === k ? C.green : C.panel2 }}>
        <Text style={{ color: t.lang === k ? C.greenDark : C.text, fontWeight: "900" }}>{LANGS[k]}</Text></TouchableOpacity>)}</View>
      <Muted small>සිංහල: menus, screen titles, buttons and settings switch to Sinhala; detailed text inside some screens stays in English for now. Your own notes and tasks are never changed.</Muted>
    </Card>
    <Card style={{ gap: 10 }} accent>
      <Kicker>PREVIEW</Kicker>
      <Text style={{ color: C.text, fontSize: 18, fontWeight: "900" }}>Good morning 👋</Text>
      <Text style={{ color: C.muted }}>Buttons, rings, charts and highlights use your accent colour.</Text>
      <View style={{ height: 10, borderRadius: 5, backgroundColor: C.line }}><View style={{ width: "68%", height: 10, borderRadius: 5, backgroundColor: C.green }}/></View>
      <Btn title="Primary button" onPress={() => undefined}/><Btn kind="outline" title="Outline button" onPress={() => undefined}/>
    </Card>
    <Muted small>A few colours inside some screens refresh fully the next time you open the app.</Muted>
  </Screen>;
}
