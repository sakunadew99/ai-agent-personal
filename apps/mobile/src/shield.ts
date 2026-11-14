import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

/** Typed wrapper around the native Sakuna Shield module (Android only; null elsewhere, e.g. Expo Go). */
export type ShieldStatus = {
  accessibility: boolean;
  usageAccess: boolean;
  sessionEndsAt: number;
  sessionActive: boolean;
  strict: boolean;
  blockingActive: boolean;
  exitAvailableAt: number; // 0 = can end now, -1 = strict and no exit requested, else ms timestamp
  blocksToday: number;
};
export type ShieldConfig = { apps: string[]; domains: string[]; alwaysOn: boolean };
export type AppInfo = { packageName: string; label: string };
export type AppUsage = AppInfo & { minutes: number };

type NativeShield = {
  getStatus(): ShieldStatus;
  openAccessibilitySettings(): void;
  openUsageAccessSettings(): void;
  getConfig(): ShieldConfig;
  setConfig(apps: string[], domains: string[], alwaysOn: boolean): ShieldStatus;
  startSession(minutes: number, strict: boolean): ShieldStatus;
  requestExit(): ShieldStatus;
  endSession(): ShieldStatus;
  getInstalledApps(): Promise<AppInfo[]>;
  getUsageToday(): Promise<AppUsage[]>;
};

export const Shield: NativeShield | null = Platform.OS === "android" ? requireOptionalNativeModule<NativeShield>("SakunaShield") : null;
