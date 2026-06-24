import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Modal } from './Modals.jsx';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ASSIGNEE_COLORS = ['#1C6E78', '#B26B22', '#3E7E58', '#7A3F6E', '#34568C', '#9A6324', '#4F7A2F', '#A03D55'];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar({ members, meId, onGotoClient, flash, reloadSignal }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [data, setData] = useState({ events: [], deadlines: [], conflicts: {} });
  const [modal, setModal] = useState(null);

  // 6-week grid starting on the Sunday on/before the 1st.
  const grid = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const load = useCallback(() => {
    api.calendar(ymd(grid[0]), ymd(grid[41])).then(setData);
  }, [grid]);
  useEffect(() => { load(); }, [load, reloadSignal]);

  const colorFor = (assigneeId) => {
    if (!assigneeId) return '#869089';
    const idx = members.findIndex((m) => m.id === assigneeId);
    return ASSIGNEE_COLORS[(idx < 0 ? 0 : idx) % ASSIGNEE_COLORS.length];
  };

  const byDay = useMemo(() => {
    const map = {};
    grid.forEach((d) => { map[ymd(d)] = { events: [], deadlines: [] }; });
    data.deadlines.forEach((dl) => { if (map[dl.date]) map[dl.date].deadlines.push(dl); });
    data.events.forEach((ev) => {
      const s = ev.start.slice(0, 10), e = ev.end.slice(0, 10);
      Object.keys(map).forEach((day) => { if (day >= s && day <= e) map[day].events.push(ev); });
    });
    return map;
  }, [grid, data]);

  const save = async (payload, id) => {
    try {
      if (id) await api.updateEvent(id, payload); else await api.createEvent(payload);
      setModal(null); load();
    } catch (e) { flash(e.message); }
  };
  const remove = async (id) => { try { await api.deleteEvent(id); setModal(null); load(); } catch (e) { flash(e.message); } };

  const monthLabel = `${MONTHS[cursor.m]} ${cursor.y}`;
  const step = (n) => setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const todayKey = ymd(today);
  const conflictCount = Object.keys(data.conflicts).length;

  return (
    <>
      <div className="topbar">
        <div className="who"><h2>Calendar</h2>
          <div className="sub">{conflictCount ? `${conflictCount} day${conflictCount === 1 ? '' : 's'} with clashes this view` : 'Deadlines and team events'}</div></div>
        <div className="topbar-actions">
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous month">‹</button>
            <button className="btn sm" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</button>
            <button className="icon-btn" onClick={() => step(1)} aria-label="Next month">›</button>
          </div>
          <span className="cal-month">{monthLabel}</span>
          <button className="btn primary" onClick={() => setModal({ date: todayKey })}>Add event</button>
        </div>
      </div>
      <div className="content">
        <div className="cal-grid">
          {DOW.map((d) => <div className="cal-dow" key={d}>{d}</div>)}
          {grid.map((d) => {
            const key = ymd(d);
            const cell = byDay[key];
            const inMonth = d.getMonth() === cursor.m;
            const isToday = key === todayKey;
            const conflict = data.conflicts[key];
            return (
              <div className={'cal-cell' + (inMonth ? '' : ' dim') + (isToday ? ' today' : '')} key={key}
                   onClick={(e) => { if (e.target.classList.contains('cal-cell') || e.target.classList.contains('cal-daynum')) setModal({ date: key }); }}>
                <div className="cal-dayhead">
                  <span className="cal-daynum">{d.getDate()}</span>
                  {conflict && <span className="cal-conflict" title={conflict === 'deadline_during_event' ? 'Deadline falls on an event day' : 'Several deadlines this day'}>⚠</span>}
                </div>
                {cell.events.map((ev) => (
                  <button className={'cal-event ' + ev.type} key={'e' + ev.id} onClick={() => setModal({ event: ev })} title={ev.title}>
                    {ev.allDay ? '' : new Date(ev.start.replace(' ', 'T')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' '}{ev.title}
                  </button>
                ))}
                {cell.deadlines.slice(0, 4).map((dl) => (
                  <button className={'cal-deadline' + (dl.status === 'done' ? ' done' : '')} key={'d' + dl.id}
                          onClick={() => onGotoClient(dl.clientId)} title={`${dl.client}: ${dl.title}${dl.assignee ? ' · ' + dl.assignee : ''}`}>
                    <span className="cdot" style={{ background: colorFor(dl.assigneeId) }}></span>
                    <span className="ctitle">{dl.title}</span>
                  </button>
                ))}
                {cell.deadlines.length > 4 && <span className="cal-more">+{cell.deadlines.length - 4} more</span>}
              </div>
            );
          })}
        </div>
        <div className="cal-legend">
          <span><span className="lg meeting"></span>Meeting</span>
          <span><span className="lg event"></span>Event</span>
          <span><span className="lg ooo"></span>Out of office</span>
          <span><span className="cdot" style={{ background: '#869089' }}></span>Deadline (colored by assignee)</span>
          <span><span className="cal-conflict">⚠</span>Possible clash</span>
        </div>
      </div>

      {modal && <EventModal init={modal} meId={meId} onSave={save} onDelete={remove} onClose={() => setModal(null)} />}
    </>
  );
}

function EventModal({ init, meId, onSave, onDelete, onClose }) {
  const ev = init.event || null;
  const [title, setTitle] = useState(ev?.title || '');
  const [type, setType] = useState(ev?.type || 'meeting');
  const [allDay, setAllDay] = useState(ev ? ev.allDay : true);
  const baseDate = ev ? ev.start.slice(0, 10) : (init.date || ymd(new Date()));
  const [date, setDate] = useState(baseDate);
  const [start, setStart] = useState(ev && !ev.allDay ? ev.start.slice(0, 16).replace(' ', 'T') : `${baseDate}T09:00`);
  const [end, setEnd] = useState(ev && !ev.allDay ? ev.end.slice(0, 16).replace(' ', 'T') : `${baseDate}T10:00`);
  const canEdit = !ev || ev.createdBy === meId || true; // server enforces; UI permissive
  const TYPES = [['meeting', 'Meeting'], ['event', 'Event'], ['ooo', 'Out of office']];

  const submit = () => {
    if (!title.trim()) return;
    const payload = allDay
      ? { title: title.trim(), type, allDay: true, start: `${date}T00:00`, end: `${date}T23:59` }
      : { title: title.trim(), type, allDay: false, start, end };
    onSave(payload, ev?.id);
  };

  return (
    <Modal title={ev ? 'Edit event' : 'New event'} onClose={onClose} footer={
      <>
        {ev && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => onDelete(ev.id)}>Delete</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit}>{ev ? 'Save' : 'Add event'}</button>
      </>
    }>
      <div className="field"><label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client kickoff call" autoFocus /></div>
      <div className="field"><label>Type</label>
        <div className="seg">
          {TYPES.map(([t, l]) => <button key={t} type="button" className={type === t ? 'on' : ''} onClick={() => setType(t)}>{l}</button>)}
        </div></div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} style={{ width: 'auto' }} /> All day
        </label>
      </div>
      {allDay
        ? <div className="field" style={{ maxWidth: 220 }}><label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        : <div className="field-row">
            <div className="field"><label>Starts</label><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="field"><label>Ends</label><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>}
    </Modal>
  );
}
