import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { DateWarn } from '../dateflags.jsx';

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

export function TaskModal({ task, members = [], holidays = [], onSave, onClose }) {
  const editing = !!task;
  const [title, setTitle] = useState(task?.title || '');
  const [detail, setDetail] = useState(task?.detail || '');
  const [notes, setNotes] = useState(task?.notes || '');
  const [dueDate, setDueDate] = useState(task?.dueDate || '');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [priority, setPriority] = useState(task?.priority || 'medium');
  const [estHours, setEstHours] = useState(task?.estHours ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId || '');
  const [reviewWithId, setReviewWithId] = useState(task?.reviewWithId || '');
  return (
    <Modal title={editing ? 'Edit task' : 'New task'} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => title.trim() &&
          onSave({ title: title.trim(), detail: detail.trim(), notes: notes.trim(), dueDate: dueDate || null, status, priority, estHours: estHours === '' ? null : Math.max(1, parseInt(estHours, 10) || 1), assigneeId: assigneeId || null, reviewWithId: reviewWithId || null })}>
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
          <input type="date" value={dueDate || ''} onChange={(e) => setDueDate(e.target.value)} />
          <DateWarn date={dueDate} holidays={holidays} /></div>
      </div>
      <div className="field"><label>Review with <span className="hint">— optional; adds it to your Reviews tab</span></label>
        <select value={reviewWithId} onChange={(e) => setReviewWithId(e.target.value)}>
          <option value="">No one</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
        </select></div>
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
