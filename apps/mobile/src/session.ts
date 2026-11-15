/**
 * Staying signed in on the phone until you sign out.
 *
 * The refresh token is kept in the phone's encrypted secure storage (never AsyncStorage). On start the app swaps it
 * for a fresh 15-minute access token; whenever a request gets "401", it renews once and retries. The server rotates
 * refresh tokens (each one works once and the window slides 90 days), so only ONE renewal may run at a time.
 * You're signed out only when the server rejects the session or you tap Sign out, never because you were offline.
 */
import * as SecureStore from "expo-secure-store";

import { ApiError, apiRequest, setAccessToken, type ApiRecord as Row } from "./api";

const REFRESH_KEY = "sakuna.refreshToken";
const USER_KEY = "sakuna.user";
let inflight: Promise<string | null> | null = null;
let expiredHandler: (() => void) | null = null;

export function onSessionExpired(fn: (() => void) | null) { expiredHandler = fn; }

export async function saveSession(refreshToken: string, user: Row | undefined) {
  await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
  try { await SecureStore.setItemAsync(USER_KEY, JSON.stringify({ id: user?.id, email: user?.email, full_name: user?.full_name })); } catch { /* optional */ }
}

export async function storedUser(): Promise<Row> {
  try { return JSON.parse((await SecureStore.getItemAsync(USER_KEY)) || "{}"); } catch { return {}; }
}

export async function hasSession(): Promise<boolean> {
  try { return !!(await SecureStore.getItemAsync(REFRESH_KEY)); } catch { return false; }
}

export async function clearSession() {
  setAccessToken("");
  try { await SecureStore.deleteItemAsync(REFRESH_KEY); } catch { /* already gone */ }
  try { await SecureStore.deleteItemAsync(USER_KEY); } catch { /* already gone */ }
}

/** A fresh access token, or null (offline, or the session ended). One renewal at a time. */
export function refreshAccess(): Promise<string | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    let refresh: string | null = null;
    try { refresh = await SecureStore.getItemAsync(REFRESH_KEY); } catch { return null; }
    if (!refresh) return null;
    try {
      const pair = await apiRequest<Row>("/auth/refresh", "", "POST", { refresh_token: refresh });
      await saveSession(pair.refresh_token, pair.user);
      setAccessToken(pair.access_token);
      return pair.access_token as string;
    } catch (reason) {
      if (reason instanceof ApiError && (reason.status === 401 || reason.status === 403)) {
        await clearSession();
        expiredHandler?.();
      }
      return null; // offline or the server is waking up: keep the session and try again later
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Sign out on this phone: end the session on the server (best effort) and forget it here. */
export async function endSession() {
  try {
    const refresh = await SecureStore.getItemAsync(REFRESH_KEY);
    const access = await refreshAccess().catch(() => null);
    if (refresh && access) await apiRequest("/auth/logout", access, "POST", { refresh_token: (await SecureStore.getItemAsync(REFRESH_KEY)) || refresh });
  } catch { /* still sign out locally */ }
  await clearSession();
}
