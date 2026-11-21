import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { File, Paths } from "expo-file-system";

export type ApiRecord = Record<string, any>;

// Build-time default. The user can change it on the sign-in screen (it is saved on the phone), so one APK
// keeps working when the server address changes (for example a new Cloudflare tunnel URL).
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000");
const SERVER_KEY = "sakuna.serverUrl";
let baseUrl = normalizeServerUrl(DEFAULT_URL);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** "sakuna.example.com/api/v1/" -> "https://sakuna.example.com" */
export function normalizeServerUrl(value: string): string {
  let url = value.trim().replace(/\/+$/, "").replace(/\/api\/v1$/i, "");
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export function getServerUrl() { return baseUrl; }

export async function loadServerUrl(): Promise<string> {
  try {
    const saved = await SecureStore.getItemAsync(SERVER_KEY);
    if (saved) baseUrl = normalizeServerUrl(saved);
  } catch { /* keep the build-time default */ }
  return baseUrl;
}

export async function saveServerUrl(value: string): Promise<string> {
  baseUrl = normalizeServerUrl(value);
  try { await SecureStore.setItemAsync(SERVER_KEY, baseUrl); } catch { /* still used for this session */ }
  return baseUrl;
}

// Staying signed in: the newest access token (it lasts 15 minutes) and a function that renews it with the saved
// refresh token (see session.ts). Screens keep passing the token they got at sign-in; requests use the newest one.
let latestAccess = "";
let refresher: (() => Promise<string | null>) | null = null;
export function setAccessToken(token: string) { latestAccess = token; }
export function setRefresher(fn: (() => Promise<string | null>) | null) { refresher = fn; }

// Requests that are safe to send again after the server restarted mid-way: reads, and chat (it carries an
// Idempotency-Key, so a repeat returns the first answer instead of a second message).
const RETRY_SAFE = (method: string, path: string) => method === "GET" || path === "/chat";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const SERVER_BUSY = "The server is waking up or restarting. Please try again in a few seconds.";

// ---------- Home in one request: /home returns every card's data; cards then read it here instead of calling the server ----------
const HOME_CARDS = ["/nudge", "/today/plan", "/routines/today", "/health/trends?days=14"];
const primed = new Map<string, { at: number; value: unknown }>();
let homeInflight: Promise<void> | null = null;

/** Load Home in one request. Cards asking for their part get it from this answer (once, within 45 s). */
export function loadHome<T = ApiRecord>(token: string): Promise<T> {
  const p = rawRequest<ApiRecord>("/home", token).then(out => {
    for (const [path, value] of Object.entries(out)) {
      if (value == null) continue;
      if (CACHEABLE.test(path)) remember(path, value);
      if (HOME_CARDS.includes(path)) primed.set(path, { at: Date.now(), value });
    }
    return out as T;
  });
  homeInflight = p.then(() => undefined, () => undefined).finally(() => { homeInflight = null; });
  return p;
}

export async function apiRequest<T = ApiRecord>(path: string, token = "", method = "GET", body?: unknown): Promise<T> {
  if (method !== "GET") primed.clear();
  else if (HOME_CARDS.includes(path)) {
    if (homeInflight) await homeInflight;
    const hit = primed.get(path);
    if (hit) { primed.delete(path); if (Date.now() - hit.at < 45000) return hit.value as T; }
  }
  return rawRequest<T>(path, token, method, body);
}

async function rawRequest<T = ApiRecord>(path: string, token = "", method = "GET", body?: unknown): Promise<T> {
  const key = path === "/chat" && method === "POST" ? newKey() : "";
  const send = (bearer: string) => fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let response: Response | null = null;
  let payload: ApiRecord = {};
  const retrySafe = RETRY_SAFE(method, path);
  for (let attempt = 0; attempt < (retrySafe ? 3 : 1); attempt++) {
    if (attempt) await sleep(attempt === 1 ? 2500 : 6000);
    const bearer = token ? latestAccess || token : "";
    try {
      response = await send(bearer);
      if (response.status === 401 && bearer && refresher && !path.startsWith("/auth/")) {
        const fresh = await refresher();
        if (fresh) response = await send(fresh);
      }
    } catch {
      response = null;
      if (retrySafe && attempt < 2) continue;
      if (token && method !== "GET" && OFFLINE_OK.test(path)) { await enqueue({ path, method, body }); return { queued: true, offline: true } as T; }
      throw new ApiError(`Can't reach the server at ${baseUrl}. Check your internet connection and the server address.`, 0);
    }
    if (response.status === 204) return null as T;
    payload = await response.json().catch(() => ({}));
    // A 502/503/504 without our JSON "detail" comes from the hosting proxy while the server restarts or wakes up.
    const proxyBusy = [502, 503, 504].includes(response.status) && !payload.detail;
    if (!(proxyBusy && retrySafe && attempt < 2)) break;
  }
  if (!response) throw new ApiError(`Can't reach the server at ${baseUrl}.`, 0);
  if (!response.ok) {
    const busy = [502, 503, 504].includes(response.status) && !payload.detail;
    throw new ApiError(busy ? SERVER_BUSY : String(payload.detail || `Request failed (${response.status})`), response.status);
  }
  if (method === "GET" && token && CACHEABLE.test(path)) remember(path, payload);
  if (token && queue.length && !flushing) void flushQueue(token);
  return payload as T;
}

// ---------- Offline: save now, send when the internet is back ----------
// Logging things (day tracker, gym, inbox, tasks, habits, journal, meals) works without internet. The request waits in a
// small file on this phone and is sent, in order, the next time any request succeeds or the app starts.
const OFFLINE_OK = /^\/(day\/entries|capture|gym\/workouts|tasks|habits\/[^/]+\/logs|journal\/\d{4}-\d{2}-\d{2}|meals)$/;
type Queued = { path: string; method: string; body?: unknown; at: number };
let queue: Queued[] = [];
let flushing = false;
const queueFile = () => new File(Paths.document, "sakuna-offline-queue.json");
async function saveQueue() { try { queueFile().write(JSON.stringify(queue)); } catch { /* best effort */ } }
async function enqueue(item: Omit<Queued, "at">) { queue.push({ ...item, at: Date.now() }); queue = queue.slice(-200); await saveQueue(); }
export function pendingCount() { return queue.length; }
export async function loadQueue() {
  try { const f = queueFile(); if (f.exists) queue = JSON.parse(await f.text()) || []; } catch { queue = []; }
}
/** Send everything saved while offline. Stops at the first network error; drops items the server refuses (4xx). */
export async function flushQueue(token: string): Promise<number> {
  if (flushing || !queue.length) return 0;
  flushing = true;
  let sent = 0;
  try {
    while (queue.length) {
      const item = queue[0];
      try {
        const bearer = latestAccess || token;
        const res = await fetch(`${baseUrl}/api/v1${item.path}`, { method: item.method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          ...(item.body === undefined ? {} : { body: JSON.stringify(item.body) }) });
        if (res.status >= 500 || res.status === 401) break;      // try again later
        queue.shift(); sent++;                                      // done (or refused for good: 4xx)
      } catch { break; }
    }
  } finally { flushing = false; await saveQueue(); }
  return sent;
}

// ---------- Fast screens: show the last data at once, refresh in the background ----------
// Successful reads of the main screens are kept in memory and in a small file on this phone (only for the signed-in
// account; deleted on sign-out). Screens start from peek(path) and then load fresh data as usual.
const CACHEABLE = /^\/(compass|workers(\/today)?|routines\/(today|week|month)|focus\/(today|avoid)|exams|you(\/reports)?|invest|news|journal|dashboard|planner\/daily|tasks|finance\/(summary|trends)|health\/(summary|trends)|life\/overview|study|me)(\?|$)/;
const memCache = new Map<string, unknown>();
let cacheOwner = "";
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const cacheFile = () => new File(Paths.document, "sakuna-screen-cache.json");

export function peek<T = ApiRecord>(path: string): T | null {
  return (memCache.get(path) as T | undefined) ?? null;
}

function remember(path: string, data: unknown) {
  memCache.set(path, data);
  if (memCache.size > 60) memCache.delete(memCache.keys().next().value as string);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!cacheOwner) return;
    try { void cacheFile().write(JSON.stringify({ owner: cacheOwner, saved: Date.now(), entries: Object.fromEntries(memCache) })); } catch { /* best effort */ }
  }, 1500);
}

/** Load this account's saved screens (call once after sign-in or on start). */
export async function loadScreenCache(owner: string) {
  cacheOwner = owner;
  try {
    const file = cacheFile();
    if (!file.exists) return;
    const data = JSON.parse(await file.text());
    if (data?.owner !== owner || Date.now() - Number(data.saved) > 7 * 86400000) return;
    for (const [k, v] of Object.entries(data.entries || {})) if (!memCache.has(k)) memCache.set(k, v);
  } catch { /* a broken cache file is simply ignored */ }
}

export function clearScreenCache() {
  memCache.clear();
  cacheOwner = "";
  try { const file = cacheFile(); if (file.exists) file.delete(); } catch { /* already gone */ }
}

/** Load the main screens together in the background, so every tab opens instantly. */
export function prefetchScreens(token: string) {
  const paths = ["/compass", "/workers/today", "/routines/today", "/focus/today", "/journal", "/exams", "/you", "/invest", "/news", "/routines/week", "/tasks", "/life/overview", "/finance/trends", "/health/trends?days=14"];
  void Promise.allSettled(paths.map(path => apiRequest(path, token)));
}

/** Upload one file (multipart/form-data) to the API, e.g. a CSV or Excel file picked on the phone. */
export async function apiUpload<T = ApiRecord>(path: string, token: string, file: { uri: string; name: string; type?: string | null }, fields?: Record<string, string>): Promise<T> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for files on the device.
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as unknown as Blob);
  for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
  const bearer = token ? latestAccess || token : "";
  let response: Response | null = null;
  let why = "";
  for (let attempt = 0; attempt < 2 && !response; attempt++) {     // one retry: the free server may be waking up
    if (attempt) await sleep(4000);
    try {
      response = await fetch(`${baseUrl}/api/v1${path}`, { method: "POST", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: form });
      if (response.status === 401 && bearer && refresher) {
        const fresh = await refresher();
        if (fresh) response = await fetch(`${baseUrl}/api/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${fresh}` }, body: form });
      }
    } catch (reason) { why = reason instanceof Error ? reason.message : ""; response = null; }
  }
  if (!response) throw new ApiError(`Can't reach the server at ${baseUrl}${why ? ` (${why})` : ""}. Check your internet connection and try again.`, 0);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(String(payload.detail || `Upload failed (${response.status})`), response.status);
  return payload as T;
}
