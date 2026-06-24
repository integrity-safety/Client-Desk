import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, setCsrf } from '../api.js';

const STATUS_TONE = {
  'Submitted': 'submitted', 'Accepted': 'accepted', 'In progress': 'inprogress',
  'Needs your input': 'needs', 'Completed': 'done', 'Declined': 'declined',
};
const timeShort = (s) => new Date(s.replace(' ', 'T')).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDay = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export default function Portal({ user, client, onSignOut, initialTicketId, onTicketConsumed }) {
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(initialTicketId ? Number(initialTicketId) : null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(() => api.portalTickets().then((d) => setTickets(d.tickets)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  // If we arrived from an email link (?ticket=N), open it once and tidy the URL.
  useEffect(() => { if (initialTicketId && onTicketConsumed) onTicketConsumed(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const signOut = async () => { await api.logout(); setCsrf(null); onSignOut(); };

  return (
    <div className="portal">
      <header className="portal-head">
        <div className="portal-brand">
          <h1>{client.name}</h1>
          <span>Request portal</span>
        </div>
        <div className="portal-user">
          <span>{user.name || user.email}</span>
          <button className="btn sm ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main className="portal-main">
        {openId ? (
          <TicketDetail id={openId} onBack={() => { setOpenId(null); load(); }} />
        ) : (
          <>
            <div className="portal-top">
              <h2>Your requests</h2>
              <button className="btn primary" onClick={() => setComposing(true)}>New request</button>
            </div>

            {composing && <NewTicket onClose={() => setComposing(false)} onCreated={() => { setComposing(false); load(); }} />}

            {tickets === null ? <p className="none">Loading…</p>
              : tickets.length === 0 ? (
                <div className="portal-empty">
                  <h3>No requests yet</h3>
                  <p>Submit your first request and you'll be able to track its progress here.</p>
                </div>
              ) : (
                <div className="ticket-list">
                  {tickets.map((t) => (
                    <button className="ticket-row" key={t.id} onClick={() => setOpenId(t.id)}>
                      <span className="tk-main">
                        <span className="tk-title">{t.title}</span>
                        <span className="tk-date">
                          {t.targetDate ? `Target: ${fmtDay(t.targetDate)}`
                            : t.requestedDate ? `Requested by ${fmtDay(t.requestedDate)}`
                            : `Submitted ${new Date(t.createdAt.replace(' ', 'T')).toLocaleDateString()}`}
                        </span>
                      </span>
                      {t.unread > 0 && <span className="tk-unread">{t.unread} new</span>}
                      <span className={'tk-status ' + (STATUS_TONE[t.status] || 'submitted')}>{t.status}</span>
                    </button>
                  ))}
                </div>
              )}
          </>
        )}
      </main>
    </div>
  );
}

function NewTicket({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!title.trim()) { setErr('Please add a short title'); return; }
    setBusy(true); setErr('');
    try { await api.portalCreate({ title: title.trim(), body: body.trim(), requestedDate: requestedDate || null }); onCreated(); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="portal-card">
      <h3>New request</h3>
      <div className="field"><label>What do you need?</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" autoFocus /></div>
      <div className="field"><label>Details</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Anything that helps us understand the request" /></div>
      <div className="field" style={{ maxWidth: 260 }}><label>Requested completion date <span className="hint">— optional</span></label>
        <input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} /></div>
      {err && <p className="auth-error">{err}</p>}
      <div className="portal-card-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
      </div>
    </div>
  );
}

function TicketDetail({ id, onBack }) {
  const [t, setT] = useState(null);
  const [draft, setDraft] = useState('');
  const lastCount = useRef(0);
  // On the first load, a missing/foreign ticket (e.g. a stale email link) bounces back to the list.
  // Transient poll errors after a successful load are ignored.
  const load = useCallback(() => api.portalTicket(id)
    .then((d) => { setT(d); lastCount.current = d.messages.length; })
    .catch(() => { setT((cur) => { if (!cur) onBack(); return cur; }); }), [id, onBack]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [load]);

  const reply = async () => {
    const body = draft.trim(); if (!body) return;
    setDraft('');
    try { await api.portalReply(id, body); load(); } catch { /* */ }
  };
  if (!t) return <p className="none">Loading…</p>;

  return (
    <div className="ticket-detail">
      <button className="link-back" onClick={onBack}>← All requests</button>
      <div className="td-head">
        <h2>{t.title}</h2>
        <span className={'tk-status ' + (STATUS_TONE[t.status] || 'submitted')}>{t.status}</span>
      </div>
      {(t.requestedDate || t.targetDate) && (
        <div className="td-dates">
          {t.requestedDate && <span><b>You requested:</b> {fmtDay(t.requestedDate)}</span>}
          {t.targetDate && <span className="confirmed"><b>Target date:</b> {fmtDay(t.targetDate)}</span>}
          {t.requestedDate && !t.targetDate && <span className="pending">Not yet confirmed</span>}
        </div>
      )}
      {t.body && <p className="td-body">{t.body}</p>}

      <div className="td-thread">
        <h4>Messages</h4>
        {t.messages.length === 0 ? <p className="none">No messages yet. If we need anything, we'll post it here.</p>
          : t.messages.map((m) => (
            <div className={'td-msg' + (m.fromTeam ? ' team' : ' me')} key={m.id}>
              <span className="td-msg-who">{m.fromTeam ? m.author : 'You'} · {timeShort(m.createdAt)}</span>
              <div className="td-bubble">{m.body}</div>
            </div>
          ))}
      </div>

      {t.status !== 'Completed' && t.status !== 'Declined' && (
        <div className="td-reply">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a reply…"
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(); } }} />
          <button className="btn primary" onClick={reply}>Send</button>
        </div>
      )}
    </div>
  );
}
