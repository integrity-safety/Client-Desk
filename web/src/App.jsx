import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setCsrf } from './api.js';
import Login, { AcceptInvite, ResetPassword } from './components/Login.jsx';
import { Modal, Confirm, ClientModal, TaskModal, ImportModal } from './components/Modals.jsx';
import Calendar from './components/Calendar.jsx';
import Messages from './components/Messages.jsx';
import Portal from './components/Portal.jsx';
import TVDashboard from './components/TVDashboard.jsx';
import { DateWarn } from './dateflags.jsx';
import { applyTheme, PRESETS } from './theme.js';

const STATUS_LABEL = { todo: 'To do', inprogress: 'In progress', blocked: 'Blocked', done: 'Done' };
const STATUS_ORDER = ['todo', 'inprogress', 'blocked', 'done'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const STALE_DAYS = 14;
const daysSince = (s) => s ? Math.floor((Date.now() - new Date(s.replace(' ', 'T')).getTime()) / 86400000) : 0;
const isStale = (t) => t.status !== 'done' && daysSince(t.updatedAt || t.createdAt) >= STALE_DAYS;
const fmtDate = (d) => d ? new Date(d.length <= 10 ? d + 'T00:00:00' : d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const fmtLong = (d) => new Date(d).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
const todayStr = () => new Date().toLocaleDateString('en-CA');
const inviteToken = () => new URLSearchParams(window.location.search).get('invite');
const resetToken = () => new URLSearchParams(window.location.search).get('reset');
const ticketParam = () => { const v = new URLSearchParams(window.location.search).get('ticket'); return v && /^\d+$/.test(v) ? v : null; };
const clearInviteFromUrl = () => window.history.replaceState({}, '', window.location.pathname);
const clearTicketFromUrl = () => window.history.replaceState({}, '', window.location.pathname);
const readRoute = () => (window.location.hash || '').replace(/^#\/?/, '');

// Turns a task_event into a short human sentence, shared by the live note and the Activity list.
function eventText(e) {
  const who = e.actor || 'Someone';
  const t = `“${e.title || 'a task'}”`;
  switch (e.action) {
    case 'created':  return `${who} added ${t}`;
    case 'deleted':  return `${who} deleted ${t}`;
    case 'assigned': return e.to && e.to !== 'Unassigned' ? `${who} assigned ${t} to ${e.to}` : `${who} unassigned ${t}`;
    case 'due':      return e.to ? `${who} set ${t} due ${fmtDate(e.to)}` : `${who} cleared the due date on ${t}`;
    case 'status':
      if (e.to === 'done')       return `${who} completed ${t}`;
      if (e.to === 'inprogress') return `${who} started ${t}`;
      if (e.to === 'blocked')    return `${who} marked ${t} blocked`;
      if (e.to === 'todo')       return `${who} reopened ${t}`;
      return `${who} updated ${t}`;
    default: return `${who} updated ${t}`;
  }
}

export default function App() {
  const [boot, setBoot] = useState({ loading: true });
  const [user, setUser] = useState(null);
  const [kind, setKind] = useState('team');
  const [portalClient, setPortalClient] = useState(null);
  const [workspace, setWorkspace] = useState('');
  const [theme, setTheme] = useState('');
  const [clients, setClients] = useState([]);
  const [members, setMembers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [tab, setTab] = useState('today');
  const [selectedId, setSelectedId] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [today, setToday] = useState({ overdue: [], today: [], reminders: [] });
  const [scope, setScope] = useState('mine');
  const [chatUnread, setChatUnread] = useState(0);
  const [ticketAlert, setTicketAlert] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const [liveNotes, setLiveNotes] = useState([]);
  const [liveTick, setLiveTick] = useState(0);
  const [route, setRoute] = useState(readRoute);
  const tvMode = route === 'tv';

  const flash = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 2400); }, []);

  // Track the URL hash so /#tv flips into the read-only TV dashboard (and back).
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Apply the identity returned by /auth/me. Used at boot and after every sign-in,
  // so the right surface (team app vs requester portal) renders immediately.
  const applySession = useCallback((r) => {
    setCsrf(r.csrf); setUser(r.user); setKind(r.kind || 'team');
    setWorkspace(r.workspace || ''); setTheme(r.theme || ''); applyTheme(r.theme || '');
    setPortalClient(r.kind === 'requester' ? (r.client || null) : null);
  }, []);
  const reloadMe = useCallback(() => api.me().then((r) => { if (r.user) applySession(r); return r; }), [applySession]);

  // --- boot ---
  useEffect(() => {
    api.me().then((r) => {
      if (r.user) applySession(r);
      setBoot({ loading: false, needsSetup: !!r.needs_setup, invite: inviteToken(), reset: resetToken(), ticket: ticketParam() });
    }).catch(() => setBoot({ loading: false, needsSetup: false, invite: inviteToken(), reset: resetToken(), ticket: ticketParam() }));
  }, [applySession]);

  const loadClients = useCallback(() => api.clients().then((r) => setClients(r.clients)), []);
  const loadToday = useCallback((sc) => api.today(sc).then(setToday), []);
  const reminderDelete = useCallback((id) => api.deleteTimeline(id).then(() => loadToday(scope)).catch(() => {}), [loadToday, scope]);
  const reminderUpdate = useCallback((id, patch) => api.updateTimeline(id, patch).then(() => loadToday(scope)).catch(() => {}), [loadToday, scope]);
  const loadTasks = useCallback((cid) => api.tasks(cid).then((r) => setTasks(r.tasks)), []);
  const loadMembers = useCallback(() => api.team().then((r) => setMembers(r.members || [])), []);
  const loadHolidays = useCallback(() => api.holidays().then((r) => setHolidays(r.holidays || [])).catch(() => {}), []);

  useEffect(() => { if (user && kind === 'team' && !tvMode) { loadClients(); loadMembers(); loadHolidays(); } }, [user, kind, tvMode, loadClients, loadMembers, loadHolidays]);
  useEffect(() => { if (user && kind === 'team' && !tvMode) loadToday(scope); }, [user, kind, tvMode, scope, loadToday]);
  useEffect(() => { if (user && kind === 'team' && !tvMode && tab === 'client' && selectedId) loadTasks(selectedId); }, [user, kind, tvMode, tab, selectedId, loadTasks]);

  // Background poll for the Messages unread badge (Messages view updates it live too).
  useEffect(() => {
    if (!user || kind !== 'team' || tvMode) return;
    let alive = true;
    const tick = () => api.conversations().then((d) => { if (alive) setChatUnread(d.unreadTotal); }).catch(() => {});
    tick();
    const t = setInterval(tick, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [user, kind, tvMode]);

  // Requests badge: queue size + unread replies.
  const loadTicketAlert = useCallback(() => api.tickets().then((d) => {
    const unread = d.tickets.reduce((n, t) => n + (t.unread || 0), 0);
    setTicketAlert(d.queue + unread);
  }).catch(() => {}), []);
  useEffect(() => {
    if (!user || kind !== 'team' || tvMode) return;
    let alive = true;
    loadTicketAlert();
    const t = setInterval(() => { if (alive) loadTicketAlert(); }, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [user, kind, tvMode, loadTicketAlert]);

  // Reviews badge: how many tasks others have flagged for review with me.
  const loadReviewCount = useCallback(() => api.reviews().then((d) => {
    setReviewCount((d.forMe || []).reduce((n, g) => n + g.tasks.length, 0));
  }).catch(() => {}), []);
  useEffect(() => {
    if (!user || kind !== 'team' || tvMode) return;
    loadReviewCount();
  }, [user, kind, tvMode, loadReviewCount, liveTick]);

  const refresh = useCallback(async () => {
    await loadClients(); await loadToday(scope);
    if (tab === 'client' && selectedId) await loadTasks(selectedId);
  }, [loadClients, loadToday, scope, loadTasks, tab, selectedId]);

  // Live task updates. A cheap "what changed?" poll every ~2.5s; when something
  // actually changed we refresh whatever's on screen and surface a short note for
  // teammates' actions (never your own). Paused while the tab is in the background.
  // Read-only and team-only — requesters never reach /tasks/changes.
  const liveCursor = useRef(null);
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!user || kind !== 'team' || tvMode) return;
    let alive = true;
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const r = await api.tasksChanges(liveCursor.current);
        if (!alive) return;
        if (liveCursor.current == null) { liveCursor.current = r.cursor; return; } // prime: no backlog
        if (r.events && r.events.length) {
          liveCursor.current = r.cursor;
          const others = r.events.filter((e) => String(e.actorId) !== String(user.id));
          if (others.length) {
            const notes = others.slice(-3).map((e) => ({ id: e.id, text: eventText(e) }));
            setLiveNotes((cur) => [...cur, ...notes].slice(-3));
            notes.forEach((n) => setTimeout(() => setLiveNotes((cur) => cur.filter((x) => x.id !== n.id)), 5200));
          }
          refreshRef.current();          // reflect the change in the task list / Today
          setLiveTick((n) => n + 1);     // nudge the Calendar to reload if it's open
        }
      } catch { /* transient poll error — ignore */ }
    };
    const iv = setInterval(tick, 2500);
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    tick();
    return () => { alive = false; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [user, kind, tvMode]);

  if (boot.loading) return <div className="boot">Loading…</div>;

  // Password-reset link (signed out): set a new password, then back to sign in.
  if (!user && boot.reset) {
    return <ResetPassword token={boot.reset}
      onDone={() => { clearInviteFromUrl(); setBoot((b) => ({ ...b, reset: null })); }} />;
  }
  // Invite link takes priority when not already signed in.
  if (!user && boot.invite) {
    return <AcceptInvite token={boot.invite}
      onAuthed={() => { clearInviteFromUrl(); setBoot((b) => ({ ...b, invite: null })); reloadMe(); }}
      onInvalid={() => { clearInviteFromUrl(); setBoot((b) => ({ ...b, invite: null })); }} />;
  }
  if (!user) return <Login needsSetup={boot.needsSetup} onAuthed={() => reloadMe()} />;

  if (kind === 'requester') {
    return <Portal user={user} client={portalClient || { name: 'Requests' }}
      initialTicketId={boot.ticket}
      onTicketConsumed={() => { clearTicketFromUrl(); setBoot((b) => ({ ...b, ticket: null })); }}
      onSignOut={() => { setUser(null); setKind('team'); }} />;
  }

  // Read-only office TV view at /#tv (team members only; requesters handled above).
  if (tvMode) return <TVDashboard onExit={() => { window.location.hash = ''; }} />;

  const selected = clients.find((c) => String(c.id) === String(selectedId)) || null;
  const briefCount = today.overdue.length + today.today.length;
  const isAdmin = user.role === 'admin';

  // --- actions ---
  const saveClient = async (data) => {
    try {
      if (modal.client) await api.updateClient(modal.client.id, data);
      else { const r = await api.createClient(data); setSelectedId(r.id); setTab('client'); }
      setModal(null); await refresh();
    } catch (e) { flash(e.message); }
  };
  const deleteClient = (client) => setModal({ type: 'confirm',
    title: 'Delete client', message: `Delete ${client.name} and all their tasks? This can't be undone.`,
    confirmLabel: 'Delete client', danger: true,
    onConfirm: async () => { await api.deleteClient(client.id); if (String(selectedId) === String(client.id)) { setSelectedId(null); setTab('today'); } await refresh(); } });

  const saveTask = async (data) => {
    try {
      if (modal.task) await api.updateTask(modal.task.id, data);
      else await api.createTask({ ...data, clientId: selected.id });
      setModal(null); await refresh();
      setLiveTick((n) => n + 1); loadReviewCount();   // refresh Reviews view + badge
    } catch (e) { flash(e.message); }
  };
  const changeStatus = async (t, status) => { try { await api.updateTask(t.id, { status }); await refresh(); } catch (e) { flash(e.message); } };
  const deleteTask = (t) => setModal({ type: 'confirm',
    title: 'Delete task',
    message: t.fromRequest
      ? `Delete "${t.title}"? This task came from a request${t.requester ? ` by ${t.requester}` : ''}. Deleting it will cancel that request and email the requester. This can't be undone.`
      : `Delete "${t.title}"? This can't be undone.`,
    confirmLabel: 'Delete', danger: true,
    onConfirm: async () => { await api.deleteTask(t.id); await refresh(); } });

  const doImport = async (text) => {
    let d; try { d = JSON.parse(text); } catch { flash("That isn't valid backup text"); return; }
    if (!Array.isArray(d.clients) || !Array.isArray(d.tasks)) { flash("That isn't a Client Desk backup"); return; }
    try { const r = await api.import(d); setModal(null); await refresh(); flash(`Imported ${r.clients} clients, ${r.tasks} tasks`); }
    catch (e) { flash(e.message); }
  };

  const logout = async () => { await api.logout(); setCsrf(null); liveCursor.current = null; setLiveNotes([]); setUser(null); setClients([]); setTasks([]); setMembers([]); setHolidays([]); setTab('today'); setSelectedId(null); };
  const openTV = () => window.open(window.location.pathname + '#tv', '_blank', 'noopener');

  const saveTheme = async (themeObj) => {
    try {
      const r = await api.setTheme(themeObj);
      setTheme(r.theme); applyTheme(r.theme); flash('Theme updated for the team');
    } catch (e) { flash(e.message); }
  };

  const gotoClient = (id) => { setSelectedId(id); setTab('client'); };
  const memberName = (id) => { const m = members.find((x) => x.id === id); return m ? (m.name || m.email) : ''; };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>Client <span className="mark">Desk</span></h1>
          <p>{workspace || 'Signed in'} · {user.name || user.email}</p>
        </div>

        <div className="today-nav">
          <button className={'today-btn' + (tab === 'today' ? ' active' : '')} onClick={() => setTab('today')}>
            <span className="ti">
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2" /><path d="M2.5 7h13M6 2v3M12 2v3" /></svg>
            </span>
            <span className="tl"><b>Today</b><small>{briefCount === 0 ? 'All clear' : `${briefCount} need${briefCount === 1 ? 's' : ''} attention`}</small></span>
            <span className={'tbadge' + (briefCount === 0 ? ' clear' : '')}>{briefCount === 0 ? '✓' : briefCount}</span>
          </button>
          <button className={'nav-btn' + (tab === 'weekly' ? ' active' : '')} onClick={() => setTab('weekly')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2" /><path d="M2.5 7.5h13M6 2v3M12 2v3M5.5 11h7" /></svg>
            </span>
            <span className="tl"><b>Weekly report</b></span>
          </button>
          <button className={'nav-btn' + (tab === 'calendar' ? ' active' : '')} onClick={() => setTab('calendar')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="13" height="12" rx="2" /><path d="M2.5 7.5h13M6 2v3M12 2v3" /></svg>
            </span>
            <span className="tl"><b>Calendar</b></span>
          </button>
          <button className={'nav-btn' + (tab === 'messages' ? ' active' : '')} onClick={() => setTab('messages')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h12v8H7l-3 2.5V12H3z" /></svg>
            </span>
            <span className="tl"><b>Messages</b></span>
            {chatUnread > 0 && <span className="tbadge">{chatUnread}</span>}
          </button>
          <button className={'nav-btn' + (tab === 'requests' ? ' active' : '')} onClick={() => setTab('requests')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3.5h10v11l-5-2.5-5 2.5z" /></svg>
            </span>
            <span className="tl"><b>Requests</b></span>
            {ticketAlert > 0 && <span className="tbadge">{ticketAlert}</span>}
          </button>
          <button className={'nav-btn' + (tab === 'activity' ? ' active' : '')} onClick={() => setTab('activity')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 9h3l2-5 3 11 2-6h3" /></svg>
            </span>
            <span className="tl"><b>Activity</b></span>
          </button>
          <button className={'nav-btn' + (tab === 'reviews' ? ' active' : '')} onClick={() => setTab('reviews')}>
            <span className="ti">
              <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 4.5h11M3.5 9h11M3.5 13.5h7" /><circle cx="14" cy="13.5" r="2.2" /><path d="M15.6 15.1 17 16.5" /></svg>
            </span>
            <span className="tl"><b>Reviews</b></span>
            {reviewCount > 0 && <span className="tbadge">{reviewCount}</span>}
          </button>
        </div>

        <div className="clients-head">
          <span>Clients</span>
          <button className="icon-btn" title="Add client" onClick={() => setModal({ type: 'client' })}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 4v10M4 9h10" /></svg>
          </button>
        </div>
        <div className="client-list">
          {clients.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13, padding: '10px 12px', margin: 0 }}>No clients yet.</p>
            : clients.map((c) => (
              <button key={c.id} className={'client-item' + (tab === 'client' && String(c.id) === String(selectedId) ? ' active' : '')} onClick={() => gotoClient(c.id)}>
                {c.due_flag && <span className={'due-flag ' + c.due_flag}
                  title={c.due_flag === 'red' ? 'Has a task overdue or due within 3 days' : 'Has a task due within 7 days'} />}
                <span className="nm">{c.name}</span>
                <span className={'count' + (Number(c.open_count) === 0 ? ' zero' : '')}>{c.open_count}</span>
              </button>
            ))}
        </div>
        <div className="sidebar-foot-stack">
          <button className={'team-link' + (tab === 'team' ? ' active' : '')} onClick={() => setTab('team')}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="6" r="2" /><circle cx="11" cy="6.5" r="1.6" /><path d="M2 13c0-2 1.6-3 3.5-3s3.5 1 3.5 3M10 10.2c1.6.1 2.8 1 2.8 2.8" /></svg>
            Team{members.length ? ` · ${members.length}` : ''}
          </button>
          <button className="tv-launch" onClick={openTV} title="Open the office TV dashboard in a new browser tab">
            <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3.5" width="13" height="9" rx="1.5" /><path d="M6.5 15.5h5M9 12.5v3" /></svg>
            TV view
          </button>
          <div className="sidebar-foot">
            <button className="btn sm ghost" onClick={() => setModal({ type: 'import' })}>Import V1</button>
            <button className="btn sm ghost" onClick={logout}>Sign out</button>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === 'team' ? <TeamView isAdmin={isAdmin} meId={user.id} flash={flash} onChanged={loadMembers}
            theme={theme} onTheme={saveTheme} holidays={holidays} onHolidaysChanged={loadHolidays} />
          : tab === 'messages' ? <Messages meId={user.id} members={members} onConvUpdate={setChatUnread} />
          : tab === 'requests' ? <RequestsView isAdmin={isAdmin} holidays={holidays} onGotoClient={gotoClient} onChanged={() => { loadTicketAlert(); refresh(); }} flash={flash} userName={user.name} />
          : tab === 'calendar' ? <Calendar members={members} meId={user.id} holidays={holidays} onGotoClient={gotoClient} flash={flash} reloadSignal={liveTick} />
          : tab === 'activity' ? <ActivityView members={members} clients={clients} onGoto={gotoClient} reloadSignal={liveTick} />
          : tab === 'reviews' ? <ReviewsView meId={user.id} onGoto={gotoClient} onEditTask={(t) => setModal({ type: 'task', task: t })} reloadSignal={liveTick} onChanged={loadReviewCount} flash={flash} />
          : tab === 'clients' ? <MobileClientsView clients={clients} onGoto={gotoClient} onAdd={() => setModal({ type: 'client' })} />
          : tab === 'today' ? <TodayView today={today} scope={scope} onScope={setScope} onStatus={changeStatus} onGoto={gotoClient}
            onReminderDelete={reminderDelete} onReminderUpdate={reminderUpdate} />
          : tab === 'weekly' ? <WeeklyView onGoto={gotoClient} />
          : selected ? <ClientView client={selected} tasks={tasks} memberName={memberName} isAdmin={isAdmin}
            onAddTask={() => setModal({ type: 'task' })}
            onEditTask={(t) => setModal({ type: 'task', task: t })}
            onDeleteTask={deleteTask}
            onStatus={changeStatus}
            onEditClient={() => setModal({ type: 'client', client: selected })} />
          : <Empty onAdd={() => setModal({ type: 'client' })} />}
      </main>

      <nav className="mobilenav" aria-label="Sections">
        <button className={'mn-item' + (tab === 'today' ? ' on' : '')} onClick={() => { setMoreOpen(false); setTab('today'); }}>
          <span className="mn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg></span>
          <span>Today</span>
        </button>
        <button className={'mn-item' + (tab === 'clients' || tab === 'client' ? ' on' : '')} onClick={() => { setMoreOpen(false); setSelectedId(null); setTab('clients'); }}>
          <span className="mn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3.4" /><path d="M22 20v-2a4 4 0 0 0-3-3.8" /><path d="M16 3.2a4 4 0 0 1 0 7.6" /></svg></span>
          <span>Clients</span>
        </button>
        <button className={'mn-item' + (tab === 'messages' ? ' on' : '')} onClick={() => { setMoreOpen(false); setTab('messages'); }}>
          <span className="mn-ic">{chatUnread > 0 && <i className="mn-dot">{chatUnread > 99 ? '99+' : chatUnread}</i>}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" /></svg></span>
          <span>Messages</span>
        </button>
        <button className={'mn-item' + (tab === 'requests' ? ' on' : '')} onClick={() => { setMoreOpen(false); setTab('requests'); }}>
          <span className="mn-ic">{ticketAlert > 0 && <i className="mn-dot">{ticketAlert > 99 ? '99+' : ticketAlert}</i>}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14v15l-7-3.5L5 19z" /></svg></span>
          <span>Requests</span>
        </button>
        <button className={'mn-item' + (moreOpen ? ' on' : '')} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          <span className="mn-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg></span>
          <span>More</span>
        </button>
      </nav>
      {moreOpen && (
        <>
          <div className="more-scrim" onClick={() => setMoreOpen(false)} />
          <div className="more-sheet" role="dialog" aria-label="More">
            <div className="ms-grip" />
            <div className="ms-title">More</div>
            <button className="ms-row" onClick={() => { setMoreOpen(false); setTab('weekly'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7 14h10" /></svg>
              <span>This week</span>
            </button>
            <button className="ms-row" onClick={() => { setMoreOpen(false); setTab('calendar'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>
              <span>Calendar</span>
            </button>
            <button className="ms-row" onClick={() => { setMoreOpen(false); setTab('activity'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2.5-6 4 14 2.5-8H21" /></svg>
              <span>Activity</span>
            </button>
            <button className="ms-row" onClick={() => { setMoreOpen(false); setTab('team'); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8.5" r="2.8" /><circle cx="16.5" cy="9.5" r="2.3" /><path d="M3 19c0-3 2.4-4.5 5-4.5S13 16 13 19M14.5 14.7c2.4.2 4 1.6 4 4.3" /></svg>
              <span>Team</span>
              {members.length > 0 && <span className="ms-n">{members.length}</span>}
            </button>
            <div className="ms-sep" />
            <button className="ms-row danger" onClick={() => { setMoreOpen(false); logout(); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              <span>Sign out</span>
            </button>
          </div>
        </>
      )}

      {modal?.type === 'client' && <ClientModal client={modal.client} onSave={saveClient}
        onDelete={() => { setModal(null); deleteClient(modal.client); }} onClose={() => setModal(null)} />}
      {modal?.type === 'task' && <TaskModal task={modal.task} members={members} holidays={holidays} onSave={saveTask} onClose={() => setModal(null)} />}
      {modal?.type === 'import' && <ImportModal onImport={doImport} onClose={() => setModal(null)} />}
      {modal?.type === 'confirm' && <Confirm {...modal} onClose={() => setModal(null)} />}

      <div className={'toast' + (toast ? ' show' : '')}>{toast}</div>
      {liveNotes.length > 0 && (
        <div className="live-notes">
          {liveNotes.map((n) => (
            <div key={n.id} className="live-note">
              <span className="dot" />
              <span>{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ onAdd }) {
  return (
    <div className="content"><div className="empty">
      <div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg></div>
      <h3>Add your first client</h3>
      <p>Group tasks by client, mark them done as you go, and generate a client-ready report any time.</p>
      <div className="row"><button className="btn primary" onClick={onAdd}>Add a client</button></div>
    </div></div>
  );
}

function relTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const ACTION_TONE = { created: 'todo', status: 'inprogress', assigned: 'accepted', due: 'submitted', deleted: 'declined' };

function ActivityView({ members, clients, onGoto, reloadSignal }) {
  const [rows, setRows] = useState([]);
  const [actor, setActor] = useState('');
  const [client, setClient] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback((before) => {
    setLoading(true);
    return api.activity({ actor: actor || undefined, client: client || undefined, before })
      .then((r) => {
        setHasMore(r.hasMore);
        setRows((cur) => (before ? [...cur, ...r.events] : r.events));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [actor, client]);

  // Reload on filter change and when a live change lands while this page is open.
  useEffect(() => { load(); }, [load, reloadSignal]);

  return (
    <div className="content activity">
      <div className="topbar">
        <div className="who">
          <h2>Activity</h2>
          <p className="sub">Everything the team has done, newest first.</p>
        </div>
        <div className="filters">
          <select value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">Everyone</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {rows.length === 0 && !loading
        ? <div className="empty sm"><p>No activity yet{actor || client ? ' for this filter' : ''}.</p></div>
        : (
          <ul className="activity-list">
            {rows.map((e) => (
              <li key={e.id} className={'activity-row tone-' + (ACTION_TONE[e.action] || 'todo')}>
                <span className="bar" />
                <div className="ac-main">
                  <div className="ac-text">{eventText(e)}</div>
                  <div className="ac-meta">
                    {e.clientName && (
                      e.clientId
                        ? <button className="ac-client" onClick={() => onGoto(e.clientId)}>{e.clientName}</button>
                        : <span className="ac-client static">{e.clientName}</span>
                    )}
                    <span className="ac-time">{relTime(e.at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

      {hasMore && (
        <div className="row center">
          <button className="btn ghost sm" disabled={loading} onClick={() => load(rows[rows.length - 1].id)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewsView({ meId, onGoto, onEditTask, reloadSignal, onChanged, flash }) {
  const [data, setData] = useState({ mine: [], forMe: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return api.reviews()
      .then((d) => setData({ mine: d.mine || [], forMe: d.forMe || [] }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load, reloadSignal]);

  const clear = async (id) => {
    try { await api.clearReview(id); await load(); onChanged && onChanged(); }
    catch (e) { flash && flash(e.message); }
  };

  const item = (t, canClear) => (
    <li key={t.id} className="review-item">
      <div className="ri-head">
        <p className="ri-title">{t.title}</p>
        <span className={'status-pill s-' + t.status}><span className={'d dot ' + t.status} />{STATUS_LABEL[t.status]}</span>
      </div>
      <div className="ri-meta">
        {t.clientName && <button className="ac-client" onClick={() => onGoto(t.clientId)}>{t.clientName}</button>}
      </div>
      {t.notes
        ? <div className="t-note ri-note">
            <span className="t-note-label">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
              Private note
            </span>
            {t.notes}
          </div>
        : <p className="ri-nonote">No private note yet — add your discussion points by opening the task.</p>}
      <div className="ri-actions">
        <button className="btn sm ghost" onClick={() => onEditTask(t)}>Open task</button>
        {canClear && <button className="btn sm" onClick={() => clear(t.id)}>Clear</button>}
      </div>
    </li>
  );

  const groupList = (groups, canClear) => groups.map((g) => (
    <div className="review-group" key={(g.groupId || 'none') + (canClear ? 'm' : 'f')}>
      <h4 className="review-group-head">{g.groupName} <span className="rg-count">{g.tasks.length}</span></h4>
      <ul className="review-items">{g.tasks.map((t) => item(t, canClear))}</ul>
    </div>
  ));

  const mineEmpty = !data.mine.length;
  const forMeEmpty = !data.forMe.length;

  return (
    <div className="content reviews">
      <div className="topbar">
        <div className="who">
          <h2>Reviews</h2>
          <p className="sub">Tasks flagged to talk through, grouped by person. Clearing removes the flag — the task and its notes stay put.</p>
        </div>
      </div>

      <section className="review-sec">
        <h3 className="review-sec-head">I want to review</h3>
        {mineEmpty
          ? <div className="empty sm"><p>{loading ? 'Loading…' : 'Nothing flagged yet. Set “Review with” on a task to add it here.'}</p></div>
          : groupList(data.mine, true)}
      </section>

      <section className="review-sec">
        <h3 className="review-sec-head">Others want to review with me</h3>
        {forMeEmpty
          ? <div className="empty sm"><p>{loading ? 'Loading…' : 'Nothing flagged for you right now.'}</p></div>
          : groupList(data.forMe, false)}
      </section>
    </div>
  );
}

function ClientView({ client, tasks, memberName, isAdmin, onAddTask, onEditTask, onDeleteTask, onStatus, onEditClient }) {
  const open = tasks.filter((t) => t.status !== 'done').length;
  const [showReq, setShowReq] = useState(false);
  const [view, setView] = useState('tasks');
  const [sort, setSort] = useState('priority');
  const [filter, setFilter] = useState('todo');
  const staleCount = tasks.filter(isStale).length;

  const visible = (() => {
    let list = tasks.filter((t) => filter === 'done' ? t.status === 'done' : t.status !== 'done');
    const dueVal = (t) => t.dueDate ? new Date(t.dueDate + 'T00:00:00').getTime() : Infinity;
    const created = (t) => new Date((t.createdAt || '').replace(' ', 'T')).getTime();
    list = [...list];
    if (sort === 'priority') list.sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (dueVal(a) - dueVal(b)) || (created(a) - created(b)));
    else if (sort === 'due') list.sort((a, b) => (dueVal(a) - dueVal(b)) || (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]));
    else if (sort === 'oldest') list.sort((a, b) => created(a) - created(b));
    else if (sort === 'newest') list.sort((a, b) => created(b) - created(a));
    return list;
  })();
  return (
    <>
      <div className="topbar">
        <div className="who">
          <h2>{client.name}</h2>
          <div className="sub">{client.email && <><a href={`mailto:${client.email}`}>{client.email}</a> · </>}{open} open · {tasks.length} total</div>
        </div>
        <div className="topbar-actions">
          {isAdmin && <button className="btn" title="People who can submit requests" onClick={() => setShowReq((s) => !s)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="5.5" r="2.2" /><path d="M2 13c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" /><path d="M11 6h3M12.5 4.5v3" /></svg> Requesters
          </button>}
          <button className="btn" title="Edit client" onClick={onEditClient}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3z" /></svg>
          </button>
          <button className="btn" onClick={onAddTask}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg> Add task
          </button>
        </div>
      </div>
      <div className="content">
        {isAdmin && showReq && <RequesterPanel client={client} onClose={() => setShowReq(false)} />}
        <div className="seg small cv-tabs">
          <button className={view === 'tasks' ? 'on' : ''} onClick={() => setView('tasks')}>Tasks</button>
          <button className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>Timeline</button>
        </div>
        {view === 'timeline' ? <TimelineView client={client} /> : tasks.length === 0
          ? <div className="empty">
              <div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8" /><path d="M21 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg></div>
              <h3>No tasks for {client.name} yet</h3>
              <p>Add what you're working on. Mark items done as you finish, and they flow into the report automatically.</p>
              <div className="row"><button className="btn primary" onClick={onAddTask}>Add a task</button></div>
            </div>
          : <>
            <div className="list-controls">
              <div className="seg small">
                {[['todo', 'To-Do'], ['done', 'Done']].map(([k, l]) => (
                  <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
                ))}
              </div>
              {staleCount > 0 && <span className="stale-note" title="Tasks untouched for 2+ weeks">⏳ {staleCount} going stale</span>}
              <label className="sort-by">Sort
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="priority">Priority (high first)</option>
                  <option value="due">Due date (soonest)</option>
                  <option value="oldest">Oldest submitted</option>
                  <option value="newest">Newest submitted</option>
                </select>
              </label>
            </div>
            <div className="task-flat">
              {visible.length === 0
                ? <p className="none" style={{ padding: '8px 2px' }}>{filter === 'done' ? 'No completed tasks yet.' : 'All caught up — nothing open.'}</p>
                : visible.map((t) => <TaskCard key={t.id} t={t} onStatus={onStatus} onEdit={onEditTask} onDelete={onDeleteTask} />)}
            </div>
          </>}
      </div>
    </>
  );
}

function TaskCard({ t, onStatus, onEdit, onDelete }) {
  const overdue = t.dueDate && t.status !== 'done' && new Date(t.dueDate + 'T00:00:00').getTime() < Date.now() - 86400000;
  const stale = isStale(t);
  const prio = t.priority || 'medium';
  return (
    <div className={'task' + (t.status === 'done' ? ' is-done' : '') + (stale ? ' stale' : '')}>
      <div className="t-body">
        <div className="t-titlerow">
          <span className={'prio-chip ' + prio} title={PRIORITY_LABEL[prio] + ' priority'}>{PRIORITY_LABEL[prio]}</span>
          <p className="t-title">{t.title}</p>
          {stale && <span className="stale-badge" title={`No activity in ${daysSince(t.updatedAt || t.createdAt)} days`}>Going stale</span>}
        </div>
        {t.detail && <p className="t-detail">{t.detail}</p>}
        <div className="t-meta">
          {t.assignee && <span className="assignee-chip">{t.assignee}</span>}
          {t.reviewById && <span className="review-chip" title={t.reviewWith ? `Flagged to review with ${t.reviewWith}` : 'Flagged for review'}>Review{t.reviewWith ? ': ' + t.reviewWith : ''}</span>}
          {t.dueDate && <span className={'due' + (overdue ? ' over' : '')}>{overdue ? 'Overdue · ' : 'Due '}{fmtDate(t.dueDate)}</span>}
          {t.estHours ? <span className="t-est" title="Estimated time to complete (internal)">~{t.estHours}h</span> : null}
          <span className="t-added">Added {fmtDate(t.createdAt)}</span>
          {t.status === 'done' && t.completedAt && <span>Completed {fmtDate(t.completedAt)}</span>}
        </div>
        {t.notes && (
          <div className="t-note">
            <span className="t-note-label">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>
              Private note
            </span>
            {t.notes}
          </div>
        )}
      </div>
      <div className="t-actions">
        <select className={'status-sel s-' + t.status} value={t.status} onChange={(e) => onStatus(t, e.target.value)} aria-label="Status">
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <div className="t-icons">
          <button className="icon-btn" title="Edit" onClick={() => onEdit(t)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3z" /></svg>
          </button>
          <button className="icon-btn" title="Delete" onClick={() => onDelete(t)}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5L11 4" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function TodayView({ today, scope, onScope, onStatus, onGoto, onReminderDelete, onReminderUpdate }) {
  const reminders = today.reminders || [];
  const count = today.overdue.length + today.today.length + reminders.length;
  return (
    <>
      <div className="topbar">
        <div className="who"><h2>Today</h2><div className="sub">{fmtLong(Date.now())}</div></div>
        <div className="topbar-actions">
          <div className="scope-toggle">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => onScope('mine')}>Mine</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => onScope('all')}>Team</button>
          </div>
        </div>
      </div>
      <div className="content">
        {count === 0
          ? <div className="all-clear">
              <div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg></div>
              <h3>You're all caught up</h3>
              <p>{scope === 'mine' ? 'Nothing assigned to you is overdue or due today.' : 'Nothing across the team is overdue or due today.'} Add due dates to tasks and they'll show up here.</p>
            </div>
          : <>
            <TodayReminders items={reminders} onGoto={onGoto} onDelete={onReminderDelete} onUpdate={onReminderUpdate} />
            <TodaySection title="Overdue" kind="over" items={today.overdue} scope={scope} onStatus={onStatus} onGoto={onGoto} />
            <TodaySection title="Due today" kind="today" items={today.today} scope={scope} onStatus={onStatus} onGoto={onGoto} />
          </>}
      </div>
    </>
  );
}

function ReminderRow({ r, onGoto, onDelete, onUpdate }) {
  const hasNote = !!(r.details && r.details.trim());
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(r.details || '');

  const openNote = () => { setNote(r.details || ''); setNoteOpen(true); };
  const closeNote = () => { setNote(r.details || ''); setNoteOpen(false); };
  const saveNote = () => { onUpdate(r.id, { details: note }); setNoteOpen(false); };
  const dismiss = () => {
    // If the editor is open with an unsaved change, fold the note into the dismiss.
    const patch = { done: true };
    if (noteOpen && note !== (r.details || '')) patch.details = note;
    onUpdate(r.id, patch);
  };

  return (
    <div className="brief-card">
      <div className="bc-body">
        <button className="eyebrow" onClick={() => onGoto(r.clientId)} title={`Go to ${r.client}`}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h4l2.5 2.5v6.5H3z" /></svg>{r.client}
        </button>
        <p className="bc-title">{r.body}</p>
        <div className={'bc-due' + (r.overdue ? ' over' : ' today')}>Reminder · {fmtDate(r.date)}</div>
        {noteOpen ? (
          <div className="rm-note-edit">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note or response…" rows={2} />
            <div className="rm-note-row">
              <button className="btn xs primary" onClick={saveNote}>Save note</button>
              <button className="btn xs" onClick={closeNote}>Cancel</button>
            </div>
          </div>
        ) : hasNote ? (
          <div className="rm-note-show">
            <p className="rm-note-body">{r.details}</p>
            <button className="rm-note-link" onClick={openNote}>Edit note</button>
          </div>
        ) : (
          <button className="rm-note-link" onClick={openNote}>Add note</button>
        )}
      </div>
      <div className="t-actions">
        <button className="btn xs" title="Dismiss — clears it from Today but keeps it on the client timeline" onClick={dismiss}>Dismiss</button>
        <button className="icon-btn" title="Delete reminder" onClick={() => onDelete(r.id)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5L11 4" /></svg>
        </button>
      </div>
    </div>
  );
}

function RemindersGroup({ items, onGoto, onDelete, onUpdate, defaultShown }) {
  const [show, setShow] = useState(defaultShown);
  if (!items || !items.length) return null;
  return (
    <div className="group">
      <div className="group-head">
        <span className="dot reminder" /><h3>Reminders</h3><span className="n">{items.length}</span>
        <button className="rm-toggle" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
      </div>
      {show && items.map((r) => <ReminderRow key={'rm' + r.id} r={r} onGoto={onGoto} onDelete={onDelete} onUpdate={onUpdate} />)}
    </div>
  );
}

function TodayReminders({ items, onGoto, onDelete, onUpdate }) {
  if (!items || !items.length) return null;
  return <RemindersGroup items={items} onGoto={onGoto} onDelete={onDelete} onUpdate={onUpdate} defaultShown={true} />;
}

function TodaySection({ title, kind, items, scope, onStatus, onGoto }) {
  if (!items.length) return null;
  return (
    <div className="group">
      <div className="group-head"><span className={'dot ' + (kind === 'over' ? 'blocked' : 'inprogress')}></span><h3>{title}</h3><span className="n">{items.length}</span></div>
      {items.map((t) => {
        const days = kind === 'over' ? Math.round((Date.now() - new Date(t.dueDate + 'T00:00:00').getTime()) / 86400000) : 0;
        return (
          <div className="brief-card" key={t.id}>
            <div className="bc-body">
              <button className="eyebrow" onClick={() => onGoto(t.clientId)} title={`Go to ${t.client}`}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h4l2.5 2.5v6.5H3z" /></svg>{t.client}
                {scope === 'all' && t.assignee && <span className="assignee-chip" style={{ marginLeft: 8 }}>{t.assignee}</span>}
              </button>
              <p className="bc-title">{t.priority && t.priority !== 'medium' && <span className={'prio-chip ' + t.priority} style={{ marginRight: 8 }}>{PRIORITY_LABEL[t.priority]}</span>}{t.title}</p>
              {t.detail && <p className="bc-detail">{t.detail}</p>}
              {kind === 'over'
                ? <div className="bc-due over">Overdue · was due {fmtDate(t.dueDate)}{days > 0 ? ` (${days} day${days === 1 ? '' : 's'} ago)` : ''}</div>
                : <div className="bc-due today">Due today</div>}
            </div>
            <div className="t-actions">
              <select className={'status-sel s-' + t.status} value={t.status} onChange={(e) => onStatus(t, e.target.value)} aria-label="Status">
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeamView({ isAdmin, meId, flash, onChanged, theme, onTheme, holidays = [], onHolidaysChanged }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState('');
  const [resetLinks, setResetLinks] = useState({});

  const load = useCallback(() => api.team().then(setData), []);
  useEffect(() => { load(); }, [load]);

  const invite = async (e) => {
    e.preventDefault();
    setBusy(true); setLastLink('');
    try {
      const r = await api.invite({ email: email.trim(), role });
      setEmail('');
      setLastLink(r.link);
      flash(r.emailed ? 'Invitation emailed' : 'Invite created — copy the link to share');
      await load(); onChanged();
    } catch (err) { flash(err.message); } finally { setBusy(false); }
  };
  const changeRole = async (m, newRole) => { try { await api.setRole(m.id, newRole); await load(); onChanged(); } catch (e) { flash(e.message); } };
  const remove = async (m) => { if (!window.confirm(`Remove ${m.name || m.email}? Their tasks stay but become unassigned.`)) return; try { await api.removeMember(m.id); await load(); onChanged(); } catch (e) { flash(e.message); } };
  const sendReset = async (m) => {
    try {
      const r = await api.memberReset(m.id);
      setResetLinks((s) => ({ ...s, [m.id]: r.link }));
      flash(r.emailed ? `Reset link emailed to ${m.email}` : 'Reset link created — copy it to share');
    } catch (e) { flash(e.message); }
  };
  const revoke = async (inv) => { try { await api.revokeInvite(inv.id); await load(); } catch (e) { flash(e.message); } };
  const copy = async (link) => { try { await navigator.clipboard.writeText(link); flash('Link copied'); } catch { /* */ } };

  if (!data) return <div className="content"><p className="none">Loading team…</p></div>;

  return (
    <>
      <div className="topbar"><div className="who"><h2>Team</h2><div className="sub">{data.members.length} member{data.members.length === 1 ? '' : 's'}</div></div></div>
      <div className="content" style={{ maxWidth: 760 }}>
        {isAdmin && <ThemePicker theme={theme} onTheme={onTheme} />}
        {isAdmin && <HolidaysAdmin holidays={holidays} onChanged={onHolidaysChanged} flash={flash} />}
        {isAdmin && (
          <div className="team-invite">
            <h3 className="block-title">Invite someone</h3>
            <form onSubmit={invite} className="invite-row">
              <input type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button>
            </form>
            {lastLink && (
              <div className="invite-link">
                <span>Invite link (in case the email doesn't arrive):</span>
                <code>{lastLink}</code>
                <button className="btn sm" onClick={() => copy(lastLink)}>Copy</button>
              </div>
            )}
          </div>
        )}

        <h3 className="block-title">Members</h3>
        <div className="team-list">
          {data.members.map((m) => (
            <div className="team-row" key={m.id}>
              <div className="tr-id">
                <span className="tr-name">{m.name || m.email}{m.id === meId && <span className="you"> · you</span>}</span>
                <span className="tr-email">{m.email}</span>
                {resetLinks[m.id] && (
                  <div className="invite-link" style={{ marginTop: 8 }}>
                    <span>Reset link (in case the email doesn't arrive):</span>
                    <code>{resetLinks[m.id]}</code>
                    <button className="btn sm" onClick={() => copy(resetLinks[m.id])}>Copy</button>
                  </div>
                )}
              </div>
              {isAdmin && m.id !== meId ? (
                <div className="tr-actions">
                  <select value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="btn sm" onClick={() => sendReset(m)}>Reset password</button>
                  <button className="btn sm danger" onClick={() => remove(m)}>Remove</button>
                </div>
              ) : <span className={'role-badge ' + m.role}>{m.role}</span>}
            </div>
          ))}
        </div>

        {isAdmin && data.invites && data.invites.length > 0 && (
          <>
            <h3 className="block-title">Pending invitations</h3>
            <div className="team-list">
              {data.invites.map((inv) => (
                <div className="team-row" key={inv.id}>
                  <div className="tr-id">
                    <span className="tr-name">{inv.email}</span>
                    <span className="tr-email">invited as {inv.role}</span>
                  </div>
                  <div className="tr-actions">
                    <button className="btn sm" onClick={() => copy(inv.link)}>Copy link</button>
                    <button className="btn sm danger" onClick={() => revoke(inv)}>Revoke</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function ThemePicker({ theme, onTheme }) {
  let cur = { preset: 'pine', accent: '' };
  try { cur = { preset: 'pine', accent: '', ...(theme ? JSON.parse(theme) : {}) }; } catch { /* */ }
  const [brand, setBrand] = useState(cur.accent || '#1C6E78');
  const usingBrand = !!cur.accent;

  return (
    <div className="team-invite" style={{ marginBottom: 8 }}>
      <h3 className="block-title">Appearance — team theme</h3>
      <p className="share-hint" style={{ margin: '0 0 12px' }}>Sets the colors everyone on the team sees.</p>
      <div className="swatches">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} className={'swatch' + (!usingBrand && cur.preset === key ? ' on' : '')}
                  onClick={() => onTheme({ preset: key, accent: '' })} title={p.label}>
            <span className="sw-dot" style={{ background: p.accent }}></span>{p.label}
          </button>
        ))}
      </div>
      <div className="brand-row">
        <span>Or match your brand:</span>
        <input type="color" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand color" />
        <input type="text" className="brand-hex" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="#1C6E78" />
        <button className={'btn sm' + (usingBrand ? ' primary' : '')} onClick={() => onTheme({ preset: 'pine', accent: brand })}>Use brand color</button>
      </div>
    </div>
  );
}

// Admin-only manager for office holidays / closure dates. Adding or removing a
// date refreshes the app-level holidays list (via onChanged), so the soft
// warnings update everywhere immediately.
function HolidaysAdmin({ holidays = [], onChanged, flash }) {
  const [day, setDay] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const todayKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

  const add = async (e) => {
    e.preventDefault();
    if (!day) return;
    setBusy(true);
    try {
      await api.addHoliday(day, label.trim());
      setDay(''); setLabel('');
      if (onChanged) await onChanged();
      flash('Holiday saved');
    } catch (err) { flash(err.message); } finally { setBusy(false); }
  };
  const remove = async (h) => {
    try { await api.deleteHoliday(h.id); if (onChanged) await onChanged(); }
    catch (e) { flash(e.message); }
  };

  return (
    <div className="team-invite" style={{ marginBottom: 8 }}>
      <h3 className="block-title">Office holidays</h3>
      <p className="share-hint" style={{ margin: '0 0 12px' }}>Dates the office is closed. Scheduling a task, event, or request target on one of these — or on a weekend — shows a heads-up. It never blocks you.</p>
      <form onSubmit={add} className="invite-row">
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        <input type="text" placeholder="e.g. Independence Day (observed)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        <button className="btn primary" type="submit" disabled={busy || !day}>{busy ? 'Saving…' : 'Add'}</button>
      </form>
      {holidays.length === 0
        ? <p className="none" style={{ marginTop: 12 }}>No holidays added yet.</p>
        : <div className="team-list" style={{ marginTop: 12 }}>
            {holidays.map((h) => (
              <div className="team-row" key={h.id}>
                <div className="tr-id">
                  <span className="tr-name">{h.label || 'Holiday'}{h.day < todayKey && <span className="you"> · past</span>}</span>
                  <span className="tr-email">{fmt(h.day)}</span>
                </div>
                <div className="tr-actions">
                  <button className="btn sm danger" onClick={() => remove(h)}>Remove</button>
                </div>
              </div>
            ))}
          </div>}
    </div>
  );
}
const tkTime = (s) => new Date(s.replace(' ', 'T')).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function RequesterPanel({ client, onClose }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.clientRequesters(client.id).then(setData).catch(() => setData({ requesters: [], pending: [] })), [client.id]);
  useEffect(() => { load(); }, [load]);

  const invite = async (e) => {
    e.preventDefault(); setBusy(true); setLink('');
    try { const r = await api.requesterInvite(client.id, email.trim()); setEmail(''); setLink(r.link); load(); }
    catch (err) { alert(err.message); } finally { setBusy(false); }
  };
  const remove = async (id) => { if (!window.confirm('Remove this requester’s access?')) return; try { await api.requesterRemove(id); load(); } catch (e) { alert(e.message); } };
  const copy = (l) => { try { navigator.clipboard.writeText(l); } catch { /* */ } };
  if (!data) return null;

  return (
    <div className="team-invite" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="block-title" style={{ margin: 0 }}>Requesters for {client.name}</h3>
        <button className="btn sm ghost" onClick={onClose}>Close</button>
      </div>
      <p className="share-hint" style={{ margin: '8px 0 12px' }}>These people get a private portal to submit requests for this client — nothing else.</p>
      <form onSubmit={invite} className="invite-row">
        <input type="email" placeholder="requester@theircompany.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Invite requester'}</button>
      </form>
      {link && <div className="invite-link"><span>Invite link (backup):</span><code>{link}</code><button className="btn sm" onClick={() => copy(link)}>Copy</button></div>}

      {data.requesters.length > 0 && <div className="team-list" style={{ marginTop: 12 }}>
        {data.requesters.map((r) => (
          <div className="team-row" key={r.id}>
            <div className="tr-id"><span className="tr-name">{r.name || r.email}</span><span className="tr-email">{r.email}</span></div>
            <button className="btn sm danger" onClick={() => remove(r.id)}>Remove</button>
          </div>
        ))}
      </div>}
      {data.pending.length > 0 && <>
        <div className="block-title" style={{ marginTop: 16 }}>Pending</div>
        <div className="team-list">{data.pending.map((p) => (
          <div className="team-row" key={p.id}>
            <div className="tr-id"><span className="tr-name">{p.email}</span><span className="tr-email">invited</span></div>
            <button className="btn sm" onClick={() => copy(p.link)}>Copy link</button>
          </div>
        ))}</div>
      </>}
    </div>
  );
}

function RequestsView({ isAdmin, holidays = [], onGotoClient, onChanged, flash, userName }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = useCallback(() => api.tickets().then(setData).catch(() => setData({ tickets: [], queue: 0 })), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 12000); return () => clearInterval(t); }, [load]);

  if (openId) return <TicketDetailTeam id={openId} isAdmin={isAdmin} userName={userName} holidays={holidays} onBack={() => { setOpenId(null); load(); }}
    onGotoClient={onGotoClient} onChanged={() => { load(); onChanged(); }} flash={flash} />;

  const tickets = data?.tickets || [];
  const queue = tickets.filter((t) => t.state === 'submitted');
  const rest = tickets.filter((t) => t.state !== 'submitted');

  return (
    <>
      <div className="topbar"><div className="who"><h2>Requests</h2>
        <div className="sub">{data === null ? '' : queue.length ? `${queue.length} waiting for triage` : 'No new requests'}</div></div></div>
      <div className="content">
        {data === null ? <p className="none">Loading…</p>
          : tickets.length === 0 ? (
            <div className="empty"><div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14v13l-7-3.5L5 17z" /></svg></div>
              <h3>No requests yet</h3><p>When a requester submits a ticket, it lands here for you to accept or decline. Invite requesters from a client's page.</p></div>
          ) : <>
            {queue.length > 0 && <div className="group">
              <div className="group-head"><span className="dot blocked"></span><h3>New — needs triage</h3><span className="n">{queue.length}</span></div>
              {queue.map((t) => <TicketRow key={t.id} t={t} onClick={() => setOpenId(t.id)} />)}
            </div>}
            {rest.length > 0 && <div className="group">
              <div className="group-head"><span className="dot inprogress"></span><h3>Active &amp; past</h3><span className="n">{rest.length}</span></div>
              {rest.map((t) => <TicketRow key={t.id} t={t} onClick={() => setOpenId(t.id)} />)}
            </div>}
          </>}
      </div>
    </>
  );
}

function TicketRow({ t, onClick }) {
  const dateHint = t.targetDate ? `Target ${fmtDate(t.targetDate)}` : t.requestedDate ? `Wants by ${fmtDate(t.requestedDate)}` : '';
  return (
    <button className="ticket-row team" onClick={onClick}>
      <span className="tk-main">
        <span className="tk-title">{t.title}</span>
        <span className="tk-date">{t.client}{t.requester ? ` · ${t.requester}` : ''}{dateHint ? ` · ${dateHint}` : ''}</span>
      </span>
      {t.unread > 0 && <span className="tk-unread">{t.unread} new</span>}
      <span className={'tk-status ' + (TK_TONE[t.status] || 'submitted')}>{t.status}</span>
    </button>
  );
}

function TicketDetailTeam({ id, isAdmin, userName, holidays = [], onBack, onGotoClient, onChanged, flash }) {
  const [t, setT] = useState(null);
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState(null); // null = uninitialized
  const load = useCallback(() => api.ticket(id).then(setT).catch(() => {}), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [load]);
  useEffect(() => { if (t && t.state === 'submitted') setTarget((cur) => cur === null ? (t.requestedDate || '') : cur); }, [t]);

  const accept = async () => { try { await api.ticketAccept(id, target || null); flash(target ? `Accepted with target ${fmtDate(target)}` : 'Accepted — added to the client as a task'); load(); onChanged(); } catch (e) { flash(e.message); } };
  const decline = async () => { if (!window.confirm('Decline this request? The requester will see it as declined.')) return; try { await api.ticketDecline(id); load(); onChanged(); } catch (e) { flash(e.message); } };
  const reply = async () => { const body = draft.trim(); if (!body) return; setDraft(''); try { await api.ticketReply(id, body); load(); onChanged(); } catch (e) { flash(e.message); } };
  const deleteTicket = async () => { if (!window.confirm('Permanently delete this request and its entire message thread? It will also disappear from the requester’s portal. This can’t be undone.')) return; try { await api.ticketDelete(id); onChanged(); onBack(); } catch (e) { flash(e.message); } };
  const changeTaskStatus = async (status) => { try { await api.updateTask(t.taskId, { status }); load(); onChanged(); } catch (e) { flash(e.message); } };
  if (!t) return <div className="content"><p className="none">Loading…</p></div>;

  return (
    <>
      <div className="topbar"><div className="who"><button className="link-back" onClick={onBack}>← All requests</button><h2 style={{ marginTop: 4 }}>{t.title}</h2>
        <div className="sub">{t.requester ? `${t.requester.name || t.requester.email} · ${t.requester.email}` : 'Requester removed'}</div></div>
        <div className="topbar-actions">
          {t.state === 'accepted' && t.taskId
            ? <select className={'status-sel s-' + (t.taskStatus || 'todo')} value={t.taskStatus || 'todo'} onChange={(e) => changeTaskStatus(e.target.value)} aria-label="Status" style={{ alignSelf: 'center' }}>
                {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            : <span className={'tk-status ' + (TK_TONE[t.status] || 'submitted')} style={{ alignSelf: 'center' }}>{t.status}</span>}
          {t.taskId && <button className="btn" onClick={() => onGotoClient(t.clientId)}>Open in client</button>}
          {isAdmin && (t.state === 'cancelled' || t.state === 'declined') && <button className="btn danger" onClick={deleteTicket}>Delete request</button>}
        </div>
      </div>
      <div className="content" style={{ maxWidth: 760 }}>
        {(t.requestedDate || t.targetDate) && (
          <div className="td-dates team">
            {t.requestedDate && <span><b>Requested by:</b> {fmtDate(t.requestedDate)}</span>}
            {t.targetDate && <span className="confirmed"><b>Confirmed target:</b> {fmtDate(t.targetDate)}</span>}
            {t.taskId && <span className="hint">Change the date anytime on the task — the requester is emailed automatically.</span>}
          </div>
        )}
        {t.body && <div className="td-body card-body">{t.body}</div>}
        {t.state === 'submitted' && (
          <div className="triage">
            <div className="triage-date">
              <label>Target completion date <span className="hint">— {t.requestedDate ? 'prefilled from their request; change if needed' : 'optional'}</span></label>
              <input type="date" value={target || ''} onChange={(e) => setTarget(e.target.value)} />
              {t.requestedDate && target !== t.requestedDate && <button className="btn sm" type="button" onClick={() => setTarget(t.requestedDate)}>Use requested ({fmtDate(t.requestedDate)})</button>}
              <DateWarn date={target} holidays={holidays} />
            </div>
            <div className="triage-actions">
              <button className="btn primary" onClick={accept}>Accept → create task</button>
              <button className="btn danger" onClick={decline}>Decline</button>
            </div>
          </div>
        )}
        <div className="td-thread">
          <h4>Feedback thread <span className="hint">— visible to the requester</span></h4>
          {t.messages.length === 0 ? <p className="none">No messages yet. Anything you post here is emailed to the requester.</p>
            : t.messages.map((m) => (
              <div className={'td-msg' + (m.fromTeam ? ' me' : ' team')} key={m.id}>
                <span className="td-msg-who">{m.fromTeam ? (m.author || 'Team') : (t.requester?.name || 'Requester')} · {tkTime(m.createdAt)}</span>
                <div className="td-bubble">{m.body}</div>
              </div>
            ))}
        </div>
        {t.state !== 'declined' && (
          <div className="td-reply">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply to the requester (emails them)…"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply(); } }} />
            <button className="btn primary" onClick={reply}>Send</button>
          </div>
        )}
      </div>
    </>
  );
}

// Weekly report: an all-clients dashboard (done in the last 7 days + due in the next 7),
// grouped by client, filterable to a single client, and printable / saveable as a PDF
// to share with a client or the team. Replaces the old copy-paste "Share my day" /
// "Client report" drafts.
function WeeklyView({ onGoto }) {
  const [scope, setScope] = useState('all');   // team-wide by default
  const [client, setClient] = useState('all');
  const [data, setData] = useState(null);
  const load = useCallback(
    () => api.weekly(scope).then(setData).catch(() => setData({ completed: [], upcoming: [] })),
    [scope]
  );
  useEffect(() => { load(); }, [load]);

  // Group completed + upcoming under each client.
  const groups = useMemo(() => {
    const map = new Map();
    const ensure = (id, name) => {
      const k = String(id);
      if (!map.has(k)) map.set(k, { clientId: id, client: name, completed: [], upcoming: [] });
      return map.get(k);
    };
    (data?.completed || []).forEach((t) => ensure(t.clientId, t.client).completed.push(t));
    (data?.upcoming || []).forEach((t) => ensure(t.clientId, t.client).upcoming.push(t));
    return [...map.values()].sort((a, b) => a.client.localeCompare(b.client));
  }, [data]);

  // If the chosen client drops out of the data (e.g. after a scope switch), reset to all.
  useEffect(() => {
    if (client !== 'all' && data && !groups.some((g) => String(g.clientId) === String(client))) setClient('all');
  }, [groups, client, data]);

  const shown = client === 'all' ? groups : groups.filter((g) => String(g.clientId) === String(client));
  const totalDone = (data?.completed || []).length;
  const totalUp = (data?.upcoming || []).length;
  const range = data ? `${fmtDate(data.doneFrom)} – ${fmtDate(data.today)}` : 'last 7 days';
  const clientName = client === 'all' ? null : (groups.find((g) => String(g.clientId) === String(client))?.client || null);

  const clientIcon = (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 1.5h4l2.5 2.5v6.5H3z" /></svg>
  );

  return (
    <>
      <div className="topbar">
        <div className="who"><h2>Weekly report</h2><div className="sub">Last 7 days · {range}</div></div>
        <div className="topbar-actions wk-actions">
          <div className="scope-toggle">
            <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Mine</button>
            <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Team</button>
          </div>
          {groups.length > 0 && (
            <select className="wk-client" value={client} onChange={(e) => setClient(e.target.value)} title="Filter to one client to share their slice only">
              <option value="all">All clients</option>
              {groups.map((g) => <option key={g.clientId} value={g.clientId}>{g.client}</option>)}
            </select>
          )}
          <button className="btn primary" onClick={() => window.print()} title="Print or save as PDF to share">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 6V2h6v4M5 12H3.5A1.5 1.5 0 0 1 2 10.5v-3A1.5 1.5 0 0 1 3.5 6h9A1.5 1.5 0 0 1 14 7.5v3a1.5 1.5 0 0 1-1.5 1.5H11M5 10h6v4H5z" /></svg> Print / PDF
          </button>
        </div>
      </div>
      <div className="content">
        {data === null
          ? <p className="none">Loading…</p>
          : (
            <div className="weekly-report" id="weekly-report">
              {/* Masthead — printed/PDF only (the topbar covers the title on screen). */}
              <div className="rep-print-head" style={data.brand?.accent ? { borderBottomColor: data.brand.accent } : undefined}>
                <div className="rep-ph-brand">
                  {data.brand?.logo
                    ? <img className="rep-logo" src={data.brand.logo} alt={data.brand?.company || 'Logo'} />
                    : <span className="rep-ph-name" style={data.brand?.accent ? { color: data.brand.accent } : undefined}>{data.brand?.company || data.workspace || 'Client Desk'}</span>}
                  {data.brand?.logo && <span className="rep-ph-co">{data.brand?.company || data.workspace}</span>}
                </div>
                <h1 className="rep-ph-title">Weekly report{clientName ? ` — ${clientName}` : ''}</h1>
                <div className="rep-ph-meta">Completed {range} · Upcoming through {fmtDate(data.upTo)} · Generated {fmtLong(Date.now())}</div>
              </div>

              {shown.length === 0
                ? <div className="all-clear">
                    <div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg></div>
                    <h3>A quiet week</h3>
                    <p>{scope === 'mine' ? "Nothing you've completed in the last 7 days" : 'Nothing completed in the last 7 days'}, and nothing due in the next 7 days.</p>
                  </div>
                : (
                  <>
                    {client === 'all' && (
                      <div className="rep-summary">
                        <span><b>{totalDone}</b> completed</span>
                        <span><b>{totalUp}</b> due next 7 days</span>
                        <span><b>{groups.length}</b> {groups.length === 1 ? 'client' : 'clients'}</span>
                      </div>
                    )}
                    {shown.map((g) => {
                      // Only render sections that actually have items — no empty "—" filler.
                      const cols = [];
                      if (g.completed.length) cols.push({ key: 'done', label: 'Completed', dotCls: 'done', kind: 'done', items: g.completed });
                      if (g.upcoming.length) cols.push({ key: 'up', label: 'Coming up', dotCls: 'inprogress', kind: 'up', items: g.upcoming });
                      return (
                        <section className="rep-client" key={g.clientId}>
                          <button className="rep-client-name" onClick={() => onGoto(g.clientId)} title={`Go to ${g.client}`}>
                            {clientIcon}{g.client}
                          </button>
                          <div className={'rep-cols cols-' + cols.length}>
                            {cols.map((col) => (
                              <div className="rep-col" key={col.key}>
                                <div className="rep-col-head"><span className={'dot ' + col.dotCls} />{col.label}<span className="n">{col.items.length}</span></div>
                                <ul className="rep-list">
                                  {col.items.map((t) => (
                                    <li key={col.key + t.id}>
                                      <span className="rep-task">
                                        {col.kind === 'up' && t.priority && t.priority !== 'medium' && <span className={'prio-chip ' + t.priority} style={{ marginRight: 6 }}>{PRIORITY_LABEL[t.priority]}</span>}
                                        {t.title}
                                        {col.kind === 'up' && t.status === 'blocked' && <span className="rep-blocked">Blocked</span>}
                                      </span>
                                      <span className="rep-meta">
                                        {col.kind === 'done' ? fmtDate(t.completedAt) : (t.dueToday ? 'Due today' : `Due ${fmtDate(t.dueDate)}`)}
                                        {scope === 'all' && t.assignee ? ` · ${t.assignee}` : ''}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </>
                )}
              <div className="rep-print-foot">{data.brand?.company || data.workspace || 'Client Desk'} · {fmtLong(Date.now())}</div>
            </div>
          )}
      </div>
    </>
  );
}

function MobileClientsView({ clients, onGoto, onAdd }) {
  return (
    <>
      <div className="topbar">
        <div className="who"><h2>Clients</h2><div className="sub">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</div></div>
        <div className="topbar-actions">
          <button className="btn primary" onClick={onAdd}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg> Add client
          </button>
        </div>
      </div>
      <div className="content">
        {clients.length === 0
          ? <div className="empty">
              <div className="glyph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg></div>
              <h3>No clients yet</h3>
              <p>Add your first client to start grouping tasks by who they're for.</p>
              <div className="row"><button className="btn primary" onClick={onAdd}>Add a client</button></div>
            </div>
          : <div className="mcl-list">
              {clients.map((c) => (
                <button className="mcl-item" key={c.id} onClick={() => onGoto(c.id)}>
                  {c.due_flag && <span className={'due-flag ' + c.due_flag} title={c.due_flag === 'red' ? 'Has a task overdue or due within 3 days' : 'Has a task due within 7 days'} />}
                  <span className="mcl-nm">{c.name}</span>
                  <span className={'count' + (Number(c.open_count) === 0 ? ' zero' : '')}>{c.open_count}</span>
                </button>
              ))}
            </div>}
      </div>
    </>
  );
}

function TimelineView({ client }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState('reminder');
  const [bodyText, setBodyText] = useState('');
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () => api.timeline(client.id).then(setData).catch(() => setData({ entries: [], tasks: [], today: todayStr() })),
    [client.id]);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    if (!bodyText.trim()) return;
    setBusy(true);
    try { await api.addTimeline(client.id, { kind, body: bodyText.trim(), date }); setBodyText(''); setDate(todayStr()); await load(); }
    catch (err) { /* surfaced via disabled state */ } finally { setBusy(false); }
  };
  const save = async (id, patch) => { try { await api.updateTimeline(id, patch); await load(); } catch { /* */ } };
  const del = async (en) => { if (!window.confirm('Delete this timeline entry?')) return; try { await api.deleteTimeline(en.id); await load(); } catch { /* */ } };

  if (!data) return <p className="none" style={{ padding: '14px 2px' }}>Loading timeline…</p>;

  const today = data.today || todayStr();
  const isUpcoming = (e) => e.kind === 'reminder' && !e.done && e.date >= today;
  const upcoming = data.entries
    .filter(isUpcoming)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rest = [
    ...data.entries.filter((e) => !isUpcoming(e)),
    ...data.tasks,
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="timeline">
      <form className="tl-add" onSubmit={add}>
        <div className="seg small">
          <button type="button" className={kind === 'reminder' ? 'on' : ''} onClick={() => setKind('reminder')}>Reminder</button>
          <button type="button" className={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>Note</button>
        </div>
        <input className="tl-text" value={bodyText} onChange={(e) => setBodyText(e.target.value)}
          placeholder={kind === 'reminder' ? 'e.g. Send a follow-up about the proposal' : 'e.g. Confirmed the renewal email went out'} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={kind === 'reminder' ? 'Reminder date' : 'Note date'} />
        <button className="btn primary" type="submit" disabled={busy}>Add</button>
      </form>

      {upcoming.length > 0 && (
        <div className="tl-upcoming">
          <div className="group-head"><span className="dot reminder" /><h3>Upcoming reminders</h3><span className="n">{upcoming.length}</span></div>
          {upcoming.map((en) => <TimelineEntry key={'u' + en.id} en={en} today={today} onSave={save} onDelete={del} />)}
        </div>
      )}

      <div className="tl-feed">
        {rest.length === 0 && upcoming.length === 0
          ? <p className="none" style={{ padding: '10px 2px' }}>Nothing on the timeline yet. Add a reminder or note above.</p>
          : rest.map((it) => it.kind === 'task'
              ? <TimelineTask key={'t' + it.id} it={it} />
              : <TimelineEntry key={'e' + it.id} en={it} today={today} onSave={save} onDelete={del} />)}
      </div>
    </div>
  );
}

function TimelineTask({ it }) {
  const label = it.anchor === 'completed' ? 'Completed' : it.anchor === 'due' ? 'Due' : 'Added';
  return (
    <div className={'tl-item tl-task'}>
      <span className="tl-date">{fmtDate(it.date)}</span>
      <div className="tl-dot-line"><span className="tl-node task" /></div>
      <div className="tl-card">
        <span className={'prio-chip ' + it.priority}>{PRIORITY_LABEL[it.priority]}</span>
        <span className="tl-title">{it.title}</span>
        <span className="tl-tag">{label} · {STATUS_LABEL[it.status]}{it.assignee ? ' · ' + it.assignee : ''}</span>
      </div>
    </div>
  );
}

function TimelineEntry({ en, today, onSave, onDelete }) {
  const isReminder = en.kind === 'reminder';
  const isNote = en.kind === 'note';
  const dismissed = isReminder && en.done;
  const overdue = isReminder && !dismissed && en.date < today;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(en.body);
  const [date, setDate] = useState(en.date);
  const startEdit = () => { setBody(en.body); setDate(en.date); setEditing(true); };
  const save = async () => { const b = body.trim(); if (!b) return; await onSave(en.id, { body: b, date }); setEditing(false); };

  // Free-text block. On notes it's meeting notes (behind an arrow); on reminders
  // it's the dismiss note / response, shown inline.
  const hasDetails = !!(en.details && en.details.trim());
  const [expanded, setExpanded] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  const [detailsText, setDetailsText] = useState(en.details || '');
  const startDetails = () => { setDetailsText(en.details || ''); setEditDetails(true); };
  const saveDetails = async () => { await onSave(en.id, { details: detailsText }); setEditDetails(false); };
  const showEditor = editDetails || !hasDetails;

  // Reminder note editor (inline, available anytime).
  const [rnoteOpen, setRnoteOpen] = useState(false);
  const openRnote = () => { setDetailsText(en.details || ''); setRnoteOpen(true); };
  const closeRnote = () => { setDetailsText(en.details || ''); setRnoteOpen(false); };
  const saveRnote = async () => { await onSave(en.id, { details: detailsText }); setRnoteOpen(false); };

  const dismissedOn = dismissed && en.doneAt ? fmtDate(en.doneAt.slice(0, 10)) : '';
  const kindLabel = isReminder
    ? (dismissed ? (dismissedOn ? 'Reminder · dismissed ' + dismissedOn : 'Reminder · dismissed') : (overdue ? 'Reminder · overdue' : 'Reminder'))
    : 'Note';

  return (
    <div className={'tl-item tl-entry ' + en.kind + (overdue ? ' overdue' : '') + (dismissed ? ' done' : '')}>
      <span className="tl-date">{fmtDate(en.date)}</span>
      <div className="tl-dot-line"><span className={'tl-node ' + en.kind} /></div>
      <div className="tl-card">
        <div className="tl-card-top">
          <span className="tl-kind">{kindLabel}</span>
          <div className="tl-actions">
            {isReminder && !editing && (
              dismissed
                ? <button className="btn xs" title="Bring this reminder back to Today" onClick={() => onSave(en.id, { done: false })}>Un-dismiss</button>
                : <button className="btn xs" title="Dismiss — clears it from Today, keeps it here" onClick={() => onSave(en.id, { done: true })}>Dismiss</button>
            )}
            {isNote && !editing && (
              <button className={'icon-btn tl-expand' + (expanded ? ' open' : '')} title={expanded ? 'Hide meeting notes' : 'Meeting notes'} onClick={() => setExpanded((v) => !v)}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>
              </button>
            )}
            {!editing && (
              <button className="icon-btn" title="Edit" onClick={startEdit}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3z" /></svg>
              </button>
            )}
            <button className="icon-btn" title="Delete" onClick={() => onDelete(en)}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9h5L11 4" /></svg>
            </button>
          </div>
        </div>
        {editing ? (
          <div className="tl-edit">
            <input className="tl-text" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="tl-edit-row">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={isReminder ? 'Reminder date' : 'Note date'} />
              <button className="btn xs primary" onClick={save}>Save</button>
              <button className="btn xs" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="tl-body">{en.body}</p>
            {en.author && <span className="tl-by">{en.author}</span>}
            {isReminder && (
              <div className="rm-note tl-rnote">
                {rnoteOpen ? (
                  <div className="rm-note-edit">
                    <textarea value={detailsText} onChange={(e) => setDetailsText(e.target.value)} placeholder="Add a note or response…" rows={2} />
                    <div className="rm-note-row">
                      <button className="btn xs primary" onClick={saveRnote}>Save note</button>
                      <button className="btn xs" onClick={closeRnote}>Cancel</button>
                    </div>
                  </div>
                ) : hasDetails ? (
                  <div className="rm-note-show">
                    <p className="rm-note-body">{en.details}</p>
                    <button className="rm-note-link" onClick={openRnote}>Edit note</button>
                  </div>
                ) : (
                  <button className="rm-note-link" onClick={openRnote}>Add note</button>
                )}
              </div>
            )}
            {isNote && expanded && (
              <div className="tl-notes">
                {showEditor ? (
                  <div className="tl-notes-edit">
                    <textarea value={detailsText} onChange={(e) => setDetailsText(e.target.value)} placeholder="Meeting notes…" />
                    <div className="tl-edit-row">
                      <button className="btn xs primary" onClick={saveDetails}>Save notes</button>
                      {hasDetails && <button className="btn xs" onClick={() => { setEditDetails(false); setDetailsText(en.details || ''); }}>Cancel</button>}
                    </div>
                  </div>
                ) : (
                  <div className="tl-notes-show">
                    <div className="tl-notes-label">Meeting notes</div>
                    <p className="tl-notes-body">{en.details}</p>
                    <button className="btn xs" onClick={startDetails}>Edit notes</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
