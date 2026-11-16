"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest, patchJson, postJson, type JsonRecord as Row } from "@/lib/api";
import { appendSpeech, VoiceButton } from "./VoiceButton";

type Tab = "Balance" | "Wish list" | "Buy list";
const EXPENSE_CATS = ["food", "transport", "housing", "subscriptions", "shopping", "health", "education", "business", "savings", "other"];
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : "Something went wrong";
const fmt = (value: unknown, cur?: string) => value === null || value === undefined ? "—"
  : `${cur ? `${cur} ` : ""}${Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Phase 5 money: balances you enter by hand, envelopes, wish list with cooling-off, buy list. Never pays or transfers. */
export function MoneyHub({ token, defaultCurrency = "LKR" }: { token: string; defaultCurrency?: string }) {
  const [tab, setTab] = useState<Tab>("Balance");
  const [message, setMessage] = useState(""); const [error, setError] = useState("");
  // Stable callbacks: the panes' loaders depend on them, so new identities would re-fetch in a loop.
  const say = useCallback((m: string) => { setMessage(m); setError(""); }, []);
  const fail = useCallback((reason: unknown) => { setError(errorText(reason)); setMessage(""); }, []);
  return <section className="panel money-hub">
    <div className="panel-head"><div><p className="eyebrow">MONEY HUB</p><h2>Balances, envelopes and lists</h2></div>
      <small className="muted">Manual entry only. Sakuna never buys, pays or transfers.</small></div>
    <div className="tab-bar" role="tablist">{(["Balance", "Wish list", "Buy list"] as Tab[]).map(item =>
      <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? "selected" : ""} onClick={() => { setTab(item); setMessage(""); setError(""); }}>{item}</button>)}</div>
    {message && <p className="success-note">{message}</p>}{error && <p className="warning-copy">{error}</p>}
    {tab === "Balance" && <BalancePane token={token} cur={defaultCurrency} say={say} fail={fail}/>}
    {tab === "Wish list" && <WishPane token={token} cur={defaultCurrency} say={say} fail={fail}/>}
    {tab === "Buy list" && <BuyPane token={token} cur={defaultCurrency} say={say} fail={fail}/>}
  </section>;
}

type PaneProps = { token: string; cur: string; say: (m: string) => void; fail: (r: unknown) => void };

function BalancePane({ token, cur, say, fail }: PaneProps) {
  const [balance, setBalance] = useState<Row>({});
  const [accounts, setAccounts] = useState<Row[]>([]);
  const [envelopes, setEnvelopes] = useState<Row[]>([]);
  const [acc, setAcc] = useState({ name: "", account_type: "bank", currency: cur, balance: "" });
  const [env, setEnv] = useState({ name: "", kind: "fun", currency: cur, monthly_amount: "", categories: "shopping" });
  const load = useCallback(() => {
    Promise.all([apiRequest<Row>("/money/balance", token), apiRequest<Row[]>("/money/accounts", token), apiRequest<Row[]>("/money/envelopes", token)])
      .then(([b, a, e]) => { setBalance(b); setAccounts(a); setEnvelopes(e); }).catch(fail);
  }, [token, fail]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) { try { await work; say(note); load(); } catch (reason) { fail(reason); } }

  function addAccount(event: FormEvent) {
    event.preventDefault();
    void run(apiRequest("/money/accounts", token, postJson({ ...acc, balance: acc.balance || "0" })).then(() => setAcc({ ...acc, name: "", balance: "" })), "Account added.");
  }
  function reconcile(row: Row) {
    const value = window.prompt(`What does ${row.name} show right now? (${row.currency})`, String(row.balance));
    if (value === null) return;
    const amount = value.replace(/,/g, "").trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(amount)) { fail(new Error("Enter a number like 12500.50")); return; }
    const note = window.prompt("Note (optional)", "") ?? "";
    void run(apiRequest(`/money/accounts/${row.id}/reconcile`, token, postJson({ balance: amount, ...(note ? { note } : {}) })), "Balance updated. The difference was recorded as an adjustment.");
  }
  function addEnvelope(event: FormEvent) {
    event.preventDefault();
    const categories = env.categories.split(",").map(c => c.trim()).filter(c => EXPENSE_CATS.includes(c));
    void run(apiRequest("/money/envelopes", token, postJson({ ...env, categories })).then(() => setEnv({ ...env, name: "", monthly_amount: "" })), "Envelope created.");
  }
  const views: Row[] = balance.currencies || [];

  return <div className="money-pane">
    <div className="money-cards">{views.length ? views.map(v => <div className="money-card" key={v.currency}>
      <small className="muted">{v.currency} · {v.accounts} account{v.accounts === 1 ? "" : "s"}</small>
      <div className="money-big">{fmt(v.safe_to_spend, v.currency)}</div><small>safe to spend</small>
      <dl>
        <dt>Have now</dt><dd>{fmt(v.have_now)}</dd>
        <dt>In savings</dt><dd>{fmt(v.in_savings)}</dd>
        <dt>Committed (30 days)</dt><dd>{fmt(v.committed_30_days)}</dd>
        <dt>Runway</dt><dd>{v.runway_months != null ? `${v.runway_months} months` : "needs spending history"}</dd>
        {v.next_month_forecast && <><dt>Next month</dt><dd>{fmt(v.next_month_forecast.low)} – {fmt(v.next_month_forecast.high)}</dd></>}
      </dl>
      {v.stale_accounts?.length > 0 && <small className="warning-copy">Not checked this week: {v.stale_accounts.join(", ")}</small>}
    </div>) : <div className="empty-state">Add your accounts (cash, bank, wallet, savings) to see what is safe to spend.</div>}</div>

    <div className="grid main-grid">
      <div>
        <h3>Accounts</h3>
        {accounts.map(row => <div className="money-row" key={row.id}>
          <div><b>{row.name}</b><small className="muted">{row.account_type} · updated {row.balance_as_of ? new Date(row.balance_as_of).toLocaleDateString() : "never"}</small></div>
          <b>{fmt(row.balance, row.currency)}</b>
          <div className="row-actions"><button className="text-button" onClick={() => reconcile(row)}>Reconcile</button>
            <button className="danger-link" onClick={() => { if (window.confirm(`Archive ${row.name}? Its history is kept.`)) void run(apiRequest(`/money/accounts/${row.id}`, token, patchJson({ archived: true })), "Archived."); }}>Archive</button></div>
        </div>)}
        <form className="inline-form" onSubmit={addAccount}>
          <input value={acc.name} onChange={e => setAcc({ ...acc, name: e.target.value })} placeholder="Account name" required maxLength={200}/>
          <select value={acc.account_type} onChange={e => setAcc({ ...acc, account_type: e.target.value })}>{["bank", "cash", "wallet", "savings", "other"].map(t => <option key={t}>{t}</option>)}</select>
          <input value={acc.currency} onChange={e => setAcc({ ...acc, currency: e.target.value.toUpperCase() })} maxLength={3} className="cur-input" aria-label="Currency"/>
          <input value={acc.balance} onChange={e => setAcc({ ...acc, balance: e.target.value })} placeholder="Balance" inputMode="decimal"/>
          <button className="primary" disabled={!acc.name.trim()}>Add</button>
        </form>
        <p className="muted small-copy">No bank logins or passwords are stored. Reconcile weekly: differences are kept as adjustments, never overwritten silently.</p>
      </div>
      <div>
        <h3>Envelopes · this month</h3>
        {envelopes.map(e => <div className="envelope" key={e.id}>
          <div className="envelope-head"><b>{e.name}</b><small className="muted">{e.kind}</small>
            <span className={e.over ? "over" : ""}>{fmt(e.left, e.currency)} left</span>
            <button className="danger-link" aria-label={`Delete ${e.name}`} onClick={() => { if (window.confirm(`Delete envelope ${e.name}?`)) void run(apiRequest(`/money/envelopes/${e.id}`, token, { method: "DELETE" }), "Envelope deleted."); }}>×</button></div>
          <div className="progress"><span className={e.over ? "over" : ""} style={{ width: `${Math.min(100, e.used_percent ?? 0)}%` }}/></div>
          <small className="muted">{fmt(e.spent)} of {fmt(e.monthly_amount, e.currency)} · {e.categories.join(", ") || "no categories yet"}{e.over ? " · over budget (a warning, not a block)" : ""}</small>
        </div>)}
        <form className="inline-form" onSubmit={addEnvelope}>
          <input value={env.name} onChange={e => setEnv({ ...env, name: e.target.value })} placeholder="Envelope (e.g. Fun money)" required maxLength={64}/>
          <select value={env.kind} onChange={e => setEnv({ ...env, kind: e.target.value })}>{["needs", "fun", "savings", "goal", "other"].map(t => <option key={t}>{t}</option>)}</select>
          <input value={env.monthly_amount} onChange={e => setEnv({ ...env, monthly_amount: e.target.value })} placeholder="Monthly" inputMode="decimal" required/>
          <input value={env.categories} onChange={e => setEnv({ ...env, categories: e.target.value })} placeholder="Categories: food, shopping" title={`Expense categories: ${EXPENSE_CATS.join(", ")}`}/>
          <button className="primary" disabled={!env.name.trim() || !env.monthly_amount}>Add</button>
        </form>
      </div>
    </div>
  </div>;
}

function WishPane({ token, cur, say, fail }: PaneProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ name: "", price: "", currency: cur, priority: "2", cooling_days: "7", link: "", target_date: "" });
  const [check, setCheck] = useState<Row | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const load = useCallback(() => { apiRequest<Row[]>(`/money/wishlist${showClosed ? "?include_closed=true" : ""}`, token).then(setRows).catch(fail); }, [token, showClosed, fail]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) { try { await work; say(note); load(); } catch (reason) { fail(reason); } }
  function add(event: FormEvent) {
    event.preventDefault();
    const body = { name: form.name, currency: form.currency, priority: Number(form.priority), cooling_days: Number(form.cooling_days),
      ...(form.price ? { price: form.price.replace(/,/g, "") } : {}), ...(form.link.trim() ? { link: form.link.trim() } : {}), ...(form.target_date ? { target_date: form.target_date } : {}) };
    void run(apiRequest("/money/wishlist", token, postJson(body)).then(() => setForm({ ...form, name: "", price: "", link: "", target_date: "" })), `Added. It can be marked ready after ${form.cooling_days} day(s).`);
  }
  async function affordability(row: Row) { try { setCheck(await apiRequest<Row>(`/money/wishlist/${row.id}/affordability`, token)); } catch (reason) { fail(reason); } }
  function bought(row: Row) {
    const paid = window.prompt(`You bought “${row.name}”. How much did you pay? (${row.currency}) It will be logged as an expense.`, row.price ? String(row.price) : "");
    if (paid === null) return;
    void run(apiRequest(`/money/wishlist/${row.id}/decide`, token, postJson({ action: "bought", ...(paid.trim() ? { amount: paid.replace(/,/g, "") } : { record_expense: false }) })), "Marked as bought.");
  }

  return <div className="money-pane">
    <form className="inline-form" onSubmit={add}>
      <span className="with-mic"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="What do you want?" required maxLength={200}/>
        <VoiceButton onText={spoken => setForm(f => ({ ...f, name: appendSpeech(f.name, spoken) }))}/></span>
      <input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="Price" inputMode="decimal"/>
      <input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={3} className="cur-input" aria-label="Currency"/>
      <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} aria-label="Priority"><option value="1">Must</option><option value="2">Nice</option><option value="3">Someday</option></select>
      <select value={form.cooling_days} onChange={e => setForm({ ...form, cooling_days: e.target.value })} aria-label="Cooling-off"><option value="0">No wait</option><option value="7">Wait 7 days</option><option value="14">Wait 14 days</option><option value="30">Wait 30 days (big)</option></select>
      <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} placeholder="Link (optional)" maxLength={500}/>
      <label className="inline-check" title="When you'd like it by (optional)">🎯 by <input type="date" value={form.target_date} onChange={e => setForm({ ...form, target_date: e.target.value })}/></label>
      <button className="primary" disabled={!form.name.trim()}>Add wish</button>
    </form>
    <label className="inline-check"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)}/> Show bought and skipped</label>
    {check && <div className="notice-card afford"><b>Can I afford “{rows.find(r => r.id === check.wish_id)?.name || "this"}”?</b>
      {(check.lines as string[]).map((line, i) => <p key={i}>{line}</p>)}<small className="muted">These are your numbers; the decision is yours.</small>
      <button className="text-button" onClick={() => setCheck(null)}>Close</button></div>}
    <div className="card-list">{rows.map(row => <div className={`wish-row state-${row.state}`} key={row.id}>
      <div><b>{row.name}</b>{row.price != null && <span> · {fmt(row.price, row.currency)}</span>}
        <small className="muted">{row.state === "waiting" ? `⏳ cooling off · ${row.days_left} day(s) left` : row.state === "ready" ? "✓ ready, if you still want it" : row.state}
          {" · "}{["", "must", "nice", "someday"][row.priority]}{row.target_date ? ` · 🎯 by ${new Date(`${row.target_date}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}` : ""}{row.link && /^https?:\/\//i.test(row.link) ? <> · <a href={row.link} target="_blank" rel="noopener noreferrer">link ↗</a></> : null}</small></div>
      <div className="row-actions">{row.status === "active" ? <>
        {row.price != null && <button className="text-button" onClick={() => void affordability(row)}>Afford?</button>}
        <button className="text-button" onClick={() => { const p = window.prompt("New price", row.price ?? ""); if (p) void run(apiRequest(`/money/wishlist/${row.id}`, token, patchJson({ price: p.replace(/,/g, "") })), "Price noted."); }}>Price</button>
        <button className="text-button" onClick={() => { const d = window.prompt("Target date (YYYY-MM-DD), empty to clear", row.target_date || ""); if (d !== null && (d === "" || /^\d{4}-\d{2}-\d{2}$/.test(d))) void run(apiRequest(`/money/wishlist/${row.id}`, token, patchJson({ target_date: d || null })), "Date saved."); }}>Date</button>
        <button className="text-button" onClick={() => bought(row)}>Bought</button>
        <button className="text-button" onClick={() => void run(apiRequest(`/money/wishlist/${row.id}/decide`, token, postJson({ action: "skipped" })), "Skipped. You won't be reminded again.")}>Skip</button>
      </> : <button className="text-button" onClick={() => void run(apiRequest(`/money/wishlist/${row.id}/decide`, token, postJson({ action: "reopen" })), "Reopened.")}>Reopen</button>}
        <button className="danger-link" aria-label={`Delete ${row.name}`} onClick={() => { if (window.confirm(`Delete “${row.name}”?`)) void run(apiRequest(`/money/wishlist/${row.id}`, token, { method: "DELETE" }), "Deleted."); }}>×</button></div>
    </div>)}
      {!rows.length && <div className="empty-state">Wishes wait for a cooling-off period before they are “ready”. It's a gentle pause, not a rule.</div>}</div>
  </div>;
}

function BuyPane({ token, cur, say, fail }: PaneProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ name: "", qty: "1", unit: "", est_price: "", list_name: "groceries", staple: false, need_by: "" });
  const [selected, setSelected] = useState<string[]>([]);
  const load = useCallback(() => { apiRequest<Row[]>("/money/buy-list", token).then(setRows).catch(fail); }, [token, fail]);
  useEffect(() => { load(); }, [load]);
  async function run(work: Promise<unknown>, note: string) { try { await work; say(note); setSelected([]); load(); } catch (reason) { fail(reason); } }
  function add(event: FormEvent) {
    event.preventDefault();
    const body = { name: form.name, qty: form.qty || "1", list_name: form.list_name || "groceries", currency: cur, staple: form.staple,
      ...(form.unit ? { unit: form.unit } : {}), ...(form.est_price ? { est_price: form.est_price.replace(/,/g, "") } : {}), ...(form.need_by ? { need_by: form.need_by } : {}) };
    void run(apiRequest("/money/buy-list", token, postJson(body)).then(() => setForm({ ...form, name: "", qty: "1", unit: "", est_price: "", staple: false, need_by: "" })), "Added to the buy list.");
  }
  function checkout() {
    const items = rows.filter(r => selected.includes(r.id));
    const estimate = items.reduce((n, r) => n + Number(r.est_price || 0), 0);
    const paid = window.prompt(`Bought ${items.length} item(s). Total paid (${cur})? It will be logged as one expense.`, estimate ? String(estimate) : "");
    if (paid === null) return;
    void run(apiRequest("/money/buy-list/checkout", token, postJson({ item_ids: selected, currency: cur, ...(paid.trim() ? { amount: paid.replace(/,/g, "") } : {}) })), "Checked off and logged as an expense.");
  }
  const open = rows.filter(r => !r.checked_at);
  const done = rows.filter(r => r.checked_at);
  const total = open.reduce((n, r) => n + (r.currency === cur ? Number(r.est_price || 0) : 0), 0);
  const lists = Array.from(new Set(open.map(r => r.list_name)));

  return <div className="money-pane">
    <form className="inline-form" onSubmit={add}>
      <span className="with-mic"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Item (or say “rice and eggs”)" required maxLength={200}/>
        <VoiceButton onText={spoken => setForm(f => ({ ...f, name: appendSpeech(f.name, spoken) }))}/></span>
      <input value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" inputMode="decimal" className="qty-input" aria-label="Quantity"/>
      <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="Unit" maxLength={16} className="qty-input"/>
      <input value={form.est_price} onChange={e => setForm({ ...form, est_price: e.target.value })} placeholder={`Est. ${cur}`} inputMode="decimal"/>
      <input value={form.list_name} onChange={e => setForm({ ...form, list_name: e.target.value })} placeholder="List" maxLength={32} list="buy-lists"/>
      <datalist id="buy-lists">{["groceries", "household", "pharmacy", "market"].map(l => <option key={l} value={l}/>)}</datalist>
      <label className="inline-check"><input type="checkbox" checked={form.staple} onChange={e => setForm({ ...form, staple: e.target.checked })}/> staple</label>
      <label className="inline-check" title="Need it by (optional)">📅 by <input type="date" value={form.need_by} onChange={e => setForm({ ...form, need_by: e.target.value })}/></label>
      <button className="primary" disabled={!form.name.trim()}>Add</button>
    </form>
    <div className="buy-bar"><span>{open.length} to buy · est. {fmt(total, cur)}</span>
      <button className="primary" disabled={!selected.length} onClick={checkout}>Bought selected ({selected.length})</button>
      <button className="outline" onClick={() => void run(apiRequest<Row>("/money/buy-list/restock", token, { method: "POST" }), "Staples are back on the list.")}>Restock staples</button></div>
    {lists.map(list => <div key={list}><h3 className="list-title">{list}</h3>
      {open.filter(r => r.list_name === list).map(row => <label className="buy-row" key={row.id}>
        <input type="checkbox" checked={selected.includes(row.id)} onChange={e => setSelected(s => e.target.checked ? [...s, row.id] : s.filter(id => id !== row.id))}/>
        <span><b>{row.name}</b> <small className="muted">{Number(row.qty) !== 1 || row.unit ? `${Number(row.qty)} ${row.unit || ""}` : ""}{row.staple ? " · staple" : ""}{row.need_by ? ` · 📅 by ${new Date(`${row.need_by}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}</small></span>
        <span className="muted">{row.est_price != null ? fmt(row.est_price, row.currency) : ""}</span>
        <button type="button" className="danger-link" aria-label={`Delete ${row.name}`} onClick={() => void run(apiRequest(`/money/buy-list/${row.id}`, token, { method: "DELETE" }), "Removed.")}>×</button>
      </label>)}</div>)}
    {!open.length && <div className="empty-state">Nothing to buy. Add items, or restock your staples.</div>}
    {done.length > 0 && <details className="job-closed"><summary>Bought recently ({done.length})</summary>
      {done.slice(0, 30).map(row => <div className="job-closed-row" key={row.id}><span>{row.name}</span><small className="muted">{new Date(row.checked_at).toLocaleDateString()}</small>
        <button className="text-button" onClick={() => void run(apiRequest(`/money/buy-list/${row.id}`, token, patchJson({ checked: false })), "Back on the list.")}>Undo</button></div>)}</details>}
  </div>;
}
