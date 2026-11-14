"use client";

import { useCallback, useEffect, useState } from "react";
import { apiRequest, type JsonRecord as Row } from "@/lib/api";

const REASONS: Record<string, string> = {
  connected: "Gmail connected (read-only).",
  denied: "You cancelled on Google's screen. Nothing was connected.",
  gmail_permission_not_granted: "The Gmail read permission was not ticked on Google's screen, so nothing was connected. Try again and tick it.",
  expired_state: "That sign-in link was older than 10 minutes. Press Connect again.",
  invalid_state: "That sign-in link was already used or is unknown. Press Connect again.",
  missing_state: "Google's reply was incomplete. Press Connect again.",
  exchange_failed: "Google refused the sign-in code. Check the client ID/secret and redirect URI on the server, then try again.",
  no_refresh_token: "Google did not return a long-lived token. Remove Sakuna at myaccount.google.com/permissions, then connect again.",
  not_configured: "Gmail connection is not set up on the server yet.",
  google_error: "Google returned an error. Try again in a minute.",
};

/** Phase 5 (Fiverr F1): connect Gmail read-only. Sakuna can read, never send, delete or change mail. */
export function GmailConnect({ token }: { token: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<Row | null>(null);
  const load = useCallback(() => { apiRequest<Row>("/integrations", token).then(r => setData(r.gmail)).catch(reason => setError(reason instanceof Error ? reason.message : "Could not load")); }, [token]);
  useEffect(() => {
    load();
    // Result of Google's redirect: /?gmail=connected&reason=...#settings
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail")) {
      const reason = params.get("reason") || "";
      if (params.get("gmail") === "connected") setMessage(REASONS.connected); else setError(REASONS[reason] || `Connection failed (${reason}).`);
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }, [load]);

  async function connect() {
    setBusy(true); setError("");
    try { const r = await apiRequest<Row>("/integrations/gmail/connect", token, { method: "POST" }); window.location.href = r.auth_url; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start"); setBusy(false); }
  }
  async function runCheck() {
    setBusy(true); setError(""); setMessage("");
    try { const r = await apiRequest<Row>("/integrations/gmail/check", token, { method: "POST" }); setCheck(r); if (!r.ok) setError(r.message); load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Check failed"); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm("Disconnect Gmail? Sakuna will ask Google to revoke its access and delete the stored tokens.")) return;
    setBusy(true); setError("");
    try {
      const r = await apiRequest<Row>("/integrations/gmail", token, { method: "DELETE" });
      setMessage(r.revoked_at_google ? "Disconnected and access revoked at Google." : `Disconnected here. ${r.note || ""}`); setCheck(null); load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not disconnect"); }
    finally { setBusy(false); }
  }

  const conn: Row | null = data?.connection || null;
  return <div className="gmail-card">
    <div className="gmail-head"><b>Gmail (for Fiverr notifications)</b>
      <span className={`badge status-${conn?.status || "none"}`}>{conn ? (conn.status === "connected" ? "connected · read-only" : conn.status) : data?.configured === false ? "not set up" : "not connected"}</span></div>
    {conn?.email && <small className="muted">{conn.email} · since {new Date(conn.connected_at).toLocaleDateString()}{conn.last_checked_at ? ` · checked ${new Date(conn.last_checked_at).toLocaleString()}` : ""}</small>}
    {conn?.status === "expired" && <p className="warning-copy">{conn.last_error || "Google ended this connection."} This is normal while the Google app is in “Testing” mode (about every 7 days).</p>}
    {message && <p className="success-note">{message}</p>}
    {error && <p className="warning-copy">{error}</p>}
    {check?.ok && <p className="muted small-copy">Mailbox reachable: {Number(check.messages_total).toLocaleString()} emails · {check.fiverr_emails_90_days ?? "?"} from Fiverr in the last 90 days. (Counts only; no email content was read.)</p>}
    <div className="row-actions" style={{ justifyContent: "flex-start" }}>
      {data?.configured === false ? <small className="muted">The server needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.</small>
        : !conn || conn.status !== "connected"
          ? <button className="primary" disabled={busy || !data} onClick={() => void connect()}>{conn ? "Reconnect Gmail" : "Connect Gmail (read-only)"}</button>
          : <button className="outline" disabled={busy} onClick={() => void runCheck()}>Test connection</button>}
      {conn && <button className="danger-link" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}
    </div>
    <small className="muted">Read-only permission ({String(data?.scope || "gmail.readonly").split("/").pop()}). Sakuna can never send, delete or change your email, and never acts on Fiverr for you. Syncing Fiverr emails comes in the next phase.</small>
  </div>;
}
