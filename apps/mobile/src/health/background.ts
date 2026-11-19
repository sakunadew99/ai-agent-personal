/**
 * Background sync while the app is closed: Android WorkManager wakes Sakuna about every 30 minutes (Android decides the
 * exact time, and skips it on low battery), reads Health Connect (Mi Fitness writes there) and saves anything new.
 * It also shows watchlist rule alerts. Needs Health Connect's "read in background" permission, asked for in Health.
 *
 * Every native call here is loaded lazily and guarded: if the background modules are missing or fail, the app still
 * starts and simply syncs when opened.
 */
import { AppState, Platform } from "react-native";
import { apiRequest, loadServerUrl, type ApiRecord as Row } from "../api";
import { notifyStockAlerts } from "../notify";
import { refreshAccess } from "../session";
import { syncHealthNow } from "./autosync";
import { getHealthConnectStatus } from "./health-connect";

export const HEALTH_TASK = "sakuna-health-sync";
type BT = typeof import("expo-background-task");
type TM = typeof import("expo-task-manager");

function mods(): { BackgroundTask: BT; TaskManager: TM } | null {
  if (Platform.OS !== "android") return null;
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return { BackgroundTask: require("expo-background-task") as BT, TaskManager: require("expo-task-manager") as TM };
  } catch { return null; }
}

/** Must run when the JS bundle loads (also in the headless background run), so it is called at module level below. */
function defineTask() {
  const m = mods();
  if (!m) return;
  try {
    if (m.TaskManager.isTaskDefined(HEALTH_TASK)) return;
    m.TaskManager.defineTask(HEALTH_TASK, async () => {
      const ok = m.BackgroundTask.BackgroundTaskResult.Success, failed = m.BackgroundTask.BackgroundTaskResult.Failed;
      try {
        if (AppState.currentState === "active") return ok;   // the open app syncs itself
        await loadServerUrl();
        const token = await refreshAccess();                 // signed out or offline: try again next time
        if (!token) return ok;
        const api = <T = Row>(path: string, method = "GET", body?: unknown) => apiRequest<T>(path, token, method, body);
        const status = await getHealthConnectStatus();
        if (status.connected) await syncHealthNow(api);
        await notifyStockAlerts(api);
        return ok;
      } catch { return failed; }
    });
  } catch { /* background sync unavailable on this build */ }
}
defineTask();

/** Turn the background job on (safe to call every start; Android keeps a single job). */
export async function enableBackgroundSync(): Promise<boolean> {
  const m = mods();
  if (!m) return false;
  try {
    if ((await m.BackgroundTask.getStatusAsync()) !== m.BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await m.TaskManager.isTaskRegisteredAsync(HEALTH_TASK))) await m.BackgroundTask.registerTaskAsync(HEALTH_TASK, { minimumInterval: 30 });
    return true;
  } catch { return false; }
}

export async function disableBackgroundSync() {
  const m = mods();
  try { if (m && await m.TaskManager.isTaskRegisteredAsync(HEALTH_TASK)) await m.BackgroundTask.unregisterTaskAsync(HEALTH_TASK); } catch { /* not registered */ }
}

/** Ask Health Connect for "read data in the background" (Android 14+ / recent Health Connect). */
export async function requestBackgroundHealth(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const hc = await import("react-native-health-connect");
    await hc.initialize();
    const granted = await hc.requestPermission([{ accessType: "read", recordType: "BackgroundAccessPermission" }]);
    return granted.some(p => p.recordType === "BackgroundAccessPermission");
  } catch { return false; }
}

export async function hasBackgroundHealth(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const hc = await import("react-native-health-connect");
    await hc.initialize();
    return (await hc.getGrantedPermissions()).some(p => p.recordType === "BackgroundAccessPermission");
  } catch { return false; }
}
