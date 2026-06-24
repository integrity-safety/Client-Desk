import React, { useState } from 'react';
import { api, setCsrf } from '../api.js';

// Handles sign-in, the one-time first-run setup (first user becomes admin),
// and the self-service "forgot password" request.
export default function Login({ needsSetup, onAuthed }) {
  const mode = needsSetup ? 'setup' : 'login';
  const [view, setView] = useState('login'); // login | forgot
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = mode === 'setup'
        ? await api.register({ name, email, password })
        : await api.login({ email, password });
      setCsrf(res.csrf);
      onAuthed(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const forgotSubmit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.forgot(email);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // --- Forgot-password sub-view ---
  if (view === 'forgot') {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-brand">Client <span className="mark">Desk</span></h1>
          {sent ? (
            <>
              <p className="auth-sub">If an account exists for <b>{email}</b>, a reset link is on its way. It expires in 1 hour.</p>
              <p className="auth-sub" style={{ fontSize: 13 }}>Didn't get it? Check spam, or ask an admin to send you a reset link.</p>
              <button className="btn primary block" onClick={() => { setView('login'); setSent(false); setError(''); }}>Back to sign in</button>
            </>
          ) : (
            <>
              <p className="auth-sub">Enter your email and we'll send a link to set a new password.</p>
              <form onSubmit={forgotSubmit}>
                <div className="field">
                  <label htmlFor="femail">Email</label>
                  <input id="femail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
              </form>
              <button className="auth-link" onClick={() => { setView('login'); setError(''); }}>Back to sign in</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- Sign-in / setup view ---
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-brand">Client <span className="mark">Desk</span></h1>
        <p className="auth-sub">
          {mode === 'setup' ? 'Set up your account to get started.' : 'Sign in to your workspace.'}
        </p>
        <form onSubmit={submit}>
          {mode === 'setup' && (
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} required />
            {mode === 'setup' && <span className="hint">At least 8 characters.</span>}
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary block" type="submit" disabled={busy}>
            {busy ? 'One moment…' : (mode === 'setup' ? 'Create account' : 'Sign in')}
          </button>
        </form>
        {mode === 'login' && (
          <button className="auth-link" onClick={() => { setView('forgot'); setError(''); setPassword(''); }}>Forgot password?</button>
        )}
      </div>
    </div>
  );
}

// Shown when someone opens an invite link (?invite=TOKEN). They set their name
// and password; the email is fixed to whatever was invited.
export function AcceptInvite({ token, onAuthed, onInvalid }) {
  const [info, setInfo] = useState(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    api.inviteInfo(token).then((r) => {
      if (!r.valid) { onInvalid(); return; }
      setInfo(r);
    }).catch(() => onInvalid());
  }, [token, onInvalid]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await api.acceptInvite({ token, name, password });
      setCsrf(res.csrf);
      onAuthed(res.user);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  if (!info) return <div className="boot">Loading invitation…</div>;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-brand">Client <span className="mark">Desk</span></h1>
        <p className="auth-sub">You've been invited to join <b>{info.workspace}</b> as {info.email}. Set a password to finish.</p>
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="iname">Your name</label>
            <input id="iname" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
          <div className="field"><label htmlFor="ipw">Password</label>
            <input id="ipw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
            <span className="hint">At least 8 characters.</span></div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'One moment…' : 'Join the team'}</button>
        </form>
      </div>
    </div>
  );
}

// Shown when someone opens a password-reset link (?reset=TOKEN). Validates the
// token, takes a new password, and on success sends them back to sign in.
export function ResetPassword({ token, onDone }) {
  const [state, setState] = useState('checking'); // checking | invalid | form | done
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    api.resetInfo(token)
      .then((r) => setState(r.valid ? 'form' : 'invalid'))
      .catch(() => setState('invalid'));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await api.resetPassword(token, password);
      setState('done');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-brand">Client <span className="mark">Desk</span></h1>
        {state === 'checking' && <p className="auth-sub">Checking your reset link…</p>}
        {state === 'invalid' && (
          <>
            <p className="auth-sub">This reset link is invalid or has expired. Reset links last 1 hour — request a new one from the sign-in screen.</p>
            <button className="btn primary block" onClick={onDone}>Back to sign in</button>
          </>
        )}
        {state === 'form' && (
          <>
            <p className="auth-sub">Set a new password for your account.</p>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="npw">New password</label>
                <input id="npw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required autoFocus />
                <span className="hint">At least 8 characters.</span>
              </div>
              {error && <p className="auth-error">{error}</p>}
              <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set new password'}</button>
            </form>
          </>
        )}
        {state === 'done' && (
          <>
            <p className="auth-sub">Your password has been updated, and you've been signed out on any other devices. Sign in with your new password.</p>
            <button className="btn primary block" onClick={onDone}>Go to sign in</button>
          </>
        )}
      </div>
    </div>
  );
}
