import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { getHealthConnectStatus, readRecentHealth, readTodayHealth, type TodayHealth } from "./health-connect";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
export const LAST_SYNC = "sakuna.lastHealthSync";
const EVERY_MS = 30 * 60 * 1000;
let running = false;

/** Read the last 7 days from Health Connect (Mi Fitness writes there) and save them in one call: one value per day is
 *  updated, never duplicated, so missed days are filled in. Returns today's numbers for the screen. */
export async function syncHealthNow(api: Api): Promise<{ saved: number; today: TodayHealth }> {
  const [today, recent] = await Promise.all([readTodayHealth(), readRecentHealth(7)]);
  const out = await api<Row>("/health/sync", "POST", { days: recent.days.filter(d => d.steps !== null || d.heart_rate_avg !== null), sleep: recent.sleep.slice(0, 31) });
  await SecureStore.setItemAsync(LAST_SYNC, String(Date.now())).catch(() => undefined);
  return { saved: Number(out.saved || 0) + Number(out.updated || 0), today };
}

/** Quiet automatic sync: when the app opens or comes back, at most every 30 minutes, only if Health Connect is connected. */
export async function autoSyncHealth(api: Api): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const last = Number(await SecureStore.getItemAsync(LAST_SYNC).catch(() => null)) || 0;
    if (Date.now() - last < EVERY_MS) return 0;
    const status = await getHealthConnectStatus();
    if (!status.connected) return 0;
    return (await syncHealthNow(api)).saved;
  } catch { return 0; } finally { running = false; }
}
