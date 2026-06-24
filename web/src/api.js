// Thin API client. Session is a same-origin cookie (sent automatically);
// writes carry the CSRF token returned by /auth/me or /auth/login.

let csrf = null;
export function setCsrf(t) { csrf = t; }

async function req(method, path, bodyObj) {
  const headers = {};
  const opts = { method, credentials: 'same-origin', headers };
  if (bodyObj !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(bodyObj);
  }
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  me:        () => req('GET', '/auth/me'),
  register:  (d) => req('POST', '/auth/register', d),
  login:     (d) => req('POST', '/auth/login', d),
  logout:    () => req('POST', '/auth/logout', {}),
  inviteInfo:   (token) => req('GET', `/auth/invite?token=${encodeURIComponent(token)}`),
  acceptInvite: (d) => req('POST', '/auth/accept-invite', d),
  forgot:        (email) => req('POST', '/auth/forgot', { email }),
  resetInfo:     (token) => req('GET', `/auth/reset?token=${encodeURIComponent(token)}`),
  resetPassword: (token, password) => req('POST', '/auth/reset', { token, password }),

  team:         () => req('GET', '/team'),
  invite:       (d) => req('POST', '/team/invite', d),
  revokeInvite: (id) => req('DELETE', `/team/invite/${id}`, {}),
  setRole:      (id, role) => req('PATCH', `/team/member/${id}`, { role }),
  removeMember: (id) => req('DELETE', `/team/member/${id}`, {}),
  memberReset:  (id) => req('POST', `/team/member/${id}/reset`, {}),

  clients:      () => req('GET', '/clients'),
  createClient: (d) => req('POST', '/clients', d),
  updateClient: (id, d) => req('PATCH', `/clients/${id}`, d),
  deleteClient: (id) => req('DELETE', `/clients/${id}`, {}),

  tasks:      (clientId) => req('GET', `/tasks?client=${clientId}`),
  createTask: (d) => req('POST', '/tasks', d),
  updateTask: (id, d) => req('PATCH', `/tasks/${id}`, d),
  deleteTask: (id) => req('DELETE', `/tasks/${id}`, {}),
  tasksChanges: (since) => req('GET', '/tasks/changes' + (since != null ? `?since=${since}` : '')),
  activity: (opts = {}) => {
    const q = new URLSearchParams();
    if (opts.before != null) q.set('before', opts.before);
    if (opts.actor) q.set('actor', opts.actor);
    if (opts.client) q.set('client', opts.client);
    const s = q.toString();
    return req('GET', '/activity' + (s ? `?${s}` : ''));
  },

  today:  (scope) => req('GET', `/today?scope=${scope || 'mine'}`),
  weekly: (scope) => req('GET', `/weekly?scope=${scope || 'mine'}`),
  dashboard: () => req('GET', '/dashboard'),
  dashboardUpcoming: () => req('GET', '/dashboard/upcoming'),
  report: (clientId, asOf) => req('GET', `/report/${clientId}?asOf=${asOf}`),
  share:  (scope) => req('GET', `/share?scope=${scope || 'mine'}`),
  import: (d) => req('POST', '/import', d),

  calendar:    (from, to) => req('GET', `/calendar?from=${from}&to=${to}`),
  createEvent: (d) => req('POST', '/events', d),
  updateEvent: (id, d) => req('PATCH', `/events/${id}`, d),
  deleteEvent: (id) => req('DELETE', `/events/${id}`, {}),
  setTheme:    (d) => req('POST', '/team/theme', d),

  conversations: () => req('GET', '/conversations'),
  openDm:        (userId) => req('POST', '/conversations/dm', { userId }),
  messages:      (id, after) => req('GET', `/conversations/${id}/messages?after=${after || 0}`),
  sendMessage:   (id, body) => req('POST', `/conversations/${id}/messages`, { body }),
  readConversation: (id) => req('POST', `/conversations/${id}/read`, {}),

  portalTickets:     () => req('GET', '/portal/tickets'),
  portalCreate:      (d) => req('POST', '/portal/tickets', d),
  portalTicket:      (id) => req('GET', `/portal/tickets/${id}`),
  portalReply:       (id, body) => req('POST', `/portal/tickets/${id}/messages`, { body }),

  tickets:        (clientId) => req('GET', '/tickets' + (clientId ? `?client=${clientId}` : '')),
  ticket:         (id) => req('GET', `/tickets/${id}`),
  ticketAccept:   (id, date) => req('POST', `/tickets/${id}/accept`, { date: date || null }),
  ticketDecline:  (id) => req('POST', `/tickets/${id}/decline`, {}),
  ticketReply:    (id, body) => req('POST', `/tickets/${id}/messages`, { body }),

  clientRequesters:    (id) => req('GET', `/clients/${id}/requesters`),
  requesterInvite:     (id, email) => req('POST', `/clients/${id}/requester-invite`, { email }),
  requesterRemove:     (id) => req('DELETE', `/requesters/${id}`, {}),
};
