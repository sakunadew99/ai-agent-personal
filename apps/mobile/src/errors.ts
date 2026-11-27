/** A small on-phone log of the last errors you saw (screen, time, message), for the "Problem report" in Settings. */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "sakuna.errorLog";
type Entry = { at: string; where: string; message: string };

export async function logError(message: string, where: string) {
  try {
    const cur: Entry[] = JSON.parse((await SecureStore.getItemAsync(KEY)) || "[]");
    const next = [{ at: new Date().toISOString(), where: where.slice(0, 40), message: message.slice(0, 300) }, ...cur].slice(0, 20);
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
  } catch { /* the log is a convenience */ }
}

export async function errorReport(): Promise<string> {
  let list: Entry[] = [];
  try { list = JSON.parse((await SecureStore.getItemAsync(KEY)) || "[]"); } catch { /* none */ }
  const head = `Sakuna problem report\nPhone: ${Platform.OS} ${String(Platform.Version)}\nTime: ${new Date().toISOString()}\n`;
  return head + (list.length ? list.map(e => `\n[${e.at}] ${e.where}: ${e.message}`).join("") : "\nNo errors recorded. 🎉");
}

export async function clearErrors() { try { await SecureStore.deleteItemAsync(KEY); } catch { /* ignore */ } }
