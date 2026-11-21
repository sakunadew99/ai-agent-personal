/**
 * Keyboard handling for the whole app. Android 15+ draws apps edge-to-edge, so the window no longer shrinks when the
 * keyboard opens and inputs near the bottom were hidden. KbScroll keeps the focused input visible; useKeyboard tells
 * the app frame how tall the keyboard is.
 */
import React, { ReactNode, useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardEvent, Platform, ScrollView, ScrollViewProps, TextInput, View } from "react-native";

/** Current keyboard height (0 when closed). */
export function useKeyboard(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e: KeyboardEvent) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}

type Focusable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

/** A ScrollView that scrolls the focused text box above the keyboard (and leaves room under the last field). */
export function KbScroll({ children, contentContainerStyle, onScroll, ...rest }: ScrollViewProps & { children: ReactNode }) {
  const inner = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const kb = useKeyboard();
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => {
      const keyboardTop = e.endCoordinates.screenY;
      setTimeout(() => {
        const input = TextInput.State.currentlyFocusedInput?.() as unknown as Focusable | null;
        input?.measureInWindow?.((_x, y, _w, h) => {
          const overlap = y + h + 24 - keyboardTop;                      // how far the box is hidden behind the keyboard
          if (overlap > 0) inner.current?.scrollTo({ y: offset.current + overlap, animated: true });
        });
      }, 60);
    });
    return () => sub.remove();
  }, []);
  return <ScrollView ref={inner} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEventThrottle={32}
    onScroll={e => { offset.current = e.nativeEvent.contentOffset.y; onScroll?.(e); }}
    contentContainerStyle={contentContainerStyle} {...rest}>
    {children}
    {kb > 0 && <View style={{ height: kb * 0.6 }}/>}
  </ScrollView>;
}
