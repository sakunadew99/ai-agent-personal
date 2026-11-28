/**
 * Local phone reminders (Phase 3). Everything is scheduled on the device, so no push server or Firebase is needed.
 * The API decides *when* (due time minus a lead, moved out of your quiet hours); the phone only schedules it.
 */
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { ApiRecord as Row } from "./api";
import { tr } from "./i18n";

type Api = <T = Row>(path: string, method?: string, body?: unknown) => Promise<T>;

const TASK_PREFIX = "task-";
const FOCUS_ID = "focus-end";
const CHANNEL = "reminders";
const MAX_SCHEDULED = 50; // Android allows ~500 alarms per app; stay well below.
let configured = false;
export const TASK_CATEGORY = "task-reminder";
export const HABIT_CATEGORY = "habit-reminder";
export const APPROVAL_CATEGORY = "approval";

/** Buttons shown on notifications. opensAppToForeground: false = the action runs without opening Sakuna. */
async function setupCategories() {
  await Notifications.setNotificationCategoryAsync(TASK_CATEGORY, [
    { identifier: "task_done", buttonTitle: "✓ Done", options: { opensAppToForeground: false } },
    { identifier: "task_snooze", buttonTitle: "⏰ +1 hour", options: { opensAppToForeground: false } },
  ]);
  await Notifications.setNotificationCategoryAsync(HABIT_CATEGORY, [
    { identifier: "habit_done", buttonTitle: "✓ Done", options: { opensAppToForeground: false } },
  ]);
  await Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [
    { identifier: "approve", buttonTitle: "✓ Approve", options: { opensAppToForeground: false } },
    { identifier: "reject", buttonTitle: "✕ Reject", options: { opensAppToForeground: false, isDestructive: true } },
  ]);
}

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
    await setupCategories().catch(() => undefined);
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
        content: { title: String(item.title), body: item.moved_for_quiet_hours ? `Due ${due} (held until your quiet hours ended)` : `Due at ${due}`,
          categoryIdentifier: TASK_CATEGORY, data: { kind: "task", taskId: item.task_id } },
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
          content: { title: `${h.icon || "🔁"} ${h.name}`, body: h.kind === "avoid" ? "Stay strong today. Open Sakuna to log a clean day." : "Time for your habit. Tap ✓ Done when it's done.", categoryIdentifier: HABIT_CATEGORY, data: { kind: "habit", habitId: h.id } },
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

const MED_PREFIX = "med-";

/** Medicine dose reminders for the next 2 days (doses already marked are skipped). Replaced on every sync. */
export async function syncMedicineReminders(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const data = await api<Row>("/medicines/reminders?days=2");
    const items: Row[] = Array.isArray(data.items) ? data.items : [];
    await cancelWhere(id => id.startsWith(MED_PREFIX));
    let n = 0;
    for (const m of items.slice(0, 40)) {
      const at = new Date(String(m.at));
      if (at.getTime() <= Date.now() + 5000) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${MED_PREFIX}${m.id}`,
        content: { title: `💊 ${m.name}${m.dose ? ` · ${m.dose}` : ""}`, body: `Time for your ${m.slot} dose${m.with_food ? " (with food)" : ""}. Open Sakuna to mark it taken.`, data: { medicine: m.medicine_id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
      });
      n++;
    }
    return n;
  } catch { return 0; }
}


const WATER_PREFIX = "water-";
export const WATER_CATEGORY = "water-reminder";

/** "Time for water" every 2 hours, 10:00-20:00, with a +250 ml button that logs without opening the app. */
export async function scheduleWaterReminders(on: boolean): Promise<number> {
  try {
    if (!(await ready())) return -1;
    await cancelWhere(id => id.startsWith(WATER_PREFIX));
    if (!on) return 0;
    await Notifications.setNotificationCategoryAsync(WATER_CATEGORY, [
      { identifier: "water250", buttonTitle: "💧 +250 ml", options: { opensAppToForeground: false } },
      { identifier: "water500", buttonTitle: "+500 ml", options: { opensAppToForeground: false } },
    ]);
    let n = 0;
    for (const h of [10, 12, 14, 16, 18, 20]) {
      await Notifications.scheduleNotificationAsync({
        identifier: `${WATER_PREFIX}${h}`,
        content: { title: "💧 Water time", body: "A glass now keeps energy and focus up. Tap +250 ml when you've had it.", categoryIdentifier: WATER_CATEGORY, data: { kind: "water" } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: h, minute: 5, channelId: CHANNEL },
      });
      n++;
    }
    return n;
  } catch { return 0; }
}


const APPROVAL_SEEN = "sakuna.seenApprovals";

/** New pending approvals (plan check, MCP tools, assistant) as notifications with Approve / Reject buttons. */
export async function notifyApprovals(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const rows = (await api<Row[]>("/approvals")).filter(r => r.status === "pending");
    const seen: string[] = JSON.parse((await SecureStore.getItemAsync(APPROVAL_SEEN)) || "[]");
    const fresh = rows.filter(r => !seen.includes(String(r.id))).slice(0, 5);
    for (const r of fresh) {
      const body = String(r.payload?.preview || `${String(r.tool_name).replace(/_/g, " ")}: ${JSON.stringify(r.payload?.body || {}).slice(0, 120)}`);
      await Notifications.scheduleNotificationAsync({
        identifier: `approval-${r.id}`,
        content: { title: "🛡 Sakuna wants your OK", body, categoryIdentifier: APPROVAL_CATEGORY, data: { kind: "approval", approvalId: r.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: CHANNEL },
      });
    }
    if (fresh.length) await SecureStore.setItemAsync(APPROVAL_SEEN, JSON.stringify([...fresh.map(r => String(r.id)), ...seen].slice(0, 200)));
    return fresh.length;
  } catch { return 0; }
}

const DAILY_PREFIX = "daily-";
const WEEKLY: Record<string, [string, string, string]> = {   // key: title, body, kind
  weekly: ["🗓 Your week in review", "Score, wins and one change for next week. Takes 1 minute.", "report_week"],
  backup: ["💾 Weekly backup", "Export your Sakuna data to keep a copy safe.", "backup"],
};
const DAILY_TEXT: Record<string, [string, string]> = {
  morning: ["🌅 Good morning", "Your brief is ready: sleep, first task, water and today's affirmation."],
  night: ["🌙 Night review", "Fill in today's hours, note 3 good things, and put the phone away."],
  affirmation: ["✨ Your affirmation", "Take 20 seconds to read today's affirmation and picture one action."],
};

/** Morning brief, night review and affirmation prompts at your chosen times (every day). */
export async function scheduleDailyPrompts(notify: Row): Promise<number> {
  try {
    if (!(await ready())) return -1;
    await cancelWhere(id => id.startsWith(DAILY_PREFIX));
    let n = 0;
    for (const key of Object.keys(DAILY_TEXT)) {
      const cfg = notify?.[key];
      if (!cfg?.on || !cfg.time) continue;
      const [hh, mm] = String(cfg.time).split(":").map(Number);
      await Notifications.scheduleNotificationAsync({
        identifier: `${DAILY_PREFIX}${key}`,
        content: { title: tr(DAILY_TEXT[key][0]), body: tr(DAILY_TEXT[key][1]), data: { kind: "brief", brief: key } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: hh, minute: mm, channelId: CHANNEL },
      });
      n++;
    }
    for (const key of Object.keys(WEEKLY)) {                        // Sunday (weekday 1 in Expo's calendar)
      const cfg = notify?.[key];
      if (!cfg?.on || !cfg.time) continue;
      const [hh, mm] = String(cfg.time).split(":").map(Number);
      await Notifications.scheduleNotificationAsync({
        identifier: `${DAILY_PREFIX}${key}`,
        content: { title: tr(WEEKLY[key][0]), body: tr(WEEKLY[key][1]), data: { kind: WEEKLY[key][2] } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: 1, hour: hh, minute: mm, channelId: CHANNEL },
      });
      n++;
    }
    return n;
  } catch { return 0; }
}

/** Apply the notification centre: turn each reminder family on or off on this phone. */
export async function applyNotificationPrefs(api: Api, notify: Row): Promise<void> {
  const on = (k: string) => !!notify?.[k]?.on;
  await scheduleHourlyCheckins(on("checkins"));
  if (on("water")) await scheduleWaterSmart(api); else await scheduleWaterReminders(false);
  if (on("tasks")) await syncReminders(api); else await cancelWhere(id => id.startsWith(TASK_PREFIX)).catch(() => undefined);
  if (on("habits")) await syncHabitReminders(api); else await cancelWhere(id => id.startsWith(HABIT_PREFIX)).catch(() => undefined);
  if (on("medicines")) await syncMedicineReminders(api); else await cancelWhere(id => id.startsWith(MED_PREFIX)).catch(() => undefined);
  await scheduleDailyPrompts(notify);
  await SecureStore.setItemAsync("sakuna.notifyPrefs", JSON.stringify(notify)).catch(() => undefined);
}

/** The notification centre saved on this phone (used before the API answers). */
export async function savedNotifyPrefs(): Promise<Row | null> {
  try { return JSON.parse((await SecureStore.getItemAsync("sakuna.notifyPrefs")) || "null"); } catch { return null; }
}

/** Is the phone allowing notifications? */
export async function notificationsAllowed(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).granted; } catch { return false; }
}


/**
 * Smart water reminders for the next 24 hours (re-planned every time Sakuna opens): a reminder only for the 2-hourly
 * slots where you'd be behind your own pace (your target spread over the waking day). Already on track = no ping.
 */
export async function scheduleWaterSmart(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    const w = await api<Row>("/water");
    await cancelWhere(id => id.startsWith(WATER_PREFIX));
    await Notifications.setNotificationCategoryAsync(WATER_CATEGORY, [
      { identifier: "water250", buttonTitle: "💧 +250 ml", options: { opensAppToForeground: false } },
      { identifier: "water500", buttonTitle: "+500 ml", options: { opensAppToForeground: false } },
    ]);
    const target = Number(w.target_ml) || 2500; const had = Number(w.today_ml) || 0;
    const now = new Date(); let n = 0;
    for (let dayOff = 0; dayOff < 2; dayOff++) {
      for (const h of [10, 12, 14, 16, 18, 20]) {
        const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOff, h, 5);
        if (at.getTime() <= Date.now() + 60_000) continue;
        if (dayOff === 0) {
          const expected = target * Math.min(1, (h - 7) / 15);               // 07:00-22:00 waking day
          if (had >= expected) continue;                                     // on pace by then already: skip this one
        }
        const left = Math.max(0, target - (dayOff === 0 ? had : 0));
        await Notifications.scheduleNotificationAsync({
          identifier: `${WATER_PREFIX}${dayOff}-${h}`,
          content: { title: tr("💧 Water time"), body: dayOff === 0 ? `${left} ml to go today. Tap +250 ml when you've had a glass.` : tr("A glass now keeps energy and focus up."),
            categoryIdentifier: WATER_CATEGORY, data: { kind: "water" } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
        });
        n++;
      }
    }
    return n;
  } catch { return 0; }
}

/**
 * Smart hourly check-ins (re-planned each time Sakuna opens): only for hours Sakuna doesn't already know, today and
 * tomorrow. Logged hours, focus, gym, Google Calendar meetings and sleep are skipped. Falls back to every hour offline.
 */
export async function scheduleSmartCheckins(api: Api): Promise<number> {
  try {
    if (!(await ready())) return -1;
    if ((await SecureStore.getItemAsync("sakuna.hourlyCheckins")) !== "on") return 0;
    let plan: Row;
    try { plan = await api<Row>("/day/checkin-plan"); } catch { return scheduleHourlyCheckins(true); }
    await cancelWhere(id => id.startsWith(CHECKIN_PREFIX));
    await Notifications.setNotificationCategoryAsync(CHECKIN_CATEGORY, [
      ...CHECKIN_ACTIONS.map(([id, title]) => ({ identifier: id, buttonTitle: title, options: { opensAppToForeground: false } })),
      { identifier: "open", buttonTitle: "Other…", options: { opensAppToForeground: true } },
    ]);
    let n = 0;
    for (const [day, v] of Object.entries(plan)) {
      const [y, mo, d] = day.split("-").map(Number);
      for (const h of ((v as Row).ask as number[]) || []) {
        const at = new Date(y, mo - 1, d, h + 1, 0);
        if (at.getTime() <= Date.now() + 60_000) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: `${CHECKIN_PREFIX}${day}-${h}`,
          content: { title: `⏱ ${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`, body: tr("What did you do this hour? Tap a button, or open Sakuna for more."),
            categoryIdentifier: CHECKIN_CATEGORY, data: { kind: "checkin", hour: h } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
        });
        n++;
      }
    }
    await Notifications.scheduleNotificationAsync({
      identifier: `${CHECKIN_PREFIX}report`,
      content: { title: "📋 Your day report is ready", body: "See where the time went, and what to change tomorrow.", data: { kind: "report" } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 30, channelId: CHANNEL },
    });
    return n + 1;
  } catch { return 0; }
}
