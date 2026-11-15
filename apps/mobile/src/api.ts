import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

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

export async function apiRequest<T = ApiRecord>(path: string, token = "", method = "GET", body?: unknown): Promise<T> {
  const send = (bearer: string) => fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const bearer = token ? latestAccess || token : "";
  let response: Response;
  try {
    response = await send(bearer);
    if (response.status === 401 && bearer && refresher && !path.startsWith("/auth/")) {
      const fresh = await refresher();
      if (fresh) response = await send(fresh);
    }
  } catch {
    throw new ApiError(`Can't reach the server at ${baseUrl}. Check your internet connection and the server address.`, 0);
  }
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(String(payload.detail || `Request failed (${response.status})`), response.status);
  return payload as T;
}

/** Upload one file (multipart/form-data) to the API, e.g. a CSV or Excel file picked on the phone. */
export async function apiUpload<T = ApiRecord>(path: string, token: string, file: { uri: string; name: string; type?: string | null }): Promise<T> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for files on the device.
  form.append("file", { uri: file.uri, name: file.name, type: file.type || "application/octet-stream" } as unknown as Blob);
  const bearer = token ? latestAccess || token : "";
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, { method: "POST", headers: bearer ? { Authorization: `Bearer ${bearer}` } : {}, body: form });
    if (response.status === 401 && bearer && refresher) {
      const fresh = await refresher();
      if (fresh) response = await fetch(`${baseUrl}/api/v1${path}`, { method: "POST", headers: { Authorization: `Bearer ${fresh}` }, body: form });
    }
  } catch {
    throw new ApiError(`Can't reach the server at ${baseUrl}. Check your internet connection and the server address.`, 0);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(String(payload.detail || `Upload failed (${response.status})`), response.status);
  return payload as T;
}
