import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/** Typed wrapper around the native Sakuna Shield module (Android only; null elsewhere, e.g. Expo Go). */
export type StrictMethod = "timer" | "schedule" | "charger";
export type ShieldStatus = {
  accessibility: boolean;
  usageAccess: boolean;
  charging: boolean;
  sessionActive: boolean;
  sessionEndsAt: number;
  sessionListIds: string[];
  activeListIds: string[];
  strict: boolean;
  strictMethod: StrictMethod | "";
  strictEndsAt: number;
  exitAvailableAt: number; // timer only: 0 = no early exit requested, else when it opens (ms)
  strictBlockedReason: string | null; // null = Strict Mode may be turned off now
  blocksToday: number;
};

/** days: 1 = Monday … 7 = Sunday; start/end in minutes from midnight (start > end runs overnight). */
export type Schedule = { days: number[]; start: number; end: number; from?: string | null; until?: string | null };
export type ListMode = "manual" | "always" | "schedule";
export type BlockList = {
  id: string;
  name: string;
  mode: ListMode;
  schedule: Schedule | null;
  apps: string[];
  domains: string[];
  keywords: string[];
  newApps: boolean;
  newAppsSince: number;
  adult: boolean;
  purchases: boolean;
  unsupportedBrowsers: boolean;
  shorts?: boolean;
};

export type AppCategory = "social" | "games" | "entertainment" | "creativity" | "education" | "health" | "productivity" | "news" | "shopping" | "travel" | "other";
export type AppInfo = { packageName: string; label: string; category: AppCategory };
export type Mark = "distracting" | "neutral" | "productive";
export type DayInsights =
  | { available: false }
  | {
      available: true;
      dayStart: number;
      totalMinutes: number;
      hourly: number[]; // 24 values, minutes
      hourlyApps?: (AppInfo & { minutes: number })[][]; // 24 lists, top 3 apps per hour
      apps: (AppInfo & { minutes: number })[];
      pickups: number;
      continuousMinutes: number;
      longestFocusMinutes: number | null;
      peakHour: number | null;
    };

/** Phone-based sleep estimate for the night before a day (longest screen-off stretch 20:00-12:00, short check-ins merged). */
export type SleepWindow = { available: boolean; detected?: boolean; lastUse?: number; firstUse?: number; stillAsleep?: boolean; coreMinutes?: number;
  spanMinutes?: number; interruptions?: { at: number; minutes: number }[]; reason?: string };

type NativeShield = {
  getStatus(): ShieldStatus;
  openAccessibilitySettings(): void;
  openUsageAccessSettings(): void;
  getLists(): string;
  saveList(json: string): string;
  deleteList(id: string): string;
  startSession(minutes: number, listIds: string[]): ShieldStatus;
  endSession(): ShieldStatus;
  startStrict(method: StrictMethod, minutes: number): ShieldStatus;
  requestStrictExit(): ShieldStatus;
  endStrict(): ShieldStatus;
  getAppMarks(): Record<string, Mark>;
  setAppMark(pkg: string, mark: Mark | ""): Record<string, Mark>;
  getInstalledApps(): Promise<AppInfo[]>;
  getInsights(daysAgo: number): Promise<DayInsights>;
  getSleepWindow?(daysAgo: number): Promise<SleepWindow>;
};

export const Shield: NativeShield | null = Platform.OS === "android" ? requireOptionalNativeModule<NativeShield>("SakunaShield") : null;

export const parseLists = (json: string): BlockList[] => { try { return JSON.parse(json) as BlockList[]; } catch { return []; } };

export const CATEGORY_LABEL: Record<AppCategory, string> = {
  social: "Social media", games: "Games", entertainment: "Entertainment", creativity: "Creativity", education: "Education",
  health: "Health & Fitness", productivity: "Productivity", news: "News & Books", shopping: "Shopping & Food", travel: "Travel & Maps", other: "Other apps",
};
export const CATEGORY_ICON: Record<AppCategory, string> = {
  social: "💬", games: "🎮", entertainment: "🎵", creativity: "🎨", education: "🎓", health: "❤️", productivity: "✈️", news: "📚", shopping: "🛒", travel: "🗺️", other: "📦",
};
export const CATEGORY_ORDER: AppCategory[] = ["social", "games", "entertainment", "creativity", "education", "health", "productivity", "news", "shopping", "travel", "other"];

/** Default mark when the user hasn't chosen one. */
export function defaultMark(category: AppCategory): Mark {
  if (category === "social" || category === "games" || category === "entertainment") return "distracting";
  if (category === "productivity" || category === "education") return "productive";
  return "neutral";
}

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export function hm(minutes: number) {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export function clockMin(min: number) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
export function clock(ms: number) { return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
export function scheduleText(s: Schedule | null) {
  if (!s || !s.days.length) return "No days";
  const days = s.days.length === 7 ? "Every day" : s.days.join(",") === "1,2,3,4,5" ? "Mon–Fri" : s.days.join(",") === "6,7" ? "Weekends" : s.days.map(d => DAY_SHORT[d - 1]).join(" ");
  const range = s.from || s.until ? ` · ${s.from ? new Date(`${s.from}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }) : "now"}–${s.until ? new Date(`${s.until}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }) : "no end"}` : "";
  return `${days} · ${s.start === s.end ? "all day" : `${clockMin(s.start)}–${clockMin(s.end)}`}${range}`;
}
/** Native errors arrive as "Call to function … has been rejected.\n→ Caused by: <our message>". Keep our message. */
export function errorText(reason: unknown) {
  if (!(reason instanceof Error)) return "Something went wrong";
  const parts = reason.message.split("Caused by:");
  return parts[parts.length - 1].trim() || "Something went wrong";
}
