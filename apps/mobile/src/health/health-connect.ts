import { Platform } from "react-native";

export type HealthConnectStatus = { available: boolean; connected: boolean; reason: string };
export type TodayHealth = {
  steps: { value: number; recordedAt: string } | null;
  heartRate: { value: number; recordedAt: string } | null;
  sleep: { startAt: string; endAt: string; minutes: number; stages: number[] } | null;
};

const HEALTH_PERMISSIONS = [
  { accessType: "read" as const, recordType: "Steps" as const },
  { accessType: "read" as const, recordType: "HeartRate" as const },
  { accessType: "read" as const, recordType: "SleepSession" as const },
];

async function healthConnectModule() {
  if (Platform.OS !== "android") throw new Error("Health Connect is available on Android only.");
  return import("react-native-health-connect");
}

export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  if (Platform.OS !== "android") return { available: false, connected: false, reason: "Health Connect is available on Android only." };
  try {
    const { getSdkStatus, initialize, getGrantedPermissions, SdkAvailabilityStatus } = await healthConnectModule();
    const sdkStatus = await getSdkStatus();
    if (sdkStatus !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      return { available: false, connected: false, reason: sdkStatus === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ? "Install or update Health Connect, then try again." : "Health Connect is unavailable on this device." };
    }
    if (!await initialize()) return { available: false, connected: false, reason: "Health Connect could not be initialized." };
    const permissions = await getGrantedPermissions();
    const grantedTypes = new Set(permissions.filter(p => p.accessType === "read").map(p => p.recordType));
    const connected = HEALTH_PERMISSIONS.some(p => grantedTypes.has(p.recordType));
    const missing = HEALTH_PERMISSIONS.filter(p => !grantedTypes.has(p.recordType)).map(p => ({ Steps: "steps", HeartRate: "heart rate", SleepSession: "sleep" }[p.recordType])).join(", ");
    return { available: true, connected, reason: connected ? (missing ? `Connected. Allow ${missing} access for all available metrics.` : "Health Connect is connected.") : "Connect and allow steps, heart rate, and sleep access." };
  } catch {
    return { available: false, connected: false, reason: "Could not reach Health Connect. Check that it is installed and try again." };
  }
}

export async function connectHealthConnect(): Promise<boolean> {
  const status = await getHealthConnectStatus();
  if (!status.available) throw new Error(status.reason);
  const { requestPermission } = await healthConnectModule();
  const granted = await requestPermission(HEALTH_PERMISSIONS);
  return granted.some(permission => permission.accessType === "read" && HEALTH_PERMISSIONS.some(p => p.recordType === permission.recordType));
}

/** Read today's steps and latest heart-rate sample, plus the most recent completed sleep session. */
export async function readTodayHealth(): Promise<TodayHealth> {
  const status = await getHealthConnectStatus();
  if (!status.available) throw new Error(status.reason);
  if (!status.connected) throw new Error("Connect Health Connect and allow health data access first.");

  const { aggregateRecord, readRecords, getGrantedPermissions } = await healthConnectModule();
  const granted = new Set((await getGrantedPermissions()).filter(p => p.accessType === "read").map(p => p.recordType));
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const steps = granted.has("Steps") ? await aggregateRecord({
    recordType: "Steps", timeRangeFilter: { operator: "between", startTime: dayStart.toISOString(), endTime: now.toISOString() },
  }) : null;

  let heartRate: TodayHealth["heartRate"] = null;
  if (granted.has("HeartRate")) {
    const result = await readRecords("HeartRate", { timeRangeFilter: { operator: "between", startTime: dayStart.toISOString(), endTime: now.toISOString() }, ascendingOrder: false, pageSize: 1000 });
    const samples = result.records.flatMap(record => record.samples).filter(sample => new Date(sample.time).getTime() <= now.getTime()).sort((a, b) => b.time.localeCompare(a.time));
    if (samples[0]) heartRate = { value: Math.round(samples[0].beatsPerMinute), recordedAt: samples[0].time };
  }

  let sleep: TodayHealth["sleep"] = null;
  if (granted.has("SleepSession")) {
    const from = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    const result = await readRecords("SleepSession", { timeRangeFilter: { operator: "between", startTime: from.toISOString(), endTime: now.toISOString() }, ascendingOrder: false, pageSize: 100 });
    const session = result.records.filter(record => new Date(record.endTime).getTime() <= now.getTime()).sort((a, b) => b.endTime.localeCompare(a.endTime))[0];
    if (session) sleep = {
      startAt: session.startTime,
      endAt: session.endTime,
      minutes: Math.max(0, Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000)),
      stages: session.stages?.map(stage => stage.stage) ?? [],
    };
  }

  return { steps: steps ? { value: Math.max(0, Math.round(Number(steps.COUNT_TOTAL ?? 0))), recordedAt: now.toISOString() } : null, heartRate, sleep };
}
