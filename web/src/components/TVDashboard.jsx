import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const REFRESH_MS = 30000;
const URGENT_ROTATE_MS = 8000; // how long each client's urgent items hold on the TV before advancing
const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

// Same palette the month calendar uses, so deadlines read as "that person's color".
const ASSIGNEE_COLORS = ['#1C6E78', '#B26B22', '#3E7E58', '#7A3F6E', '#34568C', '#9A6324', '#4F7A2F', '#A03D55'];
const colorFor = (assigneeId) =>
  assigneeId ? ASSIGNEE_COLORS[assigneeId % ASSIGNEE_COLORS.length] : '#869089';

const fmtDay = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
const fmtLong = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

// Small self-contained "refreshed Xs ago" readout. Lives in its own component so its
// 1-second tick re-renders only this line, never the whole board between data pulls.
function Ago({ since }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return <span className="tv-ago">—</span>;
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  const label = s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
  return <span className="tv-ago">Refreshed {label}</span>;
}

function dot(priority) {
  const p = priority || 'medium';
  return <span className={'tv-dot ' + p} title={PRIORITY_LABEL[p] + ' priority'} />;
}

// Group overdue + due-today by client. Overdue items lead within each client, and
// clients with anything overdue float to the top; everything else falls back to name.
function groupByClient(overdue, dueToday) {
  const map = new Map();
  const push = (t, kind) => {
    const key = t.clientId;
    if (!map.has(key)) map.set(key, { client: t.client, hasOverdue: false, items: [] });
    const g = map.get(key);
    g.items.push({ ...t, kind });
    if (kind === 'over') g.hasOverdue = true;
  };
  overdue.forEach((t) => push(t, 'over'));
  dueToday.forEach((t) => push(t, 'today'));
  const groups = [...map.values()];
  groups.forEach((g) => g.items.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'over' ? -1 : 1)));
  groups.sort((a, b) =>
    a.hasOverdue !== b.hasOverdue ? (a.hasOverdue ? -1 : 1) : a.client.localeCompare(b.client));
  return groups;
}

function daysOverdue(dueDate) {
  return Math.round((Date.now() - new Date(dueDate + 'T00:00:00').getTime()) / 86400000);
}

// The TV only has room to show one cluster of urgent items at a time, so rotate through
// the client groups — one per slide, advancing on a timer — with dots marking position.
function UrgentCarousel({ groups }) {
  const [page, setPage] = useState(0);
  const n = groups.length;

  useEffect(() => {
    if (n <= 1) return undefined;
    const t = setInterval(() => setPage((p) => (p + 1) % n), URGENT_ROTATE_MS);
    return () => clearInterval(t);
  }, [n]);

  // Keep the index valid if the group count shrinks between data refreshes.
  useEffect(() => { if (n > 0 && page >= n) setPage(0); }, [n, page]);

  if (n === 0) return null;
  const idx = page % n;
  const g = groups[idx];

  return (
    <div className="tv-carousel">
      <div className="tv-clients tv-carousel-stage">
        <div className="tv-client" key={g.client}>
          <h3 className="tv-client-name">{g.client}</h3>
          <ul className="tv-tasks">
            {g.items.map((t) => (
              <li className={'tv-task' + (t.kind === 'over' ? ' is-over' : '')} key={t.id}>
                {dot(t.priority)}
                <span className="tv-task-title">{t.title}</span>
                <span className={'tv-due' + (t.kind === 'over' ? ' over' : ' today')}>
                  {t.kind === 'over' ? `Overdue · ${daysOverdue(t.dueDate)}d` : 'Due today'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {n > 1 && (
        <div className="tv-dots" aria-label={`${n} clients`}>
          {groups.map((gr, i) => (
            <span key={gr.client} className={'tv-pip' + (i === idx ? ' on' : '')} />
          ))}
        </div>
      )}
    </div>
  );
}

// Shell: owns which tab is showing and the Esc-to-exit hatch; hands a tab switcher
// down to whichever board is mounted so it sits inline in that board's header.
export default function TVDashboard({ onExit }) {
  const [view, setView] = useState('today');

  // Invisible escape hatch for setup: Esc leaves the TV view from either tab.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onExit) onExit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const tabs = (
    <div className="tv-tabs" role="tablist">
      <button role="tab" className={view === 'today' ? 'on' : ''} onClick={() => setView('today')}>Today</button>
      <button role="tab" className={view === 'ten' ? 'on' : ''} onClick={() => setView('ten')}>Next 10 days</button>
    </div>
  );

  return view === 'today' ? <TodayBoard tabs={tabs} /> : <TenDayBoard tabs={tabs} />;
}

// ---- Tab 1: today (overdue + due-today, upcoming high priority, request count) ----
function TodayBoard({ tabs }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | auth | error
  const [lastSync, setLastSync] = useState(null);
  const dataRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboard();
      dataRef.current = d;
      setData(d);
      setStatus('ok');
      setLastSync(Date.now());
    } catch (e) {
      // 401/403 means the screen's session lapsed — show a calm sign-in prompt but
      // keep polling so it recovers on its own once someone signs in here again.
      if (e.status === 401 || e.status === 403) setStatus('auth');
      else setStatus(dataRef.current ? 'ok' : 'error'); // keep showing last good data on a blip
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (status === 'loading' && !data) {
    return <div className="tv tv-center"><p className="tv-msg">Loading the board…</p></div>;
  }
  if (status === 'auth') {
    return (
      <div className="tv tv-center">
        <div className="tv-signin">
          <h1>Signed out</h1>
          <p>This screen needs to sign in again to keep showing the dashboard. Open Client Desk on this device, sign in, then return to the <code>/#tv</code> view. It will pick back up on its own.</p>
        </div>
      </div>
    );
  }
  if (status === 'error' && !data) {
    return <div className="tv tv-center"><p className="tv-msg">Can’t reach the server. Retrying…</p></div>;
  }

  const groups = groupByClient(data.overdue, data.dueToday);
  const topCount = data.overdue.length + data.dueToday.length;

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="tv-head-left">
          <h1>{data.workspace || 'Client Desk'}</h1>
          <span className="tv-date">{fmtLong()}</span>
        </div>
        {tabs}
        <Ago since={lastSync} />
      </header>

      <section className="tv-top">
        <div className="tv-sec-head">
          <h2>Overdue &amp; Due Today</h2>
          {topCount > 0 && <span className="tv-count">{topCount}</span>}
        </div>
        {topCount === 0 ? (
          <div className="tv-clear">
            <span className="tv-check">✓</span>
            <p>All clear — nothing overdue and nothing due today.</p>
          </div>
        ) : (
          <UrgentCarousel groups={groups} />
        )}
      </section>

      <div className="tv-bottom">
        <section className="tv-upcoming">
          <div className="tv-sec-head">
            <h2>Upcoming High Priority</h2>
            <span className="tv-sub">through Sunday</span>
          </div>
          {data.upcoming.length === 0 ? (
            <p className="tv-empty">No high-priority work due the rest of this week.</p>
          ) : (
            <ul className="tv-up-list">
              {data.upcoming.map((t) => (
                <li className="tv-up" key={t.id}>
                  {dot('high')}
                  <span className="tv-up-main">
                    <span className="tv-up-title">{t.title}</span>
                    <span className="tv-up-client">{t.client}</span>
                  </span>
                  <span className="tv-up-due">{fmtDay(t.dueDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={'tv-requests' + (data.requests > 0 ? ' has' : '')}>
          <span className="tv-req-count">{data.requests}</span>
          <span className="tv-req-label">
            {data.requests === 0
              ? 'No requests to review'
              : data.requests === 1
                ? 'request to review'
                : 'requests to review'}
          </span>
        </section>
      </div>
    </div>
  );
}

// ---- Tab 2: the next 10 days (overdue lane + one row per day with tasks + events) ----
function TenDayBoard({ tabs }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | auth | error
  const [lastSync, setLastSync] = useState(null);
  const dataRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.dashboardUpcoming();
      dataRef.current = d;
      setData(d);
      setStatus('ok');
      setLastSync(Date.now());
    } catch (e) {
      if (e.status === 401 || e.status === 403) setStatus('auth');
      else setStatus(dataRef.current ? 'ok' : 'error');
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const range = data ? `${fmtDay(data.days[0].date)} – ${fmtDay(data.days[data.days.length - 1].date)}` : 'Next 10 days';

  return (
    <div className="tv">
      <header className="tv-head">
        <div className="tv-head-left">
          <h1>{(data && data.workspace) || 'Client Desk'}</h1>
          <span className="tv-date">{range}</span>
        </div>
        {tabs}
        <Ago since={lastSync} />
      </header>

      {status === 'loading' && !data
        ? <div className="tv-ten tv-ten-msg"><p className="tv-msg">Loading the next 10 days…</p></div>
        : status === 'auth'
          ? <div className="tv-ten tv-ten-msg"><p className="tv-msg">Signed out — open Client Desk on this device and sign in to resume.</p></div>
          : status === 'error' && !data
            ? <div className="tv-ten tv-ten-msg"><p className="tv-msg">Can’t reach the server. Retrying…</p></div>
            : <TenDayBody data={data} />}
    </div>
  );
}

function TenDayBody({ data }) {
  const todayKey = data.date;
  return (
    <div className="tv-ten">
      {data.overdue.length > 0 && (
        <section className="tv-ten-over">
          <div className="tv-sec-head">
            <h2>Overdue</h2>
            <span className="tv-count" style={{ background: 'var(--danger)' }}>{data.overdue.length}</span>
          </div>
          <ul className="tv-ten-overlist">
            {data.overdue.map((t) => (
              <li className="tv-ten-overitem" key={t.id} title={`${t.client}: ${t.title}${t.assignee ? ' · ' + t.assignee : ''}`}>
                <span className="cdot" style={{ background: colorFor(t.assigneeId) }} />
                <span className="tt">{t.title}</span>
                <span className="tc">{t.client}</span>
                <span className="tv-ten-od">{daysOverdue(t.dueDate)}d</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="tv-ten-days">
        {data.days.map((day) => {
          const d = new Date(day.date + 'T00:00:00');
          const isToday = day.date === todayKey;
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          const empty = day.tasks.length === 0 && day.events.length === 0;
          return (
            <div className={'tv-ten-day' + (isToday ? ' is-today' : '') + (weekend ? ' is-weekend' : '')} key={day.date}>
              <div className="tv-ten-date">
                <span className="tv-ten-dow">{isToday ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <span className="tv-ten-md">{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              </div>
              <div className="tv-ten-items">
                {empty && <span className="tv-ten-empty">—</span>}
                {day.events.map((ev) => (
                  <span className={'tv-ten-ev ' + ev.type} key={'e' + ev.id} title={ev.title}>
                    {ev.allDay ? '' : new Date(ev.start.replace(' ', 'T')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' '}{ev.title}
                  </span>
                ))}
                {day.tasks.map((t) => (
                  <span className={'tv-ten-task' + (t.priority === 'high' ? ' p-high' : '')} key={'t' + t.id}
                        title={`${t.client}: ${t.title}${t.assignee ? ' · ' + t.assignee : ''}`}>
                    <span className="cdot" style={{ background: colorFor(t.assigneeId) }} />
                    <span className="tt">{t.title}</span>
                    <span className="tc">{t.client}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
