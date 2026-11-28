import React, { ReactNode, useState } from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { C } from "../ui";

/** One "Today's coach" card on Home instead of four AI cards: only the open tab loads. */
export function CoachTabs({ tabs }: { tabs: { key: string; label: string; node: ReactNode }[] }) {
  const [open, setOpen] = useState(tabs[0]?.key);
  return <View style={{ gap: 10 }}>
    <Text style={{ color: C.green, fontSize: 10, letterSpacing: 1.6, fontWeight: "800" }}>✨ TODAY'S COACH</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {tabs.map(t => <TouchableOpacity key={t.key} onPress={() => setOpen(t.key)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1,
        borderColor: open === t.key ? C.green : C.line, backgroundColor: open === t.key ? C.greenSoft : "transparent" }}>
        <Text style={{ color: open === t.key ? C.green : C.muted, fontWeight: "800" }}>{t.label}</Text></TouchableOpacity>)}
    </View>
    {tabs.find(t => t.key === open)?.node}
  </View>;
}
