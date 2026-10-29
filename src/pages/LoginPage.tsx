import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { Alert, Button, Card, Field, TextInput } from '../components/ui.js';
import { supabase } from '../lib/supabase.js';

type Mode = 'signin' | 'signup' | 'reset';

export default function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'reset') {
        const { error: resetError } = await supabase().auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/login`,
        });
        if (resetError) throw resetError;
        setNotice('Password reset email sent. Open the link in that email to choose a new password.');
        return;
      }

      if (mode === 'signup') {
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const { data, error: signUpError } = await supabase().auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() || undefined } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice(
            'Account created. Check your inbox for the confirmation email, then sign in here. (Your invited projects will be linked automatically when you sign in.)',
          );
          setMode('signin');
          return;
        }
        navigate('/', { replace: true });
        return;
      }

      const { error: signInError } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw signInError;
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth__pitch">
        <div className="brand" style={{ color: '#fff' }}>
          <span className="brand__mark">TP</span> TeamPilot AI
        </div>
        <h1>Group projects, planned fairly.</h1>
        <p>
          TeamPilot turns your problem statement into a realistic task plan, shares the hours out by skill and
          availability, and keeps everyone in one real-time chat.
        </p>
        <ul>
          <li>AI drafts the plan — you approve it before anything is saved</li>
          <li>Workload shown in hours per person, not just task counts</li>
          <li>Private to your team through Supabase Row Level Security</li>
          <li>Readiness score you can explain to your supervisor</li>
        </ul>
      </aside>

      <main className="auth__main">
        <div className="auth__card">
          <div className="stack">
            <div>
              <h2 style={{ margin: 0 }}>
                {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset password'}
              </h2>
              <p className="muted small" style={{ marginTop: 4 }}>
                {mode === 'signin'
                  ? 'Sign in with the email you gave your project owner.'
                  : mode === 'signup'
                    ? 'One account per person. Invitations are matched by email.'
                    : 'We will email you a secure link to set a new password.'}
              </p>
            </div>

            {error ? <Alert tone="error">{error}</Alert> : null}
            {notice ? <Alert tone="ok">{notice}</Alert> : null}

            <form className="stack" onSubmit={submit}>
              {mode === 'signup' ? (
                <Field label="Full name">
                  <TextInput
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Aarav Sharma"
                    autoComplete="name"
                  />
                </Field>
              ) : null}

              <Field label="College email">
                <TextInput
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@college.edu"
                  autoComplete="email"
                />
              </Field>

              {mode !== 'reset' ? (
                <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
                  <TextInput
                    type="password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  />
                </Field>
              ) : null}

              <Button type="submit" variant="primary" block loading={busy}>
                {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
              </Button>
            </form>

            <div className="row row--between small">
              {mode === 'signin' ? (
                <>
                  <button type="button" className="linkbtn" onClick={() => setMode('signup')}>
                    Create an account
                  </button>
                  <button type="button" className="linkbtn" onClick={() => setMode('reset')}>
                    Forgot password?
                  </button>
                </>
              ) : (
                <button type="button" className="linkbtn" onClick={() => setMode('signin')}>
                  ← Back to sign in
                </button>
              )}
            </div>
          </div>
        </div>

        <Card>
          <div className="card__body stack small muted">
            <strong style={{ color: 'var(--text)' }}>First time here?</strong>
            <span>
              New accounts start with no projects. Create one from the dashboard, or ask a teammate for their project
              email invitation — you will join it the first time you sign in with that address.
            </span>
            <Link to="/login" className="small">
              Need help?
            </Link>
          </div>
        </Card>
      </main>
    </div>
  );
}
