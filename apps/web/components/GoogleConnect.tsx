"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, postJson, type JsonRecord as Row } from "@/lib/api";

type Provider = "gmail" | "calendar";
const REASONS: Record<string, string> = {
  connected: "Connected.",
  denied: "You cancelled on Google's screen. Nothing was connected.",
  gmail_permission_not_granted: "The Gmail read permission was not ticked on Google's screen, so nothing was connected. Try again and tick it.",
  calendar_permission_not_granted: "The Calendar permission was not ticked on Google's screen, so nothing was connected. Try again and tick it.",
  too_broad: "Google granted more access than Sakuna asks for, so it was refused and revoked. Try again.",
  expired_state: "That sign-in link was older than 10 minutes. Press Connect again.",
  invalid_state: "That sign-in link was already used or is unknown. Press Connect again.",
  missing_state: "Google's reply was incomplete. Press Connect again.",
  exchange_failed: "Google refused the sign-in code. Check the client ID/secret and redirect URI on the server, then try again.",
  no_refresh_token: "Google did not return a long-lived token. Remove Sakuna at myaccount.google.com/permissions, then connect again.",
  not_configured: "Google connection is not set up on the server yet.",
  google_error: "Google returned an error. Try again in a minute.",
};
const COPY: Record<Provider, { title: string; connect: string; note: string }> = {
  gmail: { title: "Gmail (for Fiverr notifications)", connect: "Connect Gmail (read-only)",
    note: "Read-only. Sakuna can never send, delete or change your email, and never acts on Fiverr for you. Syncing Fiverr emails comes in a later phase." },
  calendar: { title: "Google Calendar", connect: "Connect Google Calendar",
    note: "Your events show in the month plan and reduce free time in the time engine. With “add events” allowed, only tasks you press 📅 on are added, with Google's own reminders (phone pop-up and/or email)." },
};

/** Settings card for one Google connection (Gmail or Calendar). Tokens never reach the browser. */
export function GoogleConnect({ token, provider }: { token: string; provider: Provider }) {
  const [data, setData] = useState<Row | null>(null);
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Row | null>(null);
  const [write, setWrite] = useState(true);
  const load = useCallback(() => {
    apiRequest<Row>("/integrations", token).then(r => setData(r[provider])).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load"));
  }, [token, provider]);
  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const result = params.get(provider) || (provider === "gmail" ? params.get("google") : null);
    if (result) {
      const reason = params.get("reason") || "";
      if (result === "connected") setMessage(`${COPY[provider].title}: connected.`); else setError(REASONS[reason] || `Connection failed (${reason}).`);
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }, [load, provider]);

  async function connect(allowWrite: boolean) {
    setBusy(true); setError("");
    try { const r = await apiRequest<Row>(`/integrations/${provider}/connect`, token, postJson({ write: allowWrite })); window.location.href = r.auth_url; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start"); setBusy(false); }
  }
  async function runCheck() {
    setBusy(true); setError(""); setMessage("");
    try { const r = await apiRequest<Row>(`/integrations/${provider}/check`, token, { method: "POST" }); setCheck(r); if (!r.ok) setError(r.message); load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Check failed"); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm(`Disconnect ${COPY[provider].title}? Sakuna will ask Google to revoke its access and delete the stored tokens.`)) return;
    setBusy(true); setError("");
    try {
      const r = await apiRequest<Row>(`/integrations/${provider}`, token, { method: "DELETE" });
      setMessage(r.revoked_at_google ? "Disconnected and access revoked at Google." : `Disconnected here. ${r.note || ""}`); setCheck(null); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect"); }
    finally { setBusy(false); }
  }

  const conn: Row | null = data?.connection || null;
  const statusLabel = conn ? (conn.status === "connected" ? (provider === "calendar" ? (conn.can_add_events ? "connected · can add events" : "connected · read-only") : "connected · read-only") : conn.status)
    : data?.configured === false ? "not set up" : "not connected";
  return <div className="gmail-card">
    <div className="gmail-head"><b>{COPY[provider].title}</b><span className={`badge status-${conn?.status || "none"}`}>{statusLabel}</span></div>
    {conn?.email && <small className="muted">{conn.email} · since {new Date(conn.connected_at).toLocaleDateString()}{conn.last_checked_at ? ` · checked ${new Date(conn.last_checked_at).toLocaleString()}` : ""}</small>}
    {conn?.status === "expired" && <p className="warning-copy">{conn.last_error || "Google ended this connection."} This is normal while the Google app is in “Testing” mode (about every 7 days).</p>}
    {message && <p className="success-note">{message}</p>}
    {error && <p className="warning-copy">{error}</p>}
    {check?.ok && provider === "gmail" && <p className="muted small-copy">Mailbox reachable: {Number(check.messages_total).toLocaleString()} emails · {check.fiverr_emails_90_days ?? "?"} from Fiverr in the last 90 days. (Counts only; no email content was read.)</p>}
    {check?.ok && provider === "calendar" && <p className="muted small-copy">Calendar “{check.calendar}” ({check.timezone}) reachable · {check.events_next_7_days ?? "?"} events in the next 7 days.</p>}
    {provider === "calendar" && (!conn || conn.status !== "connected") && data?.configured !== false &&
      <label className="inline-check"><input type="checkbox" checked={write} onChange={e => setWrite(e.target.checked)}/> Also allow adding tasks I choose as events (with reminders)</label>}
    <div className="row-actions" style={{ justifyContent: "flex-start" }}>
      {data?.configured === false ? <small className="muted">The server needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.</small>
        : !conn || conn.status !== "connected"
          ? <button className="primary" disabled={busy || !data} onClick={() => void connect(provider === "calendar" && write)}>{conn ? "Reconnect" : COPY[provider].connect}</button>
          : <>
            <button className="outline" disabled={busy} onClick={() => void runCheck()}>Test connection</button>
            {provider === "calendar" && !conn.can_add_events && <button className="text-button" disabled={busy} onClick={() => void connect(true)}>Allow adding events</button>}
          </>}
      {conn && <button className="danger-link" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}
    </div>
    <small className="muted">{COPY[provider].note}</small>
  </div>;
}

const REMINDER_CHOICES: { label: string; popup: number | null; email: number | null }[] = [
  { label: "Pop-up 10 min before", popup: 10, email: null },
  { label: "Pop-up 10 min + email 1 hour before", popup: 10, email: 60 },
  { label: "Pop-up 30 min + email 1 day before", popup: 30, email: 1440 },
  { label: "Calendar's default reminders", popup: null, email: null },
];

/** 📅 on a task: add it to Google Calendar with reminders, or remove it. Shown only when allowed. */
export function TaskCalendarButton({ token, task, canAdd, onDone }: { token: string; task: Row; canAdd: boolean; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (task.calendar_event_id) {
    return <button className="text-button cal-btn" disabled={busy || !canAdd} title={canAdd ? "Remove from Google Calendar" : "In Google Calendar"} onClick={async () => {
      if (!window.confirm(`Remove “${task.title}” from Google Calendar?${task.recurrence ? " This removes the whole repeating event." : ""}`)) return;
      setBusy(true);
      try { await apiRequest(`/tasks/${task.id}/calendar`, token, { method: "DELETE" }); onDone("Removed from Google Calendar."); }
      catch (reason) { onDone(reason instanceof Error ? reason.message : "Could not remove"); } finally { setBusy(false); }
    }}>📅 ✓</button>;
  }
  if (!canAdd || !task.due_at) return null;
  return <select className="cal-select" aria-label={`Add ${task.title} to Google Calendar`} disabled={busy} value="" onChange={async e => {
    const choice = REMINDER_CHOICES[Number(e.target.value)];
    if (!choice) return;
    setBusy(true);
    try {
      await apiRequest(`/tasks/${task.id}/calendar`, token, postJson({ popup_minutes: choice.popup, email_minutes: choice.email }));
      onDone(`Added to Google Calendar${task.recurrence ? " as a repeating event" : ""} (${choice.label.toLowerCase()}).`);
    } catch (reason) { onDone(reason instanceof Error ? reason.message : "Could not add"); } finally { setBusy(false); }
  }}>
    <option value="">📅 Add</option>
    {REMINDER_CHOICES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
  </select>;
}
