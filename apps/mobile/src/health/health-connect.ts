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
  { accessType: "read" as const, recordType: "ExerciseSession" as const },   // workouts incl. swims
  { accessType: "read" as const, recordType: "Distance" as const },          // swim / run distance
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
    const missing = HEALTH_PERMISSIONS.filter(p => !grantedTypes.has(p.recordType)).map(p => ({ Steps: "steps", HeartRate: "heart rate", SleepSession: "sleep", ExerciseSession: "workouts & swims", Distance: "distance" } as Record<string, string>)[p.recordType]).join(", ");
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

export type RecentHealth = {
  days: { day: string; steps: number | null; heart_rate_avg: number | null }[];
  sleep: { start_at: string; end_at: string; stages: number[] }[];
  workouts: { start_at: string; end_at: string; activity: string; distance_m: number | null }[];
};

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The last `days` days from Health Connect (Mi Fitness writes there): daily step totals, average heart rate, sleep sessions.
 *  Reading several days means a day you didn't open Sakuna is still filled in. */
export async function readRecentHealth(days = 7): Promise<RecentHealth> {
  const status = await getHealthConnectStatus();
  if (!status.available || !status.connected) return { days: [], sleep: [], workouts: [] };
  const { aggregateRecord, readRecords, getGrantedPermissions, ExerciseType } = await healthConnectModule();
  const granted = new Set((await getGrantedPermissions()).filter(p => p.accessType === "read").map(p => p.recordType));
  const now = new Date();
  const out: RecentHealth = { days: [], sleep: [], workouts: [] };
  for (let k = days - 1; k >= 0; k--) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - k);
    const end = k === 0 ? now : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const range = { operator: "between" as const, startTime: start.toISOString(), endTime: end.toISOString() };
    let steps: number | null = null, hr: number | null = null;
    try {
      if (granted.has("Steps")) steps = Math.max(0, Math.round(Number((await aggregateRecord({ recordType: "Steps", timeRangeFilter: range })).COUNT_TOTAL ?? 0)));
    } catch { /* keep going with other days */ }
    try {
      if (granted.has("HeartRate")) {
        const r = await readRecords("HeartRate", { timeRangeFilter: range, pageSize: 5000 });
        const bpm = r.records.flatMap(x => x.samples).map(s => s.beatsPerMinute).filter(v => v > 25 && v < 230);
        if (bpm.length) hr = Math.round(bpm.reduce((a, b) => a + b, 0) / bpm.length);
      }
    } catch { /* optional */ }
    out.days.push({ day: localDay(start), steps, heart_rate_avg: hr });
  }
  try {
    if (granted.has("SleepSession")) {
      const from = new Date(now.getTime() - (days + 1) * 86400000);
      const r = await readRecords("SleepSession", { timeRangeFilter: { operator: "between", startTime: from.toISOString(), endTime: now.toISOString() }, pageSize: 100 });
      out.sleep = r.records.filter(s => new Date(s.endTime).getTime() <= now.getTime())
        .map(s => ({ start_at: s.startTime, end_at: s.endTime, stages: s.stages?.map(x => x.stage) ?? [] }));
    }
  } catch { /* optional */ }
  try {
    if (granted.has("ExerciseSession")) {
      // Workouts from Mi Fitness (swimming pool / open water, running, cycling...) with distance when allowed.
      const names: Record<number, string> = {};
      for (const [k, v] of Object.entries(ExerciseType as Record<string, number>)) names[v] = k.toLowerCase();
      const from = new Date(now.getTime() - days * 86400000);
      const r = await readRecords("ExerciseSession", { timeRangeFilter: { operator: "between", startTime: from.toISOString(), endTime: now.toISOString() }, pageSize: 100 });
      for (const s of r.records) {
        let distance: number | null = null;
        if (granted.has("Distance")) {
          try {
            const d = await aggregateRecord({ recordType: "Distance", timeRangeFilter: { operator: "between", startTime: s.startTime, endTime: s.endTime } });
            const m = Number((d as { DISTANCE?: { inMeters?: number } }).DISTANCE?.inMeters ?? 0);
            distance = m > 0 ? Math.round(m) : null;
          } catch { /* distance is optional */ }
        }
        out.workouts.push({ start_at: s.startTime, end_at: s.endTime, activity: names[s.exerciseType] || "workout", distance_m: distance });
      }
    }
  } catch { /* optional */ }
  return out;
}
