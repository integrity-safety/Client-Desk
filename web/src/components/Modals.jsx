import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const STATUSES = [
  ['todo', 'To do'], ['inprogress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done'],
];

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target.classList.contains('overlay')) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel, danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={'btn ' + (danger ? 'danger' : 'primary')}
                onClick={() => { onClose(); onConfirm(); }}>{confirmLabel || 'Confirm'}</button>
      </>
    }>
      <p style={{ margin: 0, color: 'var(--ink-soft)', fontSize: '14.5px', lineHeight: 1.55 }}>{message}</p>
    </Modal>
  );
}

export function ClientModal({ client, onSave, onDelete, onClose }) {
  const editing = !!client;
  const [name, setName] = useState(client?.name || '');
  const [email, setEmail] = useState(client?.email || '');
  return (
    <Modal title={editing ? 'Edit client' : 'New client'} onClose={onClose} footer={
      <>
        {editing && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={onDelete}>Delete client</button>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => name.trim() && onSave({ name: name.trim(), email: email.trim() })}>
          {editing ? 'Save' : 'Add client'}</button>
      </>
    }>
      <div className="field"><label>Client name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northwind Studio" autoFocus /></div>
      <div className="field"><label>Contact email <span className="hint">— used as the “To” on reports</span></label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div>
    </Modal>
  );
}

export function TaskModal({ task, members = [], onSave, onClose }) {
  const editing = !!task;
  const [title, setTitle] = useState(task?.title || '');
  const [detail, setDetail] = useState(task?.detail || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [priority, setPriority] = useState(task?.priority || 'medium');
  const [estHours, setEstHours] = useState(task?.estHours ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || '');
  return (
    <Modal title={editing ? 'Edit task' : 'New task'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => title.trim() &&
          onSave({ title: title.trim(), detail: detail.trim(), notes: notes.trim(), dueDate: dueDate || null, status, priority, estHours: estHours === '' ? null : Math.max(1, parseInt(estHours, 10) || 1), assigneeId: assigneeId || null })}>
          {editing ? 'Save task' : 'Add task'}</button>
      </>
    }>
      <div className="field"><label>Task <span className="hint">— shown to the client in reports</span></label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Draft homepage copy" autoFocus /></div>
      <div className="field"><label>Detail <span className="hint">— optional, also client-facing</span></label>
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} /></div>
      <div className="field-row">
        <div className="field"><label>Status</label>
          <div className="seg">
            {STATUSES.map(([s, l]) => (
              <button key={s} type="button" className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                <span className={'d dot ' + s}></span>{l}</button>
            ))}
          </div></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Priority</label>
          <div className="seg priorities">
            {[['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([p, l]) => (
              <button key={p} type="button" className={(priority === p ? 'on ' : '') + 'prio-' + p} onClick={() => setPriority(p)}>{l}</button>
            ))}
          </div></div>
        <div className="field" style={{ maxWidth: 150 }}><label>Est. hours <span className="hint">— internal</span></label>
          <input type="number" min="1" step="1" value={estHours}
            onChange={(e) => setEstHours(e.target.value)} placeholder="—" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>Assigned to</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select></div>
        <div className="field"><label>Due date <span className="hint">— optional</span></label>
          <input type="date" value={dueDate || ''} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>Private note <span className="hint">— internal only, never in reports</span></label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Just for you" /></div>
    </Modal>
  );
}

const fmtLong = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });

function section(title, st, items, empty) {
  return (
    <div className="rsec">
      <h4><span className={'d dot ' + st}></span>{title}</h4>
      {items.length
        ? <ul>{items.map((t, i) => <li key={i}>{t.title}{t.detail && <span className="det">{t.detail}</span>}</li>)}</ul>
        : <p className="none">{empty}</p>}
    </div>
  );
}

export function ReportModal({ client, onClose }) {
  const today = new Date(); const todayStr = today.toLocaleDateString('en-CA');
  const [asOf, setAsOf] = useState(todayStr);
  const [data, setData] = useState(null);
  const [to, setTo] = useState(client.email || '');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');

  useEffect(() => {
    let live = true;
    api.report(client.id, asOf).then((d) => {
      if (!live) return;
      setData(d);
      setSubject(`Update — ${new Date(asOf + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
      setBodyText(buildEmail(client, d, asOf));
    });
    return () => { live = false; };
  }, [asOf, client]);

  const openMail = () => {
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${bodyText}`); } catch { /* */ }
  };

  return (
    <Modal title="Client report" wide onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p className="report-meta">{client.name}{data && ` · covering ${fmtLong(data.from)} – ${fmtLong(data.to)}`}</p>
      <div className="field" style={{ maxWidth: 240 }}>
        <label>As of <span className="hint">— reports the 7 days up to this date</span></label>
        <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <div className="report-doc">
        {data ? <>
          {section('Completed in this period', 'done', data.completed, 'Nothing marked done in this 7-day window.')}
          {section('Currently in progress', 'inprogress', data.inprogress, 'Nothing currently in progress.')}
          {section('Needs your input', 'blocked', data.blocked, 'Nothing waiting on the client right now.')}
        </> : <p className="none">Loading…</p>}
      </div>
      <p className="draft-label">Email draft — edit anything before you send</p>
      <div className="draft">
        <div className="field"><label>To</label>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@company.com" /></div>
        <div className="field"><label>Subject</label>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="field"><label>Message</label>
          <textarea style={{ minHeight: 230 }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} /></div>
        <div className="draft-actions">
          <button className="btn primary" onClick={openMail}>Open in email</button>
          <button className="btn" onClick={copy}>Copy email</button>
        </div>
      </div>
    </Modal>
  );
}

function buildEmail(client, d, asOf) {
  const first = (client.name || 'there').split(/\s+/)[0];
  const L = [`Hi ${first},`, '', `Here's your update as of ${fmtLong(asOf)}.`, ''];
  const block = (head, items) => { if (items.length) { L.push(head); items.forEach((t) => L.push(`  • ${t.title}${t.detail ? ` — ${t.detail}` : ''}`)); L.push(''); } };
  block('COMPLETED IN THIS PERIOD', d.completed);
  block('CURRENTLY IN PROGRESS', d.inprogress);
  block('NEEDS YOUR INPUT', d.blocked);
  if (!d.completed.length && !d.inprogress.length && !d.blocked.length) { L.push('No items to report for this period.'); L.push(''); }
  L.push('Happy to talk through any of this — just let me know.', '', 'Best,', '[Your name]');
  return L.join('\n');
}

export function ShareModal({ onClose }) {
  const [scope, setScope] = useState('mine');
  const [groups, setGroups] = useState(null);
  const [bodyText, setBodyText] = useState('');
  useEffect(() => {
    setGroups(null);
    api.share(scope).then((d) => {
      setGroups(d.groups);
      setBodyText(buildStandup(d.groups, scope));
    });
  }, [scope]);
  const copy = async () => { try { await navigator.clipboard.writeText(bodyText); } catch { /* */ } };

  return (
    <Modal title="Share my day" wide onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="scope-toggle">
        <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>My day</button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Whole team</button>
      </div>
      <div className="report-doc">
        {groups === null ? <p className="none">Loading…</p>
          : groups.length === 0 ? <p className="none" style={{ margin: '4px 0' }}>Nothing in progress or due today — nothing to share yet.</p>
          : groups.map((g, i) => (
            <div className="rsec" key={i}>
              <h4><span className="d dot inprogress"></span>{g.client}</h4>
              <ul>{g.tasks.map((t, j) => <li key={j}>{t.title}{t.dueToday && <span className="tag-due">due today</span>}{t.detail && <span className="det">{t.detail}</span>}</li>)}</ul>
            </div>
          ))}
      </div>
      <p className="draft-label">Message draft — edit before you send</p>
      <div className="draft">
        <div className="field"><label>Message</label>
          <textarea style={{ minHeight: 230 }} value={bodyText} onChange={(e) => setBodyText(e.target.value)} /></div>
        <div className="draft-actions"><button className="btn primary" onClick={copy}>Copy message</button></div>
        <p className="share-hint">Paste into Slack, Teams, or email.</p>
      </div>
    </Modal>
  );
}

function buildStandup(groups, scope) {
  const who = scope === 'all' ? "what the team is working on today" : "what I'm working on today";
  const L = ['Hi [name],', '', `Here's ${who} — ${new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric' })}:`, ''];
  if (!groups.length) L.push('Nothing actively in progress or due today right now.', '');
  else groups.forEach((g) => { L.push(`${g.client}:`); g.tasks.forEach((t) => L.push(`  • ${t.title}${t.dueToday ? ' (due today)' : ''}${t.detail ? ` — ${t.detail}` : ''}`)); L.push(''); });
  L.push('Let me know if anything needs to shift.', '', 'Thanks,', '[Your name]');
  return L.join('\n');
}

export function ImportModal({ onImport, onClose }) {
  const [text, setText] = useState('');
  return (
    <Modal title="Import backup" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p style={{ margin: '0 0 12px', color: 'var(--ink-soft)', fontSize: '13.5px' }}>
        Paste a Client Desk (V1) backup below. It adds those clients and tasks to your workspace.</p>
      <div className="field"><textarea value={text} onChange={(e) => setText(e.target.value)}
        placeholder="Paste backup JSON here…" style={{ minHeight: 220, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '12.5px' }} /></div>
      <div className="draft-actions"><button className="btn primary" onClick={() => onImport(text)}>Import</button></div>
    </Modal>
  );
}
