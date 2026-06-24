import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const timeShort = (s) => new Date(s.replace(' ', 'T')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayLabel = (s) => {
  const d = new Date(s.replace(' ', 'T')); const t = new Date();
  const same = d.toDateString() === t.toDateString();
  return same ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export default function Messages({ meId, members, onConvUpdate }) {
  const [lists, setLists] = useState({ channels: [], dms: [] });
  const [active, setActive] = useState(null); // conversation object
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const [showNewDm, setShowNewDm] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef(null);

  const loadList = useCallback(() => api.conversations().then((d) => {
    setLists({ channels: d.channels, dms: d.dms });
    if (onConvUpdate) onConvUpdate(d.unreadTotal);
  }), [onConvUpdate]);

  useEffect(() => { loadList(); }, [loadList]);

  // Poll the conversation list every 8s for unread/preview updates.
  useEffect(() => {
    const t = setInterval(loadList, 8000);
    return () => clearInterval(t);
  }, [loadList]);

  // When a conversation is opened: load messages, mark read, then poll for new ones.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    lastId.current = 0;
    setMsgs([]);
    const pull = async (initial) => {
      try {
        const d = await api.messages(active.id, lastId.current);
        if (!alive || !d.messages.length) return;
        lastId.current = d.messages[d.messages.length - 1].id;
        setMsgs((m) => [...m, ...d.messages]);
        if (initial) { await api.readConversation(active.id); loadList(); }
        else { api.readConversation(active.id); }
        requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
      } catch { /* */ }
    };
    pull(true);
    const t = setInterval(() => pull(false), 3000);
    return () => { alive = false; clearInterval(t); };
  }, [active, loadList]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !active) return;
    setDraft('');
    try {
      await api.sendMessage(active.id, body);
      const d = await api.messages(active.id, lastId.current);
      if (d.messages.length) { lastId.current = d.messages[d.messages.length - 1].id; setMsgs((m) => [...m, ...d.messages]); }
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
      loadList();
    } catch { /* */ }
  };

  const startDm = async (userId) => {
    setShowNewDm(false);
    try { const r = await api.openDm(userId); await loadList(); setActive({ id: r.id, type: 'dm', label: (members.find((m) => m.id === userId) || {}).name || 'Direct message' }); }
    catch { /* */ }
  };

  const otherMembers = members.filter((m) => m.id !== meId);

  return (
    <div className="msg-wrap">
      <div className="msg-list">
        <div className="msg-sec-head">Client channels</div>
        {lists.channels.map((c) => <ConvRow key={c.id} c={c} active={active} onClick={() => setActive(c)} kind="client" />)}
        <div className="msg-sec-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Direct messages
          <button className="icon-btn" title="New message" onClick={() => setShowNewDm((s) => !s)}>
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 4v10M4 9h10" /></svg>
          </button>
        </div>
        {showNewDm && (
          <div className="newdm">
            {otherMembers.length === 0 ? <p className="none" style={{ padding: '6px 10px', margin: 0 }}>No teammates yet.</p>
              : otherMembers.map((m) => <button key={m.id} className="newdm-item" onClick={() => startDm(m.id)}>{m.name || m.email}</button>)}
          </div>
        )}
        {lists.dms.map((c) => <ConvRow key={c.id} c={c} active={active} onClick={() => setActive(c)} kind="dm" />)}
        {lists.dms.length === 0 && <p className="none" style={{ padding: '4px 12px' }}>No direct messages yet.</p>}
      </div>

      <div className="msg-thread">
        {!active ? (
          <div className="msg-empty">
            <h3>Your messages</h3>
            <p>Pick a client channel or a direct message on the left. Channels are shared with the whole team; DMs are just between you two.</p>
          </div>
        ) : (
          <>
            <div className="msg-head">
              <div>
                <span className={'conv-tag ' + (active.type === 'client' ? 'client' : 'dm')}>{active.type === 'client' ? 'Client channel' : 'Direct message'}</span>
                <h3>{active.label}</h3>
              </div>
            </div>
            <div className="msg-stream" ref={scroller}>
              {msgs.map((m, i) => {
                const mine = m.authorId === meId;
                const showDay = i === 0 || dayLabel(msgs[i - 1].createdAt) !== dayLabel(m.createdAt);
                return (
                  <React.Fragment key={m.id}>
                    {showDay && <div className="msg-daydiv"><span>{dayLabel(m.createdAt)}</span></div>}
                    <div className={'msg' + (mine ? ' mine' : '')}>
                      {!mine && <span className="msg-author">{m.author}</span>}
                      <div className="msg-bubble">{m.body}</div>
                      <span className="msg-time">{timeShort(m.createdAt)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
              {msgs.length === 0 && <p className="none" style={{ textAlign: 'center', marginTop: 30 }}>No messages yet — say hello.</p>}
            </div>
            <div className="msg-compose">
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a message…"
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="btn primary" onClick={send}>Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConvRow({ c, active, onClick, kind }) {
  return (
    <button className={'conv-row' + (active && active.id === c.id ? ' active' : '')} onClick={onClick}>
      <span className={'conv-ico ' + kind}>{kind === 'client' ? '#' : '@'}</span>
      <span className="conv-mid">
        <span className="conv-label">{c.label}</span>
        {c.preview && <span className="conv-preview">{c.preview}</span>}
      </span>
      {c.unread > 0 && <span className="conv-unread">{c.unread}</span>}
    </button>
  );
}
