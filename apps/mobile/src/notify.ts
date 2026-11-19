/**
 * Local phone reminders (Phase 3). Everything is scheduled on the device, so no push server or Firebase is needed.
 * The API decides *when* (due time minus a lead, moved out of your quiet hours); the phone only schedules it.
 */
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
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

const ROUTINE_PREFIX = "routine-";

/** Phone reminders when each routine starts, for the next 7 days (replaced on every sync). */
export async function syncRoutineReminders(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    await cancelWhere(id => id.startsWith(ROUTINE_PREFIX));
    let count = 0;
    const today = new Date();
    for (let n = 0; n < 7 && count < MAX_SCHEDULED; n++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 12);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const view = await api<Row>(`/routines/today?day=${day}`);
      for (const r of ((view.items || []) as Row[]).filter(i => i.kind === "routine" && i.starts && i.status === "open")) {
        const [h, m] = String(r.starts).split(":").map(Number);
        const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
        if (at.getTime() <= Date.now() + 5000) continue;
        const short = (r.steps as Row[]).filter(s => s.essential).length;
        await Notifications.scheduleNotificationAsync({
          identifier: `${ROUTINE_PREFIX}${r.id}-${day}`,
          content: { title: `${r.icon} ${r.name}`, body: `${(r.steps as Row[]).length} steps · busy? the short version is ${short} steps`, data: { routineId: r.id, day } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
        });
        count++;
      }
    }
    return count;
  } catch {
    return 0; // best-effort
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

const HABIT_PREFIX = "habit-";

/** Habit reminders at each habit's reminder time for the next 7 days (skips today once it's done). Replaced on every sync. */
export async function syncHabitReminders(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const [habits, overview] = await Promise.all([api<Row[]>("/habits"), api<Row>("/life/overview").catch(() => ({} as Row))]);
    const doneToday = new Set(((overview.habits || []) as Row[]).filter(h => h.done_today).map(h => String(h.id)));
    await cancelWhere(id => id.startsWith(HABIT_PREFIX));
    let count = 0;
    const today = new Date();
    for (const h of habits.filter(x => x.reminder_time)) {
      const [hh, mm] = String(h.reminder_time).split(":").map(Number);
      for (let n = 0; n < 7 && count < MAX_SCHEDULED; n++) {
        if (n === 0 && doneToday.has(String(h.id))) continue;
        const at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, hh, mm);
        if (at.getTime() <= Date.now() + 5000) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: `${HABIT_PREFIX}${h.id}-${n}`,
          content: { title: `${h.icon || "🔁"} ${h.name}`, body: h.kind === "avoid" ? "Stay strong today. Open Sakuna to log a clean day." : "Time for your habit. Tap ✓ in Sakuna when it's done.", data: { habitId: h.id } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
        });
        count++;
      }
    }
    return count;
  } catch {
    return 0; // best-effort
  }
}

const CHECKIN_PREFIX = "checkin-";
export const CHECKIN_CATEGORY = "hour-checkin";
export const CHECKIN_ACTIONS: [string, string][] = [["work", "💼 Work"], ["study", "📚 Study"], ["wasted", "📱 Wasted"]];

/** Hourly "what did you do?" reminders (8:00-21:00, every day) and the 21:30 day report. Answer from the notification. */
export async function scheduleHourlyCheckins(on: boolean): Promise<number> {
  try {
    if (!(await ready())) return -1;
    await cancelWhere(id => id.startsWith(CHECKIN_PREFIX));
    if (!on) return 0;
    await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY, [
      ...CHECKIN_ACTIONS.map(([id, title]) => ({ identifier: id, buttonTitle: title, options: { opensAppToForeground: false } })),
      { identifier: "open", buttonTitle: "Other…", options: { opensAppToForeground: true } },
    ]);
    let count = 0;
    for (let h = 9; h <= 21; h++) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${CHECKIN_PREFIX}${h}`,
        content: { title: `⏱ ${String(h - 1).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:00`, body: "What did you do this hour? Tap a button, or open Sakuna for more.",
          categoryIdentifier: CHECKIN_CATEGORY, data: { kind: "checkin", hour: h - 1 } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: 0, channelId: CHANNEL },
      });
      count++;
    }
    await Notifications.scheduleNotificationAsync({
      identifier: `${CHECKIN_PREFIX}report`,
      content: { title: "📋 Your day report is ready", body: "See where the time went, and what to change tomorrow.", data: { kind: "report" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 30, channelId: CHANNEL },
    });
    return count + 1;
  } catch {
    return 0;
  }
}

const SEEN_ALERTS = "sakuna.seenStockAlerts";

/** Your own watchlist rules (buy below, stop-loss, take-profit) that fired after the daily CSE close, shown as phone notifications once each. */
export async function notifyStockAlerts(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const v = await api<Row>("/invest");
    const fresh: Row[] = (Array.isArray(v.alerts) ? v.alerts : []).filter((a: Row) => a.status === "new");
    const seen: string[] = JSON.parse((await SecureStore.getItemAsync(SEEN_ALERTS)) || "[]");
    const todo = fresh.filter(a => !seen.includes(String(a.id))).slice(0, 5);
    for (const a of todo) {
      await Notifications.scheduleNotificationAsync({
        content: { title: `📈 ${String(a.symbol).split(".")[0]}: your rule fired`, body: `${a.message} (not advice; decide yourself)` },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: CHANNEL },
      });
    }
    if (todo.length) await SecureStore.setItemAsync(SEEN_ALERTS, JSON.stringify([...todo.map(a => String(a.id)), ...seen].slice(0, 100)));
    return todo.length;
  } catch { return 0; }
}
