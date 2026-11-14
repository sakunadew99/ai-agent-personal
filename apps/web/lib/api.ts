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
  if (response.status === 401 && path !== "/auth/refresh" && typeof window !== "undefined") {
    const refreshToken = localStorage.getItem("sakuna-refresh");
    if (refreshToken) {
      const refreshed = await fetch(`${API_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshed.ok) {
        const pair = await refreshed.json();
        localStorage.setItem("sakuna-access", pair.access_token);
        localStorage.setItem("sakuna-refresh", pair.refresh_token);
        response = await send(pair.access_token);
      } else {
        localStorage.removeItem("sakuna-access");
        localStorage.removeItem("sakuna-refresh");
        window.dispatchEvent(new Event("sakuna:session-expired"));
      }
    }
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
