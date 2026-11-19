/**
 * Background sync while the app is closed: Android WorkManager wakes Sakuna about every 30 minutes (Android decides the
 * exact time, and skips it on low battery), reads Health Connect (Mi Fitness writes there) and saves anything new.
 * It also shows watchlist rule alerts. Needs Health Connect's "read in background" permission, asked for in Health.
 */
import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { AppState, Platform } from "react-native";
import { apiRequest, loadServerUrl, type ApiRecord as Row } from "../api";
import { notifyStockAlerts } from "../notify";
import { refreshAccess } from "../session";
import { syncHealthNow } from "./autosync";
import { getHealthConnectStatus } from "./health-connect";

export const HEALTH_TASK = "sakuna-health-sync";

TaskManager.defineTask(HEALTH_TASK, async () => {
  try {
    if (AppState.currentState === "active") return BackgroundTask.BackgroundTaskResult.Success;   // the open app syncs itself
    await loadServerUrl();
    const token = await refreshAccess();         // signed out or offline: try again next time
    if (!token) return BackgroundTask.BackgroundTaskResult.Success;
    const api = <T = Row>(path: string, method = "GET", body?: unknown) => apiRequest<T>(path, token, method, body);
    const status = await getHealthConnectStatus();
    if (status.connected) await syncHealthNow(api);
    await notifyStockAlerts(api);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Turn the background job on (safe to call every start; Android keeps a single job). */
export async function enableBackgroundSync(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(HEALTH_TASK))) await BackgroundTask.registerTaskAsync(HEALTH_TASK, { minimumInterval: 30 });
    return true;
  } catch { return false; }
}

export async function disableBackgroundSync() {
  try { if (await TaskManager.isTaskRegisteredAsync(HEALTH_TASK)) await BackgroundTask.unregisterTaskAsync(HEALTH_TASK); } catch { /* not registered */ }
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
