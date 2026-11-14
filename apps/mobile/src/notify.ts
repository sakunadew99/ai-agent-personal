/**
 * Local phone reminders (Phase 3). Everything is scheduled on the device, so no push server or Firebase is needed.
 * The API decides *when* (due time minus a lead, moved out of your quiet hours); the phone only schedules it.
 */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { ApiRecord as Row } from "./api";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;

const TASK_PREFIX = "task-";
const FOCUS_ID = "focus-end";
const CHANNEL = "reminders";
const MAX_SCHEDULED = 50; // Android allows ~500 alarms per app; stay well below.
let configured = false;

async function ready(): Promise<boolean> {
  if (!configured) {
    configured = true;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: "Task reminders and focus timer", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250],
      });
    }
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function cancelWhere(match: (id: string) => boolean) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter(n => match(n.identifier)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

/** Replace all task reminders with the API's list for the next 7 days. Returns how many are scheduled (or -1 if not allowed). */
export async function syncReminders(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const data = await api<Row>("/reminders/upcoming?days=7&lead_minutes=10");
    const items: Row[] = Array.isArray(data.items) ? data.items : [];
    await cancelWhere(id => id.startsWith(TASK_PREFIX));
    let count = 0;
    for (const item of items.slice(0, MAX_SCHEDULED)) {
      const at = new Date(String(item.notify_at));
      if (at.getTime() <= Date.now() + 5000) continue;
      const due = new Date(String(item.due_at)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      await Notifications.scheduleNotificationAsync({
        identifier: `${TASK_PREFIX}${item.task_id}`,
        content: { title: String(item.title), body: item.moved_for_quiet_hours ? `Due ${due} (held until your quiet hours ended)` : `Due at ${due}`, data: { taskId: item.task_id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
      });
      count++;
    }
    return count;
  } catch {
    return 0; // Reminders are best-effort; the app keeps working without them.
  }
}

/** Alarm for the end of a focus block, so it rings even if the app is in the background. */
export async function scheduleFocusEnd(seconds: number) {
  try {
    if (seconds < 5 || !(await ready())) return;
    await cancelWhere(id => id === FOCUS_ID);
    await Notifications.scheduleNotificationAsync({
      identifier: FOCUS_ID,
      content: { title: "Focus block finished", body: "Nice work. Take a short break before the next one." },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + seconds * 1000), channelId: CHANNEL },
    });
  } catch { /* best-effort */ }
}

export async function cancelFocusEnd() {
  try { await cancelWhere(id => id === FOCUS_ID); } catch { /* best-effort */ }
}
