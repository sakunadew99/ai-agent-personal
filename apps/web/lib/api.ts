export type JsonRecord = Record<string, any>;

// Browser requests stay on the web origin; Next.js forwards them to the API.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let refreshing: Promise<string | null> | null = null;

/**
 * Get a new access token with the stored refresh token. Only ONE refresh runs at a time: the server rotates refresh
 * tokens, so parallel refreshes with the same token would make all but the first fail and sign you out by mistake.
 * You're signed out only when the server really rejects the session (401/403), never on a network blip or a 5xx.
 */
function refreshAccess(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const used = localStorage.getItem("sakuna-refresh");
    if (!used) return null;
    let refreshed: Response;
    try {
      refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: used }),
      });
    } catch {
      return null;                                   // offline: keep the session and try again on the next request
    }
    if (refreshed.ok) {
      const pair = await refreshed.json();
      localStorage.setItem("sakuna-access", pair.access_token);
      localStorage.setItem("sakuna-refresh", pair.refresh_token);
      return pair.access_token as string;
    }
    if (refreshed.status === 401 || refreshed.status === 403) {
      // Another tab may have rotated the token a moment ago: use its result instead of signing out.
      const now = localStorage.getItem("sakuna-refresh");
      if (now && now !== used) return localStorage.getItem("sakuna-access");
      localStorage.removeItem("sakuna-access");
      localStorage.removeItem("sakuna-refresh");
      window.dispatchEvent(new Event("sakuna:session-expired"));
    }
    return null;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Authenticated JSON client with one refresh-token retry. */
export async function apiRequest<T = JsonRecord>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let access = token;
  if (typeof window !== "undefined") access = localStorage.getItem("sakuna-access") || token;
  const send = (bearer: string) => fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...init.headers,
    },
  });

  let response = await send(access);
  if (response.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
    const fresh = await refreshAccess();
    if (fresh) response = await send(fresh);
  }

  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.detail || payload.message || `Request failed (${response.status})`;
    throw new ApiError(String(message), response.status);
  }
  return payload as T;
}

export const postJson = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
export const patchJson = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
