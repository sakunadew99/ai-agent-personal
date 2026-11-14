import { Platform } from "react-native";

export type ApiRecord = Record<string, any>;

const API_URL = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://localhost:8000");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T = ApiRecord>(path: string, token = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null as T;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(String(payload.detail || `Request failed (${response.status})`), response.status);
  return payload as T;
}
