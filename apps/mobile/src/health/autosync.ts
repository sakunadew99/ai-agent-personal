import * as SecureStore from "expo-secure-store";
import type { ApiRecord as Row } from "../api";
import { getHealthConnectStatus, readTodayHealth, type TodayHealth } from "./health-connect";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;
export const LAST_SYNC = "sakuna.lastHealthSync";
const EVERY_MS = 30 * 60 * 1000;
let running = false;

/** Read today's steps, heart rate and last sleep from Health Connect (Mi Fitness writes there) and save anything new. */
export async function syncHealthNow(api: Api): Promise<{ saved: number; today: TodayHealth }> {
  const today = await readTodayHealth();
  const current = await api<Row>("/health/summary");
  const records: Row[] = Array.isArray(current.records) ? current.records : [];
  const sleeps: Row[] = Array.isArray(current.sleep) ? current.sleep : [];
  const savedToday = (metric: string, value: number) => records.some(r => r.metric === metric && r.source === "health_connect" && Number(r.value) === value
    && new Date(r.recorded_at).toDateString() === new Date().toDateString());
  let saved = 0;
  if (today.steps && !savedToday("steps", today.steps.value)) { await api("/health/records", "POST", { metric: "steps", value: today.steps.value, unit: "steps", recorded_at: today.steps.recordedAt, source: "health_connect" }); saved++; }
  if (today.heartRate && !savedToday("heart_rate", today.heartRate.value)) { await api("/health/records", "POST", { metric: "heart_rate", value: today.heartRate.value, unit: "bpm", recorded_at: today.heartRate.recordedAt, source: "health_connect" }); saved++; }
  if (today.sleep && !sleeps.some(r => r.source === "health_connect" && new Date(r.start_at).getTime() === new Date(today.sleep!.startAt).getTime())) {
    await api("/health/sleep", "POST", { start_at: today.sleep.startAt, end_at: today.sleep.endAt, stages: { stage_codes: today.sleep.stages }, source: "health_connect" }); saved++;
  }
  await SecureStore.setItemAsync(LAST_SYNC, String(Date.now())).catch(() => undefined);
  return { saved, today };
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
